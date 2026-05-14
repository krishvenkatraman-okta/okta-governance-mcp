# Org Authorization Server Token Flow for Governance API

## The Problem

The Okta Identity Governance end-user API (`/api/v1/governance/`) only accepts tokens issued by the **Org Authorization Server** — tokens where the `iss` claim is the bare Okta domain (e.g., `https://taskvantage.okta.com`), with no `/oauth2/{id}` path.

This is different from most Okta integrations which use custom authorization servers. The Governance API enforces this because it needs to verify the identity of the actual human reviewer making certification decisions. The Org Auth Server token carries the user's real identity and is the same token type used by Okta's own Access Certification Reviews UI.

Tokens from custom authorization servers (e.g., `https://taskvantage.okta.com/oauth2/aus123...`) are rejected with:

```
www-authenticate: Bearer ... error="invalid_request",
  error_description="The authorization server id is invalid."
```

## Required Scopes

The Governance end-user API requires two Org-level OAuth scopes:

| Scope | Purpose |
|-------|---------|
| `okta.governance.reviewer.read` | List campaigns, review items, stats |
| `okta.governance.reviewer.manage` | Submit approve/revoke decisions |

These are **Org Authorization Server scopes** — they don't exist on custom authorization servers. They must be granted to the OIDC app via the Okta Management API:

```bash
POST /api/v1/apps/{appId}/grants
Body: {"scopeId": "okta.governance.reviewer.read", "issuer": "https://your-org.okta.com"}
```

## Two Access Paths

We have two applications that need Org AS tokens with governance scopes:

### Path 1: MCP Adapter → Governance MCP Server (Claude Code / MCP Clients)

```
┌──────────┐     ┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Claude    │────▶│  MCP Adapter  │────▶│  Governance MCP  │────▶│  Okta Gov API   │
│ Code      │     │              │     │  Server          │     │ /api/v1/gov/    │
└──────────┘     └──────────────┘     └──────────────────┘     └─────────────────┘
                       │                      │
                 User logs in via        Server validates
                 Okta OIDC (Org AS)      Org AS token, calls
                 with governance         Governance API with
                 scopes                  user's token
```

**How it works:**

1. User connects Claude Code to the MCP adapter
2. Adapter redirects user to Okta Org Auth Server for OIDC login
3. The adapter requests extra scopes via `GATEWAY_EXTRA_SCOPES` env var:
   ```
   GATEWAY_EXTRA_SCOPES=okta.governance.reviewer.read okta.governance.reviewer.manage
   ```
   These are appended to the standard `openid offline_access` scopes in the authorize request.

4. User authenticates + MFA → Okta issues an Org AS access token with the governance scopes

5. For the governance resource specifically, the adapter uses **bearer-passthrough** instead of the normal XAA token exchange. This is controlled by:
   ```
   AUTH_METHOD_OVERRIDE_OKTA_GOVERNANCE=bearer-passthrough
   ```
   Without this override, the adapter would exchange the user's Org AS token for a custom auth server token via XAA (ID-JAG), which the Governance API would reject.

6. The user's original Org AS token is forwarded directly to the Governance MCP Server

7. The MCP Server validates the Org AS token, extracts the user identity, and uses it for Governance API calls

**Why bearer-passthrough instead of XAA:**

The standard adapter flow (XAA / ID-JAG) exchanges the user's Org AS token for a custom auth server token:
```
User Org AS token → ID-JAG → Custom AS token (for resource)
```
The final token's `iss` claim points to the custom auth server, which the Governance API rejects. Bearer-passthrough skips this exchange entirely, preserving the Org AS token.

### Path 2: Cert Review Web App (Direct Browser Access)

```
┌──────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Browser   │────▶│  Cert Review App │────▶│  Okta Gov API   │
│           │     │  (Next.js)       │     │ /api/v1/gov/    │
└──────────┘     └──────────────────┘     └─────────────────┘
      │                   │
  User logs in via    App stores token
  Okta OIDC (Org AS)  in encrypted session,
  with governance +   auto-refreshes via
  offline_access      refresh_token
  scopes
```

**How it works:**

1. User clicks "Sign in with Okta" in the web app
2. next-auth redirects to the Okta Org Auth Server authorize endpoint:
   ```
   https://your-org.okta.com/oauth2/v1/authorize
     ?scope=openid profile email offline_access
            okta.governance.reviewer.read
            okta.governance.reviewer.manage
     &response_type=code
     &client_id={app_client_id}
     &redirect_uri=https://cert-review.supersafe-ai.io/api/auth/callback/okta
   ```

3. User authenticates + MFA → Okta returns an authorization code

4. next-auth exchanges the code for tokens:
   - `access_token` — Org AS token with governance scopes (1 hour TTL)
   - `refresh_token` — for automatic renewal (from `offline_access` scope)
   - `id_token` — user identity claims

5. Tokens are stored in an encrypted JWT session cookie (next-auth)

6. The app's API routes (`/api/campaigns`, `/api/reviews`, `/api/decide`) read the access token from the session and use it for Governance API calls

7. When the access token expires (checked 60 seconds before `expires_at`), the JWT callback automatically refreshes it:
   ```
   POST https://your-org.okta.com/oauth2/v1/token
   Body: grant_type=refresh_token
         &refresh_token={stored_refresh_token}
         &client_id={app_client_id}
         &client_secret={app_client_secret}
   ```

## Adapter Patches (Bearer Passthrough)

Two patches to the MCP Adapter v0.14.0 enable the bearer-passthrough flow:

### Patch 1: `resource_token_resolver.py` — Auth Method Override

Added at the top of `resolve_auth_headers()`:

```python
import os
config = getattr(resource_config, "config", {}) or {}
env_key = f"AUTH_METHOD_OVERRIDE_{resource_name.upper().replace('-', '_')}"
override = config.get("auth_method_override") or os.environ.get(env_key)
if override:
    auth_method = override
```

This checks for an environment variable like `AUTH_METHOD_OVERRIDE_OKTA_GOVERNANCE=bearer-passthrough`. When set, it overrides the auto-derived `okta-cross-app` auth method, causing the adapter to skip XAA token exchange and forward the user's Org AS token directly.

### Patch 2: `app.py` — Extra OIDC Scopes

Added in the OAuth authorize handler:

```python
extra_scopes = os.environ.get("GATEWAY_EXTRA_SCOPES", "")
if extra_scopes:
    existing = set(scope.split())
    for s in extra_scopes.split():
        existing.add(s)
    scope = " ".join(sorted(existing))
```

This appends governance scopes to every OIDC authorize request. Without this, the adapter only requests `openid offline_access`, and the resulting Org AS token wouldn't have permission to call the Governance API.

## MCP Server Token Validation

The Governance MCP Server validates both custom auth server tokens (for MCP protocol auth) and Org AS tokens (for bearer-passthrough). Two changes were required:

### Token Router (`token-router.ts`)

Added detection of bare domain issuers:

```typescript
const orgUrl = `https://${config.okta.domain}`;
if (issuer === orgUrl) {
  return 'ORG_OR_DEFAULT_AUTH_SERVER';
}
```

Org AS tokens have `iss: "https://org.okta.com"` (no `/oauth2/` path), which didn't match the existing custom AS issuer check.

### OAuth Token Validator (`okta-token-validator.ts`)

Added dynamic JWKS resolution based on the token's issuer:

```typescript
function resolveValidationParams(token: string) {
  const issuer = jwt.decode(token)?.iss;
  const orgUrl = `https://${config.okta.domain}`;

  if (issuer === orgUrl) {
    // Org AS: use /oauth2/v1/keys, skip audience validation
    return { jwksUri: `${orgUrl}/oauth2/v1/keys`, issuer };
  }
  // Custom AS: use configured JWKS and audience
  return { jwksUri: config.okta.oauth.jwksUri, issuer: config.okta.oauth.issuer, audience: config.okta.oauth.audience };
}
```

Key difference: Org AS tokens don't have a custom `aud` claim — they use the client_id (`cid`) as the audience. We skip audience validation for Org AS tokens.

## Chain of Evidence

This token flow preserves the reviewer's identity for audit compliance:

1. The user authenticates with Okta → their identity is in the Org AS token's `sub` claim
2. The token flows through to the Governance API unmodified (bearer-passthrough)
3. The Governance API records the `sub` claim's user as the decision-maker
4. Okta's system log shows the actual human reviewer for every approve/revoke action

The AI agent assists the decision, but the **human reviewer's identity** is the one recorded. No service account impersonation occurs at any point in the flow.

## Okta Configuration Checklist

### For MCP Adapter Path

| Component | Configuration |
|-----------|---------------|
| **OIDC App** (adapter relay) | Grant `okta.governance.reviewer.read` + `okta.governance.reviewer.manage` on Org AS |
| **Adapter Env Vars** | `AUTH_METHOD_OVERRIDE_OKTA_GOVERNANCE=bearer-passthrough` |
| | `GATEWAY_EXTRA_SCOPES=okta.governance.reviewer.read okta.governance.reviewer.manage` |
| **Custom Auth Server** | `mcp:read` scope + `jwt-bearer` grant type policy rule (for XAA on other resources) |
| **Managed Connection** | `IDENTITY_ASSERTION_CUSTOM_AS` to the governance custom auth server |
| **MCP Server** | Token router detects Org AS issuer; OAuth validator uses Org JWKS |

### For Cert Review Web App Path

| Component | Configuration |
|-----------|---------------|
| **OIDC App** (web app) | Grant `okta.governance.reviewer.read` + `okta.governance.reviewer.manage` on Org AS |
| | Redirect URI: `https://cert-review.supersafe-ai.io/api/auth/callback/okta` |
| | Grant types: `authorization_code`, `refresh_token` |
| **next-auth Config** | Scopes: `openid profile email offline_access okta.governance.reviewer.read okta.governance.reviewer.manage` |
| | JWT callback: stores `access_token`, `refresh_token`, `expires_at` |
| | Auto-refresh: calls `/oauth2/v1/token` with `grant_type=refresh_token` before expiry |

## Debugging Tips

| Symptom | Cause | Fix |
|---------|-------|-----|
| `invalid_request: authorization server id is invalid` | Token is from custom AS, not Org AS | Use bearer-passthrough or authenticate against Org AS directly |
| `403` on `/api/v1/governance/` | Token missing governance scopes | Grant `okta.governance.reviewer.read/manage` to the OIDC app |
| Adapter returns 0 tools for governance resource | XAA exchange producing custom AS token, MCP server returning 401 | Set `AUTH_METHOD_OVERRIDE_OKTA_GOVERNANCE=bearer-passthrough` |
| Token expires after 1 hour, no auto-refresh | `offline_access` scope not requested | Add `offline_access` to OIDC scope request; sign out and back in to get refresh token |
| `access_denied: Policy evaluation failed` on XAA Step 3 | Custom auth server missing `jwt-bearer` grant type | Add policy rule with `urn:ietf:params:oauth:grant-type:jwt-bearer` and `scopes: ["*"]` |
| MCP server rejects Org AS token | Token router doesn't recognize bare domain issuer | Add check for `issuer === https://{domain}` in token-router.ts |

# Certification Review MCP Tools — Status

**Date**: 2026-05-09
**Repo**: krishvenkatraman-okta/okta-governance-mcp
**Deployed at**: https://governance-mcp.supersafe-ai.io

## Summary

Three MCP tools for AI-assisted access certification review are implemented, deployed, and tested end-to-end. These tools allow an AI agent (via any MCP client) to list a reviewer's pending certification items, analyze risk context, and submit approve/revoke decisions.

## Tools

### 1. `list_my_certification_reviews` — Working
Lists pending review items assigned to the authenticated user. Filters by campaign, decision status, and reviewer identity.

**Token**: Service app (Org Auth Server) — uses `ACCESS_CERTIFICATIONS_ADMIN` role
**API**: `GET /governance/api/v1/reviews` (admin path)

### 2. `get_certification_review_detail` — Working
Returns full review item detail including:
- Principal profile (who is being reviewed)
- Entitlement/app details with active entitlement values
- Risk items (past governance decisions, assignment method, usage history, user profile changes)
- SOD conflicts
- **AI recommendation** (`govAnalyzerRecommendationContext.recommendedReviewDecision`)
- Multi-level reviewer chain
- Contextual info (group memberships, app usage)

**Token**: Service app (Org Auth Server) — uses `ACCESS_CERTIFICATIONS_ADMIN` role
**API**: `GET /governance/api/v1/reviews/{id}` (admin path)

### 3. `submit_certification_decision` — Working
Submits approve/revoke decision for a review item as the authenticated reviewer.

**Token**: User token from **Org Authorization Server** with `okta.governance.reviewer.manage` scope
**API**: `PUT /api/v1/governance/campaigns/{id}/reviewItems/me` (end-user path)
**Body**:
```json
{
  "decisions": [{"reviewItemId": "...", "decision": "APPROVE"|"REVOKE"}],
  "reviewerLevelId": "ONE",
  "note": "Optional justification"
}
```

## Architecture — Dual API Paths

The Okta Governance API uses **two different base paths**:

| Path | Context | Token | Used For |
|------|---------|-------|----------|
| `/governance/api/v1/` | Admin | Service app (Org Auth Server) | List campaigns, reviews, labels |
| `/api/v1/governance/` | End-user | User OIDC (Org Auth Server) | List my items, submit decisions |

This was discovered by capturing the network trace from the Access Certification Reviews UI using Playwright.

## Token Strategy

| Operation | Token Source | Scopes |
|-----------|-------------|--------|
| List/read reviews | Service app (client_credentials) | `okta.governance.accessCertifications.read` |
| Submit decision | User OIDC (device_code or auth_code) | `okta.governance.reviewer.manage` |

### Service App
- **Client ID**: `0oa22zja6foEQ1a3j1d8` ("Governance MCP Service App")
- **Auth**: `private_key_jwt` with RSA key (PEM in ECS task def + `/tmp/governance-mcp-private.pem`)
- **Role**: `ACCESS_CERTIFICATIONS_ADMIN` (required for Governance API access)
- **Token endpoint**: `https://taskvantage.okta.com/oauth2/v1/token` (Org Auth Server)

### Reviewer Client (for user tokens)
- **Client ID**: `0oa22zovsolfmfzIC1d8` ("Governance MCP Reviewer Client")
- **Grant types**: `device_code`, `authorization_code`
- **Scopes**: `okta.governance.reviewer.read`, `okta.governance.reviewer.manage`
- **Token endpoint**: `https://taskvantage.okta.com/oauth2/v1/token` (Org Auth Server)

### MCP Auth Server (for MCP protocol auth)
- **Auth Server ID**: `aus22zgxiud01vsii1d8` ("Governance MCP Server")
- **Audience**: `api://mcp-governance`
- **Scopes**: `governance:reviews:read`, `governance:reviews:manage`, etc.
- Used for MCP client authentication, NOT for calling Okta APIs

## Infrastructure

| Component | Value |
|-----------|-------|
| ECS Cluster | `okta-governance-mcp` (us-east-2) |
| Task Definition | `okta-governance-mcp:4+` |
| Docker Image | `959737396568.dkr.ecr.us-east-2.amazonaws.com/okta-governance-mcp:latest` |
| Domain | `governance-mcp.supersafe-ai.io` |
| Deploy Workflow | `gh workflow run deploy.yml -f action=deploy` |
| GitHub Secrets | `AWS_ROLE_ARN`, `OKTA_CLIENT_ID`, `OKTA_PRIVATE_KEY_PEM`, `OKTA_OAUTH_ISSUER`, `OKTA_DOMAIN` |

## Test Campaign

- **Campaign ID**: `ici5uhiie8Ep1tacW1d6` ("MCP Tool Test Campaign")
- **Status**: ACTIVE
- **Review items**: 254 (20 assigned to test user)
- **Test user**: `mcp-testbot@atko.email` (ID: `00u22znaqasB0kke81d8`)
- **TOTP secret**: stored at `/tmp/totp-secret.txt` (`YIAL7W6STGNYEILX`)
- **Test user password**: `MCPtest1234!@#`

## Test Results

| Test | Status | Method |
|------|--------|--------|
| MCP initialize | Pass | JSON-RPC via curl |
| tools/list (9 tools) | Pass | JSON-RPC via curl |
| list_my_certification_reviews | Pass | JSON-RPC with user token |
| get_certification_review_detail | Pass | JSON-RPC with user token |
| submit_certification_decision (direct API) | Pass | curl with Org Auth Server user token |
| submit_certification_decision (via MCP) | Pending | Needs Org Auth Server user token passthrough |

## Key Bugs Fixed This Session

1. **Duplicate API path** — `governanceRequest()` prepended `/governance/api/v1` and endpoint strings also included it, resulting in doubled paths
2. **Service app 403** — Service app needed `ACCESS_CERTIFICATIONS_ADMIN` role (not just scope grants) to call Governance API
3. **Reviewer matching** — Token `sub` is email but reviewer profile uses Okta user ID; now matches both
4. **Decision endpoint** — Was using wrong method (POST→PUT), wrong path (`/governance/api/v1/` → `/api/v1/governance/`), and missing `reviewerLevelId`

## Automated Headless Auth

Playwright scripts for headless device authorization flow with TOTP:
- `scripts/device_auth_playwright.py` — Full device auth flow
- `scripts/enroll_totp_factor.py` — TOTP factor enrollment

## Completed: Adapter Integration (2026-05-11)

### Token Flow (Working End-to-End)

The adapter uses the Okta XAA (Cross-App Access) ID-JAG token exchange:
1. User authenticates to adapter via Okta Org Auth Server (OIDC)
2. Adapter exchanges user's ID token → ID-JAG (Step 1+2, Org AS)
3. Adapter exchanges ID-JAG → resource-specific token (Step 3, custom AS `aus22zgxiud01vsii1d8`)
4. Adapter forwards resource token to governance MCP server
5. MCP server validates token, resolves user identity, executes tools

**Chain of evidence preserved**: The token carries the actual human reviewer's identity (`sub` claim) through the entire flow. Okta system log shows the real user for every action.

### Critical Setup Requirements

From debugging + lessons learned from `joevanhorn/okta-mcp-demo`:

1. **JWT Bearer grant type on auth server** — The XAA Step 3 uses `urn:ietf:params:oauth:grant-type:jwt-bearer`, NOT `token-exchange`. Must have a dedicated policy rule:
   ```
   Rule: "JWT Bearer Exchange (XAA Step 3)"
   Grant types: [urn:ietf:params:oauth:grant-type:jwt-bearer]
   Scopes: [*]
   ```
   **Without this**: `access_denied: Policy evaluation failed` on Step 3.

2. **`mcp:read` scope on auth server** — The adapter requests `mcp:read` as default scope. Must exist on the custom auth server AND in the policy rule.

3. **Managed Connection on AI Agent** — Custom auth server connection type (`IDENTITY_ASSERTION_CUSTOM_AS`) pointing to the governance auth server, with resource indicator `api://mcp-governance`.

4. **Resource in adapter with matching `resource_id`** — Must equal the auth server ID (`aus22zgxiud01vsii1d8`), not a UUID.

5. **Resource config metadata** — The adapter resource needs `config.connection_id`, `config.connection_type`, `config.metadata` (issuer_url, resource_indicator, authorization_server_orn) to be fully hydrated. Use the Admin UI "Import from Okta" flow to populate these.

6. **Linkage record** — Links agent + connection + resource in the adapter DB. Created by the syncer or manually via `/api/admin/linkages`.

### Adapter Resource Configuration

| Field | Value |
|-------|-------|
| name | `okta-governance` |
| resource_id | `aus22zgxiud01vsii1d8` |
| mcp_url | `https://governance-mcp.supersafe-ai.io/mcp` |
| auth_method | `okta-cross-app` |
| connection_id | `mcn230l4wb1i8kpro1d8` |
| source | `okta` (after import) |

### Okta Configuration

| Component | ID |
|-----------|-----|
| AI Agent (Product Intelligence) | `wlp22ckv04ag0130Q1d8` |
| AI Agent App | `0oa22ckrun7qkth0Y1d8` |
| Governance Auth Server | `aus22zgxiud01vsii1d8` |
| Managed Connection (Custom AS) | `mcn230l4wb1i8kpro1d8` |
| Managed Connection (MCP Server) | `mcn230kq0pjcVRLWm1d8` |
| MCP Server (UD entry) | `ems230kt10nABNER91d8` |

## Next Steps

1. **Switch list tool to end-user API** — Use `GET /api/v1/governance/campaigns/{id}/reviewItems/me` instead of admin API + client-side filtering. Pre-filtered to reviewer, includes rich contextual data.

2. **Add pagination** — End-user API supports `after` cursor. Current tool caps at 200 results.

3. **Test decision submission via adapter** — The token from XAA Step 3 is a custom auth server token, but the decision endpoint needs an Org AS token. Need to verify if the MCP server can use its service app for reads while the adapter token handles user identity.

4. **Rich review data** — The `/api/v1/governance/campaigns/{id}/reviewItems/me` endpoint returns AI recommendations, risk scores, entitlement details, and group membership context — leverage this for the agent's decision analysis.

5. **Internal API spec** — Completed at `ofcto-workforce-taskvantage/docs/okta-governance-internal-api.yaml` (OpenAPI 3.1, 9 endpoints, 11 schemas).

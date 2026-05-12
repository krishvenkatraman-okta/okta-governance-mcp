# Lessons Learned: Okta Governance MCP Certification Review Tools

Hard-won technical learnings from building AI-assisted access certification review tools that connect through an MCP adapter to the Okta Identity Governance API. Written for SEs and developers who will extend or replicate this work.

Each lesson follows a symptom/fix format where applicable.

---

## Okta Governance API

### 1. Dual API paths

Okta exposes two distinct API paths for governance operations:

| Path | Token type | Purpose |
|------|-----------|---------|
| `/governance/api/v1/` | Service app (client credentials) | Admin/bulk reads |
| `/api/v1/governance/` | End-user (Org AS bearer token) | Reviewer-scoped operations |

The admin path is for bulk reads with service app tokens. The end-user path is what the Access Certification Reviews UI uses -- it is pre-filtered to the authenticated reviewer and returns rich contextual data including risk items, AI recommendations, entitlements, and group memberships.

The decision submission endpoint **only** works on the end-user path.

- **Symptom:** `405 "endpoint does not support the provided HTTP method"` when POSTing decisions to `/governance/api/v1/.../reviewItems/me`
- **Fix:** Use `PUT /api/v1/governance/campaigns/{id}/reviewItems/me` (end-user path, PUT not POST)

### 2. Decision endpoint requires `reviewerLevelId`

Multi-level campaigns require the `reviewerLevelId` field in the decision request body. The field name is exactly `reviewerLevelId` -- not `level`, `reviewerLevel`, or `currReviewerLevel`. The value comes from the campaign's `assignedReviewerLevels` array (typically `"ONE"` for first-level review).

- **Symptom:** `400 "reviewer level is required"`
- **Discovery method:** Playwright network trace of the Access Certification Reviews UI

### 3. Service app needs ACCESS_CERTIFICATIONS_ADMIN role

OAuth scope grants alone are not sufficient. The service app must also have the `ACCESS_CERTIFICATIONS_ADMIN` admin role assigned via `POST /oauth2/v1/clients/{clientId}/roles`.

- **Symptom:** `403` on `/governance/api/v1/reviews` even with `okta.governance.accessCertifications.read` scope granted
- **Fix:** Assign the admin role to the service app via the Okta Admin API

### 4. Decision endpoint requires Org Auth Server token

The end-user Governance API only accepts tokens where `iss` equals `https://{org}.okta.com` (bare domain, no `/oauth2/` path segment). Custom authorization server tokens are rejected outright.

- **Symptom:** `"authorization server id is invalid"` when calling the end-user governance path with a custom AS token
- **Implication:** This is non-negotiable for chain of evidence -- the token must carry the real reviewer's identity from the Org Auth Server

### 5. End-user API returns AI recommendations

The end-user review items response includes Okta's built-in AI recommendation in the `govAnalyzerRecommendationContext.recommendedReviewDecision` field (values: `APPROVE` or `REVOKE`). It also includes four risk dimension scores:

- `PAST_GOVERNANCE_DECISIONS`
- `RESOURCE`
- `USAGE_HISTORY`
- `USER_RELATIONSHIP`

These are available out of the box and do not require any additional configuration beyond having OIG Access Certifications enabled.

---

## MCP Adapter Integration

### 6. jwt-bearer grant type required on auth server

XAA (Cross-Application Authentication) Step 3 uses `urn:ietf:params:oauth:grant-type:jwt-bearer`, **not** `urn:ietf:params:oauth:grant-type:token-exchange`. The custom auth server must have a dedicated policy rule that permits this grant type.

- **Symptom:** `access_denied: Policy evaluation failed` during XAA Step 3
- **Fix:** Add a policy rule with `grantTypes: ["urn:ietf:params:oauth:grant-type:jwt-bearer"]` and `scopes: ["*"]`

### 7. mcp:read scope must exist on custom auth server

The adapter requests `mcp:read` as the default scope during tool discovery. If the custom auth server does not define this scope, the token exchange fails.

- **Symptom:** `invalid_scope: One or more scopes are not configured`
- **Fix:** Create `mcp:read` as a scope on the custom auth server AND include it in the policy rule that permits the jwt-bearer grant

### 8. Bearer passthrough for Org AS tokens

The standard XAA flow produces custom auth server tokens. However, the Governance end-user API requires the user's original Org AS token (see lesson 4). The solution is to patch the adapter's `resource_token_resolver.py` to support an `auth_method_override` mechanism.

- **Implementation:** Set environment variable `AUTH_METHOD_OVERRIDE_{RESOURCE_NAME}=bearer-passthrough` on the adapter
- **Effect:** The adapter passes through the user's Org AS token directly instead of exchanging it for a custom AS token

### 9. GATEWAY_EXTRA_SCOPES for governance permissions

The adapter's OIDC login flow only requests `openid offline_access` by default. For bearer-passthrough resources that need specific Org AS scopes, you must explicitly configure additional scopes.

- **Fix:** Set `GATEWAY_EXTRA_SCOPES=okta.governance.reviewer.read okta.governance.reviewer.manage` on the adapter
- **Also required:** Grant these scopes to the adapter's OIDC application via the Okta Admin API

### 10. User must re-authenticate after scope changes

Adding scopes to the adapter configuration does not affect existing sessions. The user must disconnect and reconnect Claude Code (or whatever MCP client) to trigger a new OIDC login that requests the updated scopes.

- **Symptom:** Tools still fail with permission errors even after scopes are added
- **Fix:** Disconnect the MCP connection and reconnect to force a fresh authentication flow

### 11. Resource must match auth server ID

The adapter's syncer resolves managed connections by matching `resource_id` to the Okta auth server ID (e.g., `aus...`). Resources created with auto-generated UUIDs will not be found by the syncer.

- **Symptom:** `"Resource ausXXXX not in Resources -- unresolved"` in adapter logs
- **Fix:** Ensure the resource's `resource_id` in the adapter configuration matches the Okta custom auth server ID exactly

### 12. Connection linkages

The adapter needs linkage records (agent_id + connection_id + resource_name) for the syncer to hydrate resources. These are created automatically for Okta-synced resources, but must be created manually for resources added via the admin API.

- **Fix:** Create linkage records via `POST /api/admin/linkages` with the correct agent_id, connection_id, and resource_name

---

## MCP Server Token Validation

### 13. Org AS tokens have bare domain issuer

Tokens from the Org Auth Server have `iss: "https://org.okta.com"` (no `/oauth2/` path segment). The MCP server's token router must detect this pattern alongside the custom auth server issuer pattern (`https://org.okta.com/oauth2/{id}`).

- **Implication:** A single hardcoded issuer check will break one of the two token types. The token router needs pattern matching or a whitelist of both formats.

### 14. Dynamic JWKS resolution

The MCP server must use different JWKS endpoints depending on the token's issuer:

| Issuer pattern | JWKS endpoint |
|---------------|---------------|
| `https://org.okta.com` (Org AS) | `/oauth2/v1/keys` |
| `https://org.okta.com/oauth2/{id}` (Custom AS) | `/oauth2/{id}/v1/keys` |

- **Symptom:** Signature validation fails for one token type when the other type's JWKS URI is hardcoded
- **Fix:** Parse the issuer claim, determine which JWKS endpoint to use, and cache keys per issuer

### 15. Org AS tokens do not have an audience claim

Org Auth Server tokens use `cid` (client_id) instead of a standard `aud` claim. There is no custom audience like `api://mcp-governance`.

- **Fix:** Skip audience validation entirely for Org AS tokens, or validate against the `cid` claim if you need a check

---

## Campaign Configuration

### 16. Multi-level campaigns need 2+ reviewer levels

Okta requires a minimum of two reviewer levels when configuring a multi-level campaign. The second level must have a start day of 3 or later.

- **Symptom:** Campaign creation fails validation if only one reviewer level is specified for a multi-level campaign

### 17. Campaign creation field names

Several field values have exact string requirements that differ from what you might guess:

| Field | Correct value | Common wrong value |
|-------|--------------|-------------------|
| `resourceType` | `"APPLICATION"` | `"APP"` |
| Reviewer type | `USER`, `REVIEWER_EXPRESSION`, `GROUP`, `RESOURCE_OWNER` | `SPECIFIC_USER` |

---

## Headless Testing

### 18. Playwright for device authorization

The Okta device code flow can be automated headlessly using Playwright with a test user. The TOTP factor can be enrolled via the Okta Admin API and codes generated at runtime with `pyotp`.

- **Key detail:** The Okta Identity Engine login page uses `div[data-se="okta_password"]` selectors for authentication method selection, not standard HTML form inputs. Build your selectors accordingly.

### 19. TOTP input selector

The OIE TOTP verification page input field does not use the selector you would expect.

| Selector | Works? |
|----------|--------|
| `input[type="text"]:visible` | Yes |
| `input[name="credentials.passcode"]` | No |
| `input[autocomplete="one-time-code"]` | No |

Use the visible text input selector for reliable TOTP entry in headless automation.

### 20. End-user reviewItems/me requires `reviewerLevelId` query parameter

The `GET /api/v1/governance/campaigns/{id}/reviewItems/me` endpoint requires `reviewerLevelId` as a query parameter to return items at a specific reviewer level. Without it, the API only returns items at the user's highest assigned level — which may be empty or contain very few items.

**Symptom:** API returns only 1-3 items when the reviewer has 100+ items assigned. Items at Level 1 are invisible.

**Discovery:** Playwright network trace of the Access Certification Reviews UI showed it calls:
```
?decision=UNREVIEWED&reviewerLevelId=ONE&sortBy=resourceId&sortBy=principal.lastName&sortOrder=ASC&sortOrder=ASC&limit=50
```

**Fix:** Query each assigned reviewer level separately. Get `assignedReviewerLevels` from `campaigns/me`, then call `reviewItems/me?reviewerLevelId={level}&decision=UNREVIEWED` for each level and merge results.

**Also discovered:** The UI uses `decision=UNREVIEWED` as a query parameter, NOT as an OData `filter` expression. These are different parameters.

### 21. New endpoints discovered from UI network trace

| Endpoint | Purpose |
|----------|---------|
| `GET /campaigns/{id}/my?reviewCount=true` | Reviewer-specific campaign detail |
| `GET /campaigns/{id}/resources/me?includeOnlyResourcesInReviews=true` | Resources in the campaign for this reviewer |
| `GET /campaigns/{id}/rules/me?limit=200` | Campaign rules for this reviewer |
| `GET /campaigns/{id}/stats/my?reviewerLevelId=ONE` | Stats per reviewer level |
| `GET /campaigns/{id}/smart-review/config/me` | AI smart review configuration |
| `GET /campaigns/{id}/reviewItems/me?after=50&limit=50` | Pagination via `after` cursor |

All endpoints use the Org Auth Server token and the `/api/v1/governance/` base path.

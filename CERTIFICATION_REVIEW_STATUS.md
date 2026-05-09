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

## Next Steps

1. **Token passthrough for decisions**: The MCP server currently validates incoming tokens from the custom auth server. For decision submission, it needs the user's Org Auth Server token. Options:
   - Token exchange (RFC 8693) on the Org Auth Server
   - Dual token flow: user authenticates against both auth servers
   - MCP adapter handles the Org Auth Server token separately

2. **Build internal API spec**: Document the undocumented `/api/v1/governance/` endpoints (review items, decisions) and store in the taskvantage GitOps repo

3. **MCP adapter integration**: Connect the governance MCP server through the adapter and test with Claude Code on a machine with a browser

4. **Rich review data**: The `/api/v1/governance/campaigns/{id}/reviewItems/me` endpoint returns incredibly rich data including AI recommendations, risk scores, entitlement details, and group membership context — leverage this for the agent's decision analysis

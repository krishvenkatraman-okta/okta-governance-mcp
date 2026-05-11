# Okta Governance MCP -- Solution Overview

## Overview

This solution provides an AI-assisted access certification review workflow built on the Model Context Protocol (MCP). An AI agent assists human reviewers in processing Okta Identity Governance (OIG) certification campaigns by listing campaigns, analyzing review items with multi-dimensional risk context, providing recommendations, and submitting approve/revoke decisions -- all while preserving the reviewer's chain of evidence in Okta's audit trail.

The system exposes Okta Governance operations as MCP tools, allowing any MCP-compatible client (Claude Code, Cursor, VS Code with Copilot, etc.) to drive the review process. The reviewer authenticates with their own Okta identity, and every certification decision is recorded under that identity in the Okta system log.

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Claude Code  │────>│  MCP Adapter  │────>│  Governance MCP  │────>│  Okta Governance │
│ (MCP Client) │     │  (OAuth 2.1)  │     │     Server       │     │      API         │
└─────────────┘     └──────────────┘     └──────────────────┘     └─────────────────┘
       │                    │                      │                        │
  Human reviewer      Token management       Tool execution          Identity source
  interacts here     bearer-passthrough     3 cert review tools    of truth for
                    preserves user identity + admin API tools     access decisions
```

### Components

**1. MCP Client (Claude Code, Cursor, etc.)**

The AI agent interface where the human reviewer works. The user authenticates via Okta OIDC through the adapter layer. All tool invocations are initiated by the reviewer and routed through the adapter. The AI agent analyzes certification data, surfaces risk signals, and formulates recommendations, but every decision action requires explicit human approval.

**2. MCP Adapter (Okta MCP Adapter v0.14.0)**

An OAuth 2.1 gateway that serves three functions:

- Authenticates users via Okta OIDC and manages session tokens
- Performs token exchange for downstream MCP server resources (XAA flow for custom auth server tokens, bearer-passthrough for Org Auth Server tokens)
- Consolidates tools from multiple MCP servers into a single tool namespace for the client

The adapter is patched with bearer-passthrough support for the governance resource. This ensures the user's Org Authorization Server token -- carrying their real identity -- is forwarded to the Governance MCP Server instead of being exchanged for a custom auth server token.

**3. Governance MCP Server (this repository)**

A Node.js/TypeScript server that exposes Okta Governance operations as MCP tools over HTTP (Streamable HTTP transport). It validates tokens from two issuers:

- **Custom Auth Server tokens** (from the XAA flow) -- used for MCP protocol authentication and authorization context resolution
- **Org Auth Server tokens** (from bearer-passthrough) -- used for calling the end-user Governance API with the reviewer's identity

The server maintains two API client paths: a service app client (private_key_jwt, client credentials) for admin API reads, and a passthrough path that forwards the user's token for end-user API operations.

**4. Okta Identity Governance**

The authoritative platform for access certifications. Exposes two API surfaces:

| API Surface | Base Path | Token Source | Purpose |
|---|---|---|---|
| Admin API | `/governance/api/v1/` | Service app (client credentials) | List campaigns, reviews, labels; bulk operations |
| End-user API | `/api/v1/governance/` | User's Org AS token (OIDC) | Reviewer-scoped data, submit decisions, rich contextual info |

The end-user API is the same API surface used by Okta's Access Certification Reviews UI. It returns data pre-filtered to the authenticated reviewer, including risk items, AI recommendations, entitlement details, SOD conflicts, and assignment context that the admin API does not provide.

---

## Token Flow

### Dual-Token Architecture

The solution requires two distinct tokens because the Okta Governance API has different authentication requirements for different operations:

```
                        ┌─────────────────────────────────┐
                        │         Okta Adapter             │
                        │                                  │
  User logs in ────────>│  1. OIDC login (Org AS)          │
                        │     -> user gets Org AS token    │
                        │     -> scopes: okta.governance.  │
                        │        reviewer.read/manage      │
                        │                                  │
                        │  2. XAA exchange (Custom AS)     │
                        │     -> ID-JAG -> custom AS token │
                        │     -> scope: mcp:read           │
                        │                                  │
  Tool call ───────────>│  3. Route to MCP server:         │
                        │     a) Custom AS token -> auth   │
                        │     b) Org AS token -> passthru  │
                        └─────────────────────────────────┘
                                       │
                                       v
                        ┌─────────────────────────────────┐
                        │     Governance MCP Server        │
                        │                                  │
                        │  Validates custom AS token for   │
                        │  MCP protocol authentication     │
                        │                                  │
                        │  Forwards Org AS token to        │
                        │  end-user Governance API calls   │
                        └─────────────────────────────────┘
```

**MCP Protocol Auth (Custom Auth Server token via XAA)**

The adapter performs an Identity Assertion (ID-JAG) exchange with the custom authorization server. This produces a token with the `mcp:read` scope that the Governance MCP Server uses for:

- Authenticating the MCP protocol connection
- Resolving the user's authorization context (subject, roles, capabilities)
- Gating access to administrative tools based on the user's Okta roles

**Governance API Auth (Org Auth Server token via bearer-passthrough)**

The adapter forwards the user's Org Authorization Server token directly to the Governance MCP Server without exchange. This token carries:

- The reviewer's real user identity (`sub` claim = Okta user ID)
- Governance-specific scopes: `okta.governance.reviewer.read`, `okta.governance.reviewer.manage`

This token is used for all end-user Governance API calls (`/api/v1/governance/`), including listing review items and submitting certification decisions.

**Why bearer-passthrough is required:**

The Governance end-user API only accepts tokens issued by the Org Authorization Server. The standard XAA flow produces custom auth server tokens, which the Governance API rejects. More importantly, chain of evidence compliance requires that every certification decision be recorded under the real reviewer's identity -- not a service app or intermediary identity. Bearer-passthrough ensures the user's original Org AS token, with their real `sub` claim, reaches the Governance API.

### Environment Variables Controlling Token Flow

| Variable | Value | Purpose |
|---|---|---|
| `AUTH_METHOD_OVERRIDE_OKTA_GOVERNANCE` | `bearer-passthrough` | Tells the adapter to forward the Org AS token to this resource instead of performing XAA exchange |
| `GATEWAY_EXTRA_SCOPES` | `okta.governance.reviewer.read okta.governance.reviewer.manage` | Adds governance scopes to the adapter's OIDC login request so the Org AS token includes them |

---

## MCP Tools

### Certification Review Tools (End-User API)

These three tools form the core certification review workflow. All require the reviewer's Org Auth Server token (via bearer-passthrough) and operate against the end-user Governance API (`/api/v1/governance/`).

#### 1. `list_my_certification_reviews`

Lists the reviewer's active certification campaigns and review items.

- **Without `campaignId`**: Returns active campaigns assigned to the reviewer with summary counts (pending, approved, revoked items), status, due dates, and reviewer level.
- **With `campaignId`**: Returns individual review items with rich contextual data for each:
  - Principal profile (name, email, status)
  - Resource/application under review
  - Active entitlements and their values
  - Assignment method (direct, group-based) and assigned date
  - Application usage history
  - Multi-dimensional risk analysis (risk items with level and reason)
  - Okta's AI recommendation (APPROVE/REVOKE)
  - SOD conflict count
- **Filters**: `status` (UNREVIEWED, APPROVE, REVOKE), `search` (free-text), `sortBy`, `limit`

#### 2. `get_certification_review_detail`

Full detail on a single review item, providing everything needed for an informed decision:

- **Principal**: Full profile including user ID, name, email, status
- **User context**: Extended contextual information from the Governance API
- **Resource**: Application or group under review with type and name
- **App context**: Assignment date, assignment type (direct/group), application usage metrics, group memberships granting access, active entitlements with set names and values
- **Risk analysis**: Array of risk items, each with:
  - `riskAttribute` -- the dimension being evaluated
  - `riskLabel` -- human-readable label
  - `riskLevel` -- severity (LOW, MEDIUM, HIGH)
  - `reason` -- templated explanation with interpolated values
- **SOD conflicts**: Separation of duties violations detected by the governance engine
- **AI recommendation**: Okta Governance Analyzer's recommended decision (APPROVE or REVOKE)
- **Metadata**: Creation date, last update, current reviewer level, delegation status, existing notes

#### 3. `submit_certification_decision`

Submits an APPROVE or REVOKE decision for a specific review item.

- **Required**: `campaignId`, `reviewItemId`, `decision` (APPROVE or REVOKE)
- **Optional**: `reviewerLevelId` (defaults to "ONE"; required for multi-level campaigns), `note` (justification text recorded in the audit trail)
- **Authentication**: Uses the reviewer's Org AS token exclusively. If the token is not available, the tool returns an error explaining that bearer-passthrough must be configured.
- **API method**: PUT to `/api/v1/governance/campaigns/{campaignId}/reviewItems/me` -- the same endpoint the Okta UI uses
- **Audit**: The decision is recorded in Okta's system log under the reviewer's actual user ID

### Administrative Tools (Service App API)

These tools use the service app's client credentials token (private_key_jwt) to call the admin Governance API (`/governance/api/v1/`) and standard Okta APIs (`/api/v1/`). They support the reviewer's workflow with supplementary data.

| Tool | Description |
|---|---|
| `resolve_okta_user` | Resolve a username or email address to an Okta user GUID. Used to look up principals referenced in review items. |
| `check_user_inactive_apps` | Analyze Okta system logs for application inactivity. Identifies apps a user has not accessed in 60+ days -- a key signal for revocation decisions. |
| `list_manageable_apps` | List applications enabled for governance management. Returns app metadata including governance labels and entitlement configuration. |
| `list_manageable_groups` | List Okta groups available for governance operations. |
| `list_group_members` | List members of a specific Okta group with profile details. |
| `generate_app_activity_report` | Generate usage analytics for a governance-managed application, including active user counts and access patterns. |
| `manage_app_labels` | Create, assign, and remove governance labels on applications. Labels are used for campaign scoping and organizational categorization. |

---

## Chain of Evidence

Chain of evidence is the critical compliance requirement for access certification. Every approve or revoke decision must be attributable to the specific human reviewer who made it, with an unbroken audit trail from the decision point to the Okta system log.

### How the solution preserves chain of evidence

1. **Token identity preservation**: The adapter's bearer-passthrough mode forwards the user's Org Auth Server token without modification. The token's `sub` claim carries the reviewer's actual Okta user ID through the entire pipeline -- from the MCP client, through the adapter, through the Governance MCP Server, to the Okta Governance API.

2. **No service app impersonation**: The `submit_certification_decision` tool exclusively uses the reviewer's own token. It explicitly rejects requests where the user token is not available, preventing any fallback to the service app token for decision submission.

3. **Okta system log attribution**: When the Governance API processes a decision, it records the authenticated user's identity in the system log event. Because the token is the reviewer's own Org AS token, the system log entry shows the real reviewer -- not a service account or AI agent.

4. **Human-in-the-loop**: The AI agent analyzes data, surfaces risk signals, and formulates recommendations, but it cannot submit decisions autonomously. Every `submit_certification_decision` call requires explicit invocation by the human reviewer through the MCP client. The MCP protocol's tool-call confirmation mechanism provides an additional gate.

5. **Justification capture**: The `note` parameter on `submit_certification_decision` allows the reviewer (or the AI agent on the reviewer's behalf) to record justification text that becomes part of the audit record. This captures the reasoning behind each decision.

### Audit trail flow

```
Reviewer action in MCP client
  -> Tool call: submit_certification_decision(decision=REVOKE, note="...")
    -> Adapter forwards Org AS token (sub=00u...)
      -> MCP Server calls PUT /api/v1/governance/campaigns/{id}/reviewItems/me
        -> Okta records: reviewer 00u... revoked access for user 00u... with note "..."
          -> System log event: governance.certification.review.decision
```

---

## Okta Configuration Requirements

### Custom Authorization Server

- **Purpose**: Issues tokens for MCP protocol authentication (XAA flow)
- **Scope**: `mcp:read`
- **Policy rule**: Must include `urn:ietf:params:oauth:grant-type:jwt-bearer` (JWT Bearer) grant type for the ID-JAG exchange
- **Audience**: Configured as the MCP server's resource identifier

### AI Agent Registration

- **Type**: AI Agent with managed connection
- **Connection type**: `IDENTITY_ASSERTION_CUSTOM_AS` -- enables the XAA flow where the adapter exchanges an identity assertion for a custom AS token
- **Target auth server**: The custom authorization server above

### MCP Server Registration (Okta Universal Directory)

- **Connection type**: `STS_ACCESS_TOKEN` -- the standard MCP server registration in Okta
- **Purpose**: Allows the adapter to discover and connect to this MCP server as a downstream resource

### Service App (Admin API Access)

- **Authentication**: `private_key_jwt` (asymmetric key pair, no shared secrets)
- **Admin role**: `ACCESS_CERTIFICATIONS_ADMIN` -- grants access to the admin Governance API
- **Scopes**: `okta.governance.accessCertifications.read`, `okta.governance.accessCertifications.manage`, `okta.apps.read`, `okta.users.read`, `okta.logs.read`
- **Token endpoint**: Org Authorization Server (`/oauth2/v1/token`) via client credentials grant

### Reviewer Client App (End-User API Access)

- **Purpose**: The OIDC application through which the adapter authenticates users
- **Org-level scope grants**: `okta.governance.reviewer.read`, `okta.governance.reviewer.manage`
- **Grant types**: `authorization_code`, `device_code`
- **Note**: These scopes are granted at the Org level (not on a custom auth server) because the Governance end-user API requires Org AS tokens

### Adapter OIDC App

- **Org-level scope grants**: `okta.governance.reviewer.read`, `okta.governance.reviewer.manage`
- **Purpose**: The adapter's own OIDC client registration, which must also carry the governance scopes so they appear in the Org AS token issued during user login

---

## Deployment

### Infrastructure

All infrastructure is managed by Terraform (see `/terraform/`) and deployed via GitHub Actions.

| Component | Runtime | Domain |
|---|---|---|
| Governance MCP Server | ECS Fargate (Node.js 20 Alpine) | `governance-mcp.supersafe-ai.io` |
| MCP Adapter | ECS Fargate (Python) | Separate deployment via `supersafe-ai-webapp-deploy.yml` |

### Governance MCP Server Deployment Pipeline

The `deploy.yml` workflow handles the full lifecycle:

1. **Build**: Multi-stage Docker build (TypeScript compilation, production dependency install)
2. **Push**: Tagged images pushed to ECR (`:latest` and `:${commit_sha}`)
3. **Deploy**: ECS service force-redeployment pulls the new image
4. **Infrastructure**: Terraform plan/apply for ALB, ECS cluster/service, ECR, Route53 DNS, ACM certificates

### AWS Resources

- **ALB**: TLS termination with ACM certificate, forwards to ECS tasks on port 3002
- **ECS Cluster**: Fargate launch type, single service
- **ECR Repository**: `okta-governance-mcp`
- **Route53**: CNAME to ALB for `governance-mcp.supersafe-ai.io`
- **Authentication**: GitHub Actions uses OIDC federation (`id-token: write`) with an assumed IAM role -- no static credentials

### Runtime Configuration

The ECS task definition injects all configuration via environment variables:

- `OKTA_DOMAIN` -- Okta tenant domain
- `OKTA_CLIENT_ID` / `OKTA_PRIVATE_KEY_KID` / `OKTA_PRIVATE_KEY_PEM` -- Service app credentials
- `OKTA_OAUTH_ISSUER` -- Custom authorization server issuer URI
- PEM keys are written to files at container startup by `docker-entrypoint.sh`

---

## Security Considerations

### Token Security

- **Short-lived tokens**: All access tokens have a maximum lifetime of 1 hour. The service app token cache automatically refreshes tokens before expiry.
- **No shared secrets**: The service app authenticates via `private_key_jwt` -- the private key never leaves the deployment environment. There are no client secrets to rotate or leak.
- **Issuer validation**: The MCP server validates every incoming token against the correct JWKS endpoint, dynamically resolving the endpoint based on the token's issuer claim (Org AS vs. custom AS).

### Identity Integrity

- **Bearer-passthrough**: The user's Org AS token is forwarded without modification or re-signing. The Governance API receives the original token with the reviewer's real identity.
- **No impersonation**: The service app token is never used for end-user operations. The tool implementations explicitly check for the presence of the user token and reject calls that would fall back to the service app.
- **Scope separation**: Admin operations use `okta.governance.accessCertifications.*` scopes on the service app. End-user operations use `okta.governance.reviewer.*` scopes on the user's token. There is no scope overlap.

### Access Control

- **Least-privilege service app**: The service app has only the `ACCESS_CERTIFICATIONS_ADMIN` role and specific API scopes required for read operations. It cannot modify user profiles, reset passwords, or perform other administrative actions.
- **Reviewer-scoped data**: The end-user Governance API automatically filters data to only the review items assigned to the authenticated reviewer. The MCP server cannot access review items belonging to other reviewers.
- **MCP tool gating**: Tools are registered with required scopes and capabilities. The MCP server evaluates the caller's authorization context before executing any tool.

### Infrastructure Security

- **TLS everywhere**: All traffic is encrypted. The ALB terminates TLS with an ACM-managed certificate. Internal ECS traffic is within the VPC.
- **No static credentials**: GitHub Actions authenticates to AWS via OIDC federation. Okta credentials are stored as GitHub Environment secrets and injected at runtime.
- **Container isolation**: ECS Fargate provides task-level isolation. Each container runs as a non-root process in an immutable filesystem (built from a multi-stage Docker image with only production dependencies).

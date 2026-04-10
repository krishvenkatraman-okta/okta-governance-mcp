# Okta Governance MCP Server Specification

## 1. Purpose

This MCP system provides a protected governance control plane for an Okta-based AI agent platform.

It must:

- Support enterprise IdP / Cross App style authorization flows
- Accept access tokens issued by Okta's custom authorization server (after ID-JAG exchange)
- Validate access tokens locally using JWKS
- Extract user identity/subject from the access token
- Dynamically expose tools based on the user's Okta role, target scope, reviewer state, and governance policy
- Enforce authorization again on every tool invocation

This system is not a generic API relay. It is a policy-enforcing governance plane.

---

## 2. Core Architecture

The MCP system consists of **one** logical server component:

### MCP Resource Server (MRS)

**Responsibilities:**
- Accept access tokens issued by Okta custom authorization server
- Validate access tokens locally using JWKS
- Extract subject (user identity) from access token
- Resolve authorization context
- Return a filtered tool list
- Execute allowed governance operations

### High-level flow

```
1. User signs in to the first-party agent with Okta (OIDC PKCE)
   ↓
2. Agent receives ID token + user access token
   ↓
3. Agent exchanges ID token with Okta for ID-JAG
   ↓
4. Agent exchanges ID-JAG with Okta custom authorization server for access token
   (audience: api://mcp-governance)
   ↓
5. Agent calls MCP Resource Server with access token
   ↓
6. MRS validates access token (JWKS signature verification)
   ↓
7. MRS extracts subject from access token
   ↓
8. MRS resolves authorization context from Okta
   ↓
9. MRS exposes only the allowed tools
   ↓
10. Every tool invocation is re-authorized server-side
```

---

## 3. Important Design Rule

### The frontend agent must NOT call the MCP Resource Server with the ID-JAG directly.

**Correct model:**

1. **ID token** → exchanged with Okta for **ID-JAG**
2. **ID-JAG** → exchanged with Okta custom authorization server for **access token**
3. **Access token** → presented to **MCP Resource Server**

This separation ensures proper OAuth 2.0 token flow and enterprise policy enforcement.

---

## 4. Frontend Agent Flow

The frontend agent performs a three-step authentication flow to obtain an access token for the MCP Resource Server:

### Step 1: Authenticate User
User authenticates with Okta using OIDC/PKCE and receives:
- `id_token`
- `user_access_token` (for end-user APIs)

### Step 2: Exchange for ID-JAG
Frontend exchanges the `id_token` with Okta token exchange endpoint and receives:
- `ID-JAG` (Identity JWT with Authentication Grant)

### Step 3: Exchange ID-JAG for Access Token
Frontend exchanges the `ID-JAG` with Okta custom authorization server and receives:
- `access_token` (for MCP Resource Server, audience: `api://mcp-governance`)

### Step 4: Call MCP with Access Token
Frontend calls MCP Resource Server endpoints with:
- `Authorization: Bearer <access_token>`

### Python SDK Conceptual Model

The frontend agent flow can be conceptualized using a Python SDK:

```python
# Step 1: Authenticate user with Okta (OIDC PKCE)
user_tokens = okta_client.authenticate_user(
    username=username,
    password=password,
    flow="pkce"
)
id_token = user_tokens.id_token
user_access_token = user_tokens.access_token  # For end-user APIs

# Step 2: Exchange ID token for ID-JAG
id_jag_response = okta_client.exchange_token(
    token=id_token,
    grant_type="urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token_type="urn:okta:oauth:token-type:id_jag",
    audience="api://mcp-governance"
)
id_jag = id_jag_response.access_token

# Step 3: Exchange ID-JAG for access token
access_token_response = okta_client.exchange_token(
    token=id_jag,
    grant_type="urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token_type="urn:ietf:params:oauth:token-type:access_token",
    audience="api://mcp-governance",
    scope="mcp.governance"
)
access_token = access_token_response.access_token

# Step 4: Use access token with MCP Resource Server
mcp_client = McpClient(
    base_url="https://mcp.example.com",
    access_token=access_token
)

# List available tools
tools = mcp_client.list_tools()

# Execute a tool
result = mcp_client.call_tool(
    name="list_owned_apps",
    arguments={}
)
```

---

## 5. Trust Model

### 5.1 Frontend Agent
The first-party agent:
- Authenticates the user with Okta
- Receives an ID token
- Performs token exchange with Okta to obtain an ID-JAG
- Exchanges ID-JAG with Okta custom authorization server for access token
- Calls MCP Resource Server with access token

### 5.2 Okta
Okta acts as:
- Identity provider
- Managed connection / policy decision point
- Token exchange authority (ID token → ID-JAG)
- Custom authorization server (ID-JAG → access token)

### 5.3 MCP Resource Server
The MRS:
- Validates access tokens locally using JWKS
- Checks issuer, audience, expiry, signature, and expected claims
- Extracts subject (user identity) from access token
- Derives user/session identity context
- Resolves authorization context from Okta
- Returns dynamic tool exposure
- Enforces tool execution policy

---

## 6. MCP Authorization Server (MAS) Status

**MAS is NO LONGER REQUIRED in this architecture.**

The MCP Authorization Server has been eliminated from the design. In the previous architecture, MAS was responsible for:
- Accepting ID-JAG from frontend
- Validating ID-JAG
- Issuing MCP access token

**In the new architecture:**
- Access tokens are issued directly by **Okta's custom authorization server** after the ID-JAG exchange
- The MCP Resource Server validates these Okta-issued access tokens directly
- No intermediate MCP token exchange layer is needed

This simplifies the architecture while maintaining enterprise policy enforcement and security.

---

## 7. Dual-Path Platform Model

The overall platform still has two execution paths:

### Path A: End-user direct APIs
Used directly from the frontend with the user's Okta token for:
- Search resource catalog
- Create/view own access requests
- List/complete assigned reviews
- My security access reviews
- My settings

These are not MCP-governed admin tools.

### Path B: MCP-governed delegated admin APIs
Used for:
- Entitlement management
- Labels
- Collections / bundles
- Campaigns / certifications
- Delegated request workflows
- Request on behalf of other users
- Owned-app reporting from syslog
- Principal settings / delegates / resource-owner operations
- Policy-heavy governance logic

---

## 8. Access Token Validation

The MCP Resource Server validates Okta-issued access tokens using the following checks:

### 8.1 Signature Verification
- Fetch public keys from Okta JWKS endpoint
- Verify JWT signature using RS256 algorithm
- Support key rotation with caching

### 8.2 Standard Claims Validation
- **Issuer (iss)**: Must match Okta custom authorization server issuer
- **Audience (aud)**: Must be `api://mcp-governance` or configured audience
- **Expiry (exp)**: Token must not be expired
- **Not Before (nbf)**: Token must be valid (if present)
- **Issued At (iat)**: Must be present and not in future

### 8.3 Subject Extraction
- Extract `sub` claim (Okta user ID)
- Use subject to resolve authorization context

### 8.4 Clock Skew Tolerance
- Allow 5-minute clock skew tolerance
- Prevents false rejections from time drift

### 8.5 Security Features
- JWKS caching (24 hours)
- Rate limiting (10 JWKS requests/minute)
- 30-second timeout for JWKS fetch
- No raw token logging

---

## 9. Authorization Context Model

The MCP Resource Server builds a normalized authorization context.

Example:

```json
{
  "subject": "00u123",
  "roles": {
    "superAdmin": false,
    "appAdmin": true,
    "groupAdmin": false,
    "regularUser": false
  },
  "targets": {
    "apps": ["0oa123", "0oa456"],
    "groups": []
  },
  "reviewer": {
    "hasAssignedReviews": true,
    "hasSecurityAccessReviews": true
  },
  "capabilities": [
    "entitlements.manage.owned",
    "labels.manage.owned",
    "bundles.manage.owned",
    "campaigns.manage.owned",
    "request_for_others.owned",
    "workflow.manage.owned",
    "reports.syslog.owned"
  ]
}
```

**Inputs to authorization context resolution:**

- Delegated identity from access token (subject)
- Okta admin roles
- Role targets / owned apps
- Reviewer assignment state
- Governance policy
- Resource ownership constraints

---

## 10. Dynamic Tool Exposure

The MCP Resource Server must expose only the tools allowed for the current user/session.

### 10.1 Regular end user

Regular-user self-service stays on the direct API path, not the MCP admin tool path.

The MCP server may expose read-only helper tools such as:

- `get_tool_requirements`
- `get_operation_requirements`
- `explain_why_tool_is_unavailable`

### 10.2 App owner / delegated admin

Expose only scoped governance tools for owned/targeted apps:

- `list_owned_apps`
- `manage_owned_app_entitlements`
- `manage_owned_app_labels`
- `create_bundle_for_owned_app`
- `create_campaign_for_owned_app`
- `request_access_for_other_user_on_owned_app`
- `create_access_request_workflow_for_owned_app`
- `generate_owned_app_syslog_report`

### 10.3 Super admin

Expose the broadest governance tool set, still with audit and confirmation for sensitive actions.

### 10.4 Execution rule

**Visibility is not authorization.**

Every tool invocation must be re-checked for:

- Role
- Target ownership
- Reviewer status if relevant
- Governance policy
- Service-token scope sufficiency

---

## 11. Tool Requirements Registry

The MCP system must maintain a tool requirements registry.

Each tool declares:

- Required Okta OAuth scopes
- Optional / conditional scopes
- Required roles or permissions
- Target constraints
- Endpoint families
- Documentation references

Example:

```json
{
  "tool": "manage_owned_app_labels",
  "requiredScopes": [
    "okta.governance.labels.manage",
    "okta.apps.manage"
  ],
  "requiredRoles": [
    "APP_ADMIN",
    "SUPER_ADMIN"
  ],
  "targetConstraints": [
    "must_be_owned_app"
  ],
  "endpointFamilies": [
    "Labels",
    "Applications"
  ]
}
```

---

## 12. LLM Support / Explainability Tools

The MCP Resource Server must expose read-only explainability tools so the LLM can answer:

- What scopes are needed for this operation?
- Why is this tool unavailable?
- What is missing for this action?

**Required helper tools:**

- `get_tool_requirements`
- `get_operation_requirements`
- `explain_why_tool_is_unavailable`
- `list_available_tools_for_current_user`

These tools are metadata-driven and do not mutate governance state.

---

## 13. Okta Scope Model for MCP Service App

The MCP service app may need these scopes depending on the enabled tool set.

### Core admin scopes
- `okta.apps.read`
- `okta.apps.manage`
- `okta.groups.read`
- `okta.groups.manage`
- `okta.logs.read`
- `okta.appGrants.read`
- `okta.appGrants.manage`

### Access request scopes
- `okta.accessRequests.catalog.read`
- `okta.accessRequests.condition.read`
- `okta.accessRequests.condition.manage`
- `okta.accessRequests.request.read`
- `okta.accessRequests.request.manage`
- `okta.accessRequests.tasks.read`
- `okta.accessRequests.tasks.manage`

### Governance scopes
- `okta.governance.accessCertifications.read`
- `okta.governance.accessCertifications.manage`
- `okta.governance.accessRequests.read`
- `okta.governance.accessRequests.manage`
- `okta.governance.assignmentCandidates.read`
- `okta.governance.collections.read`
- `okta.governance.collections.manage`
- `okta.governance.delegates.read`
- `okta.governance.delegates.manage`
- `okta.governance.entitlements.read`
- `okta.governance.entitlements.manage`
- `okta.governance.labels.read`
- `okta.governance.labels.manage`
- `okta.governance.operations.read`
- `okta.governance.principalSettings.read`
- `okta.governance.principalSettings.manage`
- `okta.governance.resourceOwner.read`
- `okta.governance.resourceOwner.manage`
- `okta.governance.riskRule.read`
- `okta.governance.riskRule.manage`
- `okta.governance.securityAccessReviews.admin.read`
- `okta.governance.securityAccessReviews.admin.manage`
- `okta.governance.securityAccessReviews.endUser.read`
- `okta.governance.securityAccessReviews.endUser.manage`
- `okta.governance.settings.read`
- `okta.governance.settings.manage`

The runtime should request only the scopes needed for the operation when feasible.

---

## 14. Endpoint Families Backing the MCP Server

From the governance collection, the MCP server is designed around these governance management families:

- Campaigns
- Principal Access
- Principal Access - V2
- Collections
- Labels
- Principal Settings

The collection is only the endpoint-catalog source; its placeholder Authorization header/API-key model must be replaced by OAuth service-app execution logic.

---

## 15. MRS Responsibilities

The MCP Resource Server must:

- Validate Okta-issued access tokens using JWKS
- Derive the current subject from access token
- Resolve authorization context from Okta
- Filter the tool list based on capabilities
- Re-check authorization on every call
- Obtain an Okta service-app OAuth token when calling Okta APIs
- Log all privileged actions

---

## 16. Runtime Authorization Flow

```
1. Client calls tools/list or equivalent entrypoint with access token
   ↓
2. MRS validates access token (JWKS signature verification)
   ↓
3. MRS extracts subject from access token
   ↓
4. MRS resolves user authorization context from Okta
   ↓
5. MRS filters tools based on role, targets, reviewer state, and policy
   ↓
6. MRS returns only allowed tools
   ↓
7. Client calls a tool
   ↓
8. MRS re-checks authorization and scope requirements
   ↓
9. MRS obtains or reuses the appropriate Okta service-app token
   ↓
10. MRS calls the Okta governance/admin API
    ↓
11. MRS returns the result
```

---

## 17. Security Rules

- Never derive final governance scopes from the raw ID token
- Never call the MRS with the ID-JAG directly
- Never use SSWS tokens for this architecture
- Never expose the full Okta admin API surface as MCP tools
- Always enforce least privilege
- Always validate target ownership and delegated scope
- Always audit privileged actions
- Keep end-user self-service on the direct API path when native end-user APIs exist
- Validate access tokens using JWKS (not custom MCP token validation)

---

## 18. Design Principles

### Capability over role

Role names alone are insufficient. Capabilities are derived from:

- Role
- Targets
- Reviewer state
- Policy

### Explainability

The LLM must be able to ask the MCP server what a tool requires and why it is or is not available.

### Enterprise policy alignment

The architecture must align with managed connection / enterprise IdP control patterns, not bypass them.

### Separation of concerns

- Frontend handles user interaction and token exchange orchestration
- Okta handles identity, token exchange, and custom authorization server
- MRS handles governance policy and tool execution
- Okta service app handles downstream admin/governance API access

---

## 19. Final Statement

This MCP system supports enterprise-controlled Cross App authorization by using Okta's native token exchange and custom authorization server flows. The frontend agent obtains an ID-JAG from Okta, exchanges it with Okta's custom authorization server for an access token, and then uses that token to access the MCP Resource Server. The MCP Resource Server validates the Okta-issued access token using JWKS, extracts the user identity, and dynamically exposes governance tools based on Okta roles, targets, reviewer assignments, and policy. Privileged Okta API calls are executed using a separate OAuth service app with least-privilege scopes.

**Key Specification Change:** The MCP Authorization Server (MAS) has been eliminated from the specification. Access tokens are issued directly by Okta's custom authorization server after the ID-JAG exchange, removing the need for an intermediate MCP token issuance layer. The MCP Resource Server validates these Okta-issued access tokens directly using JWKS, simplifying the architecture while maintaining enterprise policy enforcement and security.

# Okta Governance AI Platform - Architecture

## 1. Objective

Build an AI-driven governance platform using Okta as the identity and governance control plane.

The platform enables:
- End-user self-service access workflows
- Delegated governance for app owners
- Full governance for administrators
- AI-assisted interactions with strict policy enforcement

---

## 2. High-Level Architecture

User → First-Party Agent → Okta → (Dual Path)

                    ┌───────────────────────────────┐
                    │        Okta Platform          │
                    │  - Authentication (OIDC)      │
                    │  - Token Exchange (ID → ID-JAG)│
                    │  - Custom Authorization Server│
                    │  - Access Token Issuance      │
                    │  - Governance APIs            │
                    │  - Roles / Permissions        │
                    │  - System Logs                │
                    └──────────────┬────────────────┘
                                   │
                ┌──────────────────┴──────────────────┐
                │                                     │
     End User Direct APIs                  MCP Resource Server (MRS)
     (User Token)                         (Access Token from Okta)

---

## 3. Core Components

### 3.1 First-Party Agent (Frontend)

**Responsibilities:**

- Authenticate users using OIDC (PKCE)
- Exchange user token for ID-JAG with Okta
- Exchange ID-JAG for access token from Okta custom authorization server
- Maintain user session
- Handle AI interaction layer
- Call:
  - Okta End User APIs directly (self-service)
  - MCP Resource Server for governance/admin actions (with Okta access token)

### 3.2 Okta Platform

**Responsibilities:**

- User authentication
- Token issuance (ID token + user access token)
- Token exchange (ID token → ID-JAG)
- Custom authorization server for access token issuance
- Managed connection / Cross App Access policy
- Governance APIs (IGA)
- Roles, permissions, and resource scoping
- System logs for reporting and audit

### 3.3 MCP Resource Server (MRS)

**Responsibilities:**

- Validate Okta-issued access token
- Extract user identity/subject from token
- Resolve authorization context from Okta
- Dynamically expose allowed tools
- Enforce governance policy
- Call Okta APIs using service-app OAuth
- Audit all actions

---

## 4. Dual-Path Execution Model

### Path A: End-User Direct APIs (User Token)

**Used for:**

- Resource catalog search
- My access requests
- My assigned certification reviews
- My security access reviews
- My settings

**Characteristics:**

- Uses user OAuth access token
- No MCP involvement
- No elevated privileges
- Self-service only

### Path B: MCP Governance System (Delegated Admin)

**Used for:**

- Entitlement management
- Labels
- Collections / bundles
- Campaigns / certifications
- Delegated access requests
- Access workflows
- Syslog reporting (scoped)
- Governance settings and policy operations

**Characteristics:**

- Uses access token from Okta custom authorization server (obtained via ID-JAG exchange)
- Enforced by MCP Resource Server
- Requires role + target + policy validation

---

## 5. MCP System Architecture

The MCP system consists of **one** logical component:

### MCP Resource Server (MRS)

**Responsibilities:**

- Validate Okta-issued access token
- Extract subject (user identity) from access token
- Resolve authorization context
- Dynamically expose allowed tools
- Enforce governance policy
- Call Okta APIs using service-app OAuth
- Audit all actions

**Note:** The MCP Authorization Server (MAS) is **no longer required** in this architecture. The frontend obtains an access token directly from Okta's custom authorization server after exchanging the ID-JAG. The MRS validates this Okta-issued access token directly.

---

## 6. Frontend Agent Flow

The frontend agent performs a three-step authentication flow to obtain an access token for the MCP Resource Server:

### Step 1: User Authentication
User logs in via Okta (OIDC PKCE) and receives:
- `id_token`
- `user_access_token` (for end-user APIs)

### Step 2: Exchange for ID-JAG
Frontend sends `id_token` to Okta token exchange endpoint and receives:
- `ID-JAG` (Identity JWT with Authentication Grant)

### Step 3: Exchange ID-JAG for Access Token
Frontend sends `ID-JAG` to Okta custom authorization server and receives:
- `access_token` (for MCP Resource Server)

### Step 4: Call MCP with Access Token
Frontend calls MCP Resource Server endpoints with:
- `Authorization: Bearer <access_token>`

**Python SDK Conceptual Flow:**

```python
# Step 1: Authenticate user with Okta (OIDC PKCE)
user_tokens = okta.authenticate_user(username, password)
id_token = user_tokens.id_token

# Step 2: Exchange ID token for ID-JAG
id_jag = okta.exchange_token(id_token, target="id-jag")

# Step 3: Exchange ID-JAG for access token
access_token = okta.exchange_token(
    id_jag,
    target="custom-auth-server",
    audience="api://mcp-governance"
)

# Step 4: Use access token with MCP
mcp_client = McpClient(access_token=access_token)
tools = mcp_client.list_tools()
```

---

## 7. Authentication Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. User logs in via Okta (OIDC PKCE)                   │
│    → id_token, user_access_token                        │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Agent exchanges id_token with Okta                   │
│    → ID-JAG (Identity JWT with Authentication Grant)    │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Agent exchanges ID-JAG with Okta custom auth server  │
│    → access_token (audience: api://mcp-governance)      │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Agent calls MCP Resource Server with access_token    │
│    Authorization: Bearer <access_token>                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 5. MRS validates access token (locally)                 │
│    • Signature verification (JWKS)                      │
│    • Issuer validation                                  │
│    • Audience validation                                │
│    • Expiry validation                                  │
│    • Extract subject (user ID)                          │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 6. MRS resolves authorization context                   │
│    • Lookup user roles in Okta                          │
│    • Lookup role targets (apps/groups)                  │
│    • Map to capabilities                                │
│    • Filter tools based on capabilities                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 7. MRS executes governance operations                   │
│    • Uses service-app OAuth for Okta API calls          │
│    • Enforces target ownership                          │
│    • Audits all actions                                 │
└─────────────────────────────────────────────────────────┘
```

---

## 8. Important Design Rule

**The frontend agent must NOT call the MCP Resource Server with the ID-JAG directly.**

**Correct flow:**

1. **ID token** → exchanged with Okta for **ID-JAG**
2. **ID-JAG** → exchanged with Okta custom authorization server for **access token**
3. **Access token** → presented to **MCP Resource Server**

This separation ensures proper OAuth 2.0 token flow and enterprise policy enforcement.

---

## 9. Authorization Model

Authorization is enforced inside the MCP Resource Server.

**Inputs:**

- Okta admin roles
- Role targets (apps/groups)
- Reviewer assignments
- Governance policy

**Output:**

- Capability model
- Allowed tool set

---

## 10. Capability-Based Model

Capabilities determine access.

### Regular User
- `resource_catalog.search`
- `access_requests.self`
- `reviews.assigned`
- `security_access_reviews.self`
- `settings.self.manage`

### App Owner / Delegated Admin
- `entitlements.manage.owned`
- `labels.manage.owned`
- `bundles.manage.owned`
- `campaigns.manage.owned`
- `request_for_others.owned`
- `workflow.manage.owned`
- `reports.syslog.owned`

### Super Admin
- Full governance capabilities (`.all` variants)

---

## 11. Dynamic Tool Exposure

The MCP Resource Server:

1. Validates access token
2. Extracts subject (user ID)
3. Resolves authorization context
4. Filters tools based on capabilities
5. Returns only allowed tools

**Important:**

- Tool visibility ≠ authorization
- Every tool call is revalidated

---

## 12. Okta API Access Model

### 12.1 End-user APIs
- Called directly from frontend
- Use user access token

### 12.2 Governance/Admin APIs
- Called only from MCP server
- Use service-app OAuth

**Service App Requirements:**

- Client credentials flow
- `private_key_jwt`
- Org authorization server
- Least-privilege scopes

---

## 13. Data Sources

The MCP server integrates with:

- **Roles API**
- **Apps API**
- **Groups API**
- **Governance APIs:**
  - Campaigns
  - Collections
  - Labels
  - Principal Access
  - Principal Settings
- **System Log API**

---

## 14. AI + MCP Interaction Model

```
AI suggests actions
    ↓
MCP evaluates permissions
    ↓
MCP enforces policy
    ↓
Okta executes
```

---

## 15. Security Principles

- Zero trust between frontend and admin APIs
- No SSWS tokens
- OAuth service app only
- Least privilege scopes
- Role + target enforcement
- Full audit logging
- No direct admin API exposure to frontend
- Access token validation using JWKS (not custom MCP tokens)

---

## 16. Separation of Responsibilities

| Layer | Responsibility |
|-------|---------------|
| **Frontend Agent** | User interaction, session management, token exchange orchestration |
| **Okta** | Identity, token exchange, custom authorization server, governance APIs |
| **MRS** | Access token validation, policy enforcement, tool execution |
| **Okta Service App** | Admin API access |

**Note:** MAS (MCP Authorization Server) is **no longer part of the architecture**. Token issuance is handled by Okta's custom authorization server.

---

## 17. Design Principles

### Capability over role

Roles are inputs; capabilities drive decisions.

### Explainability

System must explain:

- Required scopes
- Missing permissions
- Unavailable tools

### Least privilege

Only required scopes and tools are exposed.

### Enterprise alignment

Follows Cross App / managed connection model with Okta-native token flows.

---

## 18. Final Architecture Statement

The platform uses Okta as the identity and governance control plane, where a first-party AI agent authenticates users and leverages Okta's token exchange and custom authorization server to obtain an access token with delegated identity context. The MCP Resource Server validates this Okta-issued access token, extracts the user identity, and enforces governance policy by resolving user capabilities using Okta roles and resource targets. The system dynamically exposes only authorized tools based on the user's capabilities. End-user self-service flows are executed directly using Okta's end-user APIs, while all delegated administrative actions are enforced through the MCP Resource Server using service-app OAuth for downstream Okta governance API calls.

**Key Architectural Change:** The MCP Authorization Server (MAS) has been eliminated. Access tokens are issued directly by Okta's custom authorization server after the ID-JAG exchange, removing the need for an intermediate MCP token exchange layer. This simplifies the architecture while maintaining enterprise policy enforcement and security.

# Architecture Update Summary - Access Token Flow

## Overview

Updated the MCP architecture to use Okta-issued access tokens directly instead of custom MCP tokens, eliminating the MCP Authorization Server (MAS) from the design.

---

## Key Changes

### 1. Token Flow Changes

**OLD FLOW:**
```
User → Okta (OIDC) → ID token
ID token → Okta → ID-JAG
ID-JAG → MAS → MCP access token
MCP access token → MRS → Tool execution
```

**NEW FLOW:**
```
User → Okta (OIDC) → ID token + user access token
ID token → Okta → ID-JAG
ID-JAG → Okta Custom Authorization Server → Access token
Access token → MRS → Tool execution
```

### 2. MAS Status

**MAS (MCP Authorization Server) is NO LONGER REQUIRED.**

**Previous responsibilities (eliminated):**
- Accept ID-JAG from frontend
- Validate ID-JAG
- Issue MCP access token

**New approach:**
- Access tokens issued directly by Okta's custom authorization server
- MRS validates Okta-issued access tokens using JWKS
- No intermediate MCP token layer

### 3. Frontend Agent Flow

The frontend agent now performs a **3-step authentication flow**:

#### Step 1: User Authentication
```
User authenticates with Okta (OIDC/PKCE)
↓
Receives: id_token, user_access_token
```

#### Step 2: Exchange for ID-JAG
```
Frontend exchanges id_token with Okta
↓
Receives: ID-JAG
```

#### Step 3: Exchange ID-JAG for Access Token
```
Frontend exchanges ID-JAG with Okta custom authorization server
↓
Receives: access_token (audience: api://mcp-governance)
```

#### Step 4: Call MCP with Access Token
```
Frontend calls MRS with:
Authorization: Bearer <access_token>
```

### 4. MRS Changes

**MRS now:**
- Validates **Okta-issued access tokens** (not MCP tokens)
- Uses JWKS for signature verification
- Extracts subject directly from access token
- Resolves authorization context from Okta
- Executes governance operations

**Token validation checks:**
- Signature verification (JWKS)
- Issuer validation (Okta custom auth server)
- Audience validation (`api://mcp-governance`)
- Expiry validation
- Subject extraction

---

## Frontend Agent Flow (Python SDK Conceptual Model)

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

## Component Changes

### Eliminated Components

- **MAS (MCP Authorization Server)** - No longer part of architecture

### Updated Components

#### Frontend Agent
- **Added:** Token exchange orchestration (3 steps)
- **Added:** ID-JAG to access token exchange with Okta custom auth server
- **Changed:** Sends Okta-issued access token to MRS (not MCP token)

#### Okta Platform
- **Added:** Custom authorization server for access token issuance
- **Enhanced:** Issues access tokens for MCP Resource Server after ID-JAG validation

#### MRS (MCP Resource Server)
- **Changed:** Validates Okta-issued access tokens (not MCP tokens)
- **Added:** JWKS-based signature verification
- **Changed:** Extracts subject directly from Okta access token
- **Unchanged:** Authorization context resolution, tool filtering, execution

#### Okta Service App
- **Unchanged:** Still used for downstream Okta governance API calls

---

## Architecture Diagram

```
┌──────────────────┐
│   Frontend       │
│   Agent          │
└────────┬─────────┘
         │
         │ 1. Authenticate (OIDC/PKCE)
         ▼
┌──────────────────────────────────┐
│   Okta Platform                  │
│   ─────────────                  │
│   • Identity Provider            │
│   • Token Exchange (ID→ID-JAG)   │
│   • Custom Authorization Server  │◄─── 2. Exchange ID token for ID-JAG
│   • Access Token Issuance        │◄─── 3. Exchange ID-JAG for access token
│   • Governance APIs              │
└────────┬─────────────────────────┘
         │
         │ 4. access_token
         ▼
┌──────────────────────────────────┐
│   MCP Resource Server (MRS)      │
│   ───────────────────────────    │
│   • Validate access token (JWKS) │
│   • Extract subject              │
│   • Resolve authorization        │
│   • Filter tools                 │
│   • Execute governance ops       │
└────────┬─────────────────────────┘
         │
         │ 5. Service-app OAuth
         ▼
┌──────────────────────────────────┐
│   Okta Governance APIs           │
│   (via service-app OAuth)        │
└──────────────────────────────────┘
```

---

## Security Implications

### Enhanced Security
✅ Eliminates custom token layer
✅ Uses Okta-native token issuance
✅ Standard JWKS validation
✅ Aligns with OAuth 2.0 best practices

### Unchanged Security
✅ Role-based authorization
✅ Target-based scoping
✅ Capability-based access control
✅ Tool re-authorization on every call
✅ Service-app OAuth for Okta APIs
✅ Audit logging

---

## Documentation Updates

### Files Updated

1. **docs/architecture.md**
   - Updated Section 5: MCP System Architecture (MAS eliminated)
   - Added Section 6: Frontend Agent Flow (3-step flow with Python SDK example)
   - Updated Section 7: Authentication Flow (access token flow)
   - Updated Section 8: Important Design Rule (access token, not ID-JAG)
   - Updated Section 16: Separation of Responsibilities (removed MAS)
   - Added note in Section 18: Final Architecture Statement (MAS elimination)

2. **docs/mcp-spec.md**
   - Updated Section 2: Core Architecture (single component: MRS)
   - Added Section 4: Frontend Agent Flow (3-step flow with Python SDK example)
   - Added Section 6: MCP Authorization Server (MAS) Status (explicitly states elimination)
   - Added Section 8: Access Token Validation (JWKS validation details)
   - Updated Section 15: MRS Responsibilities (Okta access token validation)
   - Updated Section 16: Runtime Authorization Flow (access token flow)
   - Updated Section 19: Final Statement (MAS elimination)

---

## What Did NOT Change

✅ Dual-path execution model (end-user APIs vs. MCP governance)
✅ Authorization context resolution (roles, targets, capabilities)
✅ Dynamic tool exposure based on capabilities
✅ Tool re-authorization on every call
✅ Service-app OAuth for Okta governance APIs
✅ Target ownership validation
✅ Capability-based access control
✅ Tool requirements registry
✅ Explainability tools
✅ Audit logging

---

## Migration Path (Future Code Changes)

When implementing this architecture in code:

1. **Remove MAS code** (if exists):
   - Token issuance logic
   - ID-JAG validation in MAS
   - MCP token generation

2. **Update MRS token validation**:
   - Replace MCP token validator with Okta access token validator
   - Use existing `id-jag-validator.ts` as reference (already uses JWKS)
   - Update configuration to point to Okta custom auth server JWKS

3. **Update authentication middleware**:
   - Accept `Authorization: Bearer <access_token>` (Okta-issued)
   - Validate using JWKS from Okta custom authorization server
   - Extract subject from `sub` claim

4. **Configuration updates**:
   - Replace `MCP_TOKEN_ISSUER` with Okta custom auth server issuer
   - Replace `MCP_TOKEN_AUDIENCE` with `api://mcp-governance`
   - Update JWKS URI to Okta custom auth server JWKS endpoint

5. **No changes needed**:
   - Authorization context resolution
   - Tool registry
   - Tool executor
   - Service-app OAuth client
   - Policy engine

---

## Summary

**Is MAS still required?**
**NO.** MAS is eliminated from the architecture.

**Reason:**
Access tokens are issued directly by Okta's custom authorization server after the ID-JAG exchange. The MRS validates these Okta-issued access tokens using JWKS, removing the need for an intermediate MCP token exchange layer.

**Benefits:**
- Simplified architecture
- Fewer components to maintain
- Standard OAuth 2.0 flow
- Native Okta token issuance
- Maintains enterprise policy enforcement

**Trade-offs:**
- None. The architecture is simplified without compromising security or functionality.

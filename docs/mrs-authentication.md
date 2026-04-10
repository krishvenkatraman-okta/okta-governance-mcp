# MRS Authentication and Authorization

## Overview

The MCP Resource Server (MRS) implements comprehensive request authentication and authorization context resolution. Every incoming MCP request is authenticated, and tools are filtered/executed based on the user's authorization context.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          MCP Client                              │
│  (Claude Desktop, etc.)                                          │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             │ 1. Request MCP token
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                  MAS (Authorization Server)                      │
│                                                                  │
│  • Validate user credentials                                    │
│  • Issue MCP access token (JWT)                                 │
│  • Sign with MAS private key (RS256)                            │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             │ 2. Return MCP token
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                          MCP Client                              │
│  Stores MCP access token                                         │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             │ 3. Call tool with MCP token
                             │    (in request metadata or env var)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                  MRS (Resource Server)                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Authentication Flow                                        │ │
│  │                                                            │ │
│  │ Step 1: Extract MCP Token                                 │ │
│  │   • From request metadata (request.meta.auth.token)       │ │
│  │   • From environment variable (MCP_ACCESS_TOKEN)          │ │
│  │                                                            │ │
│  │ Step 2: Validate Token                                    │ │
│  │   ✓ Signature (using MAS public key, RS256)              │ │
│  │   ✓ Issuer (mcp://okta-governance-mas)                   │ │
│  │   ✓ Audience (mcp://okta-governance-mrs)                 │ │
│  │   ✓ Expiry (exp > now)                                   │ │
│  │   ✓ Subject (sub claim present)                          │ │
│  │   ✓ Issued-at (iat not in future)                        │ │
│  │                                                            │ │
│  │ Step 3: Extract Subject                                   │ │
│  │   • Subject = Okta user ID from token                     │ │
│  │                                                            │ │
│  │ Step 4: Resolve Authorization Context                     │ │
│  │   • Fetch user's admin roles from Okta                    │ │
│  │   • Fetch role targets (apps/groups)                      │ │
│  │   • Map roles → capabilities                              │ │
│  │   • Check reviewer assignments                            │ │
│  │                                                            │ │
│  │ Step 5: Filter/Execute Tools                              │ │
│  │   • Filter tools by capabilities                          │ │
│  │   • Execute tool with authorization context               │ │
│  │   • Enforce target constraints                            │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             │ 4. Return filtered tools or result
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                          MCP Client                              │
└──────────────────────────────────────────────────────────────────┘
```

## MCP Token Format

### Token Claims

```json
{
  "iss": "mcp://okta-governance-mas",
  "sub": "00u123456",
  "aud": "mcp://okta-governance-mrs",
  "exp": 1712700000,
  "iat": 1712696400,
  "jti": "mcp-1712696400-abc123",
  "sessionId": "session-xyz"
}
```

### Token Validation

The MRS validates all incoming tokens with these checks:

1. **Signature Verification**
   - Algorithm: RS256
   - Public key: MAS public key from `keys/mas-public-key.pem`
   - Verifies token was issued by trusted MAS

2. **Issuer Check**
   - Expected: `mcp://okta-governance-mas`
   - Prevents tokens from other issuers

3. **Audience Check**
   - Expected: `mcp://okta-governance-mrs`
   - Prevents token misuse for other services

4. **Expiry Check**
   - Token must not be expired (`exp > now`)
   - Includes 60-second clock skew tolerance

5. **Subject Check**
   - `sub` claim must be present and non-empty
   - Contains Okta user ID for authorization

6. **Issued-At Check**
   - `iat` must not be in the future
   - Prevents pre-dated tokens

## Authorization Context Resolution

### Resolution Process

```typescript
async function resolveAuthorizationContextForSubject(
  subject: string,
  tokenClaims?: McpAccessToken
): Promise<AuthorizationContext>
```

**Steps**:
1. Fetch user's admin roles from Okta
2. Map roles to role flags (superAdmin, appAdmin, etc.)
3. Fetch role targets (apps, groups)
4. Map roles + targets to capabilities
5. Check for reviewer assignments (future)
6. Return complete authorization context

**Fail-Safe**:
- If role resolution fails, returns minimal context (regular user)
- Logs error but doesn't fail the request
- Prevents complete service outage due to Okta API issues

### Authorization Context Structure

```typescript
interface AuthorizationContext {
  subject: string;  // Okta user ID

  roles: {
    superAdmin: boolean;
    orgAdmin: boolean;
    appAdmin: boolean;
    groupAdmin: boolean;
    readOnlyAdmin: boolean;
    regularUser: boolean;
  };

  targets: {
    apps: string[];    // Owned app IDs
    groups: string[];  // Owned group IDs
  };

  reviewer: {
    hasAssignedReviews: boolean;
    hasSecurityAccessReviews: boolean;
  };

  capabilities: Capability[];
}
```

### Role to Capability Mapping

| Role | Target Required | Capabilities |
|------|----------------|--------------|
| Super Admin | No | All capabilities (.all suffix) |
| Org Admin | No | All capabilities except role/app/group management |
| App Admin | Yes (apps) | Owned app capabilities (.owned suffix) |
| Group Admin | Yes (groups) | Limited owned capabilities |
| Read-Only Admin | No | No governance capabilities |
| Regular User | No | Self-service capabilities only |

**Example Mappings**:

```
Super Admin:
  • entitlements.manage.all
  • labels.manage.all
  • bundles.manage.all
  • campaigns.manage.all
  • (+ 7 more)

App Admin (with targets):
  • entitlements.manage.owned
  • labels.manage.owned
  • bundles.manage.owned
  • campaigns.manage.owned
  • (+ 3 more)

Regular User:
  • resource_catalog.search
  • access_requests.self
  • reviews.assigned
  • security_access_reviews.self
  • settings.self.manage
```

## Request Handlers

### List Tools Handler

Filters tools based on authorization context:

```typescript
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  // 1. Authenticate request
  const context = await authenticateRequest(request);

  // 2. Fail closed if auth fails
  if (!context) {
    return { tools: [] };
  }

  // 3. Filter tools by capabilities
  const tools = getAvailableTools(context);

  // 4. Return filtered tools
  return { tools };
});
```

**Fail-Closed Behavior**:
- No token → Empty tool list
- Invalid token → Empty tool list
- Valid token → Tools filtered by capabilities

### Call Tool Handler

Executes tool with authorization context:

```typescript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // 1. Authenticate request
  const context = await authenticateRequest(request);

  // 2. Fail closed if auth fails
  if (!context) {
    return {
      content: [{ type: 'text', text: 'Authentication failed' }],
      isError: true
    };
  }

  // 3. Execute tool (includes re-authorization)
  const result = await executeTool(request, context);

  // 4. Return result
  return result;
});
```

**Fail-Closed Behavior**:
- No token → Authentication error
- Invalid token → Authentication error
- Valid token → Tool executed with authorization checks

## Token Extraction

### Priority Order

1. **Request Metadata** (preferred for MCP protocol)
   - `request.meta.auth.token`
   - `request.meta.token`

2. **Environment Variable** (for testing)
   - `MCP_ACCESS_TOKEN`

### Example: Passing Token

**Via Environment Variable** (for testing):
```bash
MCP_ACCESS_TOKEN="eyJhbGci..." npm run dev:mrs
```

**Via MCP Client** (production):
```typescript
// MCP client includes token in metadata
client.call('tools/list', {
  meta: {
    auth: {
      token: mcpAccessToken
    }
  }
});
```

## Logging

### Authentication Logging

All authentication events are logged (without raw tokens):

```
[MRS] Received ListTools request
[MRS] MCP token validated: {
  subject: '00u123456',
  issuer: 'mcp://okta-governance-mas',
  expiresAt: '2026-04-10T00:58:31.000Z',
  sessionId: 'session-xyz'
}

[AuthorizationContext] Resolving context for subject: {
  subject: '00u123456',
  sessionId: 'session-xyz'
}

[AuthorizationContext] Context resolved: {
  subject: '00u123456',
  roles: ['appAdmin'],
  targetApps: 3,
  targetGroups: 0,
  capabilities: 7
}

[MRS] ListTools: Returning 8 tools for subject 00u123456
```

### Token Validation Failures

```
[MRS] MCP token validation failed: {
  error: 'jwt expired',
  validationErrors: ['jwt expired']
}

[MRS] ListTools: Authentication failed, returning empty tool list
```

### Missing Tokens

```
[MRS] No MCP access token provided in request
[MRS] ListTools: Authentication failed, returning empty tool list
```

**Security**: Raw tokens are NEVER logged, only:
- Subject (user ID)
- Expiry time
- Session ID
- Validation errors

## Demo Script

### Running the Demo

```bash
npm run demo-auth
```

### Demo Scenarios

**1. Token Creation and Validation**
- Creates MCP tokens for different user types
- Validates each token
- Shows token claims

**2. Authorization Context Resolution**
- Resolves context for each user type
- Shows roles, targets, capabilities

**3. Tool Visibility by Role**
- Super Admin: 0 tools (metadata tools disabled in current implementation)
- App Admin: 8 tools
- Regular User: 0 tools

**4. Complete Authentication Flow**
- End-to-end flow from token to tool list
- Shows all intermediate steps

**5. Token Expiry Handling**
- Creates expired token
- Shows validation failure
- Demonstrates fail-closed behavior

## Security Considerations

### 1. Fail-Closed by Default

**All authentication failures result in denial**:
- No token → Empty tools / Auth error
- Invalid token → Empty tools / Auth error
- Expired token → Empty tools / Auth error
- Context resolution failure → Minimal context (regular user)

### 2. Token Security

**Tokens are treated as secrets**:
- Never logged in full
- Only logged in redacted form for debugging
- Transmitted securely (HTTPS in production)
- Short-lived (1 hour default)

### 3. Re-Authorization

**Authorization checked on every request**:
- Tool list request → Full authentication
- Tool call request → Full authentication + tool-level authorization
- No caching of authorization decisions
- Cannot bypass by reusing cached context

### 4. Signature Verification

**All tokens verified with MAS public key**:
- RS256 algorithm (RSA + SHA-256)
- Public key from trusted source
- Prevents token forgery

### 5. Audience Validation

**Prevents token misuse**:
- MRS tokens only valid for MRS
- Cannot use MAS tokens for MRS
- Cannot use tokens from other services

## Error Handling

### Authentication Errors

| Scenario | Behavior | User Impact |
|----------|----------|-------------|
| No token | Empty tool list | Cannot use any tools |
| Invalid signature | Empty tool list | Cannot use any tools |
| Expired token | Empty tool list | Must refresh token |
| Wrong audience | Empty tool list | Cannot use any tools |
| Missing subject | Empty tool list | Cannot use any tools |

### Authorization Errors

| Scenario | Behavior | User Impact |
|----------|----------|-------------|
| Role fetch fails | Minimal context | Regular user permissions |
| Target fetch fails | No targets | Cannot use owned tools |
| No capabilities | Empty tool list | Cannot use any tools |

## Testing

### Unit Tests

Test individual components:

```typescript
// Test token validation
const result = validateMcpToken(token);
expect(result.valid).toBe(true);
expect(result.payload?.sub).toBe('00u123456');

// Test context resolution
const context = await resolveAuthorizationContextForSubject('00uappadmin');
expect(context.roles.appAdmin).toBe(true);
expect(context.capabilities).toContain('entitlements.manage.owned');

// Test tool filtering
const tools = getAvailableTools(context);
expect(tools.length).toBeGreaterThan(0);
```

### Integration Tests

Test end-to-end flow:

```typescript
// Create token
const token = createMcpToken('00uappadmin', 'session1', privateKey);

// Simulate request
process.env.MCP_ACCESS_TOKEN = token;
const tools = await mrs.listTools();

// Verify tools returned
expect(tools.length).toBe(8);
expect(tools.map(t => t.name)).toContain('list_owned_apps');
```

### Manual Testing

```bash
# 1. Generate test token
npm run demo-auth

# 2. Start MRS with token
MCP_ACCESS_TOKEN="eyJ..." npm run dev:mrs

# 3. Test tool listing
# (use MCP client to list tools)

# 4. Test tool execution
# (use MCP client to call tool)
```

## Placeholder Implementation

The current implementation uses placeholders for Okta API calls:

### Role Resolution (Placeholder)

```typescript
// Current: Pattern matching on subject
if (userId.includes('superadmin')) {
  return [{ id: 'role1', type: 'SUPER_ADMIN' }];
}

// Future: Real Okta API call
const roles = await rolesClient.listUserRoles(userId);
```

### Target Resolution (Placeholder)

```typescript
// Current: Fixed sample app IDs
return ['0oa111', '0oa222', '0oa333'];

// Future: Real Okta API call
const targets = await rolesClient.listRoleTargets(userId, roleId);
```

**To enable real Okta integration**:
1. Implement `rolesClient.listUserRoles()`
2. Implement `rolesClient.listRoleTargets()`
3. Remove placeholder functions
4. Update authorization-context.ts to use real clients

## Next Steps

1. **Implement Real Okta Integration**
   - Replace placeholder role/target fetching
   - Use rolesClient for real API calls
   - Test with actual Okta tenant

2. **Add Token Refresh**
   - Detect near-expiry tokens
   - Request refresh from MAS
   - Update client with new token

3. **Add Session Management**
   - Track active sessions
   - Invalidate on logout
   - Monitor for suspicious activity

4. **Add Caching**
   - Cache authorization context (short TTL)
   - Invalidate on role changes
   - Balance performance vs freshness

5. **Add Metrics**
   - Track authentication success/failure rates
   - Monitor token expiry patterns
   - Alert on unusual activity

## Files

- `src/auth/mcp-token-validator.ts` - Token validation with comprehensive checks
- `src/policy/authorization-context.ts` - Context resolution with placeholder Okta calls
- `src/mrs/server.ts` - Authentication flow in request handlers
- `scripts/demo-auth-flow.ts` - Demo script with example tokens

## Summary

✅ **Comprehensive token validation** (signature, issuer, audience, expiry, subject)
✅ **Authorization context resolution** from token subject
✅ **Role-based capability mapping** with target constraints
✅ **Fail-closed authentication** (empty tools on auth failure)
✅ **Secure logging** (no raw tokens)
✅ **Re-authorization on every request** (no caching)
✅ **Demo script** with example tokens for all user types
✅ **Placeholder Okta integration** ready for real implementation

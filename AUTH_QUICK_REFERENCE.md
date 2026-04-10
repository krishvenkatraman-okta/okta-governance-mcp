# Authentication Flow Quick Reference

## Run the Demo

```bash
npm run build
npm run demo-auth
```

## Authentication Flow Summary

```
1. Client → MAS: Request MCP access token
2. MAS → Client: MCP access token (JWT)
3. Client → MRS: Call tool (with token)
4. MRS: Validate token → Extract subject → Resolve context
5. MRS → Client: Filtered tools or execution result
```

## MCP Token Format

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

## Validation Checks

- ✅ Signature (RS256 with MAS public key)
- ✅ Issuer (`mcp://okta-governance-mas`)
- ✅ Audience (`mcp://okta-governance-mrs`)
- ✅ Expiry (not expired)
- ✅ Subject (present)
- ✅ Issued-at (not in future)

## Authorization Context

Resolved from token subject:

```typescript
{
  subject: "00u123456",
  roles: {
    superAdmin: false,
    appAdmin: true,
    // ...
  },
  targets: {
    apps: ["0oa111", "0oa222"],
    groups: []
  },
  capabilities: ["entitlements.manage.owned", ...]
}
```

## User Types (Demo)

| Subject | Role | Tools | Targets |
|---------|------|-------|---------|
| `00usuperadmin` | Super Admin | 0 | None |
| `00uappadmin` | App Admin | 8 | 3 apps |
| `00uregularuser` | Regular User | 0 | None |

## Testing with Token

```bash
# 1. Generate token (from demo output)
npm run demo-auth

# 2. Copy token for App Admin
export MCP_ACCESS_TOKEN="eyJhbGci..."

# 3. Start MRS with token
npm run dev:mrs

# 4. MRS authenticates all requests
```

## API Functions

### Token Validation

```typescript
import { validateMcpToken } from './auth/mcp-token-validator.js';

const result = validateMcpToken(token);
if (result.valid) {
  console.log('Subject:', result.payload.sub);
}
```

### Context Resolution

```typescript
import { resolveAuthorizationContextForSubject } from './policy/authorization-context.js';

const context = await resolveAuthorizationContextForSubject('00u123456');
console.log('Roles:', context.roles);
console.log('Capabilities:', context.capabilities);
```

### Tool Filtering

```typescript
import { getAvailableTools } from './mrs/tool-registry.js';

const tools = getAvailableTools(context);
console.log('Available tools:', tools.length);
```

## Fail-Closed Behavior

| Scenario | List Tools | Call Tool |
|----------|-----------|-----------|
| No token | Empty list | Auth error |
| Invalid token | Empty list | Auth error |
| Expired token | Empty list | Auth error |
| Valid token | Filtered tools | Executed with auth |

## Logging

**Logged**:
- Subject (user ID)
- Expiry time
- Session ID
- Roles
- Capabilities

**NOT Logged**:
- Raw tokens
- Signatures
- Full JWT payload

## Files

| File | Purpose |
|------|---------|
| `src/auth/mcp-token-validator.ts` | Token validation |
| `src/policy/authorization-context.ts` | Context resolution |
| `src/mrs/server.ts` | Authentication flow |
| `scripts/demo-auth-flow.ts` | Demo script |

## Next Steps

1. Implement real Okta role/target fetching
2. Connect MAS for token issuance
3. Test with real MCP client
4. Add token refresh flow
5. Add monitoring

## Troubleshooting

**"No MCP access token provided"**
- Set `MCP_ACCESS_TOKEN` environment variable
- Or pass token in request metadata

**"Token validation failed: jwt expired"**
- Token has expired (1 hour default)
- Request new token from MAS

**"Empty tool list"**
- Check token is valid
- Check user has admin roles
- Check user has target resources

**"Authentication failed"**
- Check MAS public key is correct
- Check token audience matches MRS
- Check token issuer is MAS

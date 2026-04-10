# Okta Service App OAuth Implementation Summary

## What Was Implemented

Implemented a production-ready OAuth client for the MCP system to call Okta admin and governance APIs using service app credentials.

### Core Features

✅ **Client Credentials Flow with private_key_jwt**
- Builds signed JWT assertions (RS256)
- Authenticates to org authorization server
- Supports optional kid (key ID) for key rotation

✅ **Token Caching by Scope Set**
- In-memory cache keyed by normalized scopes
- Automatic refresh 60 seconds before expiry
- Separate tokens for different scope sets

✅ **Dynamic Scope Requests**
- Request specific scopes per operation
- Least-privilege access control
- Default scopes for common operations

✅ **Safe Logging**
- Redacts JWT assertions and access tokens
- Debug-level logging for troubleshooting
- Never logs private keys

✅ **Validation Script**
- Tests JWT structure and signing
- Validates scope normalization
- Works without real credentials
- Shows OAuth flow diagram

## Updated Files

### 1. src/okta/service-client.ts (300+ lines)

**Before**: Simple token cache, single scope set
**After**: Scope-based caching, helper functions, safe logging

**New Functions:**
```typescript
// Build JWT assertion for private_key_jwt
export function buildPrivateKeyJwtAssertion(): string

// Get token with specific scopes
export async function getServiceAccessToken(scopes: string[] | string): Promise<string>

// Get token with default scopes
export async function getDefaultServiceAccessToken(): Promise<string>

// Cache management
export function getCachedTokenInfo()
export function clearTokenCache(): void
export function clearTokenCacheForScopes(scopes: string[] | string): void
```

### 2. src/config/okta-config.ts

**Added:**
- `privateKeyKid` - Key ID for JWT header
- `defaultScopes` - Default scope set (from env)
- `orgUrl` - Normalized org URL
- Enhanced validation and documentation

### 3. .env.example

**Added:**
```bash
OKTA_PRIVATE_KEY_KID=your-key-id
OKTA_SCOPES_DEFAULT=okta.apps.read okta.users.read okta.groups.read
```

**Enhanced:** Comprehensive setup instructions

### 4. scripts/validate-okta-oauth.ts (NEW)

Validation script that:
- Generates mock RSA keys for testing
- Validates JWT assertion structure
- Tests scope normalization
- Shows OAuth flow diagram
- Works without real Okta connection

### 5. docs/okta-oauth-implementation.md (NEW)

Complete documentation covering:
- Architecture and flow diagrams
- Implementation details
- Configuration guide
- Usage examples
- Key assumptions
- Security considerations
- Troubleshooting guide

## Example Usage

### Basic: Get Token with Specific Scopes

```typescript
import { getServiceAccessToken } from './okta/service-client.js';

// Request token with specific scopes
const token = await getServiceAccessToken([
  'okta.apps.read',
  'okta.governance.entitlements.read'
]);

// Call Okta API
const response = await fetch('https://your-domain.okta.com/api/v1/apps', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json'
  }
});

const apps = await response.json();
```

### Advanced: Dynamic Scopes

```typescript
import { getServiceAccessToken } from './okta/service-client.js';
import { inferScopesFromEndpoint } from './catalog/scope-mapper.js';

// Tool handler for creating campaign
async function createCampaign(args, context) {
  // Infer required scopes from endpoint metadata
  const scopes = inferScopesFromEndpoint('Campaigns', 'POST');
  // Returns: ['okta.governance.accessCertifications.manage']

  // Get token with inferred scopes
  const token = await getServiceAccessToken(scopes);

  // Call Okta API
  const response = await fetch(
    'https://your-domain.okta.com/governance/api/v1/campaigns',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args)
    }
  );

  return await response.json();
}
```

### Default Scopes

```typescript
import { getDefaultServiceAccessToken } from './okta/service-client.js';

// Get token with configured default scopes
const token = await getDefaultServiceAccessToken();
```

### Cache Management

```typescript
import { getCachedTokenInfo, clearTokenCache } from './okta/service-client.js';

// View cache state (for debugging)
console.log(getCachedTokenInfo());
// [
//   {
//     scopes: "okta.apps.read okta.users.read",
//     expiresAt: "2026-04-09T12:00:00.000Z",
//     expiresIn: 3540,
//     isExpired: false,
//     accessToken: "eyJhbG***dJWyw"
//   }
// ]

// Clear all cached tokens (e.g., on config change)
clearTokenCache();
```

## Testing

```bash
# Build project
npm run build

# Run validation script (no real credentials needed)
npm run validate-okta-oauth

# Expected output:
# ✅ JWT Assertion: PASS
# ✅ Token Caching: PASS
```

## Key Assumptions

1. **Org Authorization Server**: Must use `/oauth2/v1/token`, not custom AS
2. **Scope-Based Caching**: Different scopes = different cache entries
3. **60-Second Buffer**: Refresh tokens 60s before expiry
4. **PEM File Storage**: Private key stored as local file (consider secrets manager for production)
5. **5-Minute JWT Expiry**: Maximum allowed by Okta
6. **Scope Normalization**: Order doesn't matter (`"a b"` == `"b a"`)
7. **In-Memory Cache**: Lost on restart (tokens re-acquired quickly)
8. **Single Tenant**: One Okta org per deployment

## Configuration Checklist

- [ ] Create service app in Okta Admin Console
- [ ] Enable "Client Credentials" grant type
- [ ] Set authentication to "Public key / Private key"
- [ ] Generate RSA key pair (2048-bit minimum)
- [ ] Upload public key to Okta, note kid
- [ ] Grant required OAuth scopes
- [ ] Grant admin consent for all scopes
- [ ] Set OKTA_DOMAIN in .env
- [ ] Set OKTA_CLIENT_ID in .env
- [ ] Set OKTA_PRIVATE_KEY_PATH in .env
- [ ] Set OKTA_PRIVATE_KEY_KID in .env (optional)
- [ ] Set OKTA_SCOPES_DEFAULT in .env (optional)
- [ ] Run validation: `npm run validate-okta-oauth`

## Integration with MRS

The OAuth client is ready to be integrated into MRS tool handlers:

```typescript
// Example: src/tools/governance/list-owned-apps.ts
export const listOwnedAppsTool = {
  name: 'list_owned_apps',
  description: 'List applications owned by the current user',

  async handler(args, context: AuthorizationContext) {
    // Get token with required scopes
    const token = await getServiceAccessToken(['okta.apps.read']);

    // Call Okta API
    const response = await fetch(
      `${config.okta.apiV1}/apps?filter=...`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );

    // Return results
    return await response.json();
  }
};
```

## Next Steps

1. **Implement Tool Handlers**: Use service client in actual governance tool implementations
2. **Add API Error Handling**: Wrap API calls with proper error handling
3. **Add Retry Logic**: Implement exponential backoff for transient failures
4. **Metrics/Monitoring**: Track token requests, cache hit rate, API latency
5. **Production Deployment**: Consider secrets manager for private key storage

## References

- [docs/okta-oauth-implementation.md](./docs/okta-oauth-implementation.md) - Complete documentation
- [Okta OAuth for Service Apps](https://developer.okta.com/docs/guides/implement-oauth-for-okta-serviceapp/main/)
- [docs/architecture.md](./docs/architecture.md) - MCP system architecture
- [docs/scope-inventory.md](./docs/scope-inventory.md) - Available OAuth scopes

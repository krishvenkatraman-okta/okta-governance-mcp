# Okta Service App OAuth Implementation

## Overview

The MCP system uses an Okta service app with client credentials flow and `private_key_jwt` authentication to call Okta admin and governance APIs. This document explains the implementation, assumptions, and usage.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MRS (Resource Server)                   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Service Client (service-client.ts)                  │  │
│  │                                                       │  │
│  │  • Build JWT assertion (private_key_jwt)             │  │
│  │  • Request access token (client credentials)         │  │
│  │  • Cache tokens by scope set                         │  │
│  │  • Refresh before expiry (60s buffer)                │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                │
│                            │ OAuth 2.0 Client Credentials   │
│                            │ + private_key_jwt              │
│                            ▼                                │
└─────────────────────────────────────────────────────────────┘
                             │
                             │ HTTPS
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                     Okta Tenant                             │
│                                                             │
│  /oauth2/v1/token (Org Authorization Server)               │
│  • Validate JWT signature                                  │
│  • Check granted scopes                                    │
│  • Issue access token                                      │
│                                                             │
│  /api/v1/* (Core APIs)                                     │
│  /governance/api/v1/* (Governance APIs)                    │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Details

### 1. JWT Client Assertion (`buildPrivateKeyJwtAssertion`)

Generates a signed JWT for authenticating to Okta's token endpoint:

**Claims:**
- `iss`: Service app client ID
- `sub`: Service app client ID (must match `iss`)
- `aud`: Token endpoint URL (`/oauth2/v1/token`)
- `exp`: Current time + 5 minutes (Okta's max)
- `iat`: Current time
- `jti`: Unique nonce (`{clientId}.{timestamp}.{random}`)

**Signature:**
- Algorithm: RS256 (RSA with SHA-256)
- Key: Service app's private key (PEM format)
- Kid: Key ID from Okta (optional but recommended)

### 2. Token Caching

Tokens are cached in-memory by normalized scope set:

**Cache Key:**
- Scopes sorted alphabetically and joined with space
- Example: `"okta.apps.read okta.groups.read okta.users.read"`

**Cache Behavior:**
- Tokens reused until 60 seconds before expiry
- Automatic refresh on next request
- Separate cache entries for different scope sets

**Why scope-based caching?**
- Different operations need different scopes
- Okta returns different tokens for different scope sets
- Least-privilege: Request only scopes needed for operation

### 3. Token Request (`getServiceAccessToken`)

**Flow:**
1. Normalize requested scopes
2. Check cache for valid token
3. If cache miss or near expiry:
   - Build JWT assertion
   - POST to `/oauth2/v1/token` with:
     - `grant_type=client_credentials`
     - `scope={requested scopes}`
     - `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`
     - `client_assertion={signed JWT}`
4. Cache token with 60-second expiry buffer
5. Return access token

### 4. Safe Logging

All logging redacts sensitive values:
- JWT assertions: Shows first 6 and last 4 characters
- Access tokens: Shows first 6 and last 4 characters
- Private keys: Never logged

Example: `"eyJhbG***dJWyw"`

## Configuration

### Required Environment Variables

```bash
# Okta domain (e.g., dev-12345678.okta.com)
OKTA_DOMAIN=your-domain.okta.com

# Service app client ID
OKTA_CLIENT_ID=0oa...

# Path to private key (PEM format, RS256)
OKTA_PRIVATE_KEY_PATH=./keys/okta-private-key.pem
```

### Optional Environment Variables

```bash
# Key ID from Okta (recommended for key rotation)
OKTA_PRIVATE_KEY_KID=your-key-id

# Token endpoint (defaults to org auth server)
OKTA_TOKEN_URL=https://your-domain.okta.com/oauth2/v1/token

# Default scopes (space-separated)
OKTA_SCOPES_DEFAULT=okta.apps.read okta.users.read okta.groups.read
```

### Setup Steps

1. **Create Service App in Okta Admin Console**
   - Applications > Applications > Create App Integration
   - API Services (OAuth 2.0)
   - Name: "MCP Governance Service"

2. **Configure Authentication**
   - Enable "Client Credentials" grant type
   - Set "Client authentication" to "Public key / Private key"
   - Generate RSA key pair locally (2048-bit minimum)
   - Upload public key to Okta
   - Note the kid (key ID)

3. **Grant OAuth Scopes**
   - Add required scopes (okta.apps.read, okta.governance.*, etc.)
   - Grant admin consent for all scopes

4. **Configure Environment**
   - Set OKTA_DOMAIN, OKTA_CLIENT_ID, OKTA_PRIVATE_KEY_PATH
   - Optionally set OKTA_PRIVATE_KEY_KID
   - Set OKTA_SCOPES_DEFAULT for common operations

## Usage Examples

### Basic Usage

```typescript
import { getServiceAccessToken } from './okta/service-client.js';

// Get token with specific scopes
const token = await getServiceAccessToken([
  'okta.apps.read',
  'okta.governance.entitlements.read'
]);

// Use token to call Okta API
const response = await fetch('https://your-domain.okta.com/api/v1/apps', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json'
  }
});
```

### Default Scopes

```typescript
import { getDefaultServiceAccessToken } from './okta/service-client.js';

// Get token with default scopes
const token = await getDefaultServiceAccessToken();
```

### Dynamic Scopes

```typescript
import { getServiceAccessToken } from './okta/service-client.js';
import { inferScopesFromEndpoint } from './catalog/scope-mapper.js';

// Infer scopes from endpoint metadata
const scopes = inferScopesFromEndpoint('Campaigns', 'POST');
// Returns: ['okta.governance.accessCertifications.manage']

const token = await getServiceAccessToken(scopes);
```

### Cache Management

```typescript
import {
  clearTokenCache,
  clearTokenCacheForScopes,
  getCachedTokenInfo
} from './okta/service-client.js';

// Clear all cached tokens
clearTokenCache();

// Clear token for specific scopes
clearTokenCacheForScopes(['okta.apps.read']);

// View cache state (for debugging)
const cacheInfo = getCachedTokenInfo();
console.log(cacheInfo);
// [
//   {
//     scopes: "okta.apps.read okta.users.read",
//     expiresAt: "2026-04-09T12:00:00.000Z",
//     expiresIn: 3540,
//     isExpired: false,
//     accessToken: "eyJhbG***dJWyw"
//   }
// ]
```

## Key Assumptions

### 1. Org Authorization Server

**Assumption**: Service app uses org authorization server (`/oauth2/v1/token`), not custom authorization server.

**Rationale**:
- Admin and governance APIs require org-level scopes
- Custom authorization servers cannot grant admin scopes
- Org authorization server is the only option for service apps calling admin APIs

**References**:
- [Okta OAuth for Service Apps](https://developer.okta.com/docs/guides/implement-oauth-for-okta-serviceapp/main/)
- docs/architecture.md

### 2. Scope Granularity

**Assumption**: Different operations may require different scopes, so tokens are cached by scope set.

**Rationale**:
- Least-privilege principle: Request only scopes needed
- Okta may return different tokens for different scope sets
- Enables dynamic scope requests based on operation

**Trade-off**: More cache entries vs better security

### 3. Token Expiry Buffer

**Assumption**: Refresh tokens 60 seconds before actual expiry.

**Rationale**:
- Prevents race conditions where token expires during API call
- Accounts for clock skew between systems
- 60 seconds is conservative but safe

### 4. Private Key Storage

**Assumption**: Private key stored as PEM file on local filesystem.

**Rationale**:
- Simple for development and small deployments
- No external dependencies (secrets manager)
- File permissions protect key at rest

**Production Note**: Consider using secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.) for production deployments.

### 5. JWT Expiry

**Assumption**: JWT assertions expire after 5 minutes.

**Rationale**:
- Okta's maximum allowed expiry is 5 minutes
- Short-lived reduces replay attack window
- Long enough to account for clock skew

### 6. Scope Normalization

**Assumption**: Scope order doesn't matter, so `"a b"` and `"b a"` should use same cache entry.

**Rationale**:
- Okta treats scope order as unimportant
- Prevents duplicate cache entries for equivalent scope sets
- Improves cache hit rate

### 7. In-Memory Cache

**Assumption**: Token cache is in-memory only (not persisted).

**Rationale**:
- Tokens are short-lived (typically 1 hour)
- In-memory is fastest
- No need for cache persistence across restarts

**Trade-off**: Cache lost on restart, but tokens re-acquired quickly.

### 8. Single Tenant

**Assumption**: Service client connects to single Okta tenant.

**Rationale**:
- Most deployments are single-tenant
- Simplifies configuration
- Multi-tenant can be added later if needed

## Testing

### Validation Script

```bash
# Run with mock credentials (no real Okta connection)
npm run validate-okta-oauth

# Run with real credentials (requires valid .env)
REAL_AUTH_TEST=true npm run validate-okta-oauth
```

The validation script tests:
- JWT assertion generation and structure
- Scope normalization and cache key generation
- Token caching behavior
- Configuration validation

### Manual Testing

```bash
# Generate RSA key pair (for testing)
npm run generate-keypair

# This creates:
# - keys/okta-private-key.pem
# - keys/okta-public-key.pem
```

## Security Considerations

### 1. Private Key Protection

- Store private key in secure location
- Set restrictive file permissions (chmod 600)
- Never commit to version control (.gitignore includes keys/)
- Consider secrets manager for production

### 2. Scope Principle of Least Privilege

- Request only scopes needed for operation
- Use dynamic scopes when feasible
- Avoid granting unnecessary scopes to service app

### 3. Token Handling

- Never log full tokens (use redaction)
- Clear cache on shutdown if handling sensitive data
- Use HTTPS for all API calls

### 4. JWT Nonce

- Each assertion has unique `jti` (nonce)
- Prevents replay attacks
- Format: `{clientId}.{timestamp}.{randomHex}`

## Troubleshooting

### "invalid_client" Error

**Cause**: JWT signature validation failed

**Solutions**:
- Verify private key matches uploaded public key
- Check kid matches Okta's key ID
- Ensure JWT not expired (check system clock)

### "invalid_scope" Error

**Cause**: Requested scope not granted to service app

**Solutions**:
- Check service app's granted scopes in Okta Admin Console
- Verify admin consent granted for all scopes
- Ensure requesting org-level scopes (not custom AS scopes)

### "Token expired" During API Call

**Cause**: Token expiry buffer too small

**Solutions**:
- Increase buffer in `getServiceAccessToken` (currently 60s)
- Check for significant clock skew between systems

### Cache Not Working

**Cause**: Scope normalization not matching

**Solutions**:
- Check scope format (space-separated, not comma)
- Verify scopes sorted consistently
- Use `getCachedTokenInfo()` to debug cache state

## Files

- `src/okta/service-client.ts` - OAuth client implementation (300+ lines)
- `src/config/okta-config.ts` - Configuration loader with validation
- `scripts/validate-okta-oauth.ts` - Validation and testing script
- `.env.example` - Environment variable template

## References

- [Okta OAuth for Service Apps](https://developer.okta.com/docs/guides/implement-oauth-for-okta-serviceapp/main/)
- [RFC 7523: JWT Bearer Token Grant](https://datatracker.ietf.org/doc/html/rfc7523)
- [RFC 6749: OAuth 2.0 Client Credentials](https://datatracker.ietf.org/doc/html/rfc6749#section-4.4)
- docs/architecture.md - MCP system architecture
- docs/mcp-spec.md - MAS/MRS specification
- docs/scope-inventory.md - Available OAuth scopes

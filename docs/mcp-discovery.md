# MCP Server Discovery and ID-JAG Validation

## Overview

This document describes the MCP server discovery metadata endpoint and the tightened ID-JAG validation logic.

---

## MCP Server Discovery

### Discovery Endpoint

**URL:** `/.well-known/mcp.json`

**Method:** `GET`

**Description:** Returns MCP server metadata describing capabilities, endpoints, authentication requirements, and protocol version according to the Model Context Protocol specification.

### Sample Response

```json
{
  "protocolVersion": "2024-11-05",
  "server": {
    "name": "okta-governance-mcp",
    "version": "1.0.0",
    "vendor": "Okta Identity Governance"
  },
  "transport": {
    "type": "http",
    "url": "http://localhost:3002",
    "endpoint": "/mcp/v1"
  },
  "authentication": {
    "required": true,
    "schemes": ["bearer"],
    "description": "Requires MCP access token issued by MAS. Obtain token via OAuth 2.0 token exchange with Okta ID-JAG."
  },
  "capabilities": {
    "tools": {
      "dynamic": true
    },
    "resources": {
      "dynamic": false,
      "count": 0
    },
    "prompts": {
      "dynamic": false,
      "count": 0
    },
    "sampling": false,
    "logging": false
  },
  "metadata": {
    "description": "MCP server for Okta Identity Governance operations. Provides governance tools for entitlements, campaigns, bundles, labels, and access requests. Authorization is role-based (SUPER_ADMIN, APP_ADMIN, GROUP_ADMIN) with fine-grained capability checks.",
    "documentation": "http://localhost:3002/docs",
    "support": "https://github.com/okta/okta-governance-mcp"
  }
}
```

### Metadata Schema

#### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `protocolVersion` | string | MCP protocol version (e.g., "2024-11-05") |
| `server` | object | Server information |
| `transport` | object | Transport configuration |
| `authentication` | object | Authentication requirements |
| `capabilities` | object | Server capabilities |
| `metadata` | object | Additional metadata |

#### Server Object

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Server name |
| `version` | string | Server version |
| `vendor` | string | Vendor/organization name |

#### Transport Object

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Transport type: "stdio", "http", or "sse" |
| `url` | string | Base URL for HTTP/SSE transports |
| `endpoint` | string | API endpoint path |

#### Authentication Object

| Field | Type | Description |
|-------|------|-------------|
| `required` | boolean | Whether authentication is required |
| `schemes` | array | Supported auth schemes (e.g., ["bearer"]) |
| `description` | string | Authentication description |

#### Capabilities Object

| Field | Type | Description |
|-------|------|-------------|
| `tools` | object | Tool capabilities |
| `tools.dynamic` | boolean | Whether tools are dynamically filtered |
| `tools.count` | number | Static tool count (if not dynamic) |
| `resources` | object | Resource capabilities |
| `prompts` | object | Prompt capabilities |
| `sampling` | boolean | Whether server supports sampling |
| `logging` | boolean | Whether server supports logging |

---

## Tightened ID-JAG Validation

### Overview

ID-JAG (Identity JWT with Authentication Grant) tokens from Okta are validated with comprehensive checks before token exchange to MCP tokens.

### Validation Checks

1. **Signature Verification**
   - Uses Okta JWKS (JSON Web Key Set)
   - Fetches public keys from `ID_JAG_JWKS_URI`
   - Supports key rotation with caching
   - Rate-limited JWKS requests (10/minute)

2. **Issuer Validation**
   - Validates `iss` claim matches `ID_JAG_ISSUER`
   - Example: `https://qa-aiagentsproduct2tc1.trexcloud.com/oauth2/default`

3. **Audience Validation**
   - Validates `aud` claim matches `ID_JAG_AUDIENCE`
   - Example: `api://mcp-governance`

4. **Expiry Validation**
   - Validates `exp` claim (token not expired)
   - Clock skew tolerance: 5 minutes

5. **Not-Before Validation**
   - Validates `nbf` claim (if present)
   - Token not used before specified time

6. **Required Claims**
   - `sub` (subject/user ID) - required
   - `iat` (issued-at) - required
   - `exp` (expiry) - required
   - Validates claim types and formats

7. **Clock Skew Protection**
   - Rejects tokens issued in the future
   - 5-minute tolerance for clock differences

### Validation Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. Receive ID-JAG Token                                 │
│    (from Authorization: Bearer header)                  │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Format Validation                                    │
│    • Check token is non-empty string                    │
│    • No token content logging                           │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Fetch Signing Key from JWKS                          │
│    • Extract kid from JWT header                        │
│    • Fetch public key from Okta JWKS endpoint           │
│    • Use cached key if available                        │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Verify Signature                                     │
│    • Verify JWT signature using public key             │
│    • Algorithm: RS256                                   │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Validate Standard Claims                             │
│    • Issuer (iss) matches configured issuer             │
│    • Audience (aud) matches configured audience         │
│    • Expiry (exp) not in the past                       │
│    • Not-before (nbf) in the past (if present)          │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 6. Validate Required Claims                             │
│    • Subject (sub) present and valid                    │
│    • Issued-at (iat) present and not in future          │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 7. Return Validation Result                             │
│    Success: { valid: true, payload, claims }            │
│    Failure: { valid: false, error, errors }             │
└─────────────────────────────────────────────────────────┘
```

### Structured Validation Errors

When validation fails, structured errors are returned:

```typescript
{
  valid: false,
  error: "ID-JAG validation failed: Token expired",
  errors: [
    {
      code: "TOKEN_EXPIRED",
      message: "Token has expired",
      details: "exp: 2026-04-09T12:00:00Z, now: 2026-04-09T13:00:00Z"
    }
  ]
}
```

#### Error Codes

| Code | Description |
|------|-------------|
| `INVALID_FORMAT` | Token is not a valid string |
| `MISSING_KID` | JWT header missing kid (key ID) |
| `JWKS_FETCH_FAILED` | Failed to fetch signing key from JWKS |
| `INVALID_SIGNATURE` | Signature verification failed |
| `TOKEN_EXPIRED` | Token has expired |
| `TOKEN_NOT_YET_VALID` | Token not-before time not reached |
| `TOKEN_ISSUED_IN_FUTURE` | Token issued-at is in the future |
| `INVALID_ISSUER` | Issuer doesn't match expected value |
| `INVALID_AUDIENCE` | Audience doesn't match expected value |
| `MISSING_SUBJECT` | Subject (sub) claim missing or invalid |
| `MISSING_IAT` | Issued-at (iat) claim missing or invalid |

### Security Features

1. **No Token Logging**
   - Raw tokens are never logged
   - Only token metadata logged (length, format)
   - Claims logged after validation (no sensitive data)

2. **JWKS Caching**
   - Public keys cached for 24 hours
   - Reduces JWKS endpoint load
   - Automatic cache refresh on key rotation

3. **Rate Limiting**
   - Maximum 10 JWKS requests per minute
   - Prevents DoS on JWKS endpoint

4. **Clock Skew Tolerance**
   - 5-minute tolerance for clock differences
   - Prevents false rejections from time drift

5. **Timeout Protection**
   - 30-second timeout for JWKS requests
   - Prevents hanging on network issues

### Example Usage

#### Successful Validation

```typescript
import { validateIdJag } from './auth/id-jag-validator.js';

const token = 'eyJhbGci...'; // ID-JAG from Okta
const result = await validateIdJag(token);

if (result.valid) {
  console.log('User:', result.payload.sub);
  console.log('Expires:', result.claims.expiresAt);
  // Proceed with token exchange to MCP token
} else {
  console.error('Validation failed:', result.error);
  console.error('Errors:', result.errors);
  // Return 401 Unauthorized
}
```

#### Validation Logs (Safe)

```
[ID-JAG] Validating token {
  tokenLength: 543,
  hasBearer: false
}
[ID-JAG] Validation successful: {
  subject: '00u8uqjojqqmM8zwy0g7',
  expiresAt: '2026-04-09T13:00:00.000Z'
}
```

**Note:** Raw token is never logged, only metadata.

---

## Complete Authentication Flow

### 1. Client Obtains ID-JAG from Okta

```
Client → Okta Authorization Server
  Grant Type: authorization_code or implicit
  Response: ID-JAG (JWT)
```

### 2. Client Discovers MCP Server

```http
GET /.well-known/mcp.json HTTP/1.1
Host: localhost:3002

HTTP/1.1 200 OK
Content-Type: application/json

{
  "protocolVersion": "2024-11-05",
  "authentication": {
    "required": true,
    "schemes": ["bearer"]
  },
  "transport": {
    "type": "http",
    "endpoint": "/mcp/v1"
  }
}
```

### 3. Client Exchanges ID-JAG for MCP Token

```http
POST /token-exchange HTTP/1.1
Host: localhost:3000  # MAS server
Authorization: Bearer <ID-JAG>

HTTP/1.1 200 OK
Content-Type: application/json

{
  "access_token": "eyJhbGci...",  # MCP access token
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**MAS validates ID-JAG using steps described above.**

### 4. Client Calls MRS with MCP Token

```http
POST /mcp/v1/tools/list HTTP/1.1
Host: localhost:3002  # MRS server
Authorization: Bearer <MCP-token>
Content-Type: application/json

{}
```

**MRS validates MCP token (different validation - signature from MAS).**

### 5. MRS Returns Tools

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "tools": [
    {
      "name": "list_owned_apps",
      "description": "..."
    }
  ]
}
```

---

## Configuration

### Environment Variables

```bash
# ID-JAG Validation (MAS)
ID_JAG_ISSUER=https://your-domain.okta.com/oauth2/default
ID_JAG_AUDIENCE=api://mcp-governance
ID_JAG_JWKS_URI=https://your-domain.okta.com/oauth2/default/v1/keys

# MRS Server Discovery
MRS_BASE_URL=http://localhost:3002
MRS_SERVER_NAME=okta-governance-mcp
MRS_SERVER_VERSION=1.0.0
```

---

## Testing

### Test Discovery Endpoint

```bash
curl http://localhost:3002/.well-known/mcp.json | jq .
```

### Test ID-JAG Validation

```typescript
// In a test file
import { validateIdJag } from './auth/id-jag-validator.js';

const testToken = '...'; // Valid ID-JAG from Okta
const result = await validateIdJag(testToken);

console.assert(result.valid === true);
console.assert(result.payload?.sub);
console.assert(result.claims?.expiresAt);
```

### Validate Error Handling

```typescript
// Test expired token
const expiredToken = '...';
const result = await validateIdJag(expiredToken);

console.assert(result.valid === false);
console.assert(result.errors?.[0]?.code === 'TOKEN_EXPIRED');
```

---

## Troubleshooting

### Issue: "Failed to fetch signing key from JWKS"

**Cause:** JWKS endpoint unreachable or kid not found

**Solution:**
- Verify `ID_JAG_JWKS_URI` is correct
- Check network connectivity to Okta
- Verify token `kid` header exists

### Issue: "Invalid issuer"

**Cause:** Token issuer doesn't match `ID_JAG_ISSUER`

**Solution:**
- Verify `ID_JAG_ISSUER` matches Okta auth server issuer
- Check token was issued by correct auth server

### Issue: "Token expired"

**Cause:** Token `exp` claim is in the past

**Solution:**
- Token has expired, client needs to obtain new token
- Check client/server clock synchronization

### Issue: "Token issued in the future"

**Cause:** Token `iat` claim is more than 5 minutes in the future

**Solution:**
- Check server clock synchronization
- Verify Okta auth server time is correct

---

## Security Recommendations

1. **Always Use HTTPS in Production**
   - Discovery endpoint should be served over HTTPS
   - Prevents MITM attacks on metadata

2. **Keep JWKS Cache Fresh**
   - Current: 24-hour cache
   - Okta rotates keys periodically
   - Automatic refresh on cache miss

3. **Monitor Validation Failures**
   - Track validation error codes
   - Alert on sustained failures
   - May indicate attack or misconfiguration

4. **Rate Limit Token Validation**
   - Prevent brute force attempts
   - Use separate rate limiting for token validation

5. **Audit Token Usage**
   - Log validation attempts (without tokens)
   - Track subject IDs and usage patterns
   - Monitor for suspicious activity

---

## References

- [Model Context Protocol Specification](https://modelcontextprotocol.io)
- [Okta OAuth 2.0 Documentation](https://developer.okta.com/docs/reference/api/oidc/)
- [JWT RFC 7519](https://datatracker.ietf.org/doc/html/rfc7519)
- [JWKS RFC 7517](https://datatracker.ietf.org/doc/html/rfc7517)

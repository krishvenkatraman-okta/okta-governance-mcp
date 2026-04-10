# Access Token Exchange Implementation

## Overview

Implemented the ID-JAG → MCP access token exchange using Okta's JWT bearer grant with the custom authorization server.

---

## Updated Route

**`app/api/token/access-token/route.ts`** - Now fully functional (179 lines)

### Key Features

1. **Accepts ID-JAG** from request body (temporary until session management)
2. **Uses JWT bearer grant** (`urn:ietf:params:oauth:grant-type:jwt-bearer`)
3. **Makes request to CUSTOM auth server** token endpoint
4. **Conditional client authentication** (client_secret if configured, else public client)
5. **Error handling** for Okta errors and network failures
6. **Returns metadata only** (not full MCP access token)
7. **Minimal logging** (no token values logged)

---

## Example Request Payload (to Okta)

The route makes the following request to Okta:

```http
POST https://{domain}/oauth2/{serverId}/v1/token
Content-Type: application/x-www-form-urlencoded
Accept: application/json

grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
&assertion=<id_jag>
&client_id=<user_oauth_client_id>
&client_secret=<user_client_secret>
```

### Parameters Explained

| Parameter | Value | Description | Required |
|-----------|-------|-------------|----------|
| `grant_type` | `urn:ietf:params:oauth:grant-type:jwt-bearer` | JWT bearer grant type (RFC 7523) | Yes |
| `assertion` | `<id_jag>` | ID-JAG token from previous exchange | Yes |
| `client_id` | `<user_oauth_client_id>` | USER OAuth client ID | Yes |
| `client_secret` | `<user_client_secret>` | USER client secret (if confidential) | Conditional |

### Grant Type: JWT Bearer (RFC 7523)

The JWT bearer grant allows exchanging a JWT (in this case, the ID-JAG) for an access token without requiring user interaction.

**Key characteristics:**
- ID-JAG serves as the "assertion" (proof of authentication)
- Scopes are inherited from the ID-JAG
- No additional user consent required
- Used for service-to-service or delegated access

---

## Expected Okta Response Shape

### Success Response (200 OK)

```json
{
  "access_token": "eyJraWQiOiJ...<MCP access token>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "governance:mcp"
}
```

**Fields:**
- `access_token` - The MCP access token (JWT format)
- `token_type` - Always "Bearer"
- `expires_in` - Token lifetime in seconds
- `scope` - Scopes granted (inherited from ID-JAG)

**Note:** The response may not include `issued_token_type` for JWT bearer grants, unlike token exchange grants.

### Error Response (4xx/5xx)

```json
{
  "error": "invalid_grant",
  "error_description": "The assertion is invalid or expired."
}
```

**Common Errors:**

| Error Code | Description | Cause |
|------------|-------------|-------|
| `invalid_grant` | Assertion invalid | ID-JAG expired or malformed |
| `invalid_client` | Client authentication failed | Invalid client_id or client_secret |
| `invalid_scope` | Scope not allowed | Requested scope not in ID-JAG |
| `unauthorized_client` | Client not authorized | USER client not configured for JWT bearer |

---

## API Response (from /api/token/access-token)

### Success Response

```json
{
  "success": true,
  "message": "MCP access token exchange successful",
  "metadata": {
    "token_type": "Bearer",
    "expires_in": 3600,
    "scope": "governance:mcp",
    "claims": {
      "iss": "https://your-domain.okta.com/oauth2/default",
      "sub": "00u1234567890abcdef",
      "aud": "api://mcp-governance",
      "exp": 1704070800,
      "iat": 1704067200,
      "scp": ["governance:mcp"]
    }
  },
  "next_step": "Store MCP access token in session and use to call MCP server"
}
```

**Security Note:** Full MCP access token is NOT returned, only metadata.

### Error Response

```json
{
  "error": "Access token exchange failed",
  "okta_error": "invalid_grant",
  "okta_error_description": "The assertion is invalid or expired.",
  "status": 400
}
```

---

## Implementation Details

### 1. Request Validation

```typescript
const body = await request.json();
const idJag = body.id_jag;

if (!idJag) {
  return NextResponse.json(
    { error: 'Missing ID-JAG', message: 'id_jag is required in request body' },
    { status: 400 }
  );
}
```

### 2. JWT Bearer Grant Request

```typescript
const requestBody = new URLSearchParams({
  grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
  assertion: idJag,
  client_id: config.okta.userOAuthClient.clientId,
});

// Add client_secret if configured (for confidential clients)
if (config.okta.userOAuthClient.clientSecret) {
  requestBody.append('client_secret', config.okta.userOAuthClient.clientSecret);
}
```

### 3. Token Exchange Request

```typescript
const response = await fetch(tokenEndpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  },
  body: requestBody.toString(),
});
```

### 4. Error Handling

```typescript
if (!response.ok) {
  const errorData = await response.json();
  console.error('[Access Token Exchange] Okta error:', {
    status: response.status,
    error: errorData.error,
    description: errorData.error_description,
  });

  return NextResponse.json(
    {
      error: 'Access token exchange failed',
      okta_error: errorData.error,
      okta_error_description: errorData.error_description,
      status: response.status,
    },
    { status: response.status }
  );
}
```

### 5. Response Processing

```typescript
const tokenResponse = await response.json();
const mcpAccessToken = tokenResponse.access_token;
const decoded = decodeJwt(mcpAccessToken);

const claims: Record<string, unknown> = {
  iss: decoded.iss,
  sub: decoded.sub,
  aud: decoded.aud,
  exp: decoded.exp,
  iat: decoded.iat,
};

if (decoded.scp) {
  claims.scp = decoded.scp;
}

return NextResponse.json({
  success: true,
  metadata: {
    token_type: tokenResponse.token_type,
    expires_in: tokenResponse.expires_in,
    scope: tokenResponse.scope,
    claims,
  },
});
```

---

## Logging Strategy

### What IS Logged

✅ Operation start/completion
```typescript
console.log('[Access Token Exchange] Starting JWT bearer exchange for USER client');
console.log('[Access Token Exchange] Calling CUSTOM auth server:', tokenEndpoint);
```

✅ Client authentication type
```typescript
console.log('[Access Token Exchange] Using confidential client authentication');
// or
console.log('[Access Token Exchange] Using public client (no secret)');
```

✅ Response metadata
```typescript
console.log('[Access Token Exchange] Token exchange successful', {
  token_type: tokenResponse.token_type,
  expires_in: tokenResponse.expires_in,
  scope: tokenResponse.scope,
});
```

✅ Error details (without tokens)
```typescript
console.error('[Access Token Exchange] Okta error:', {
  status: response.status,
  error: errorData.error,
  description: errorData.error_description,
});
```

### What is NOT Logged

❌ ID-JAG tokens
❌ MCP access tokens
❌ Client secrets
❌ Full JWT payloads

---

## Testing

### 1. Test with Valid ID-JAG

```bash
curl -X POST http://localhost:3000/api/token/access-token \
  -H "Content-Type: application/json" \
  -d '{
    "id_jag": "eyJraWQiOiJ..."
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "MCP access token exchange successful",
  "metadata": { ... }
}
```

### 2. Test with Missing ID-JAG

```bash
curl -X POST http://localhost:3000/api/token/access-token \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response:**
```json
{
  "error": "Missing ID-JAG",
  "message": "id_jag is required in request body"
}
```

### 3. Test with Invalid ID-JAG

```bash
curl -X POST http://localhost:3000/api/token/access-token \
  -H "Content-Type: application/json" \
  -d '{
    "id_jag": "invalid-token"
  }'
```

**Expected Response:**
```json
{
  "error": "Access token exchange failed",
  "okta_error": "invalid_grant",
  "okta_error_description": "The assertion is invalid or expired.",
  "status": 400
}
```

---

## Security Considerations

### ✅ Implemented

1. **No token exposure in responses**
   - Only metadata returned
   - Full MCP access token not exposed to client

2. **Minimal logging**
   - No tokens logged
   - Only operation status and errors

3. **Conditional client authentication**
   - Uses client_secret if configured
   - Supports public clients (no secret)

4. **Input validation**
   - ID-JAG presence check
   - Error handling for malformed requests

5. **Error handling**
   - Okta errors properly surfaced
   - Network failures caught
   - No sensitive data in error messages

### 🔄 TODO (Future)

1. **Session management**
   - Store MCP access token securely in session
   - Remove ID-JAG from request body

2. **Token validation**
   - Verify ID-JAG signature before use
   - Check expiration

3. **Rate limiting**
   - Prevent abuse of token exchange endpoint

---

## Client Authentication

### Public Client (No Secret)

If the USER OAuth client is a public client (e.g., SPA with PKCE):

```http
POST /oauth2/{serverId}/v1/token

grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
&assertion=<id_jag>
&client_id=<user_client_id>
```

**No `client_secret` parameter needed.**

### Confidential Client (With Secret)

If the USER OAuth client is confidential:

```http
POST /oauth2/{serverId}/v1/token

grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
&assertion=<id_jag>
&client_id=<user_client_id>
&client_secret=<user_client_secret>
```

**Implementation automatically detects and includes `client_secret` if configured.**

---

## Complete Token Flow

```
┌──────────────────────────────────────────────────────────┐
│ Step 1: User Login                                       │
│ ──────────────────────────────────────────────────────   │
│ Result: ID token + ORG access token                      │
└──────────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────────┐
│ Step 2: ID-JAG Exchange                                  │
│ ──────────────────────────────────────────────────────   │
│ Input: ID token                                          │
│ Client: AGENT (signed client assertion)                 │
│ Server: ORG                                              │
│ Result: ID-JAG (governance:mcp scope)                    │
└──────────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────────┐
│ Step 3: Access Token Exchange (THIS IMPLEMENTATION)     │
│ ──────────────────────────────────────────────────────   │
│ Input: ID-JAG                                            │
│ Grant: JWT Bearer                                        │
│ Client: USER (client_id + optional client_secret)       │
│ Server: CUSTOM                                           │
│ Result: MCP access token (governance:mcp scope)         │
└──────────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────────┐
│ Step 4: Call MCP Server (Future)                        │
│ ──────────────────────────────────────────────────────   │
│ Authorization: Bearer <mcp_access_token>                 │
│ Result: MCP resources and operations                     │
└──────────────────────────────────────────────────────────┘
```

---

## Configuration Required

### Environment Variables

```bash
# USER OAuth Client
NEXT_PUBLIC_OKTA_USER_OAUTH_CLIENT_ID=0oa...

# Optional: Only for confidential clients
OKTA_USER_OAUTH_CLIENT_SECRET=secret123

# Custom Authorization Server
NEXT_PUBLIC_OKTA_CUSTOM_AUTH_SERVER_ID=default
```

### Okta Configuration

1. **Custom Authorization Server** must be configured
2. **JWT bearer grant** enabled for USER client
3. **governance:mcp** scope defined in custom auth server
4. **Token exchange policy** allows ID-JAG → access token

---

## Assumptions

### 1. Grant Type

**Assumption:** Using JWT bearer grant (`urn:ietf:params:oauth:grant-type:jwt-bearer`) instead of token exchange grant.

**Reason:** JWT bearer grant is the standard OAuth 2.0 flow for exchanging JWTs for access tokens (RFC 7523).

**Alternative:** Token exchange grant (`urn:ietf:params:oauth:grant-type:token-exchange`) could also work, but requires additional parameters (`subject_token_type`, `requested_token_type`).

### 2. Client Authentication

**Assumption:** USER client can be either:
- Public client (no client_secret) - Common for SPAs
- Confidential client (with client_secret) - Common for web apps

**Implementation:** Automatically detects and uses client_secret if configured.

### 3. Scope Inheritance

**Assumption:** MCP access token inherits scopes from ID-JAG.

**No explicit scope parameter** is sent in the request, as the ID-JAG already contains the required `governance:mcp` scope.

### 4. Audience

**Assumption:** No explicit `audience` parameter is needed.

**Reason:** The custom authorization server already knows the audience from the ID-JAG and server configuration.

---

## Next Steps

1. **Implement session management**
   - Store ID-JAG from previous exchange
   - Retrieve ID-JAG from session
   - Store MCP access token in session after exchange

2. **Implement MCP server calls**
   - Use MCP access token to call MCP server
   - Implement tool discovery
   - Implement tool execution

3. **Remove request body requirement**
   - Get ID-JAG from session
   - Remove `id_jag` from request body

4. **Add token validation**
   - Verify ID-JAG signature before exchange
   - Check token expiration
   - Handle token refresh

---

## Verification Checklist

- [x] Access token exchange endpoint implemented
- [x] JWT bearer grant integration
- [x] CUSTOM auth server request
- [x] Conditional client authentication
- [x] Error handling
- [x] Response metadata only (no full tokens)
- [x] Minimal logging (no tokens logged)
- [x] TypeScript compilation passes
- [x] Build successful
- [ ] Session management (future)
- [ ] MCP server integration (future)

---

## Summary

**Implemented:** Full ID-JAG → MCP access token exchange with JWT bearer grant

**Key Features:**
- ✅ Uses JWT bearer grant (RFC 7523)
- ✅ Calls CUSTOM authorization server
- ✅ Conditional client authentication (public/confidential)
- ✅ Proper error handling for Okta errors
- ✅ Returns metadata only (security)
- ✅ Minimal logging (no tokens)
- ✅ Server-side only (secure)

**Next:** Session management and MCP server integration

**This completes the three-step token exchange flow!**
1. ✅ Login → ID token + ORG access token
2. ✅ ID token → ID-JAG (AGENT client, ORG server)
3. ✅ ID-JAG → MCP access token (USER client, CUSTOM server)

# ID-JAG Exchange Implementation

## Overview

Implemented the ID token → ID-JAG exchange using Okta's token exchange grant with client assertion authentication.

---

## Updated Route

**`app/api/token/id-jag/route.ts`** - Now fully functional

### Key Features

1. **Accepts ID token** from request body (temporary until session management)
2. **Builds client assertion** using `buildAgentClientAssertion()`
3. **Makes token exchange request** to Okta ORG authorization server
4. **Error handling** for Okta errors and network failures
5. **Returns metadata only** (not full ID-JAG token)
6. **Minimal logging** (no token values logged)

### Request Flow

```typescript
POST /api/token/id-jag
Content-Type: application/json

{
  "id_token": "<id_token_from_user_login>"
}
```

---

## Example Request Payload (to Okta)

The route makes the following request to Okta:

```http
POST https://{domain}/oauth2/v1/token
Content-Type: application/x-www-form-urlencoded
Accept: application/json

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&requested_token_type=urn:ietf:params:oauth:token-type:id-jag
&subject_token=<id_token>
&subject_token_type=urn:ietf:params:oauth:token-type:id_token
&audience=https://{domain}/oauth2/{custom_auth_server_id}
&scope=governance:mcp
&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
&client_assertion=<signed_jwt>
```

### Parameters Explained

| Parameter | Value | Description |
|-----------|-------|-------------|
| `grant_type` | `urn:ietf:params:oauth:grant-type:token-exchange` | OAuth token exchange grant type |
| `requested_token_type` | `urn:ietf:params:oauth:token-type:id-jag` | Request ID-JAG token |
| `subject_token` | `<id_token>` | ID token from user login |
| `subject_token_type` | `urn:ietf:params:oauth:token-type:id_token` | Subject is an ID token |
| `audience` | `https://{domain}/oauth2/{server_id}` | Custom auth server issuer |
| `scope` | `governance:mcp` | MCP resource scope (from `oktaScopes.mcpResource`) |
| `client_assertion_type` | `urn:ietf:params:oauth:client-assertion-type:jwt-bearer` | Client authentication via JWT |
| `client_assertion` | `<signed_jwt>` | Signed JWT (built by `buildAgentClientAssertion()`) |

### Client Assertion Details

The `client_assertion` is a signed JWT with:

**Header:**
```json
{
  "alg": "RS256",
  "kid": "{agent_key_id}"
}
```

**Payload:**
```json
{
  "iss": "{agent_client_id}",
  "sub": "{agent_client_id}",
  "aud": "https://{domain}/oauth2/v1/token",
  "iat": 1704067200,
  "exp": 1704067500,
  "jti": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Signature:** RS256 with agent private key

---

## Expected Okta Response Shape

### Success Response (200 OK)

```json
{
  "access_token": "eyJraWQiOiJ...<ID-JAG token>",
  "issued_token_type": "urn:ietf:params:oauth:token-type:id-jag",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "governance:mcp"
}
```

**Fields:**
- `access_token` - The ID-JAG token (JWT format)
- `issued_token_type` - Confirms ID-JAG was issued
- `token_type` - Always "Bearer"
- `expires_in` - Token lifetime in seconds
- `scope` - Scopes granted (should match requested scope)

### Error Response (4xx/5xx)

```json
{
  "error": "invalid_grant",
  "error_description": "The subject_token is invalid or expired."
}
```

**Common Errors:**

| Error Code | Description | Cause |
|------------|-------------|-------|
| `invalid_grant` | Subject token invalid | ID token expired or malformed |
| `invalid_client` | Client authentication failed | Invalid client assertion |
| `invalid_scope` | Scope not allowed | `governance:mcp` not configured |
| `invalid_request` | Malformed request | Missing required parameter |
| `unauthorized_client` | Client not authorized | Agent client not configured for token exchange |

---

## API Response (from /api/token/id-jag)

### Success Response

```json
{
  "success": true,
  "message": "ID-JAG exchange successful",
  "metadata": {
    "issued_token_type": "urn:ietf:params:oauth:token-type:id-jag",
    "token_type": "Bearer",
    "expires_in": 3600,
    "scope": "governance:mcp",
    "claims": {
      "iss": "https://your-domain.okta.com/oauth2/v1",
      "sub": "00u1234567890abcdef",
      "aud": "https://your-domain.okta.com/oauth2/default",
      "exp": 1704070800,
      "iat": 1704067200,
      "scp": ["governance:mcp"]
    }
  },
  "next_step": "Store ID-JAG in session and use for access token exchange"
}
```

**Security Note:** Full ID-JAG token is NOT returned, only metadata.

### Error Response

```json
{
  "error": "Token exchange failed",
  "okta_error": "invalid_grant",
  "okta_error_description": "The subject_token is invalid or expired.",
  "status": 400
}
```

---

## Implementation Details

### 1. Request Validation

```typescript
const body = await request.json();
const idToken = body.id_token;

if (!idToken) {
  return NextResponse.json(
    { error: 'Missing ID token', message: 'id_token is required in request body' },
    { status: 400 }
  );
}
```

### 2. Client Assertion Generation

```typescript
const clientAssertion = await buildAgentClientAssertion({
  audience: config.okta.orgAuthServer.tokenEndpoint,
});
```

### 3. Token Exchange Request

```typescript
const requestBody = new URLSearchParams({
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  requested_token_type: 'urn:okta:oauth:token-type:id_jag',
  subject_token: idToken,
  subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
  audience: config.okta.customAuthServer.issuer,
  scope: oktaScopes.mcpResource.join(' '),
  client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
  client_assertion: clientAssertion,
});

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
  console.error('[ID-JAG Exchange] Okta error:', {
    status: response.status,
    error: errorData.error,
    description: errorData.error_description,
  });

  return NextResponse.json(
    {
      error: 'Token exchange failed',
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
const idJagToken = tokenResponse.access_token;
const decoded = decodeJwt(idJagToken);

// Return metadata only (NOT full token)
return NextResponse.json({
  success: true,
  metadata: {
    issued_token_type: tokenResponse.issued_token_type,
    claims: {
      iss: decoded.iss,
      sub: decoded.sub,
      aud: decoded.aud,
      exp: decoded.exp,
      iat: decoded.iat,
    },
  },
});
```

---

## Logging Strategy

### What IS Logged

✅ Operation start/completion
```typescript
console.log('[ID-JAG Exchange] Starting token exchange for agent client');
console.log('[ID-JAG Exchange] Client assertion generated successfully');
console.log('[ID-JAG Exchange] Calling Okta token endpoint:', tokenEndpoint);
```

✅ Response metadata
```typescript
console.log('[ID-JAG Exchange] Token exchange successful', {
  issued_token_type: tokenResponse.issued_token_type,
  token_type: tokenResponse.token_type,
  expires_in: tokenResponse.expires_in,
  scope: tokenResponse.scope,
});
```

✅ Error details (without tokens)
```typescript
console.error('[ID-JAG Exchange] Okta error:', {
  status: response.status,
  error: errorData.error,
  description: errorData.error_description,
});
```

### What is NOT Logged

❌ ID tokens
❌ ID-JAG tokens
❌ Client assertions
❌ Full JWT payloads

---

## Testing

### 1. Test with Valid ID Token

```bash
curl -X POST http://localhost:3000/api/token/id-jag \
  -H "Content-Type: application/json" \
  -d '{
    "id_token": "eyJraWQiOiJ..."
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "ID-JAG exchange successful",
  "metadata": { ... }
}
```

### 2. Test with Missing ID Token

```bash
curl -X POST http://localhost:3000/api/token/id-jag \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response:**
```json
{
  "error": "Missing ID token",
  "message": "id_token is required in request body"
}
```

### 3. Test with Invalid ID Token

```bash
curl -X POST http://localhost:3000/api/token/id-jag \
  -H "Content-Type: application/json" \
  -d '{
    "id_token": "invalid-token"
  }'
```

**Expected Response:**
```json
{
  "error": "Token exchange failed",
  "okta_error": "invalid_grant",
  "okta_error_description": "The subject_token is invalid or expired.",
  "status": 400
}
```

---

## Security Considerations

### ✅ Implemented

1. **No token exposure in responses**
   - Only metadata returned
   - Full ID-JAG not exposed to client

2. **Minimal logging**
   - No tokens logged
   - Only operation status and errors

3. **Client assertion security**
   - Private key server-side only
   - Short-lived assertions (5 minutes)
   - Unique JTI per request

4. **Input validation**
   - ID token presence check
   - Error handling for malformed requests

5. **Error handling**
   - Okta errors properly surfaced
   - Network failures caught
   - No sensitive data in error messages

### 🔄 TODO (Future)

1. **Session management**
   - Store ID-JAG securely in session
   - Remove ID token from request body

2. **Rate limiting**
   - Prevent abuse of token exchange endpoint

3. **Request logging**
   - Track exchange requests (without tokens)
   - Monitor for unusual patterns

---

## Next Steps

1. **Implement session management**
   - Store ID token from login
   - Retrieve ID token from session
   - Store ID-JAG in session after exchange

2. **Implement access token exchange**
   - Use ID-JAG from session
   - Exchange for MCP access token
   - Store access token in session

3. **Remove request body requirement**
   - Get ID token from session
   - Remove `id_token` from request body

4. **Add session expiry handling**
   - Check token expiration
   - Refresh tokens as needed

---

## Configuration Required

### Environment Variables

All agent configuration must be set:

```bash
# Agent OAuth client
NEXT_PUBLIC_OKTA_AGENT_CLIENT_ID=0oa...
NEXT_PUBLIC_OKTA_AGENT_ID=agent-...
NEXT_PUBLIC_OKTA_AGENT_KEY_ID=kid-...

# Agent private key (server-side only)
AGENT_PRIVATE_KEY_JWK={"kty":"RSA",...}
# OR
AGENT_PRIVATE_KEY_PATH=/path/to/key.pem
```

### Okta Configuration

1. **Agent OAuth Client** must be registered in Okta
2. **Public key** uploaded to Okta for the agent
3. **Token exchange grant** enabled for agent client
4. **private_key_jwt** authentication method configured
5. **governance:mcp** scope defined in custom auth server
6. **Token exchange policy** allows ID token → ID-JAG exchange

---

## Verification Checklist

- [x] ID-JAG exchange endpoint implemented
- [x] Client assertion integration
- [x] Okta token endpoint request
- [x] Error handling
- [x] Response metadata only (no full tokens)
- [x] Minimal logging (no tokens logged)
- [x] TypeScript compilation passes
- [x] Build successful
- [ ] Session management (future)
- [ ] Access token exchange (future)

---

## Summary

**Implemented:** Full ID token → ID-JAG exchange with client assertion authentication

**Key Features:**
- ✅ Uses `buildAgentClientAssertion()` for secure authentication
- ✅ Makes token exchange request to Okta ORG server
- ✅ Proper error handling for Okta errors
- ✅ Returns metadata only (security)
- ✅ Minimal logging (no tokens)
- ✅ Server-side only (secure)

**Next:** Session management and access token exchange

# Client Assertion Implementation Guide

## Overview

Implemented JWT-based client assertion for ID-JAG exchange, enabling secure agent authentication without client secrets.

---

## Files Created

### 1. `lib/agent-client-assertion.ts` (224 lines)

Core utility for building and validating client assertions.

**Main Functions:**

- **`buildAgentClientAssertion(options)`** - Builds and signs JWT
  - Loads private key from JWK string or PEM file
  - Creates JWT with required claims
  - Signs with RS256 algorithm
  - Returns signed JWT string

- **`decodeClientAssertionMetadata(jwt)`** - Decodes JWT without verification
  - For inspection/debugging only
  - Returns header and payload

- **`validateClientAssertionClaims(jwt)`** - Validates claims structure
  - Checks required claims present
  - Verifies expiration
  - Validates lifetime (max 5 minutes)
  - Does NOT verify signature

### 2. `app/api/demo/client-assertion/route.ts` (89 lines)

Demo endpoint for testing client assertion generation.

**Endpoint:** `GET /api/demo/client-assertion`

**Response:**
```json
{
  "success": true,
  "metadata": {
    "header": { "alg": "RS256", "kid": "..." },
    "payload": { "iss": "...", "sub": "...", "aud": "...", ... }
  },
  "validation": {
    "valid": true,
    "errors": []
  },
  "config": {
    "agentClientId": "0oa...",
    "agentKeyId": "kid-...",
    "audience": "https://.../token",
    "privateKeySource": "JWK string"
  }
}
```

**Security:** Full JWT not shown, only metadata.

---

## Files Updated

### 1. `package.json`

Added dependency:
```json
"jose": "^5.9.6"
```

**Why jose?**
- Modern JWT library for Node.js
- Native JWK support
- Secure by default
- Official JOSE implementation

### 2. `app/api/token/id-jag/route.ts`

Updated flow comments to reference:
```typescript
buildAgentClientAssertion({ audience: orgAuthServer.tokenEndpoint })
```

### 3. `README.md`

Added comprehensive section: "Client Assertion (private_key_jwt)"

**Topics covered:**
- What is a client assertion
- Why no client secret needed
- JWT claims structure
- Implementation details
- Security considerations
- Example token exchange request

---

## JWT Structure

### Header

```json
{
  "alg": "RS256",
  "kid": "{agent_key_id}"
}
```

### Payload

```json
{
  "iss": "{agent_client_id}",
  "sub": "{agent_client_id}",
  "aud": "https://{domain}/oauth2/v1/token",
  "iat": 1234567890,
  "exp": 1234568190,
  "jti": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Claims Explained:**
- `iss` (issuer) = Agent client ID
- `sub` (subject) = Agent client ID (same as issuer)
- `aud` (audience) = ORG token endpoint URL
- `iat` (issued at) = Current Unix timestamp
- `exp` (expires) = iat + 300 seconds (5 minutes)
- `jti` (JWT ID) = Unique UUID (prevents replay attacks)

---

## Usage Example (Future Implementation)

```typescript
import { buildAgentClientAssertion } from '@/lib/agent-client-assertion';
import { config } from '@/lib/config';

// In /api/token/id-jag route handler
export async function POST(request: NextRequest) {
  // 1. Get ID token from session
  const idToken = await getIdTokenFromSession(request);

  // 2. Build client assertion
  const clientAssertion = await buildAgentClientAssertion({
    audience: config.okta.orgAuthServer.tokenEndpoint
  });

  // 3. Make token exchange request
  const response = await fetch(config.okta.orgAuthServer.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: idToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:okta:oauth:token-type:id_jag',
      audience: 'api://mcp-governance',
      scope: 'governance:mcp',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion,
    }),
  });

  // 4. Handle response...
}
```

---

## Configuration Required

### Environment Variables

```bash
# Agent OAuth client (for ID-JAG exchange)
NEXT_PUBLIC_OKTA_AGENT_CLIENT_ID=0oa...
NEXT_PUBLIC_OKTA_AGENT_ID=agent-...
NEXT_PUBLIC_OKTA_AGENT_KEY_ID=kid-...

# Agent private key (server-side only)
# Option 1: JWK string (preferred)
AGENT_PRIVATE_KEY_JWK={"kty":"RSA","kid":"...","n":"...","e":"...","d":"...","p":"...","q":"...","dp":"...","dq":"...","qi":"..."}

# Option 2: PEM file path (alternative)
AGENT_PRIVATE_KEY_PATH=/path/to/agent-private-key.pem
```

---

## Security Considerations

### ✅ Secure Practices Implemented

1. **Private key server-side only**
   - Never exposed to browser
   - Not prefixed with `NEXT_PUBLIC_`

2. **Short-lived tokens**
   - 5 minutes max lifetime
   - Reduces replay attack window

3. **Unique JTI**
   - Each token has unique ID
   - Prevents token reuse

4. **Clock skew protection**
   - 60-second tolerance for `iat`
   - Prevents future-dated tokens

5. **Validation before signing**
   - Checks all required claims
   - Validates expiration
   - Verifies algorithm

### ⚠️ Security Notes

1. **Private key protection**
   - Store securely (env vars, secrets manager)
   - Never commit to version control
   - Rotate regularly

2. **Demo endpoint**
   - Consider protecting with auth in production
   - Or remove entirely
   - Only shows metadata, not full JWT

3. **No signature verification in validation**
   - `validateClientAssertionClaims()` checks structure only
   - Okta verifies signature on token endpoint

---

## Testing

### 1. Test Client Assertion Generation

```bash
curl http://localhost:3000/api/demo/client-assertion
```

**Expected response:**
```json
{
  "success": true,
  "metadata": { ... },
  "validation": { "valid": true },
  "config": { ... }
}
```

### 2. Verify JWT Claims

Check that:
- `iss` and `sub` are equal (agent client ID)
- `aud` matches ORG token endpoint
- `exp` is 5 minutes after `iat`
- `jti` is unique UUID
- Header has `alg: RS256` and correct `kid`

### 3. Test Private Key Loading

**JWK string:**
```bash
AGENT_PRIVATE_KEY_JWK='{"kty":"RSA",...}' npm run dev
```

**PEM file:**
```bash
AGENT_PRIVATE_KEY_PATH=/path/to/key.pem npm run dev
```

---

## Next Steps (Not Implemented Yet)

1. **Session management**
   - Store ID token securely
   - Implement session utilities

2. **Full ID-JAG exchange**
   - Implement HTTP POST to Okta
   - Handle token response
   - Store ID-JAG in session

3. **Error handling**
   - Okta error responses
   - Network failures
   - Invalid assertions

4. **Production hardening**
   - Rate limiting
   - Request logging (without exposing tokens)
   - Monitoring

---

## Assumptions

1. **Private key format**
   - RSA key (RS256 algorithm)
   - JWK or PEM/PKCS8 format
   - Minimum 2048-bit key size recommended

2. **Agent registration in Okta**
   - Agent client created in Okta
   - Public key uploaded to Okta
   - `private_key_jwt` authentication method enabled

3. **Configuration**
   - All agent environment variables set
   - Private key accessible to server

4. **Node.js version**
   - Node.js 18+ (for native crypto APIs)
   - Compatible with Next.js 15

---

## Dependencies

- **jose** (^5.9.6) - JWT signing and verification
  - Zero dependencies
  - Fully typed TypeScript
  - Secure by default

---

## Verification Checklist

- [x] Client assertion utility created
- [x] Demo endpoint implemented
- [x] Route comments updated
- [x] README documentation added
- [x] Dependencies installed
- [x] Build successful
- [x] TypeScript compilation passes
- [ ] Session management (future)
- [ ] Full token exchange (future)
- [ ] Error handling (future)

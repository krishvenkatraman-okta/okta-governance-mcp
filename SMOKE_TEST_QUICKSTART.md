# Smoke Test Quick Start

## Prerequisites

- Okta tenant with Super Admin access
- Service app created with OAuth scopes granted
- Test APP_ADMIN user with target apps

## Setup (One Time)

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env:
#   OKTA_DOMAIN=your-domain.okta.com
#   OKTA_CLIENT_ID=0oa...
#   OKTA_PRIVATE_KEY_PATH=./keys/okta-private-key.pem

# 2. Generate MAS keys
npm run generate-keys

# 3. Validate configuration
npm run validate-env

# 4. Build project
npm run build
```

## Run Smoke Test

### Terminal 1: Start MRS

```bash
npm run start:mrs
```

### Terminal 2: Test API

```bash
# Generate test token (replace with your user ID)
npm run generate-token -- --sub 00u1abc2def3ghi4jkl5

# Export token for convenience
export TOKEN="<paste-token-here>"

# Test 1: Health check
curl http://localhost:3001/health

# Test 2: List tools
curl http://localhost:3001/mcp/v1/tools/list \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# Test 3: List owned apps
curl http://localhost:3001/mcp/v1/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "list_owned_apps",
    "arguments": {}
  }'

# Test 4: Generate access review candidates
# (Replace 0oa... with an app ID from Test 3)
curl http://localhost:3001/mcp/v1/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "generate_access_review_candidates",
    "arguments": {
      "appId": "0oa1abc2def3ghi4jkl5",
      "inactivityDays": 60,
      "minRiskLevel": "LOW"
    }
  }'
```

## Expected Results

### Test 1: Health ✅
```json
{
  "status": "healthy",
  "service": "okta-governance-mcp",
  "version": "1.0.0"
}
```

### Test 2: List Tools ✅
```json
{
  "tools": [
    { "name": "list_owned_apps", ... },
    { "name": "generate_owned_app_syslog_report", ... },
    { "name": "generate_access_review_candidates", ... }
  ]
}
```

### Test 3: List Owned Apps ✅
```json
{
  "content": [{
    "type": "text",
    "text": "{\"ownedApps\":[...],\"metadata\":{...}}"
  }],
  "isError": false
}
```

### Test 4: Review Candidates ✅
```json
{
  "content": [{
    "type": "text",
    "text": "{\"app\":{...},\"summary\":{...},\"candidates\":[...]}"
  }],
  "isError": false
}
```

## Troubleshooting

### "Environment validation failed"
- Run: `npm run validate-env`
- Fix missing variables in `.env`
- Re-run validation

### "Invalid client credentials"
- Verify `OKTA_CLIENT_ID` matches Okta app
- Verify `OKTA_PRIVATE_KEY_PATH` points to correct key
- Verify public key uploaded to Okta

### "User has no roles"
- Verify test user has APP_ADMIN role in Okta
- Verify role has target apps assigned
- Use correct user ID in token generation

### "No tools returned"
- Check MRS logs for authorization errors
- Verify `okta.roles.read` scope granted
- Verify user has admin role with targets

## Full Documentation

See `docs/smoke-test.md` for complete step-by-step instructions.

## Required OAuth Scopes

Minimum for smoke test:
- `okta.apps.read`
- `okta.users.read`
- `okta.roles.read`
- `okta.logs.read`

Grant admin consent in Okta Admin Console.

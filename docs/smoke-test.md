# Smoke Test Guide: Real Okta Tenant

This guide walks through smoke testing the Okta Governance MCP server against a real Okta tenant.

## Overview

The smoke test validates:
- ✅ Okta OAuth integration (service client authentication)
- ✅ MCP token generation and validation
- ✅ Authorization context resolution (roles, targets, capabilities)
- ✅ Tool execution with real Okta APIs
- ✅ Risk engine with System Log analysis

**Important:** This test uses a **locally generated MCP token** for backend validation without requiring a full frontend authentication flow or real ID-JAG integration.

---

## Prerequisites

### Required Access

- [ ] Okta tenant (production, preview, or developer)
- [ ] Super Admin access to Okta Admin Console
- [ ] At least one test user with APP_ADMIN role
- [ ] At least one active application in Okta

### Local Environment

- [ ] Node.js 18+ installed
- [ ] Project dependencies installed: `npm install`
- [ ] OpenSSL installed (for key generation)

---

## Step 1: Create Okta Service App

### 1.1 Create API Services Application

1. Log in to Okta Admin Console
2. Navigate to **Applications** > **Applications**
3. Click **Create App Integration**
4. Select:
   - **Sign-in method:** API Services
   - Click **Next**
5. Configure:
   - **App integration name:** `MCP Governance Service`
   - Click **Save**

### 1.2 Configure Client Authentication

1. In the application's **General** tab, find **Client Credentials**
2. Click **Edit**
3. Set **Client authentication:** `Public key / Private key`
4. Click **Save**

### 1.3 Generate and Upload Public Key

Generate a key pair for Okta OAuth:

```bash
# Generate private key
openssl genrsa -out keys/okta-private-key.pem 2048

# Extract public key
openssl rsa -in keys/okta-private-key.pem -pubout -out keys/okta-public-key.pem

# Display public key for upload
cat keys/okta-public-key.pem
```

Upload the public key to Okta:

1. In the application's **General** tab, scroll to **CLIENT CREDENTIALS**
2. Click **Add key** next to **Public Keys**
3. Paste the entire contents of `keys/okta-public-key.pem` (including `-----BEGIN/END-----` lines)
4. Click **Save**
5. **Note the Key ID (kid)** - you'll need this for `OKTA_PRIVATE_KEY_KID`

### 1.4 Note Client ID

- Copy the **Client ID** (starts with `0oa`)
- You'll use this for `OKTA_CLIENT_ID` in `.env`

---

## Step 2: Grant OAuth Scopes

The service app needs the following OAuth scopes for MCP governance operations.

### Required Scopes

Navigate to **Okta API Scopes** tab in the application:

**Core Scopes (Required):**
- ✅ `okta.apps.read` - Read application details
- ✅ `okta.users.read` - Read user information
- ✅ `okta.roles.read` - Read admin roles and targets
- ✅ `okta.logs.read` - Read system logs for risk analysis

**Governance Scopes (For full functionality):**
- ✅ `okta.governance.entitlements.read` - Read entitlements
- ✅ `okta.governance.entitlements.manage` - Manage entitlements
- ✅ `okta.governance.labels.read` - Read labels
- ✅ `okta.governance.labels.manage` - Manage labels
- ✅ `okta.governance.collections.read` - Read collections/bundles
- ✅ `okta.governance.collections.manage` - Manage collections
- ✅ `okta.governance.accessCertifications.read` - Read campaigns
- ✅ `okta.governance.accessCertifications.manage` - Manage campaigns
- ✅ `okta.groups.read` - Read group information

### Grant Admin Consent

1. Check all required scopes
2. Click **Grant** to grant admin consent
3. Verify scopes show **Granted** status

**Note:** For smoke testing, you only need the **Core Scopes** (apps, users, roles, logs).

---

## Step 3: Setup Test User

Create or identify a test user with APP_ADMIN role:

### 3.1 Create Test User (if needed)

1. Navigate to **Directory** > **People**
2. Click **Add person**
3. Create user:
   - **First name:** Test
   - **Last name:** AppAdmin
   - **Username:** `testappadmin@yourdomain.com`
   - Set password
4. Click **Save**
5. **Note the User ID** (starts with `00u`) - you'll use this for token generation

### 3.2 Assign APP_ADMIN Role

1. Open the user profile
2. Navigate to **Administrator Roles** tab
3. Click **Edit assignments**
4. Click **Add another**
5. Select **Application administrator**
6. Click **Add targets**
7. Select one or more applications to manage
8. Click **Save**

### 3.3 Verify Role Assignment

Verify the user has:
- ✅ APP_ADMIN role assigned
- ✅ At least one target application
- ✅ User ID noted (e.g., `00u1abc2def3ghi4jkl5`)

---

## Step 4: Configure Environment

### 4.1 Copy Environment Template

```bash
cp .env.example .env
```

### 4.2 Configure Required Variables

Edit `.env` and set the following **minimum required variables**:

```bash
# Server Configuration
SERVER_MODE=mrs  # We only need MRS for smoke test
MRS_PORT=3001

# Okta Service App (from Step 1)
OKTA_DOMAIN=dev-123456.okta.com  # Your Okta domain (no https://)
OKTA_CLIENT_ID=0oa1abc2def3ghi4jkl5  # Client ID from Step 1.4
OKTA_PRIVATE_KEY_PATH=./keys/okta-private-key.pem  # Private key from Step 1.3
OKTA_PRIVATE_KEY_KID=your-key-id  # Key ID from Step 1.3 (optional but recommended)

# MAS JWT Keys (for test token generation and validation)
MAS_JWT_PRIVATE_KEY_PATH=./keys/mas-private-key.pem
MAS_JWT_PUBLIC_KEY_PATH=./keys/mas-public-key.pem

# MCP Token Configuration
MCP_TOKEN_AUDIENCE=mcp://okta-governance-mrs
MCP_TOKEN_ISSUER=mcp://okta-governance-mas

# Default OAuth Scopes (adjust based on your granted scopes)
OKTA_SCOPES_DEFAULT=okta.apps.read okta.users.read okta.roles.read okta.logs.read
```

**Optional Variables** (can use defaults):
- `MAS_PORT` - Default: 3000 (not needed for smoke test)
- `LOG_LEVEL` - Default: info
- `MRS_SERVER_NAME` - Default: okta-governance-mcp

---

## Step 5: Generate MAS Key Pair

Generate keys for signing and validating MCP tokens:

```bash
npm run generate-keys
```

This creates:
- `keys/mas-private-key.pem` - Used to sign test MCP tokens
- `keys/mas-public-key.pem` - Used by MRS to validate MCP tokens

**Verify:**
```bash
ls -la keys/
# Should show:
# mas-private-key.pem
# mas-public-key.pem
# okta-private-key.pem
# okta-public-key.pem
```

---

## Step 6: Validate Configuration

Run the environment validation script:

```bash
npm run validate-env
```

**Expected Output:**
```
🔍 Validating environment configuration...

Mode: all

✅ OKTA_DOMAIN (dev-123456.okta.com)
✅ OKTA_CLIENT_ID (0oa1abc2def3ghi4jkl5)
✅ OKTA_PRIVATE_KEY_PATH (./keys/okta-private-key.pem)
✅ MAS_JWT_PRIVATE_KEY_PATH (./keys/mas-private-key.pem)
✅ MAS_JWT_PUBLIC_KEY_PATH (./keys/mas-public-key.pem)

════════════════════════════════════════════════════════════

✅ Environment validation PASSED

All required configuration is present.
You can now start the server.

════════════════════════════════════════════════════════════
```

**If validation fails:**
- Review error messages
- Check that all files exist
- Verify `.env` values are correct
- Re-run after fixing issues

---

## Step 7: Start MRS Server

Build and start the MRS server:

```bash
# Build TypeScript
npm run build

# Start MRS
npm run start:mrs
```

**Expected Output:**
```
🚀 Starting MCP Resource Server (MRS)...

[Config] Loading configuration...
[Config] Server mode: mrs
[Config] MRS port: 3001
[Config] Okta domain: dev-123456.okta.com

[OktaClient] Initializing OAuth client...
[OktaClient] Service app ready: 0oa1abc2def3ghi4jkl5

[MRS] Server starting on port 3001...
[MRS] Endpoints:
  - GET  /health
  - POST /mcp/v1/tools/list
  - POST /mcp/v1/tools/call

✅ MCP Resource Server ready at http://localhost:3001
```

**Troubleshooting:**
- If port 3001 is in use: `export MRS_PORT=3002` and restart
- If Okta client fails: verify `OKTA_DOMAIN`, `OKTA_CLIENT_ID`, and private key
- Check logs for detailed error messages

---

## Step 8: Generate Test MCP Token

In a **new terminal**, generate a test MCP token for your APP_ADMIN user:

```bash
npm run generate-token -- --sub 00u1abc2def3ghi4jkl5
```

Replace `00u1abc2def3ghi4jkl5` with your test user's ID from Step 3.1.

**Expected Output:**
```
📝 Generating MCP test token...

Token claims: {
  "iss": "mcp://okta-governance-mas",
  "aud": "mcp://okta-governance-mrs",
  "sub": "00u1abc2def3ghi4jkl5",
  "iat": 1712675400,
  "exp": 1712679000,
  "scope": "okta.apps.read okta.logs.read okta.users.read okta.roles.read",
  "sid": "test-session-1712675400123",
  "test": true
}

✅ Token generated successfully!

Token (copy this):
─────────────────────────────────────────────────────────────
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJtY3A6Ly9va3RhLWdvdmVybmFuY2UtbWFzIiwiYXVkIjoibWNwOi8vb2t0YS1nb3Zlcm5hbmNlLW1ycyIsInN1YiI6IjAwdTFhYmMyZGVmM2doaTRqa2w1IiwiaWF0IjoxNzEyNjc1NDAwLCJleHAiOjE3MTI2NzkwMDAsInNjb3BlIjoib2t0YS5hcHBzLnJlYWQgb2t0YS5sb2dzLnJlYWQgb2t0YS51c2Vycy5yZWFkIG9rdGEucm9sZXMucmVhZCIsInNpZCI6InRlc3Qtc2Vzc2lvbi0xNzEyNjc1NDAwMTIzIiwidGVzdCI6dHJ1ZX0.signature...
─────────────────────────────────────────────────────────────

Token also saved to: ./test-token.txt

💡 Note: This token expires in 3600 seconds
```

**Copy the token** (the long string) - you'll use it in API calls.

**Advanced Options:**

```bash
# Generate token with custom scopes
npm run generate-token -- --sub 00u123 --scope "okta.apps.read okta.logs.read"

# Generate token with 2-hour expiry
npm run generate-token -- --sub 00u123 --expires-in 7200

# See all options
npm run generate-token -- --help
```

---

## Step 9: Test Health Endpoint

Verify MRS is running:

```bash
curl http://localhost:3001/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "service": "okta-governance-mcp",
  "version": "1.0.0",
  "timestamp": "2026-04-09T12:00:00.000Z"
}
```

---

## Step 10: Test Tool Listing

List available tools for the test user:

```bash
# Replace <TOKEN> with your token from Step 8
curl http://localhost:3001/mcp/v1/tools/list \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response:**
```json
{
  "tools": [
    {
      "name": "list_owned_apps",
      "description": "List applications owned/administered by the current user",
      "inputSchema": {
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "generate_owned_app_syslog_report",
      "description": "Generate system log reports for owned applications",
      "inputSchema": {
        "type": "object",
        "properties": {
          "appId": { "type": "string" },
          "hours": { "type": "number" }
        },
        "required": ["appId"]
      }
    },
    {
      "name": "generate_access_review_candidates",
      "description": "Generate a list of users who should be reviewed for access removal",
      "inputSchema": {
        "type": "object",
        "properties": {
          "appId": { "type": "string" },
          "inactivityDays": { "type": "number" },
          "minRiskLevel": { "type": "string", "enum": ["HIGH", "MEDIUM", "LOW"] }
        },
        "required": ["appId"]
      }
    }
  ]
}
```

**What this validates:**
- ✅ Token validation working
- ✅ Authorization context resolution from Okta
- ✅ Role-based tool filtering (APP_ADMIN sees 3 tools)
- ✅ Capability mapping working

**If you see 0-2 tools:**
- Verify user has APP_ADMIN role in Okta
- Verify user has at least one target app assigned
- Check MRS logs for authorization errors

---

## Step 11: Test list_owned_apps Tool

Call the `list_owned_apps` tool:

```bash
curl http://localhost:3001/mcp/v1/tools/call \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "list_owned_apps",
    "arguments": {}
  }'
```

**Expected Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"ownedApps\":[{\"id\":\"0oa1abc2def3ghi4jkl5\",\"name\":\"salesforce\",\"label\":\"Salesforce Production\",\"status\":\"ACTIVE\",\"created\":\"2024-01-15T10:30:00.000Z\",\"lastUpdated\":\"2024-02-20T14:45:00.000Z\"}],\"metadata\":{\"totalApps\":1,\"activeApps\":1,\"inactiveApps\":0}}"
    }
  ],
  "isError": false
}
```

**What this validates:**
- ✅ Real Okta API calls working (Apps API)
- ✅ Tool execution layer working
- ✅ Target-based filtering (only owned apps returned)
- ✅ Okta OAuth client credentials flow working

**MRS Logs Should Show:**
```
[ToolExecutor] Executing tool: { name: 'list_owned_apps', user: '00u123...' }
[AuthContext] Resolving context for subject: { subject: '00u123...', sessionId: 'test-session-...' }
[RolesClient] Fetching roles for user: 00u123...
[RolesClient] Retrieved roles: { userId: '00u123...', count: 1, types: ['APP_ADMIN'] }
[RolesClient] Fetching app targets: { userId: '00u123...', roleId: 'irb...' }
[RolesClient] Retrieved app targets: { userId: '00u123...', count: 1, appIds: ['0oa1...'] }
[AuthContext] Context resolved successfully: { subject: '00u123...', roles: ['appAdmin'], targetApps: 1 }
[ListOwnedApps] Executing tool: { subject: '00u123...', targetApps: 1 }
[AppsClient] Fetching owned apps: { count: 1 }
[ListOwnedApps] Retrieved 1 apps
[ToolExecutor] Tool executed successfully: { name: 'list_owned_apps', duration: '234ms' }
```

---

## Step 12: Test generate_access_review_candidates Tool

This tool uses System Log analysis to detect inactive users.

### 12.1 Get App ID

From the `list_owned_apps` response, copy one of the app IDs (e.g., `0oa1abc2def3ghi4jkl5`).

### 12.2 Generate Review Candidates

```bash
curl http://localhost:3001/mcp/v1/tools/call \
  -H "Authorization: Bearer <TOKEN>" \
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

**Expected Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"app\":{\"id\":\"0oa1abc2def3ghi4jkl5\",\"name\":\"salesforce\",\"label\":\"Salesforce Production\",\"status\":\"ACTIVE\"},\"analysisParameters\":{\"inactivityDays\":60,\"minRiskLevel\":\"LOW\",\"analyzedPeriod\":{\"from\":\"2026-02-09T00:00:00.000Z\",\"to\":\"2026-04-09T00:00:00.000Z\"}},\"summary\":{\"totalCandidates\":3,\"riskDistribution\":{\"high\":0,\"medium\":1,\"low\":2},\"recommendations\":{\"immediate\":0,\"review\":1,\"monitor\":2}},\"candidates\":[{\"userId\":\"00u9xyz8wvu7tsr6qpo5\",\"userLogin\":\"john.doe@example.com\",\"lastAccess\":\"2026-02-25T14:30:00.000Z\",\"daysSinceLastAccess\":43,\"accessCount\":4,\"riskLevel\":\"MEDIUM\",\"reason\":\"Low usage (4 accesses in 43 days)\",\"recommendation\":\"Include in next access review\"}],\"nextSteps\":[\"Review high-risk candidates for immediate access removal\",\"Schedule access certification campaign for medium-risk users\",\"Monitor low-risk users for continued inactivity\"]}"
    }
  ],
  "isError": false
}
```

**What this validates:**
- ✅ System Log API integration working
- ✅ Risk engine analysis working
- ✅ Target ownership validation (can only analyze owned apps)
- ✅ Risk level assessment (HIGH/MEDIUM/LOW)

**MRS Logs Should Show:**
```
[GenerateReviewCandidates] Executing tool: { subject: '00u123...', appId: '0oa1abc...', inactivityDays: 60 }
[GenerateReviewCandidates] Fetching app details...
[GenerateReviewCandidates] Analyzing user activity...
[RiskEngine] Detecting inactive users: { appId: '0oa1abc...', inactivityDays: 60 }
[RiskEngine] Querying system logs for app access: { appId: '0oa1abc...', since: '2026-02-09T00:00:00.000Z' }
[SystemLogClient] Querying logs: { filter: 'target.id eq "0oa1abc..."' }
[RiskEngine] Retrieved system log events: { appId: '0oa1abc...', eventCount: 234 }
[RiskEngine] Analyzed user activity: { appId: '0oa1abc...', uniqueUsers: 15 }
[RiskEngine] Inactive users detected: { appId: '0oa1abc...', totalInactive: 3, highRisk: 0, mediumRisk: 1, lowRisk: 2 }
[GenerateReviewCandidates] Report generated successfully
```

---

## Step 13: Test Access Denied Scenarios

### 13.1 Test with Non-Owned App

Try to analyze an app the user doesn't own:

```bash
curl http://localhost:3001/mcp/v1/tools/call \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "generate_access_review_candidates",
    "arguments": {
      "appId": "0oa9xyz8wvu7tsr6qpo5"
    }
  }'
```

**Expected Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Access denied: You do not have permission to review access for app 0oa9xyz8wvu7tsr6qpo5"
    }
  ],
  "isError": true
}
```

**What this validates:**
- ✅ Target ownership enforcement working
- ✅ Pre-authorization checks working
- ✅ Error handling working

---

## Smoke Test Checklist

Use this checklist to verify all components:

### Environment Setup
- [ ] Okta service app created
- [ ] Public key uploaded to Okta
- [ ] OAuth scopes granted (minimum: apps.read, users.read, roles.read, logs.read)
- [ ] Test user with APP_ADMIN role created
- [ ] Test user has at least one target app
- [ ] `.env` file configured
- [ ] MAS key pair generated
- [ ] `npm run validate-env` passes

### Server Startup
- [ ] `npm run build` succeeds
- [ ] `npm run start:mrs` starts without errors
- [ ] Health endpoint returns 200 OK
- [ ] Okta OAuth client initializes successfully

### Token Generation
- [ ] `npm run generate-token` creates valid token
- [ ] Token saved to `test-token.txt`
- [ ] Token includes correct subject (user ID)

### Tool Testing
- [ ] `/mcp/v1/tools/list` returns expected tools
- [ ] `list_owned_apps` returns owned applications
- [ ] `generate_access_review_candidates` returns risk analysis
- [ ] Access denied for non-owned apps

### Authorization Flow
- [ ] Token validation succeeds
- [ ] Authorization context resolution from Okta works
- [ ] Role and target fetching works
- [ ] Capability mapping works
- [ ] Tool filtering by role works

---

## Troubleshooting

### Issue: "OKTA_DOMAIN is not set"

**Solution:**
- Copy `.env.example` to `.env`
- Set `OKTA_DOMAIN` to your Okta domain (without `https://`)
- Example: `dev-123456.okta.com`

### Issue: "MAS private key not found"

**Solution:**
```bash
npm run generate-keys
```

### Issue: "Invalid client credentials"

**Causes:**
- Wrong `OKTA_CLIENT_ID`
- Wrong `OKTA_PRIVATE_KEY_PATH`
- Public key not uploaded to Okta
- Key mismatch between local private key and Okta public key

**Solution:**
- Verify client ID in Okta Admin Console
- Re-generate and re-upload public key
- Ensure `OKTA_PRIVATE_KEY_KID` matches key in Okta

### Issue: "Insufficient permissions"

**Causes:**
- Missing OAuth scopes on service app
- Admin consent not granted

**Solution:**
1. Go to Okta Admin Console
2. Open service app
3. Navigate to **Okta API Scopes**
4. Grant required scopes
5. Click **Grant** to provide admin consent

### Issue: "User has no roles"

**Causes:**
- Test user doesn't have APP_ADMIN role
- Role doesn't have target apps assigned

**Solution:**
1. Open user profile in Okta
2. Navigate to **Administrator Roles**
3. Assign **Application administrator** role
4. Add target applications
5. Re-generate token with correct user ID

### Issue: "No tools returned"

**Causes:**
- User doesn't have admin roles
- User has roles but no targets
- Authorization context resolution failed

**Solution:**
- Check MRS logs for authorization errors
- Verify `okta.roles.read` scope is granted
- Verify user has APP_ADMIN role with targets
- Check `RolesClient` logs for API errors

### Issue: "System log query failed"

**Causes:**
- Missing `okta.logs.read` scope
- App ID doesn't exist
- Network connectivity issue

**Solution:**
- Grant `okta.logs.read` scope to service app
- Verify app ID from `list_owned_apps` response
- Check Okta API rate limits

---

## Next Steps

After successful smoke testing:

1. **Test with Multiple Users**
   - Generate tokens for users with different roles (APP_ADMIN, GROUP_ADMIN, SUPER_ADMIN)
   - Verify tool filtering works correctly for each role

2. **Test Edge Cases**
   - Expired tokens
   - Invalid signatures
   - Missing scopes
   - Non-existent app IDs

3. **Performance Testing**
   - Test with apps having many users
   - Test with long lookback periods
   - Monitor API rate limiting

4. **Integration Testing**
   - Connect to real MAS for full ID-JAG flow
   - Test frontend integration
   - Test with real Claude Desktop or other MCP clients

5. **Production Deployment**
   - Review security configuration
   - Set up monitoring and logging
   - Configure production OAuth scopes
   - Deploy to production environment

---

## Minimum Required Environment Variables Summary

For MRS smoke testing:

```bash
# Required
OKTA_DOMAIN=dev-123456.okta.com
OKTA_CLIENT_ID=0oa1abc2def3ghi4jkl5
OKTA_PRIVATE_KEY_PATH=./keys/okta-private-key.pem
MAS_JWT_PRIVATE_KEY_PATH=./keys/mas-private-key.pem
MAS_JWT_PUBLIC_KEY_PATH=./keys/mas-public-key.pem

# Optional (can use defaults)
SERVER_MODE=mrs
MRS_PORT=3001
MCP_TOKEN_AUDIENCE=mcp://okta-governance-mrs
MCP_TOKEN_ISSUER=mcp://okta-governance-mas
OKTA_SCOPES_DEFAULT=okta.apps.read okta.users.read okta.roles.read okta.logs.read
```

---

## Quick Start Commands

```bash
# 1. Setup
cp .env.example .env
# Edit .env with your Okta values
npm run generate-keys

# 2. Validate
npm run validate-env

# 3. Build and start MRS
npm run build
npm run start:mrs

# 4. Generate test token (in new terminal)
npm run generate-token -- --sub 00u1abc2def3ghi4jkl5

# 5. Test health
curl http://localhost:3001/health

# 6. Test list tools
curl http://localhost:3001/mcp/v1/tools/list \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'

# 7. Test list_owned_apps
curl http://localhost:3001/mcp/v1/tools/call \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"list_owned_apps","arguments":{}}'

# 8. Test generate_access_review_candidates
curl http://localhost:3001/mcp/v1/tools/call \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"generate_access_review_candidates","arguments":{"appId":"0oa...","inactivityDays":60}}'
```

---

## Success Criteria

Smoke test is successful when:

✅ All environment variables validated
✅ MRS server starts without errors
✅ Test token generated successfully
✅ Health endpoint returns 200 OK
✅ Tool list returns expected tools for APP_ADMIN
✅ `list_owned_apps` returns real Okta apps
✅ `generate_access_review_candidates` returns risk analysis
✅ Access denied for non-owned apps
✅ All MRS logs show successful authorization flow

---

**Ready to test!** 🚀

If you encounter any issues, check the troubleshooting section or review the MRS logs for detailed error messages.

# Smoke Test Preparation Summary

## Overview

Prepared the Okta Governance MCP project for smoke testing against a real Okta tenant with locally generated test MCP tokens.

## What Was Added

### 1. Test Token Generation Script

**File:** `scripts/generate-test-token.ts` (210 lines)

**Purpose:** Generate locally signed MCP access tokens for smoke testing without requiring a running MAS or full ID-JAG authentication flow.

**Features:**
- Creates JWT tokens signed with MAS private key
- Configurable user subject, scopes, expiry
- Tokens validated by MRS using MAS public key
- Outputs token to console and `test-token.txt` file

**Usage:**
```bash
# Generate token for APP_ADMIN user
npm run generate-token -- --sub 00u123456

# Generate token with custom scopes
npm run generate-token -- --sub 00u123456 --scope "okta.apps.read okta.logs.read"

# Generate token with 2-hour expiry
npm run generate-token -- --sub 00u123456 --expires-in 7200
```

**Token Claims:**
```json
{
  "iss": "mcp://okta-governance-mas",
  "aud": "mcp://okta-governance-mrs",
  "sub": "00u123456",
  "iat": 1712675400,
  "exp": 1712679000,
  "scope": "okta.apps.read okta.logs.read okta.users.read okta.roles.read",
  "sid": "test-session-1712675400123",
  "test": true
}
```

---

### 2. Environment Validation Script

**File:** `scripts/validate-env.ts` (250 lines)

**Purpose:** Validate that all required environment variables and configuration files are present before starting servers.

**Checks:**
- ✅ Required environment variables set
- ✅ Key files exist and are valid PEM format
- ✅ Okta domain and client ID format validation
- ✅ Mode-specific validation (MAS vs MRS)

**Usage:**
```bash
# Validate all configuration
npm run validate-env

# Validate only MRS configuration
npm run validate-env -- --mode mrs

# Validate only MAS configuration
npm run validate-env -- --mode mas
```

**Example Output:**
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

---

### 3. Comprehensive Smoke Test Documentation

**File:** `docs/smoke-test.md` (650+ lines)

**Contents:**

#### Prerequisites
- Okta tenant access requirements
- Local environment setup
- Required tools

#### Step-by-Step Guide

**Step 1: Create Okta Service App**
- Create API Services application
- Configure client authentication (Public key / Private key)
- Generate and upload public key
- Note client ID

**Step 2: Grant OAuth Scopes**
- Required core scopes: `okta.apps.read`, `okta.users.read`, `okta.roles.read`, `okta.logs.read`
- Optional governance scopes for full functionality
- Grant admin consent

**Step 3: Setup Test User**
- Create or identify APP_ADMIN user
- Assign role with target applications
- Note user ID (00u...)

**Step 4: Configure Environment**
- Copy `.env.example` to `.env`
- Set minimum required variables:
  - `OKTA_DOMAIN`
  - `OKTA_CLIENT_ID`
  - `OKTA_PRIVATE_KEY_PATH`
  - `MAS_JWT_PRIVATE_KEY_PATH`
  - `MAS_JWT_PUBLIC_KEY_PATH`

**Step 5: Generate MAS Key Pair**
- Run `npm run generate-keys`
- Creates MAS private/public keys for token signing/validation

**Step 6: Validate Configuration**
- Run `npm run validate-env`
- Verify all checks pass

**Step 7: Start MRS Server**
- Build: `npm run build`
- Start: `npm run start:mrs`
- Verify server starts successfully

**Step 8: Generate Test MCP Token**
- Run `npm run generate-token -- --sub 00u123456`
- Copy generated token

**Step 9: Test Health Endpoint**
- `curl http://localhost:3001/health`
- Verify 200 OK response

**Step 10: Test Tool Listing**
- Call `/mcp/v1/tools/list` with token
- Verify tools returned match user's role

**Step 11: Test list_owned_apps**
- Call `list_owned_apps` tool
- Verify real Okta apps returned

**Step 12: Test generate_access_review_candidates**
- Call with owned app ID
- Verify risk analysis returned

**Step 13: Test Access Denied**
- Call with non-owned app ID
- Verify access denied error

#### Troubleshooting Section
- Common issues and solutions
- Environment variable problems
- OAuth scope issues
- Role assignment problems
- Network connectivity issues

#### Success Checklist
- All validation steps completed
- All API calls return expected results
- Authorization flow working end-to-end

---

### 4. Updated Package.json Scripts

**Added Scripts:**
```json
{
  "generate-keys": "tsx scripts/generate-keypair.ts",
  "generate-token": "tsx scripts/generate-test-token.ts",
  "validate-env": "tsx scripts/validate-env.ts"
}
```

**Existing Scripts:**
- `start:mrs` - Start MRS in production mode
- `dev:mrs` - Start MRS in development mode with hot reload
- `build` - Compile TypeScript

---

## Minimum Required Environment Variables

For MRS smoke testing:

```bash
# Required - Okta Service App Configuration
OKTA_DOMAIN=dev-123456.okta.com
OKTA_CLIENT_ID=0oa1abc2def3ghi4jkl5
OKTA_PRIVATE_KEY_PATH=./keys/okta-private-key.pem

# Required - MAS JWT Keys (for token signing/validation)
MAS_JWT_PRIVATE_KEY_PATH=./keys/mas-private-key.pem
MAS_JWT_PUBLIC_KEY_PATH=./keys/mas-public-key.pem

# Optional - Can Use Defaults
SERVER_MODE=mrs                                    # default: mrs
MRS_PORT=3001                                      # default: 3001
MCP_TOKEN_AUDIENCE=mcp://okta-governance-mrs      # default
MCP_TOKEN_ISSUER=mcp://okta-governance-mas        # default
OKTA_SCOPES_DEFAULT=okta.apps.read okta.users.read okta.roles.read okta.logs.read
```

---

## Required Okta App Setup

### App Type
- **API Services** application

### Authentication Method
- **Public key / Private key** (OAuth 2.0 client credentials with JWT)

### Required OAuth Scopes (Minimum for Smoke Test)

| Scope | Purpose |
|-------|---------|
| `okta.apps.read` | Read application details for `list_owned_apps` |
| `okta.users.read` | Read user information |
| `okta.roles.read` | Read admin roles and targets for authorization |
| `okta.logs.read` | Read system logs for `generate_access_review_candidates` |

### Grant Admin Consent
- All scopes must have **Granted** status in Okta Admin Console

---

## Smoke Test Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Setup Okta Service App                                   │
│    - Create API Services app                                │
│    - Upload public key                                       │
│    - Grant OAuth scopes                                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Setup Test User                                          │
│    - Create APP_ADMIN user                                  │
│    - Assign target applications                             │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Configure Environment                                    │
│    - Copy .env.example to .env                             │
│    - Set OKTA_DOMAIN, OKTA_CLIENT_ID, etc.                 │
│    - Generate MAS keys: npm run generate-keys              │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Validate Configuration                                   │
│    npm run validate-env                                     │
│    ✅ All checks pass                                       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Start MRS Server                                         │
│    npm run build && npm run start:mrs                       │
│    ✅ Server listening on port 3001                         │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Generate Test MCP Token                                  │
│    npm run generate-token -- --sub 00u123456                │
│    ✅ Token saved to test-token.txt                         │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Test API Calls with Token                                │
│    ┌──────────────────────────────────────┐                 │
│    │ GET /health                          │                 │
│    │ ✅ 200 OK - Server healthy           │                 │
│    └──────────────────────────────────────┘                 │
│    ┌──────────────────────────────────────┐                 │
│    │ POST /mcp/v1/tools/list              │                 │
│    │ ✅ Returns 3 tools for APP_ADMIN     │                 │
│    └──────────────────────────────────────┘                 │
│    ┌──────────────────────────────────────┐                 │
│    │ POST /mcp/v1/tools/call              │                 │
│    │ Tool: list_owned_apps                │                 │
│    │ ✅ Returns owned applications        │                 │
│    └──────────────────────────────────────┘                 │
│    ┌──────────────────────────────────────┐                 │
│    │ POST /mcp/v1/tools/call              │                 │
│    │ Tool: generate_access_review_cands   │                 │
│    │ ✅ Returns risk analysis with users  │                 │
│    └──────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

---

## What Was NOT Changed

As requested:

❌ **Core authentication logic unchanged** - Token validation flow remains the same
❌ **Policy engine unchanged** - Authorization context resolution unchanged
❌ **Execution layer unchanged** - Tool execution flow unchanged
❌ **OAuth client unchanged** - Okta service client unchanged
❌ **No frontend authentication** - Test uses locally generated tokens only
❌ **No real ID-JAG required** - Bypasses full OAuth flow for testing

---

## Key Features

### Local Test Token Generation
- **No MAS required** - Tokens generated locally with MAS private key
- **No ID-JAG required** - Bypasses user authentication flow
- **Backend validation only** - MRS validates token signature with MAS public key
- **Real authorization** - Token subject resolves to real Okta user with real roles

### Environment Validation
- **Pre-flight checks** - Validates configuration before server start
- **Clear error messages** - Explains exactly what's missing or wrong
- **Mode-specific** - Can validate just MAS or just MRS
- **File validation** - Checks key files exist and have correct format

### Comprehensive Documentation
- **Step-by-step instructions** - Complete setup from scratch
- **Screenshots and examples** - Expected outputs for each step
- **Troubleshooting guide** - Common issues and solutions
- **Success checklist** - Verify all components working

---

## Testing Workflow

### Quick Start (5 minutes)

```bash
# 1. Setup environment
cp .env.example .env
# Edit .env with your Okta values

# 2. Generate keys
npm run generate-keys

# 3. Validate
npm run validate-env

# 4. Build and start
npm run build
npm run start:mrs

# 5. Generate token (new terminal)
npm run generate-token -- --sub 00u123456

# 6. Test (replace <TOKEN> with generated token)
export TOKEN="<your-token>"

curl http://localhost:3001/health

curl http://localhost:3001/mcp/v1/tools/list \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

curl http://localhost:3001/mcp/v1/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"list_owned_apps","arguments":{}}'
```

### Detailed Test (30 minutes)

Follow `docs/smoke-test.md` for complete step-by-step instructions including:
- Okta service app creation
- OAuth scope configuration
- Test user setup
- All tool testing
- Edge case verification

---

## Files Created/Modified

| File | Status | Lines | Description |
|------|--------|-------|-------------|
| `scripts/generate-test-token.ts` | ✅ Created | 210 | Generate test MCP tokens |
| `scripts/validate-env.ts` | ✅ Created | 250 | Validate environment configuration |
| `docs/smoke-test.md` | ✅ Created | 650+ | Comprehensive smoke test guide |
| `package.json` | ✅ Updated | +3 | Added npm scripts |
| `SMOKE_TEST_PREP_SUMMARY.md` | ✅ Created | This file | Implementation summary |

---

## Build Status

```bash
$ npm run build
✅ Build succeeded - no errors
```

---

## Next Steps

### 1. Prepare Okta Tenant

- [ ] Create API Services app
- [ ] Generate and upload public key
- [ ] Grant OAuth scopes
- [ ] Create test APP_ADMIN user
- [ ] Assign target applications

### 2. Configure Local Environment

- [ ] Copy `.env.example` to `.env`
- [ ] Set `OKTA_DOMAIN`
- [ ] Set `OKTA_CLIENT_ID`
- [ ] Set `OKTA_PRIVATE_KEY_PATH`
- [ ] Run `npm run generate-keys`
- [ ] Run `npm run validate-env`

### 3. Run Smoke Test

- [ ] Start MRS: `npm run start:mrs`
- [ ] Generate token: `npm run generate-token -- --sub 00u...`
- [ ] Test health endpoint
- [ ] Test tool listing
- [ ] Test `list_owned_apps`
- [ ] Test `generate_access_review_candidates`

### 4. Verify Results

- [ ] All API calls return 200 OK
- [ ] Tools filtered by role correctly
- [ ] Real Okta data returned
- [ ] Authorization logs show successful context resolution
- [ ] Access denied for non-owned resources

---

## Success Criteria

Smoke test is successful when:

✅ Environment validation passes
✅ MRS server starts without errors
✅ Test token generated successfully
✅ Health endpoint returns 200 OK
✅ Tool list returns expected tools (3 for APP_ADMIN)
✅ `list_owned_apps` returns real Okta applications
✅ `generate_access_review_candidates` returns risk analysis with users
✅ Access denied for non-owned apps
✅ All authorization logs show successful Okta API calls

---

## Benefits

### For Development

✅ **Fast iteration** - No need to run full OAuth flow for testing
✅ **Backend testing** - Test MRS independently of frontend
✅ **Real integration** - Uses real Okta APIs and data
✅ **Clear validation** - Know exactly what's configured correctly

### For Testing

✅ **Repeatable** - Generate new tokens anytime
✅ **Configurable** - Test different users, scopes, expirations
✅ **Isolated** - Test without affecting production systems
✅ **Debuggable** - Clear logs at each step

### For Deployment

✅ **Pre-flight checks** - Catch configuration issues before startup
✅ **Documentation** - Complete setup instructions
✅ **Troubleshooting** - Common issues documented
✅ **Production-ready** - Validates real Okta integration

---

## Summary

Successfully prepared the Okta Governance MCP project for smoke testing with:

1. ✅ **Test token generation** - Local MCP token creation without MAS
2. ✅ **Environment validation** - Pre-flight configuration checks
3. ✅ **Comprehensive documentation** - Step-by-step smoke test guide
4. ✅ **NPM scripts** - Easy-to-use commands for all operations
5. ✅ **Build verification** - All TypeScript compiles successfully

The project is now ready for smoke testing against a real Okta tenant with minimal setup required.

---

**Ready for smoke test!** 🚀

See `docs/smoke-test.md` for complete instructions.

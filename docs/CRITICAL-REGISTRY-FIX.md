# CRITICAL FIX: Endpoint Registry Not Loading on Render

## Issue

MCP server on Render shows:
```
[ManageLabels] DEBUG: Registry loaded: false
Error: Endpoint registry not loaded - MCP server initialization failed
```

The registry loading is **silently failing** without detailed error information.

## Root Cause

The catch block in `src/mrs/server.ts` was not logging sufficient information to diagnose:
- Why the file loading failed
- Whether the Postman collection file exists
- What the actual error was

## Fix Applied

### 1. Added Comprehensive Error Logging

**Before:**
```typescript
try {
  const postmanPath = './postman/Okta Governance API.postman_collection.json';
  const registryInfo = loadEndpointRegistry(postmanPath);
  // ... basic logging
} catch (error) {
  console.error('[MRS] ❌ Failed to load Postman endpoint registry:', error);
  throw error;
}
```

**After:**
```typescript
try {
  // Step 1: Log current working directory
  const cwd = process.cwd();
  console.log('[MRS] Current working directory:', cwd);

  // Step 2: Resolve absolute path
  const postmanAbsolutePath = resolve(cwd, postmanRelativePath);
  console.log('[MRS] Absolute path:', postmanAbsolutePath);

  // Step 3: Check file existence
  const fileExists = existsSync(postmanAbsolutePath);
  console.log('[MRS] File exists:', fileExists);

  if (!fileExists) {
    // Log directory contents
    // Log postman/ directory contents
    throw new Error(`Postman collection not found at: ${postmanAbsolutePath}`);
  }

  // Step 4: Load registry
  // Step 5: Verify stats
  // Step 6: Verify label endpoints
  // Step 7: Final health check

} catch (error) {
  // Log FULL error details:
  console.error('[MRS] Error type:', error.constructor.name);
  console.error('[MRS] Error message:', error.message);
  console.error('[MRS] Stack trace:', error.stack);
  console.error('[MRS] Full error object:', JSON.stringify(error, null, 2));

  // FAIL STARTUP
  throw new Error(`CRITICAL: Endpoint registry loading failed: ${error.message}`);
}
```

### 2. Added Startup Health Check

After loading, verify:
- ✅ Registry is loaded: `isRegistryLoaded() === true`
- ✅ Endpoints count > 0: `registryStatus.endpointCount > 0`
- ✅ Label endpoints found: `labelEndpoints.length === 8`
- ✅ Critical endpoints present: All 4 critical endpoints verified

If any check fails → **FAIL STARTUP** (don't continue silently)

### 3. Enhanced Debug Information

**Startup now logs:**
```
[MRS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[MRS] Initializing Endpoint Registry...
[MRS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[MRS] Current working directory: /app
[MRS] Looking for Postman collection:
[MRS]    Relative path: ./postman/Okta Governance API.postman_collection.json
[MRS]    Absolute path: /app/postman/Okta Governance API.postman_collection.json
[MRS]    File exists: true/false
[MRS] ✅ File found, loading registry...
[MRS] ✅ Endpoint Registry Loaded Successfully:
[MRS]    - 153 endpoints
[MRS]    - 25 categories
[MRS] Registry Stats: { total: 153, withBody: 51, ... }
[MRS] Verifying critical label endpoints...
[MRS]    - Found 8 label endpoints
[MRS]    ✅ "List all labels"
[MRS]    ✅ "Create a label"
[MRS]    ✅ "Assign the labels to resources"
[MRS]    ✅ "Remove the labels from resources"
[MRS] Performing final registry health check...
[MRS] Registry health check: { loaded: true, endpointCount: 153, ... }
[MRS] ✅ Registry health check passed
[MRS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**If file not found:**
```
[MRS] ❌ CRITICAL ERROR: Postman collection file not found!
[MRS]    Expected location: /app/postman/Okta Governance API.postman_collection.json
[MRS]    Working directory: /app
[MRS]    Directory contents: [lists files]
[MRS]    postman/ directory exists: false
```

**If other error:**
```
[MRS] ❌ CRITICAL FAILURE: Endpoint Registry Loading Failed
[MRS] Error details:
[MRS]    Type: SyntaxError
[MRS]    Message: Unexpected token...
[MRS]    Stack trace: [first 5 lines]
[MRS] Full error object: { ... }
```

## Expected Outcomes on Render

### Scenario A: File Not Found

**Log Output:**
```
[MRS] Current working directory: /app
[MRS]    File exists: false
[MRS] ❌ CRITICAL ERROR: Postman collection file not found!
[MRS]    postman/ directory exists: false
```

**Root Cause:** Postman collection not deployed to Render
**Fix:** Ensure `postman/` directory is included in deployment

### Scenario B: Parse Error

**Log Output:**
```
[MRS]    File exists: true
[MRS] ✅ File found, loading registry...
[MRS] ❌ CRITICAL FAILURE: Endpoint Registry Loading Failed
[MRS]    Type: SyntaxError
[MRS]    Message: Unexpected token { in JSON at position 1234
```

**Root Cause:** Corrupted or invalid JSON in Postman collection
**Fix:** Re-upload valid Postman collection file

### Scenario C: Success

**Log Output:**
```
[MRS]    File exists: true
[MRS] ✅ File found, loading registry...
[MRS] ✅ Endpoint Registry Loaded Successfully:
[MRS]    - 153 endpoints
[MRS]    ✅ "List all labels"
[MRS] ✅ Registry health check passed
```

**Root Cause:** None - working correctly
**Next:** Test label operations

## Testing Steps

### 1. Local Test (Before Deploy)

```bash
# Build
npm run build

# Run server (will output startup logs)
npm run start:mrs

# Look for:
# [MRS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# [MRS] Initializing Endpoint Registry...
# [MRS] Current working directory: ...
# [MRS]    File exists: true
# [MRS] ✅ Endpoint Registry Loaded Successfully:
```

**Expected local result:** ✅ Should succeed and show all endpoints loaded

### 2. Deploy to Render

```bash
# Ensure postman/ directory is included in git
git add postman/
git status

# Build
npm run build

# Deploy dist/ to Render
# (Copy entire dist/ directory and postman/ directory)
```

### 3. Check Render Logs

After deployment, check startup logs:

```
[MRS] Current working directory: /app (or wherever Render runs from)
[MRS]    Absolute path: /app/postman/...
[MRS]    File exists: ??? ← THIS IS THE KEY
```

**If `File exists: false`:**
- Postman collection not deployed
- Fix: Include `postman/` in deployment

**If `File exists: true` but still fails:**
- The detailed error logs will show exactly what's wrong
- Could be: parse error, permission error, memory error, etc.

## Files Changed

1. **`src/mrs/server.ts`**
   - Added `existsSync` and `resolve` from Node.js fs/path
   - Added 7-step initialization process with extensive logging
   - Added file existence check before loading
   - Added directory listing if file not found
   - Added health check after loading
   - Added comprehensive error logging in catch block
   - **FAIL STARTUP if registry doesn't load** (was: silent continue)

## Deployment Checklist

- [x] Code changes committed
- [ ] Local test: `npm run build && npm run start:mrs`
- [ ] Verify startup logs show "✅ Registry health check passed"
- [ ] Deploy to Render:
  - [ ] Include `dist/` directory
  - [ ] Include `postman/` directory ← **CRITICAL**
  - [ ] Ensure `Okta Governance API.postman_collection.json` is present
- [ ] Check Render startup logs
- [ ] Look for `[MRS] File exists: true/false`
- [ ] If false: Fix deployment to include postman/
- [ ] If true: Check error details in logs
- [ ] Share logs for further diagnosis

## What This Will Tell Us

The enhanced logging will **definitively reveal**:

1. ✅ **Current working directory** on Render
2. ✅ **Exact file path** being checked
3. ✅ **Whether file exists** (true/false)
4. ✅ **Directory contents** if file not found
5. ✅ **Exact error type** if loading fails (SyntaxError, IOError, etc.)
6. ✅ **Error message** with full details
7. ✅ **Stack trace** showing where it failed
8. ✅ **Full error object** as JSON

**No more guessing - we'll know exactly why it's failing.**

## Commit

**Files changed:**
- `src/mrs/server.ts` (comprehensive error logging and health checks)
- `docs/CRITICAL-REGISTRY-FIX.md` (this document)

**Build:** ✅ Successful
**Local test:** Required before deploy
**Deploy:** Required to Render with postman/ directory

---

## 🚨 REMINDER: REDEPLOY NEEDED

After commit:
1. Test locally: `npm run build && npm run start:mrs`
2. Verify logs show registry loaded successfully
3. Deploy to Render including `postman/` directory
4. Check Render startup logs
5. Share logs for diagnosis

**This fix will reveal the exact root cause of the registry loading failure.**

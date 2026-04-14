# Label Endpoint Lookup Debugging - Summary

## Current Status

✅ **Frontend/Chat:** Working correctly
✅ **App Resolution:** Working correctly
✅ **Confirmation Flow:** Working correctly
✅ **App Validation:** Succeeds (app exists, governance-enabled)
❌ **Label Listing:** Fails with "endpoint not found in registry"

## Problem Statement

`manage_app_labels` tool fails at **Step 1: "Checking if label exists"** with:
```
Label listing endpoint not found in registry
```

**Paradox:**
- Verification script (`npm run verify-registry`) shows all 8 label endpoints ✅
- Test script (`npx tsx scripts/test-label-endpoints.ts`) shows all endpoints found ✅
- But runtime execution in MCP server fails ❌

## Debugging Strategy

Added **comprehensive logging** to trace the exact failure point and identify the root cause.

### What I Added

#### 1. Runtime Debugging in `manage_app_labels` Tool

**Every endpoint lookup now shows:**
- Is registry loaded? (true/false)
- How many endpoints in registry? (should be 153)
- How many label endpoints? (should be 8)
- List of ALL label endpoint names in registry
- Exact search query being used
- If not found: list of available alternatives

#### 2. Startup Verification in MRS Server

**Server startup now verifies:**
- Registry loads successfully
- 8 label endpoints found
- 4 critical endpoints verified by name:
  - ✅ "List all labels"
  - ✅ "Create a label"
  - ✅ "Assign the labels to resources"
  - ✅ "Remove the labels from resources"

## Expected Debug Output

### Successful Startup
```
[MRS] ✅ Endpoint Registry Loaded:
[MRS]    - 153 endpoints
[MRS]    - 25 categories
[MRS] Verifying label endpoints...
[MRS]    - Found 8 label endpoints
[MRS]    ✅ "List all labels"
[MRS]    ✅ "Create a label"
[MRS]    ✅ "Assign the labels to resources"
[MRS]    ✅ "Remove the labels from resources"
```

### Successful Runtime
```
[ManageLabels] DEBUG: Checking endpoint registry status...
[ManageLabels] DEBUG: Registry loaded: true
[ManageLabels] DEBUG: Registry status: {
  loaded: true,
  endpointCount: 153,
  categoryCount: 25
}
[ManageLabels] DEBUG: Label endpoints in registry: 8
[ManageLabels] DEBUG:   1. "List all labels" → GET /governance/api/v1/labels
[ManageLabels] DEBUG:   2. "Create a label" → POST /governance/api/v1/labels
[ManageLabels] DEBUG:   3. "Retrieve a label" → GET /governance/api/v1/labels/:labelId
[ManageLabels] DEBUG:   4. "Update a label" → PATCH /governance/api/v1/labels/:labelId
[ManageLabels] DEBUG:   5. "Delete a label" → DELETE /governance/api/v1/labels/:labelId
[ManageLabels] DEBUG:   6. "List all labeled resources" → GET /governance/api/v1/resource-labels
[ManageLabels] DEBUG:   7. "Assign the labels to resources" → POST /governance/api/v1/resource-labels/assign
[ManageLabels] DEBUG:   8. "Remove the labels from resources" → POST /governance/api/v1/resource-labels/unassign
[ManageLabels] DEBUG: Searching for endpoint: List all labels
[ManageLabels] Using endpoint: {
  name: 'List all labels',
  method: 'GET',
  path: '/labels'
}
```

### Failure Scenarios

**Scenario A: Registry Not Loaded**
```
[ManageLabels] DEBUG: Registry loaded: false
[ManageLabels] ERROR: Registry not loaded! This is a critical error.
Error: Endpoint registry not loaded - MCP server initialization failed
```

**Scenario B: Endpoint Name Mismatch**
```
[ManageLabels] DEBUG: Registry loaded: true
[ManageLabels] DEBUG: Label endpoints in registry: 8
[ManageLabels] DEBUG:   1. "Different Name" → GET /governance/api/v1/labels
[ManageLabels] ERROR: Endpoint not found!
[ManageLabels] ERROR: Searched for: List all labels
[ManageLabels] ERROR: Available: "Different Name", ...
```

**Scenario C: Empty Registry**
```
[ManageLabels] DEBUG: Registry loaded: true
[ManageLabels] DEBUG: Label endpoints in registry: 0
[ManageLabels] ERROR: No label endpoints in registry!
```

## Root Causes We Can Identify

| Symptom in Logs | Root Cause | Fix |
|-----------------|------------|-----|
| `Registry loaded: false` | Registry failed to initialize | Check Postman file path |
| `Label endpoints in registry: 0` | Labels category not parsed | Re-run `npm run parse-postman` |
| `Searched for: X, Available: Y` | Endpoint name mismatch | Update search key in code |
| `Found 8 label endpoints` but still fails | Case sensitivity or exact match issue | Compare names character-by-character |

## How to Diagnose

### Step 1: Rebuild
```bash
cd /Users/kvenkatraman/Documents/okta-governance-mcp
npm run build
```

### Step 2: Start Server and Capture Logs
```bash
npm run start 2>&1 | tee mcp-server.log
```

**Look for:**
```
[MRS] Verifying label endpoints...
```

### Step 3: Trigger Label Operation

From frontend, test:
```
User: "create a label called 'test-debug' for Salesforce.com"
```

**Look for in logs:**
```
[ManageLabels] DEBUG: Checking endpoint registry status...
```

### Step 4: Analyze Logs

Extract relevant sections:
```bash
# Startup verification
grep "Verifying label endpoints" mcp-server.log -A 10

# Runtime debugging
grep "\[ManageLabels\] DEBUG" mcp-server.log

# Error details
grep "\[ManageLabels\] ERROR" mcp-server.log
```

### Step 5: Identify Root Cause

Compare debug output against "Expected Debug Output" above to identify which scenario matches.

## Known Correct Endpoint Names

From Postman collection (verified):

| Function | Search Key | Expected Match |
|----------|-----------|----------------|
| `listLabels()` | `'List all labels'` | "List all labels" |
| `createLabel()` | `'Create a label'` | "Create a label" |
| `assignLabel()` | `'Assign the labels to resources'` | "Assign the labels to resources" |
| `removeLabel()` | `'Remove the labels from resources'` | "Remove the labels from resources" |
| `getResourceLabels()` | `'List all labeled resources'` | "List all labeled resources" |

## Files Modified

1. **`src/tools/governance/manage-app-labels.ts`**
   - Added `isRegistryLoaded()` check
   - Added `getRegistryStatus()` call
   - Added `getEndpointsByCategory('Labels')` listing
   - Enhanced all error messages with available endpoints

2. **`src/mrs/server.ts`**
   - Added label endpoint verification section
   - Verifies 4 critical endpoints by name at startup
   - Shows ✅/❌ status for each

3. **`scripts/verify-registry.ts`**
   - Updated with correct endpoint names
   - Includes "Remove the labels from resources"

4. **`docs/label-endpoint-debugging.md`**
   - Complete debugging guide
   - Expected output examples
   - Diagnostic procedures

## Next Steps

1. ✅ **Build:** `npm run build` (already done)
2. ⏳ **Start:** `npm run start` and capture logs
3. ⏳ **Test:** Trigger label operation from frontend
4. ⏳ **Analyze:** Review debug logs
5. ⏳ **Fix:** Apply targeted solution based on root cause

## Commit

**Commit:** `1bd224e` - Add comprehensive debugging for label endpoint lookup failures
- 4 files changed
- 367 insertions, 8 deletions
- Build: ✅ Successful

## What This Tells Us

The debug logs will definitively answer:

✅ **Is the registry loaded?** → `DEBUG: Registry loaded: true/false`
✅ **How many endpoints?** → `DEBUG: endpointCount: X`
✅ **What label endpoints exist?** → Lists all 8 with exact names
✅ **What are we searching for?** → `DEBUG: Searching for endpoint: X`
✅ **Why is it failing?** → Error message shows searched vs available

## Remaining Gaps After This Debug Session

Once we have the logs, we can:

1. **Identify exact mismatch** between search key and registry key
2. **Fix the mismatch** with a surgical change
3. **Verify the fix** by seeing tool proceed past Step 1
4. **Test complete workflow** (list → create → assign)

The debugging infrastructure is now in place. We need **runtime logs** to proceed.

---

**Status:** ✅ Debugging infrastructure complete
**Next:** Run MCP server and collect logs
**Goal:** Identify why `findEndpointByName('List all labels')` returns `undefined` at runtime

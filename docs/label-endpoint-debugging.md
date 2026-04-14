# Label Endpoint Lookup Debugging

## Issue

`manage_app_labels` fails at Step 1 with:
```
Label listing endpoint not found in registry
```

Despite verification scripts showing all 8 label endpoints are correctly loaded.

## Root Cause Analysis

**Hypothesis:** The registry may not be loaded at runtime, or there's a mismatch between test environment and production environment.

## Debugging Added

### 1. Enhanced `manage_app_labels` Tool (`src/tools/governance/manage-app-labels.ts`)

Added comprehensive debugging to all endpoint lookup functions:

#### `listLabels()` - Most Detailed

```typescript
// Check if registry is loaded
console.log('[ManageLabels] DEBUG: Checking endpoint registry status...');
const registryLoaded = isRegistryLoaded();
console.log('[ManageLabels] DEBUG: Registry loaded:', registryLoaded);

// Show registry stats
const registryStatus = getRegistryStatus();
console.log('[ManageLabels] DEBUG: Registry status:', {
  loaded: registryStatus.loaded,
  endpointCount: registryStatus.endpointCount,
  categoryCount: registryStatus.categoryCount,
});

// List all label endpoints
const labelEndpoints = getEndpointsByCategory('Labels');
console.log('[ManageLabels] DEBUG: Label endpoints in registry:', labelEndpoints.length);
labelEndpoints.forEach((ep, idx) => {
  console.log(`[ManageLabels] DEBUG:   ${idx + 1}. "${ep.name}" → ${ep.method} ${ep.normalizedPath}`);
});

// Search for endpoint
const searchName = 'List all labels';
console.log('[ManageLabels] DEBUG: Searching for endpoint:', searchName);
const endpoint = findEndpointByName(searchName);

if (!endpoint) {
  console.error('[ManageLabels] ERROR: Endpoint not found!');
  console.error('[ManageLabels] ERROR: Available:', labelEndpoints.map(e => e.name));
  throw new Error(`Label listing endpoint not found. Available: ${labelEndpoints.map(e => `"${e.name}"`).join(', ')}`);
}
```

#### Other Functions

Added similar debugging to:
- `createLabel()` - "Create a label"
- `assignLabel()` - "Assign the labels to resources"
- `removeLabel()` - "Remove the labels from resources"
- `getResourceLabels()` - "List all labeled resources"

### 2. Enhanced MRS Server Startup (`src/mrs/server.ts`)

Added label endpoint verification during startup:

```typescript
// Verify label endpoints are loaded
console.log('[MRS] Verifying label endpoints...');
const labelEndpoints = getEndpointsByCategory('Labels');
console.log(`[MRS]    - Found ${labelEndpoints.length} label endpoints`);

// Check critical endpoints
const criticalLabelEndpoints = [
  'List all labels',
  'Create a label',
  'Assign the labels to resources',
  'Remove the labels from resources',
];

for (const name of criticalLabelEndpoints) {
  const endpoint = findEndpointByName(name);
  if (endpoint) {
    console.log(`[MRS]    ✅ "${name}"`);
  } else {
    console.error(`[MRS]    ❌ Missing: "${name}"`);
  }
}
```

## Expected Output

### Scenario A: Registry Loaded Successfully

**Startup logs:**
```
[MRS] ✅ Endpoint Registry Loaded:
[MRS]    - 153 endpoints
[MRS]    - 25 categories
[MRS] Registry Stats: { total: 153, withBody: 51, withExamples: 153 }
[MRS] Verifying label endpoints...
[MRS]    - Found 8 label endpoints
[MRS]    ✅ "List all labels"
[MRS]    ✅ "Create a label"
[MRS]    ✅ "Assign the labels to resources"
[MRS]    ✅ "Remove the labels from resources"
```

**Runtime logs (when tool is called):**
```
[ManageLabels] DEBUG: Checking endpoint registry status...
[ManageLabels] DEBUG: Registry loaded: true
[ManageLabels] DEBUG: Registry status: { loaded: true, endpointCount: 153, categoryCount: 25 }
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
[ManageLabels] Using endpoint: { name: 'List all labels', method: 'GET', path: '/labels' }
```

### Scenario B: Registry Not Loaded

**Runtime logs:**
```
[ManageLabels] DEBUG: Checking endpoint registry status...
[ManageLabels] DEBUG: Registry loaded: false
[ManageLabels] ERROR: Registry not loaded! This is a critical error.
Error: Endpoint registry not loaded - MCP server initialization failed
```

### Scenario C: Registry Loaded but Endpoint Name Mismatch

**Runtime logs:**
```
[ManageLabels] DEBUG: Registry loaded: true
[ManageLabels] DEBUG: Label endpoints in registry: 8
[ManageLabels] DEBUG:   1. "Different Name 1" → GET /governance/api/v1/labels
[ManageLabels] DEBUG:   2. "Different Name 2" → POST /governance/api/v1/labels
[ManageLabels] DEBUG: Searching for endpoint: List all labels
[ManageLabels] ERROR: Endpoint not found!
[ManageLabels] ERROR: Searched for: List all labels
[ManageLabels] ERROR: Available: "Different Name 1", "Different Name 2", ...
Error: Label listing endpoint not found. Available: "Different Name 1", "Different Name 2", ...
```

## Diagnostic Steps

### 1. Check Startup Logs

Look for:
```bash
[MRS] ✅ Endpoint Registry Loaded:
[MRS] Verifying label endpoints...
```

If you see:
```bash
[MRS] ❌ Failed to load Postman endpoint registry:
```

**Root cause:** Registry failed to load at startup
**Fix:** Check postman collection path, file permissions

### 2. Check Runtime Logs

When tool is called, look for:
```bash
[ManageLabels] DEBUG: Registry loaded: true/false
[ManageLabels] DEBUG: Label endpoints in registry: X
```

### 3. Compare Endpoint Names

If registry is loaded but endpoint not found:
1. Note the **searched name**: `[ManageLabels] DEBUG: Searching for endpoint: X`
2. Note the **available names**: `[ManageLabels] ERROR: Available: "A", "B", ...`
3. Find the mismatch

## Known Correct Endpoint Names

From Postman collection:

| Search Key | Expected in Registry | Method | Path |
|------------|---------------------|--------|------|
| `'List all labels'` | "List all labels" | GET | `/labels` |
| `'Create a label'` | "Create a label" | POST | `/labels` |
| `'Assign the labels to resources'` | "Assign the labels to resources" | POST | `/resource-labels/assign` |
| `'Remove the labels from resources'` | "Remove the labels from resources" | POST | `/resource-labels/unassign` |
| `'List all labeled resources'` | "List all labeled resources" | GET | `/resource-labels` |

## Possible Root Causes

### 1. Registry Path Issue
**Symptom:** `[MRS] ❌ Failed to load Postman endpoint registry`
**Cause:** Postman collection not found at `./postman/Okta Governance API.postman_collection.json`
**Fix:**
- Verify file exists
- Check working directory when server starts
- Use absolute path if needed

### 2. Registry Scope Issue
**Symptom:** Registry loaded at startup but shows as not loaded in tool
**Cause:** Registry loaded in different scope/module context
**Fix:** Verify singleton pattern in `endpoint-registry.ts`

### 3. Name Mismatch
**Symptom:** Registry shows different endpoint names
**Cause:** Postman collection updated with different names
**Fix:** Re-run `npm run parse-postman` and update tool code

### 4. Timing Issue
**Symptom:** Registry loaded but empty when tool is called
**Cause:** Tool called before registry fully loaded
**Fix:** Add registry loading check in tool initialization

## Next Steps After Logs Are Available

1. **Capture full server startup logs** including all `[MRS]` messages
2. **Capture runtime logs** including all `[ManageLabels] DEBUG` messages
3. **Identify which scenario** (A, B, or C above) matches the logs
4. **Apply targeted fix** based on root cause

## Files Modified

1. `src/tools/governance/manage-app-labels.ts`
   - Added registry status checks
   - Added endpoint listing
   - Added detailed error messages with available endpoints

2. `src/mrs/server.ts`
   - Added label endpoint verification during startup
   - Added critical endpoint checks

3. `docs/label-endpoint-debugging.md` (this file)
   - Complete debugging guide

## Test Commands

```bash
# Build with new debugging
npm run build

# Start server and capture startup logs
npm run start 2>&1 | tee startup.log

# Look for registry verification
grep "Verifying label endpoints" startup.log

# When tool is called, runtime logs will show:
grep "\[ManageLabels\] DEBUG" <mcp-server-logs>
```

## Success Criteria

After debugging logs are collected:

✅ **Startup:** All 4 critical label endpoints show ✅
✅ **Runtime:** Registry loaded: true
✅ **Runtime:** 8 label endpoints found
✅ **Runtime:** "List all labels" endpoint found
✅ **Execution:** Tool proceeds past Step 1 to Step 2

## Commit

**Files changed:**
- `src/tools/governance/manage-app-labels.ts` (comprehensive debugging)
- `src/mrs/server.ts` (startup verification)
- `docs/label-endpoint-debugging.md` (this guide)

**Build:** ✅ Successful
**Next:** Run server and collect logs to diagnose issue

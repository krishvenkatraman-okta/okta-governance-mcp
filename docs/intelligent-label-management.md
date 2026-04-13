# Intelligent Label Management Tool

## Overview

Built `manage_app_labels` tool that uses the Postman endpoint registry for intelligent label workflows. This tool dynamically loads endpoint metadata from the parsed Postman collection to construct accurate API calls.

## Architecture

### 1. Endpoint Registry Integration

The tool uses the endpoint registry from `/src/catalog/endpoint-registry.ts`:

```typescript
import { findEndpointByName } from '../../catalog/endpoint-registry.js';
```

**How it works:**
- Registry is loaded at server startup from `postman/Okta Governance API.postman_collection.json`
- Contains 8 label endpoints with full metadata:
  - Request body schemas
  - Response examples
  - Path variables
  - Query parameters
  - HTTP methods

### 2. Label Endpoints Used

The tool intelligently finds and uses these endpoints:

| Action | Endpoint Name | Method | Path |
|--------|--------------|--------|------|
| List | "List all labels" | GET | `/governance/api/v1/labels` |
| Create | "Create a label" | POST | `/governance/api/v1/labels` |
| Apply | "Assign the labels to resources" | POST | `/governance/api/v1/resource-labels/assign` |
| Remove | "Remove the labels from resources" | POST | `/governance/api/v1/resource-labels/unassign` |
| Verify | "List all labeled resources" | GET | `/governance/api/v1/resource-labels` |

### 3. Dynamic API Calls

```typescript
async function callGovernanceAPI<T>(
  endpoint: ParsedEndpoint,
  options: {
    pathParams?: Record<string, string>;
    queryParams?: Record<string, string>;
    body?: unknown;
    scopes: string;
  }
): Promise<T>
```

**Smart Features:**
- Replaces path variables from endpoint metadata: `:labelId`, `:resourceId`
- Adds query parameters from endpoint schema
- Uses request body samples as templates
- Automatically applies correct HTTP method

**Example:**
```typescript
const endpoint = findEndpointByName('Assign the labels to resources');
// Returns: { method: 'POST', normalizedPath: '/governance/api/v1/labels/:labelId/assignments' }

const result = await callGovernanceAPI(endpoint, {
  pathParams: { labelId: 'lbl123' },
  body: { resourceId: 'app456', resourceType: 'app' },
  scopes: 'okta.governance.labels.manage'
});
// Calls: POST /governance/api/v1/labels/lbl123/assignments
```

## Intelligent Workflows

### Apply Label Workflow

The most powerful feature - automatically creates labels if they don't exist:

```typescript
async function applyLabelWorkflow(input, context) {
  // Step 1: List existing labels
  const labels = await listLabels(context);
  let label = labels.find(l => l.name === input.labelName);

  // Step 2: Create if not found
  if (!label) {
    label = await createLabel(input.labelName, input.labelDescription, context);
  }

  // Step 3: Assign to app
  const assignment = await assignLabel(label.id, input.appId, context);

  return { status: 'success', label, assignment };
}
```

**User Experience:**
```
User: "create a label called 'high-risk' for Salesforce.com"

1. ✅ Checks if 'high-risk' label exists
2. ✅ Creates it if missing
3. ✅ Assigns to Salesforce.com
4. ✅ Returns: "Applied label 'high-risk' to application"
```

## Supported Actions

### 1. List Labels
```json
{
  "action": "list"
}
```

Returns all labels in the organization.

### 2. Create Label
```json
{
  "action": "create",
  "labelName": "high-risk",
  "labelDescription": "Applications requiring additional review"
}
```

Creates a new governance label.

### 3. Apply Label
```json
{
  "action": "apply",
  "appId": "0oa1234567890abcdef",
  "labelName": "high-risk",
  "labelDescription": "Optional description if creating new"
}
```

**Intelligent behavior:**
- Checks if label exists
- Creates if needed
- Assigns to application
- Returns full details

### 4. Remove Label
```json
{
  "action": "remove",
  "appId": "0oa1234567890abcdef",
  "labelId": "lbl1234567890abcdef"
}
```

Removes label assignment from application.

### 5. Verify Labels
```json
{
  "action": "verify",
  "appId": "0oa1234567890abcdef"
}
```

Lists all labels currently assigned to an application.

## Benefits of Registry-Based Approach

### 1. Endpoint Metadata Authority
- Request body schemas from actual Postman examples
- Path variables extracted from endpoint definitions
- Query parameters documented in registry
- Response format from example responses

### 2. Automatic Updates
If Okta API changes:
1. Update Postman collection
2. Re-run parser: `npm run parse-postman`
3. Tool automatically uses new schema
4. **No code changes required**

### 3. LLM Explainability
```typescript
console.log('[ManageLabels] Using endpoint:', {
  name: endpoint.name,
  method: endpoint.method,
  path: endpoint.normalizedPath,
});
```

Logs show exactly which API endpoints are being called, making debugging and user explanation easy.

### 4. Error Handling
- Uses example error responses from registry
- Parses status codes from exampleResponses
- Returns truthful error messages based on actual API behavior

## Files Modified

### Created
- `src/tools/governance/manage-app-labels.ts` - Full implementation with registry integration

### Updated
- `src/tools/index.ts` - Import real tool instead of stub
- `src/tools/governance/stubs.ts` - Removed label stub
- `src/okta/governance-client.ts` - Added label API methods

## Integration Points

### Frontend Integration
The frontend already has deterministic routing for label operations:

```typescript
// In app/api/chat/route.ts
const isLabelManagement =
  (lowerText.includes('label') || lowerText.includes('mark as')) &&
  (lowerText.includes('create') || lowerText.includes('apply') || ...);

if (isLabelManagement) {
  // Extracts app name and label details
  // Routes to manage_app_labels tool
  // Uses draft + confirm flow
}
```

### Authorization
Tool respects authorization context:
- Requires `okta.governance.labels.read` for listing
- Requires `okta.governance.labels.manage` for mutations
- Filters based on user's role targets

## Example End-to-End Flow

**User:** "create a label called 'high-risk' for Salesforce.com"

1. **Frontend:** Detects label management intent
2. **Frontend:** Resolves "Salesforce.com" to `appId: "0oa123..."`
3. **Frontend:** Builds draft summary with warnings
4. **Frontend:** User confirms
5. **Backend:** Tool receives: `{ action: 'apply', appId: '0oa123...', labelName: 'high-risk' }`
6. **Backend:** Loads endpoint `"List all labels"` from registry
7. **Backend:** Calls `/governance/api/v1/labels` (GET)
8. **Backend:** Label doesn't exist, loads `"Create a label"` endpoint
9. **Backend:** Calls `/governance/api/v1/labels` (POST) with body from registry sample
10. **Backend:** Label created with `id: "lbl789..."`
11. **Backend:** Loads `"Assign the labels to resources"` endpoint
12. **Backend:** Calls `/governance/api/v1/labels/lbl789.../assignments` (POST)
13. **Backend:** Returns success response
14. **Frontend:** Shows: "✅ Applied label 'high-risk' to Salesforce.com"

## Testing

### Unit Test Example
```typescript
// Test that endpoint lookup works
const endpoint = findEndpointByName('Create a label');
expect(endpoint).toBeDefined();
expect(endpoint.method).toBe('POST');
expect(endpoint.normalizedPath).toBe('/governance/api/v1/labels');
```

### Integration Test Example
```typescript
// Test apply workflow
const result = await handler({
  action: 'apply',
  appId: 'test-app-id',
  labelName: 'test-label'
}, mockAuthContext);

expect(result.isError).toBe(false);
expect(result.content[0].text).toContain('Applied label');
```

## Future Enhancements

1. **Batch Operations**: Use registry to support bulk label assignments
2. **Label Search**: Add filtering/search using query params from registry
3. **Label Validation**: Parse label name constraints from request schema
4. **Response Caching**: Cache label list to reduce API calls
5. **Partial Updates**: Support updating label descriptions

## Key Takeaway

This tool demonstrates **intelligent API orchestration** by:
- Using metadata instead of hardcoded paths
- Automatically adapting to API changes
- Providing explainable execution traces
- Handling complex workflows transparently

**Result:** Users can say "create a label called X for app Y" and the system handles all the complexity automatically.

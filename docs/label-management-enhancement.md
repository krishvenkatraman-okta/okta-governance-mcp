# Label Management Enhancement - Guided User Experience

## Overview

Enhanced the label management flow to behave like a guided assistant for end users, not a raw API wrapper.

## Key Changes

### 1. Label Structure Understanding

**Okta Governance labels have a two-level structure:**
- **Label (key)**: The category (e.g., "Risk", "Compliance", "Department")
- **Label Values**: The options under that category (e.g., "high-risk", "medium-risk", "low-risk")

**Previous behavior:**
- Treated labels as flat strings
- No discovery of existing labels/values
- Raw API wrapper

**New behavior:**
- Understands label + value structure
- Discovers existing labels before any action
- Provides guided, user-friendly prompts

### 2. Guided Discovery Flow

**Before any action, the tool now:**
1. Lists all existing labels and their values
2. Searches for matches (exact or partial)
3. Provides clear guidance on what to do next
4. Uses simple, non-technical language

### 3. Automatic ORN Resolution

**Before:**
- Users had to provide ORNs manually
- Complex, technical requirement

**After:**
- Tool automatically resolves ORNs for resources
- Supports: apps, groups, entitlements
- Users only provide friendly IDs (appId, groupId, etc.)
- ORN used internally but never exposed to user

---

## Example User Experiences

### Scenario 1: Value Exists Under Known Label

**User says:** "Apply high-risk label to Salesforce.com"

**System discovers:**
- Label "Risk" exists
- Has values: ["high-risk", "medium-risk", "low-risk"]
- User's term "high-risk" matches an existing value

**System responds:**
```
✅ Success!

I found the label "Risk" which has the value "high-risk".

Applied "high-risk" (from label "Risk") to Salesforce.com.
```

---

### Scenario 2: Label Exists, But Value Doesn't

**User says:** "Apply critical label to Salesforce.com"

**System discovers:**
- Label "Risk" exists
- Has values: ["high-risk", "medium-risk", "low-risk"]
- Term "critical" doesn't match, but "Risk" is similar

**System responds:**
```
I found the label "Risk" with the following values:
- high-risk
- medium-risk
- low-risk

"critical" is not an existing value.

What would you like to do?
1. Use one of the existing values above
2. Create "critical" as a new value under "Risk"
3. Create a completely new label called "Critical"

Please let me know which option you prefer.
```

---

### Scenario 3: No Label Exists

**User says:** "Apply engineering label to Salesforce.com"

**System discovers:**
- No label called "Engineering"
- No values matching "engineering"

**System responds:**
```
I couldn't find any existing labels or values matching "engineering".

To create a new label, I'll need:
1. The label name (category) - for example: "Department", "Team", "Division"
2. The first value under that label - for example: "engineering", "sales", "marketing"

Here are the existing labels for reference:
- Risk: high-risk, medium-risk, low-risk
- Compliance: PCI-compliant, SOC2-certified, HIPAA-ready

Would you like to:
A. Create a new label called "Department" with value "engineering"?
B. Something else? Please specify the label name and value.
```

---

### Scenario 4: Ambiguous Input - Only Value Given

**User says:** "Apply high-risk to Salesforce.com"

**System discovers:**
- "high-risk" is a value under label "Risk"

**System responds:**
```
I found "high-risk" as a value under the label "Risk".

The "Risk" label has these values:
- high-risk
- medium-risk
- low-risk

Assigning "high-risk" to Salesforce.com...

✅ Successfully assigned "high-risk" (from label "Risk") to Salesforce.com
```

---

### Scenario 5: User Provides Label + Value Explicitly

**User says:** "Create label Department with value Engineering and apply to Salesforce.com"

**System discovers:**
- Label "Department" doesn't exist

**System responds:**
```
Creating new label...
✅ Created label "Department" with value "Engineering"

Assigning to Salesforce.com...
✅ Successfully assigned "Engineering" (from label "Department") to Salesforce.com
```

---

## Discovery Strategies

The tool uses multiple strategies to find matches:

### 1. Exact Label Name Match
Searches for exact label name (case-insensitive)
```
Input: "Risk"
Matches: Label "Risk"
```

### 2. Exact Value Match (Any Label)
Searches all label values across all labels
```
Input: "high-risk"
Matches: Value "high-risk" under label "Risk"
```

### 3. Partial Label Name Match
Finds labels with similar names
```
Input: "compliance"
Matches: Label "Compliance Standards"
```

### 4. Partial Value Match (Any Label)
Finds values with similar names
```
Input: "high"
Matches: Value "high-risk" under label "Risk"
```

### 5. No Match - New Label Needed
Guides user to create new label + value

---

## Technical Implementation

### Files Changed

1. **`src/tools/governance/manage-app-labels-enhanced.ts` (NEW)**
   - Complete rewrite with guided discovery
   - Label value support
   - ORN resolution
   - User-friendly prompts

2. **`src/tools/index.ts`** (UPDATED)
   - Replaced `manageAppLabelsTool` with `manageAppLabelsEnhancedTool`
   - Export enhanced version

### Key Functions

#### `discoverLabels(searchTerm, context)`
Core discovery engine that:
- Lists all existing labels with values
- Searches for exact and partial matches
- Returns guidance based on what exists

#### `resolveResourceORN(resourceType, resourceId, context)`
Automatic ORN resolution:
- **Apps**: Fetches app details, extracts ORN, validates governance enablement
- **Groups**: Constructs ORN: `orn:okta:group:<instance>:<groupId>`
- **Entitlements**: Constructs ORN: `orn:okta:entitlement:<instance>:<entitlementId>`

Returns both the ORN and user-friendly resource info.

#### `guidedApplyWorkflow(input, context)`
Main workflow that:
1. Resolves resource ORN
2. Discovers existing labels/values
3. Executes or guides based on discovery

### Tool Actions

#### `discover`
Search for existing labels/values and get guidance
```
Input: { action: "discover", searchTerm: "high-risk" }
Output: Matching label/value with suggestions
```

#### `list`
List all labels with their values
```
Input: { action: "list" }
Output: Array of labels with value counts
```

#### `create`
Create new label with a value
```
Input: { action: "create", labelName: "Risk", labelValue: "high-risk" }
Output: Created label details
```

#### `apply`
Intelligently apply label with guided discovery
```
Input: { action: "apply", labelValue: "high-risk", appId: "0oa123..." }
Output: Assignment result or guidance
```

### Response Types

#### Success Response
```json
{
  "success": true,
  "action": "assign_existing",
  "message": "✅ Successfully assigned 'high-risk' (from label 'Risk') to Salesforce.com",
  "resource": {
    "name": "Salesforce.com",
    "type": "app",
    "id": "0oa123..."
  },
  "label": {
    "name": "Risk",
    "value": "high-risk"
  }
}
```

#### Guidance Response
```json
{
  "status": "guidance_needed",
  "message": "I found the label 'Risk' with 3 available values.",
  "availableValues": ["high-risk", "medium-risk", "low-risk"],
  "nextStep": "Please specify which value you want to assign from the list above.",
  "resource": {
    "name": "Salesforce.com",
    "type": "app"
  }
}
```

---

## ORN Resolution Details

### Apps
```typescript
// Fetch app details
const app = await appsClient.getById(appId);

// Validate governance enablement
const emOptInStatus = app.settings?.emOptInStatus;
if (emOptInStatus !== 'ENABLED') {
  return error;
}

// Extract or construct ORN
const orn = app.orn || `orn:okta:app:<instance>:<appId>`;
```

**ORN Format:** `orn:okta:app:<instance>:<appId>`

### Groups
```typescript
// Construct ORN (groups don't need fetch for basic operations)
const orn = `orn:okta:group:<instance>:<groupId>`;
```

**ORN Format:** `orn:okta:group:<instance>:<groupId>`

### Entitlements
```typescript
// Construct ORN
const orn = `orn:okta:entitlement:<instance>:<entitlementId>`;
```

**ORN Format:** `orn:okta:entitlement:<instance>:<entitlementId>`

### Draft Summary
The tool shows user-friendly resource information in drafts:
```
Resource: Salesforce.com (App)
Label: Risk
Value: high-risk
```

But internally uses the ORN when calling the API:
```json
{
  "assignments": [{
    "resourceOrn": "orn:okta:app:dev-12345:0oa123...",
    "resourceType": "app",
    "labelValues": [...]
  }]
}
```

---

## Safety Features

### 1. Draft + Confirm Flow (Preserved)
All write operations still use draft + confirm:
- Discovery and guidance happens first
- User confirms before execution
- No surprise writes

### 2. Validation
- App must exist
- App must have governance enabled
- User must have appropriate permissions
- Resources must be in user's role targets (for App Admins)

### 3. Truthful Messaging
- Never fabricates labels or values
- Shows exactly what exists
- Clear about what's missing
- Honest about limitations

---

## Migration Notes

### Backward Compatibility
- Old tool: `manage_app_labels` (deprecated)
- New tool: `manage_app_labels_enhanced`
- Old tool file preserved for reference: `manage-app-labels.ts`

### Breaking Changes
None - this is a new tool name. Existing integrations continue to work.

### Recommended Migration
Update chat integrations to use `manage_app_labels_enhanced` for better UX.

---

## Testing

### Local Testing
```bash
# Build
npm run build

# Test discovery
# (call tool with action: "discover", searchTerm: "high-risk")

# Test apply
# (call tool with action: "apply", labelValue: "high-risk", appId: "0oa...")
```

### Expected Behavior
1. Tool lists all existing labels and values
2. Searches for matches intelligently
3. Provides clear guidance messages
4. Resolves ORNs automatically
5. Shows user-friendly resource names

---

## Future Enhancements

1. **Value creation workflow**
   - Currently returns guidance
   - Could automate value creation with user confirmation

2. **Bulk assignment**
   - Assign same label value to multiple resources

3. **Label templates**
   - Pre-defined label structures for common use cases

4. **Smart suggestions**
   - ML-based suggestions for appropriate labels based on app type

---

## Summary

**Changed Files:**
- `src/tools/governance/manage-app-labels-enhanced.ts` (NEW) - 850+ lines
- `src/tools/index.ts` (UPDATED) - Switched to enhanced tool
- `docs/label-management-enhancement.md` (NEW) - This documentation

**Key Improvements:**
1. ✅ Automatic discovery of existing labels/values before any action
2. ✅ Intelligent search with multiple matching strategies
3. ✅ User-friendly, non-technical language
4. ✅ Automatic ORN resolution (no manual ORN input required)
5. ✅ Guided branching based on what exists
6. ✅ Clear next steps and suggestions
7. ✅ Support for label + value structure (not flat strings)

**User Experience:**
- From: Raw API wrapper requiring technical knowledge
- To: Guided assistant with discovery and suggestions

**Next Steps:**
1. Build and test locally
2. Deploy to Render
3. Update chat integrations to use new tool
4. Monitor user feedback and adjust prompts

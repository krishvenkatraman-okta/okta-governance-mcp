# Multi-Step Access Request Workflow Implementation

## Status: 🚧 IN PROGRESS

### ✅ Completed (Commit: 66dfd77)

1. **Session State Interface** (`lib/session.ts`)
   - Added `pendingAccessRequestWorkflow` field
   - Tracks workflow stages and state across turns

2. **Helper Functions** (`app/api/chat/route.ts`)
   - `findParentEntry()` - Fuzzy search for resources
   - `getChildEntries()` - Get child entitlements
   - `parseFieldValue()` - Parse user input by field type

### 🚧 TODO: Multi-Turn Handler Implementation

The full multi-turn workflow handler needs to be implemented in the POST route handler.

---

## Complete Workflow Design

### Step 1: Initial Request
```
User: "Request access for Adobe"
```

**Handler Actions:**
1. Detect intent: `type='request_access'`, `resourceName='Adobe'`
2. Call `findParentEntry('Adobe', token, domain)`
3. Check `entry.requestable` property

**Response Logic:**
- If `requestable === true`:
  - Skip to Step 3 (get request fields)
- If `requestable === false`:
  - Store workflow in session:
    ```typescript
    session.pendingAccessRequestWorkflow = {
      stage: 'awaiting_entitlement_selection',
      resourceName: 'Adobe',
      parentEntry: entry,
      childEntries: await getChildEntries(entry.id, token, domain)
    }
    ```
  - Show child options to user:
    ```
    Adobe has these access levels:
    1. Adobe Express Bundle
    2. Adobe Pro Bundle
    3. Creative Cloud Bundle

    Which one would you like?
    ```

---

### Step 2: Entitlement Selection (if needed)
```
User: "Adobe Express Bundle"
```

**Handler Actions:**
1. Check session: `session.pendingAccessRequestWorkflow.stage === 'awaiting_entitlement_selection'`
2. Match user input to one of `childEntries`
3. Update workflow:
   ```typescript
   session.pendingAccessRequestWorkflow = {
     ...session.pendingAccessRequestWorkflow,
     stage: 'collecting_fields',
     selectedEntryId: matchedChild.id,
     requestFields: await getRequestFields(matchedChild.id, token, domain),
     collectedValues: {},
     currentFieldIndex: 0
   }
   ```
4. Start collecting first required field

---

### Step 3: Field Collection (iterative)
```
User: "30 days"
```

**Handler Actions:**
1. Check session: `session.pendingAccessRequestWorkflow.stage === 'collecting_fields'`
2. Get current field: `requestFields[currentFieldIndex]`
3. Parse user input: `parseFieldValue(field.id, field.type, userInput)`
4. Store in `collectedValues[field.id] = parsedValue`
5. Move to next field: `currentFieldIndex++`

**Loop Logic:**
```typescript
const workflow = session.pendingAccessRequestWorkflow;
const requiredFields = workflow.requestFields.filter(f => f.required);
const currentIndex = workflow.currentFieldIndex || 0;

if (currentIndex < requiredFields.length) {
  // Collect next field
  const currentField = requiredFields[currentIndex];

  // Parse and store current value
  workflow.collectedValues[currentField.id] = parseFieldValue(
    currentField.id,
    currentField.type,
    userInput
  );

  workflow.currentFieldIndex = currentIndex + 1;

  // Check if more fields needed
  if (workflow.currentFieldIndex < requiredFields.length) {
    const nextField = requiredFields[workflow.currentFieldIndex];
    return NextResponse.json({
      message: `${getFieldQuestion(nextField)}`
    });
  } else {
    // All fields collected, show preview
    workflow.stage = 'awaiting_confirmation';
    return NextResponse.json({
      message: getConfirmationPreview(workflow)
    });
  }
}
```

---

### Step 4: Show Preview & Request Confirmation
```
Ready to request:
- Resource: Adobe
- Access Level: Adobe Express Bundle
- Duration: 30 days
- Reason: Project work

Type "confirm" to submit, or "cancel" to abort.
```

**Handler Actions:**
1. Workflow stage: `awaiting_confirmation`
2. Format preview from collected values
3. Wait for user to say "confirm" or "cancel"

---

### Step 5: Create Request on Confirmation
```
User: "confirm"
```

**Handler Actions:**
1. Check session: `session.pendingAccessRequestWorkflow.stage === 'awaiting_confirmation'`
2. Build request data from `collectedValues`
3. Call `createAccessRequest(selectedEntryId, collectedValues, token, domain)`
4. Clear workflow: `session.pendingAccessRequestWorkflow = undefined`
5. Show success message:
   ```
   ✅ Request created!
   Request ID: req_123
   Status: PENDING
   ```

---

## Field Question Templates

```typescript
function getFieldQuestion(field: any): string {
  const fieldLabel = field.label || field.name || field.id;

  switch (field.type) {
    case 'DURATION':
      const maxDuration = field.maximumValue; // e.g., "P30D"
      return `How long do you need access? (e.g., "7 days", "2 weeks", max: ${formatDuration(maxDuration)})`;

    case 'OKTA_USER_ID':
      return `Is this request for yourself, or someone else? (Reply "myself" or provide their email)`;

    case 'STRING':
    case 'TEXT':
      if (field.id === 'JUSTIFICATION') {
        return `Why do you need this access? (Provide a brief justification)`;
      }
      return `Please provide: ${fieldLabel}`;

    case 'ENUM':
      const options = field.options?.map((o: any) => o.label || o.value).join(', ');
      return `Select ${fieldLabel}: ${options}`;

    case 'BOOLEAN':
      return `${fieldLabel}? (yes/no)`;

    default:
      return `Please provide: ${fieldLabel}`;
  }
}
```

---

## Confirmation Preview Template

```typescript
function getConfirmationPreview(workflow: any): string {
  const entry = workflow.childEntries?.find((e: any) => e.id === workflow.selectedEntryId)
    || workflow.parentEntry;

  const lines = [
    '**Ready to submit your access request:**',
    '',
    `📦 **Resource:** ${workflow.parentEntry?.name}`,
  ];

  if (workflow.childEntries) {
    lines.push(`🎯 **Access Level:** ${entry.name}`);
  }

  // Add collected field values
  workflow.requestFields?.forEach((field: any) => {
    const value = workflow.collectedValues?.[field.id];
    if (value !== undefined) {
      const label = field.label || field.name || field.id;
      let displayValue = value;

      if (field.type === 'DURATION') {
        displayValue = formatDuration(value); // P30D → "30 days"
      }

      lines.push(`📝 **${label}:** ${displayValue}`);
    }
  });

  lines.push('');
  lines.push('Type **"confirm"** to submit, or **"cancel"** to abort.');

  return lines.join('\n');
}
```

---

## Implementation Checklist

### Phase 1: Handler Structure
- [ ] Add check at start of POST handler for `pendingAccessRequestWorkflow`
- [ ] Route to appropriate stage handler based on `workflow.stage`
- [ ] Implement stage handlers:
  - [ ] `handleAwaitingEntitlementSelection()`
  - [ ] `handleCollectingFields()`
  - [ ] `handleAwaitingConfirmation()`

### Phase 2: Stage Handlers

#### Handle Entitlement Selection
- [ ] Parse user input to match child entry
- [ ] Handle partial matches
- [ ] Update workflow state
- [ ] Start field collection

#### Handle Field Collection
- [ ] Get current field from `currentFieldIndex`
- [ ] Parse user input with `parseFieldValue()`
- [ ] Store in `collectedValues`
- [ ] Increment index
- [ ] Check if more fields needed
- [ ] Move to confirmation stage when done

#### Handle Confirmation
- [ ] Check for "confirm" or "cancel"
- [ ] If confirm: create request
- [ ] If cancel: clear workflow
- [ ] Show success/cancellation message

### Phase 3: Edge Cases
- [ ] Handle "cancel" at any stage
- [ ] Handle invalid field values
- [ ] Handle field value out of range (e.g., duration > max)
- [ ] Handle ambiguous entitlement selection
- [ ] Timeout workflow after X minutes of inactivity

### Phase 4: User Experience
- [ ] Format duration values nicely (P30D → "30 days")
- [ ] Show helpful examples for each field type
- [ ] Allow user to go back and change values
- [ ] Show progress indicator ("Step 2 of 4")

---

## Code Location

**File:** `frontend/app/api/chat/route.ts`

**Current Implementation:** Lines 1085-1184 (simple, single-turn)

**Needs Replacement:** Full multi-turn handler with session state management

---

## Testing Scenarios

### Scenario 1: Simple Request (No Children, No Required Fields)
```
User: "Request access for Slack"
→ Slack found, requestable=true, no required fields
→ ✅ Request created immediately
```

### Scenario 2: Resource with Children
```
User: "Request access for Adobe"
→ Adobe found, requestable=false
→ Show 3 child options
User: "Express Bundle"
→ Selected, get fields (2 required)
→ Ask for duration
User: "30 days"
→ Ask for justification
User: "Marketing campaign"
→ Show preview
User: "confirm"
→ ✅ Request created
```

### Scenario 3: Cancellation
```
User: "Request access for Adobe"
→ Show child options
User: "cancel"
→ ❌ Request cancelled, workflow cleared
```

---

## Current Status

**Completed:**
- ✅ Helper functions for catalog search, child entries, field parsing
- ✅ Session state interface for workflow tracking
- ✅ Documentation of complete workflow design

**In Progress:**
- 🚧 Multi-turn handler implementation

**Not Started:**
- ⏳ Stage handler functions
- ⏳ Preview formatting
- ⏳ Edge case handling
- ⏳ User experience improvements

---

## Next Steps

1. Implement stage check at POST handler start
2. Implement `handleAwaitingEntitlementSelection()`
3. Implement `handleCollectingFields()` with field iteration
4. Implement `handleAwaitingConfirmation()`
5. Add edge case handling (cancel, invalid input)
6. Test complete workflow end-to-end

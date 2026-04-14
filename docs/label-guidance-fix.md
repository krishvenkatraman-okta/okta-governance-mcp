# Label Guidance Flow Fix - Human-Readable Messages

## Overview

Fixed the label guidance flow to correctly understand the Okta Labels API model and present existing labels/values in a simple, human-readable way.

---

## The Problem

When users said "apply label high-risk to Salesforce.com", the system's guidance was technically correct but unclear:

**Before:**
```
I found the label "high-risk" with 3 available values.
```

**Issues:**
1. Not clear what "high-risk" is (label name or value name?)
2. Values not shown in readable format
3. Limited guidance on next steps
4. No context about the resource
5. Only offered implicit choices

---

## Okta Labels API Model

Understanding the structure is critical:

```typescript
Label {
  labelId: string           // e.g., "00l1234567890"
  name: string              // e.g., "high-risk" or "Compliance"
  values: LabelValue[]      // Array of values under this label
}

LabelValue {
  labelValueId: string      // e.g., "00v1234567890"
  name: string              // e.g., "SOX" or "PII"
}
```

**Key distinction:**
- **Label name**: The category (e.g., "Risk", "Compliance", "Department")
- **Value name**: The option under that category (e.g., "high-risk", "SOX", "Engineering")

**Assignment requires:**
- Both `labelId` AND `labelValueId`
- Can't assign just a label name without a value

---

## The Fix

### Part 1: Discovery Logic (Already Correct)

The discovery logic correctly checks in order:
1. **Exact label name match** (label.name)
2. **Exact value name match** (label.values[].name) across all labels
3. Partial label name match
4. Partial value name match
5. No match

**This was already working correctly.** The issue was in how the results were presented.

### Part 2: Human-Readable Guidance Messages

Enhanced ALL discovery strategies with formatted, clear messages:

#### Strategy 1: Exact Label Name Match

**Before:**
```
I found the label "high-risk" with 3 available values.
```

**After:**
```
I found an existing label: **high-risk**

Available values:
- SOX
- PII
- HIPAA

What would you like to do?
a. Assign one of the existing values above
b. Create a new value under "high-risk"
c. Create a completely new label
```

**Changes:**
- Markdown formatting for emphasis (`**bold**`)
- Bulleted list for values
- Three explicit options (a/b/c)
- Clear next steps

#### Strategy 2: Exact Value Name Match

**Before:**
```
I found the label "high-risk" which has the value "SOX".
```

**After:**
```
I found the value **"SOX"** under the label **"high-risk"**

Available values in this label:
- **SOX** ← matches your request
- PII
- HIPAA

Would you like me to assign "SOX" to the application?
```

**Changes:**
- Clarifies that "SOX" is a VALUE, not a label
- Shows which LABEL it belongs to
- Highlights the matching value with arrow
- Simple yes/no question

#### Strategy 3: Partial Label Name Match

**Before:**
```
I found a similar label: "high-risk". Did you mean to use one of its values, or create a new value?
```

**After:**
```
I found a similar label: **high-risk**

Available values:
- SOX
- PII

Did you mean:
a. Use one of the values from "high-risk"?
b. Create a new value under "high-risk"?
c. Create a completely new label?
```

**Changes:**
- Formatted values list
- Three explicit options
- Clearer phrasing

#### Strategy 4: Partial Value Name Match

**Before:**
```
I found a similar value: "SOX" under the label "high-risk".
```

**After:**
```
I found a similar value: **"SOX"** under the label **"high-risk"**

Available values:
- **SOX** ← similar to your request
- PII

Would you like me to assign "SOX"?
```

**Changes:**
- Highlights similar match
- Shows context (other values in same label)
- Simple confirmation question

#### Strategy 5: No Match

**Before:**
```
I couldn't find any existing labels or values matching "custom-tag".
To create a new label, I'll need:
1. The label name (category) - for example: "Risk", "Compliance"
2. The first value under that label - for example: "high-risk", "PCI-compliant"
```

**After:**
```
I couldn't find any existing labels or values matching **"custom-tag"**

Existing labels for reference:
- high-risk (2 values)
- Compliance (3 values)
- Department (5 values)
... and 7 more

To create a new label, I'll need:
1. **Label name** (the category) - for example: "Risk", "Compliance", "Department"
2. **First value** under that label - for example: "high-risk", "PCI-compliant", "Engineering"

Please tell me:
- The label name you want to create
- The first value under that label
```

**Changes:**
- Shows first 5 existing labels for context
- Counts values per label
- Formatted requirements
- Explicit instructions at end

### Part 3: Enhanced Guidance Responses

Updated the guidance responses in `guidedApplyWorkflow` to include:

1. **Resource context**: Always shows which resource the label will be applied to
2. **Clear instructions**: Explicit next steps for user
3. **Multiple options**: Offers all three paths (assign existing, create value, create label)
4. **Cancel option**: Users can back out

**Example enhanced response:**

```
I found an existing label: **high-risk**

Available values:
- SOX
- PII

**Resource:** Salesforce.com (app)

Please reply with your choice:
- To assign an existing value: just type the value name (e.g., "SOX")
- To create a new value: specify "create value: <name>"
- To start over with a new label: type "cancel"
```

### Part 4: Execution Model Preserved

**No changes to:**
- ✅ Discovery logic (already correct)
- ✅ Draft + confirm flow
- ✅ Authorization checks
- ✅ MCP protocol integration
- ✅ Assignment execution (requires both labelId and valueId)

**Only changed:**
- Message formatting
- User guidance clarity
- Option presentation

---

## Example Scenarios

### Scenario 1: User Provides Existing Label Name

**Input:** "apply label high-risk to Salesforce.com"

**System interprets:** "high-risk" could be label name OR value name

**Discovery:** Checks label.name first (Strategy 1) → finds "high-risk" is a LABEL

**Response:**
```
I found an existing label: **high-risk**

Available values:
- SOX
- PII
- HIPAA

What would you like to do?
a. Assign one of the existing values above
b. Create a new value under "high-risk"
c. Create a completely new label

**Resource:** Salesforce.com (app)

Please reply with your choice:
- To assign an existing value: just type the value name (e.g., "SOX")
- To create a new value: specify "create value: <name>"
- To start over with a new label: type "cancel"
```

**User follows up:** "SOX"

**System:** Assigns labelId="high-risk" + valueId="SOX" → drafts confirmation

---

### Scenario 2: User Provides Existing Value Name

**Input:** "apply label SOX to Salesforce.com"

**System interprets:** "SOX" could be label name OR value name

**Discovery:**
1. Checks label.name (Strategy 1) → no label named "SOX"
2. Checks all values[] (Strategy 2) → finds "SOX" is a VALUE under label "high-risk"

**Response:**
```
I found the value **"SOX"** under the label **"high-risk"**

Available values in this label:
- **SOX** ← matches your request
- PII
- HIPAA

Would you like me to assign "SOX" to the application?

**Resource:** Salesforce.com (app)

Please reply with your choice:
- To assign an existing value: just type the value name (e.g., "SOX")
- To create a new value: specify "create value: <name>"
- To start over with a new label: type "cancel"
```

**User confirms:** "yes" or just replies with "SOX" again

**System:** Assigns labelId="high-risk" + valueId="SOX" → drafts confirmation

---

### Scenario 3: No Existing Label or Value

**Input:** "apply label custom-security to Salesforce.com"

**System interprets:** "custom-security" could be label name OR value name

**Discovery:**
1. Checks label.name → no match
2. Checks all values[] → no match
3. Strategy 5 (no match)

**Response:**
```
I couldn't find any existing labels or values matching **"custom-security"**

Existing labels for reference:
- high-risk (2 values)
- Compliance (3 values)
- Department (5 values)
... and 7 more

To create a new label, I'll need:
1. **Label name** (the category) - for example: "Risk", "Compliance", "Department"
2. **First value** under that label - for example: "high-risk", "PCI-compliant", "Engineering"

**Resource:** Salesforce.com (app)

Please tell me:
- The label name you want to create
- The first value under that label

To proceed, please reply with:
**"create label: <label-name> value: <value-name>"**

Example: "create label: Risk value: high-risk"
```

**User follows up:** "create label: Security value: custom-security"

**System:** Creates new label "Security" with value "custom-security" → drafts confirmation

---

## Technical Changes

### File Changed

**`src/tools/governance/manage-app-labels-enhanced.ts`**
- 1 file changed
- 135 insertions, 18 deletions
- Lines 282-690: Updated all discovery messages and guidance responses

### Functions Modified

#### `discoverLabels(searchTerm, context)`

**Strategy 1 (lines 282-316):** Exact label name match
- Format values as bulleted list
- Offer three options (a/b/c)
- Use markdown for emphasis

**Strategy 2 (lines 318-339):** Exact value match
- Highlight matching value with arrow
- Show which label it belongs to
- Simple confirmation question

**Strategy 3 (lines 358-389):** Partial label name match
- Format values list
- Offer three options
- Clearer phrasing

**Strategy 4 (lines 402-428):** Partial value match
- Highlight similar match
- Show context
- Simple question

**Strategy 5 (lines 432-459):** No match
- Show first 5 existing labels
- Count values per label
- Formatted requirements

#### `guidedApplyWorkflow(input, context)`

**assign_existing case (lines 610-640):** Label exists, no value chosen
- Add resource context
- Offer three options
- Include cancel option
- Format instructions

**create_value case (lines 642-667):** Label exists, value doesn't
- Add resource context
- Clear options
- Format instructions

**create_label case (lines 669-690):** No label exists
- Add resource context
- Show format example
- Clear instructions

---

## Message Formatting Standards

All guidance messages now follow these standards:

1. **Markdown formatting**
   - `**bold**` for label names, value names, important terms
   - `- bullet` for lists
   - `← arrow` for highlighting matches

2. **Structured sections**
   - Finding statement (what was discovered)
   - Available values (bulleted list)
   - Options (a/b/c or numbered)
   - Resource context
   - Next steps (explicit instructions)

3. **User-friendly language**
   - No technical jargon (labelId, valueId hidden)
   - Simple questions
   - Clear action items
   - Examples where helpful

4. **Consistent patterns**
   - "I found..." for discoveries
   - "Available values:" for lists
   - "What would you like to do?" for options
   - "Please reply with..." for instructions

---

## Testing

### Label Name Match
```
Input: "high-risk" (existing label name)

✅ Shows: "I found an existing label: high-risk"
✅ Lists: All values under that label (bulleted)
✅ Asks: Which value to assign, OR create new value, OR create new label
✅ Includes: Resource context
✅ Provides: Clear instructions
```

### Value Name Match
```
Input: "SOX" (existing value under "high-risk" label)

✅ Shows: "I found the value 'SOX' under label 'high-risk'"
✅ Highlights: The matching value with arrow
✅ Lists: Other values in same label
✅ Asks: Confirm assignment
✅ Includes: Resource context
```

### No Match
```
Input: "nonexistent" (doesn't match any label or value)

✅ Shows: "I couldn't find any existing labels or values"
✅ Lists: First 5 existing labels for reference
✅ Counts: Values per label
✅ Asks: For label name and first value to create
✅ Provides: Format example
```

---

## Deployment

### Build Status
✅ **Build successful** - No TypeScript errors

### Files Changed
- `src/tools/governance/manage-app-labels-enhanced.ts`

### Next Steps
1. **Deploy to Render** (MCP server runs remotely)
   ```bash
   npm run build
   # Deploy dist/ directory to Render
   ```

2. **Test with real data**
   - Try: "apply label high-risk to Salesforce.com"
   - Verify: Clear guidance with formatted values
   - Confirm: All three options offered

3. **Monitor user feedback**
   - Are messages clear?
   - Do users understand label vs value?
   - Are instructions sufficient?

---

## Summary

**Changed:** 1 file, 135 insertions, 18 deletions

**Key improvements:**
1. ✅ Messages now clearly distinguish label names from value names
2. ✅ Values displayed as readable bulleted lists
3. ✅ Three options offered explicitly (assign, create value, create label)
4. ✅ Resource context shown in all guidance
5. ✅ Markdown formatting for emphasis
6. ✅ Matching items highlighted with arrows
7. ✅ Existing labels shown for reference
8. ✅ Clear, actionable next steps

**Architecture preserved:**
- ✅ No changes to discovery logic (already correct)
- ✅ No changes to execution model
- ✅ No changes to draft + confirm flow
- ✅ No changes to authorization checks
- ✅ Only improved message formatting and user guidance

**User experience:**
- From: Technical, unclear messages
- To: Human-readable, guided experience with clear options

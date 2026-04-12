# Write Tool Confirmation Flow Design

## Overview

This document describes the confirmation-required pattern for write operations in the Okta Governance Console. Write tools require explicit user confirmation before execution to prevent accidental or unintended governance changes.

## Enabled Write Tools

Currently enabled write tools (with confirmation required):
- `manage_app_labels` - Manage governance labels for applications
- `manage_app_campaigns` - Create and manage access certification campaigns

All other write tools remain stubbed and unavailable.

## Confirmation Flow Pattern

### Phase 1: Proposal (Current Implementation)

When a user requests a write operation:

1. **App Resolution**
   - Extract app name or appId from user request
   - Resolve against governance-enabled apps only
   - If multiple matches: request clarification
   - If no match: return error

2. **Action Draft**
   - Parse the intended action and parameters
   - Validate all required parameters are present
   - Generate a human-readable summary of the proposed action

3. **Confirmation Request**
   - Display the draft action summary
   - Show all parameters clearly
   - Request explicit confirmation from user
   - **Do NOT execute immediately**

### Phase 2: Execution (Future Enhancement)

When user confirms:

1. **Confirmation Message**
   - User sends explicit confirmation (e.g., "yes", "confirm", "proceed")
   - System verifies the confirmation matches the pending action

2. **Execute with Authorization**
   - Re-validate user authorization
   - Execute the write operation
   - Return execution result

3. **Audit Trail**
   - Log the action with user context
   - Include before/after state if applicable

## Tool-Specific Patterns

### manage_app_labels

**Example Flow:**
```
User: "Apply label 'high-risk' to Salesforce"

Assistant (Proposal):
"I will apply the following label:
- App: Salesforce.com (0oa123456)
- Action: apply
- Label: high-risk

This action will:
- Add the 'high-risk' governance label to Salesforce.com
- Make the app visible in high-risk app reports
- May trigger additional compliance workflows

To proceed, please confirm this action."

User: "confirm"

Assistant (Execution):
[Calls manage_app_labels with confirmation=true]
"Label 'high-risk' successfully applied to Salesforce.com."
```

**Parameters:**
- `appId` (string, required): Application ID
- `action` (enum, required): 'list', 'create', 'apply', 'remove'
- `labelName` (string, conditional): Required for apply/remove actions
- `labelDescription` (string, optional): For create action

### manage_app_campaigns

**Example Flow:**
```
User: "Create a quarterly access review campaign for Box"

Assistant (Proposal):
"I will create the following campaign:
- App: Box.com (0oa789012)
- Action: create
- Name: Quarterly Access Review - Box.com
- Type: Access Certification
- Reviewers: App Owners

This action will:
- Create a new access certification campaign
- Require app owners to review all user assignments
- Campaign will be in DRAFT status (not launched)

To proceed, please confirm this action."

User: "confirm"

Assistant (Execution):
[Calls manage_app_campaigns with confirmation=true]
"Campaign 'Quarterly Access Review - Box.com' created successfully (ID: cam123456).
Status: DRAFT
You can launch it from the Governance Console when ready."
```

**Parameters:**
- `appId` (string, required): Application ID
- `action` (enum, required): 'list', 'create', 'launch'
- `name` (string, conditional): Required for create action
- `campaignType` (enum, optional): 'access_certification', 'orphaned_accounts', 'inactive_users'

## Chat Read-Only Default

By default, the chat assistant operates in **read-only mode**:

### Read-Only Operations (No Confirmation Required)
- `list_manageable_apps` - List governance-enabled apps
- `generate_app_activity_report` - Generate activity reports
- `generate_access_review_candidates` - Find inactive user candidates
- `get_tool_requirements` - Get tool authorization requirements
- `list_available_tools_for_current_user` - List available tools

### Write Operations (Confirmation Required)
- `manage_app_labels` - Requires confirmation
- `manage_app_campaigns` - Requires confirmation
- All other write tools - Currently stubbed/unavailable

## Implementation Status

### ✅ Completed
- Governance-enabled app filtering in `list_manageable_apps`
- App response shape includes `emOptInStatus`
- Write tool stubs for labels and campaigns
- Design documentation

### 🚧 In Progress
- Confirmation flow implementation
- Chat UI for showing draft actions
- Confirmation message parsing

### 📋 Planned
- Confirmation state management
- Write tool execution handlers
- Audit logging for write operations
- Campaign launch workflow
- Label management workflow

## Security Considerations

1. **Authorization Re-validation**
   - Authorization must be re-checked at execution time
   - Confirmation does not bypass authorization checks

2. **App Governance Status**
   - Write operations only allowed on governance-enabled apps
   - `emOptInStatus === "ENABLED"` enforced

3. **Audit Trail**
   - All write operations logged with:
     - User context (subject, roles)
     - Action performed
     - Parameters used
     - Timestamp
     - Result (success/failure)

4. **Idempotency**
   - Write operations should be idempotent where possible
   - Multiple confirmations should not cause duplicate actions

5. **Timeout**
   - Confirmation requests expire after reasonable time
   - Expired confirmations require re-proposal

## Error Handling

### App Not Found
```
"No matching application was found for 'SalesIQ'.
Please check the app name and try again."
```

### Multiple Apps Match
```
"Multiple applications match 'Sales':
- Salesforce.com
- SalesIQ
- SalesHub

Please specify which application you mean."
```

### App Not Governance-Enabled
```
"The application 'Legacy CRM' is not governance-enabled.
Write operations are only available for governance-enabled apps.
Ask your Okta administrator to enable governance for this app."
```

### Missing Parameters
```
"To apply a label, I need:
- App name or ID
- Label name

Example: 'Apply label high-risk to Salesforce'"
```

### Authorization Denied
```
"You do not have permission to manage labels for Salesforce.com.
Required: labels.manage capability for this app."
```

## Testing Strategy

### Manual Testing
1. Test app resolution with various name patterns
2. Test confirmation flow end-to-end
3. Test error cases (no match, multiple matches, denied)
4. Test governance-enabled filtering
5. Test read-only vs write operation separation

### Automated Testing
- Unit tests for app resolution logic
- Unit tests for parameter parsing
- Integration tests for confirmation flow
- Authorization tests for write operations

## Future Enhancements

1. **Batch Operations**
   - Apply label to multiple apps
   - Create campaigns for multiple apps
   - Single confirmation for batch

2. **Scheduled Operations**
   - Schedule campaign launch for future date
   - Schedule label application

3. **Approval Workflows**
   - Multi-step approval for sensitive operations
   - Email notification for pending actions

4. **Rollback Support**
   - Undo recent write operations
   - History of changes with rollback option

## References

- Okta Governance API: https://developer.okta.com/docs/api/openapi/okta-management/
- Tool Requirements: `/src/catalog/tool-requirements.ts`
- Write Tool Stubs: `/src/tools/governance/stubs.ts`
- List Manageable Apps: `/src/tools/governance/list-manageable-apps.ts`

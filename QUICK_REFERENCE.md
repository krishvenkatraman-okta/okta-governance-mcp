# Quick Reference: Execution Layer

## Running the System

### Build & Demo
```bash
# Build TypeScript
npm run build

# Run execution demo
npm run demo-execution

# Validate tool requirements
npm run validate-tools

# Show tool examples
npm run show-examples

# Validate OAuth implementation
npm run validate-okta-oauth
```

### Start MRS Server
```bash
# Development
npm run dev:mrs

# Production
npm run start:mrs
```

## Tool Invocation Examples

### 1. List Owned Apps

**Request**:
```json
{
  "name": "list_owned_apps",
  "arguments": {}
}
```

**Response (Success)**:
```json
{
  "content": [{
    "type": "text",
    "text": "{\"total\":3,\"apps\":[{\"id\":\"0oa111\",\"name\":\"app1\",\"label\":\"App 1\",\"status\":\"ACTIVE\"}]}"
  }],
  "isError": false
}
```

**Response (Access Denied)**:
```json
{
  "content": [{
    "type": "text",
    "text": "Access denied to tool 'list_owned_apps': Missing capabilities: entitlements.manage.owned, labels.manage.owned"
  }],
  "isError": true
}
```

### 2. Generate Syslog Report

**Request**:
```json
{
  "name": "generate_owned_app_syslog_report",
  "arguments": {
    "appId": "0oa111",
    "days": 30,
    "includeDetails": true
  }
}
```

**Response (Success)**:
```json
{
  "content": [{
    "type": "text",
    "text": "{\"app\":{\"id\":\"0oa111\",\"name\":\"app1\"},\"reportPeriod\":{\"days\":30},\"summary\":{\"totalEvents\":1247,\"uniqueActors\":23,\"eventTypes\":{\"application.user_membership.add\":450}}}"
  }],
  "isError": false
}
```

**Response (Not Owned)**:
```json
{
  "content": [{
    "type": "text",
    "text": "Access denied: Application 0oaXXXXXX is not in your owned apps"
  }],
  "isError": true
}
```

### 3. Stubbed Tool

**Request**:
```json
{
  "name": "manage_owned_app_entitlements",
  "arguments": {
    "appId": "0oa111",
    "action": "list"
  }
}
```

**Response**:
```json
{
  "content": [{
    "type": "text",
    "text": "Tool 'manage_owned_app_entitlements' is not yet implemented. Authorization checks passed, but execution logic is pending."
  }],
  "isError": true
}
```

## Authorization Context

### Super Admin
```typescript
{
  subject: '00uSuperAdmin',
  roles: { superAdmin: true },
  targets: { apps: [], groups: [] },
  capabilities: ['entitlements.manage.owned', 'labels.manage.owned', ...]
}
```

### App Admin (3 owned apps)
```typescript
{
  subject: '00uAppAdmin',
  roles: { appAdmin: true },
  targets: { apps: ['0oa111', '0oa222', '0oa333'], groups: [] },
  capabilities: ['entitlements.manage.owned', 'labels.manage.owned', ...]
}
```

### Regular User
```typescript
{
  subject: '00uRegularUser',
  roles: { regularUser: true },
  targets: { apps: [], groups: [] },
  capabilities: []
}
```

## API Client Usage

### Apps Client
```typescript
import { appsClient } from './okta/apps-client.js';

// List all apps
const apps = await appsClient.list({
  filter: 'status eq "ACTIVE"',
  limit: 200
});

// Get specific app
const app = await appsClient.getById('0oa123456');

// Filter by owned apps
const ownedApps = appsClient.filterByIds(apps, context.targets.apps);
```

### System Log Client
```typescript
import { systemLogClient } from './okta/systemlog-client.js';

// Query logs for app
const events = await systemLogClient.queryLogsForApp('0oa123456', {
  since: '2026-03-10T00:00:00.000Z',
  limit: 1000
});

// Get recent logs (last N days)
const recentEvents = await systemLogClient.queryRecentLogsForApp('0oa123456', 30);

// Count events by type
const counts = await systemLogClient.countEventsByType('0oa123456', 60);
```

### Service OAuth Client
```typescript
import { getServiceAccessToken } from './okta/service-client.js';

// Get token with specific scopes
const token = await getServiceAccessToken(['okta.apps.read', 'okta.logs.read']);

// Get token with default scopes
const token = await getDefaultServiceAccessToken();
```

## Tool Execution Flow

```
Client Request
    ↓
MRS Server (ListTools or CallTool)
    ↓
Tool Registry (filter by auth context)
    ↓
Tool Executor (orchestrate)
    ↓
┌───────────────────────────────────┐
│ 1. Lookup tool definition         │
│ 2. Validate authorization         │
│ 3. Validate target constraints    │
│ 4. Resolve required scopes        │
│ 5. Execute tool handler           │
│    ↓                               │
│    Service OAuth Client            │
│    ↓                               │
│    Okta API Client                 │
│    ↓                               │
│    Okta API                        │
│ 6. Handle errors                  │
└───────────────────────────────────┘
    ↓
Response (success or error)
```

## Error Messages

| Error | Message |
|-------|---------|
| Missing capabilities | `Access denied to tool 'X': Missing capabilities: Y` |
| Not owned app | `Access denied: Application X is not in your owned apps` |
| Tool not found | `Tool 'X' not found` |
| Not implemented | `Tool 'X' is not yet implemented` |
| 401/403 | `Authorization error: ... The service app may lack required OAuth scopes: X` |
| 404 | `Resource not found. Please verify the IDs provided are correct.` |
| 429 | `Rate limit exceeded. Please try again in a few moments.` |
| Network | `Tool execution failed: fetch failed` |

## Logging

### Enable Debug Logging
```bash
# Set log level in environment
LOG_LEVEL=debug npm run dev:mrs
```

### Enable Audit Logging
```bash
# Set in .env
ENABLE_AUDIT_LOGGING=true
```

### Log Examples
```
[ToolExecutor] Starting tool execution: { tool: 'list_owned_apps', subject: '00uAppAdmin' }
[AppsClient] Listing apps: { url: '...', options: {...} }
[AppsClient] Retrieved 10 apps
[ListOwnedApps] User is App Admin - filtered to 3 owned apps
[ToolExecutor] Tool execution completed: { tool: 'list_owned_apps', duration: '234ms', success: true }
```

## Configuration

### Required Environment Variables
```bash
# Okta service app
OKTA_DOMAIN=dev-12345678.okta.com
OKTA_CLIENT_ID=0oa...
OKTA_PRIVATE_KEY_PATH=./keys/okta-private-key.pem

# Optional
OKTA_PRIVATE_KEY_KID=your-key-id
OKTA_SCOPES_DEFAULT=okta.apps.read okta.users.read
```

### Feature Flags
```bash
ENABLE_AUDIT_LOGGING=true
ENABLE_POSTMAN_CATALOG=true
LOG_LEVEL=info
```

## Available Tools

### Implemented (2)
- ✅ `list_owned_apps` - List applications owned by current user
- ✅ `generate_owned_app_syslog_report` - Generate syslog report for owned app

### Stubbed (6)
- ⚠️ `manage_owned_app_entitlements` - Authorization only
- ⚠️ `manage_owned_app_labels` - Authorization only
- ⚠️ `create_bundle_for_owned_app` - Authorization only
- ⚠️ `create_campaign_for_owned_app` - Authorization only
- ⚠️ `request_access_for_other_user_on_owned_app` - Authorization only
- ⚠️ `create_access_request_workflow_for_owned_app` - Authorization only

### Metadata (4)
- ✅ `get_tool_requirements` - Get requirements for any tool
- ✅ `get_operation_requirements` - Get requirements for API operations
- ✅ `explain_why_tool_is_unavailable` - Explain missing permissions
- ✅ `list_available_tools_for_current_user` - List user's available tools

## Files Reference

| Component | File | Lines |
|-----------|------|-------|
| Tool Executor | `src/mrs/tool-executor.ts` | 200+ |
| Tool Registry | `src/mrs/tool-registry.ts` | 65 |
| Apps Client | `src/okta/apps-client.ts` | 130 |
| System Log Client | `src/okta/systemlog-client.ts` | 160 |
| List Owned Apps | `src/tools/governance/list-owned-apps.ts` | 85 |
| Generate Report | `src/tools/governance/generate-syslog-report.ts` | 160 |
| Stubbed Tools | `src/tools/governance/stubs.ts` | 150 |
| Demo Script | `scripts/demo-execution-layer.ts` | 480 |
| Documentation | `docs/execution-layer.md` | 650 |

## Troubleshooting

### Build Errors
```bash
# Clean and rebuild
npm run clean
npm run build
```

### Missing Environment Variables
```bash
# Copy example
cp .env.example .env
# Edit .env with your values
```

### TypeScript Errors
```bash
# Type check only
npm run typecheck
```

### Module Import Errors
- Check all imports use `.js` extension
- Verify ES module syntax (no `require()`)
- Ensure `type: "module"` in package.json

## Next Steps

1. **Configure Okta service app** with required scopes
2. **Test with real MCP client** (Claude Desktop, etc.)
3. **Implement remaining 6 tools** (entitlements, labels, etc.)
4. **Add response validation** and retry logic
5. **Add metrics** and monitoring

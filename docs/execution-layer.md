# MCP Execution Layer

## Overview

The MCP Execution Layer connects all components of the system to enable secure, policy-driven tool execution. It orchestrates authorization validation, scope resolution, token acquisition, and API calls to Okta.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MCP Client (LLM)                             │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ MCP Protocol
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MRS Server (src/mrs/server.ts)                   │
│                                                                     │
│  ┌──────────────────┐           ┌──────────────────┐              │
│  │  List Tools      │           │   Call Tool      │              │
│  │                  │           │                  │              │
│  │  • Filter by     │           │  • Extract args  │              │
│  │    auth context  │           │  • Re-authorize  │              │
│  │  • Return tools  │           │  • Execute       │              │
│  └────────┬─────────┘           └────────┬─────────┘              │
│           │                              │                         │
│           ▼                              ▼                         │
│  ┌──────────────────┐           ┌──────────────────┐              │
│  │  Tool Registry   │           │ Tool Executor    │              │
│  │  (filter tools)  │           │  (orchestrator)  │              │
│  └──────────────────┘           └────────┬─────────┘              │
│                                           │                         │
└───────────────────────────────────────────┼─────────────────────────┘
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    │                       │                       │
                    ▼                       ▼                       ▼
         ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
         │ Policy Engine    │   │ Tool Requirements│   │  Tool Handlers   │
         │                  │   │     Registry     │   │                  │
         │ • Validate caps  │   │                  │   │ • list_owned_apps│
         │ • Validate roles │   │ • Get scopes     │   │ • generate_report│
         │ • Check targets  │   │ • Get constraints│   │ • (stubs)        │
         └──────────────────┘   └──────────────────┘   └────────┬─────────┘
                                                                 │
                                      ┌──────────────────────────┤
                                      │                          │
                                      ▼                          ▼
                           ┌──────────────────┐      ┌──────────────────┐
                           │  Service OAuth   │      │  Okta API Clients│
                           │     Client       │      │                  │
                           │                  │      │ • apps-client    │
                           │ • Get token      │      │ • systemlog      │
                           │ • Cache by scope │      │ • governance     │
                           └────────┬─────────┘      └────────┬─────────┘
                                    │                         │
                                    └─────────┬───────────────┘
                                              │
                                              ▼
                                   ┌───────────────────┐
                                   │   Okta Tenant     │
                                   │                   │
                                   │ • /api/v1/apps    │
                                   │ • /api/v1/logs    │
                                   │ • /governance/*   │
                                   └───────────────────┘
```

## Execution Flow

### 1. Tool Discovery (List Tools)

```
Client → MRS: list_tools
         ↓
MRS gets authorization context from MCP token
         ↓
Tool Registry filters tools by:
  • User roles (superAdmin, appAdmin, etc.)
  • User capabilities (entitlements.manage.owned, etc.)
  • Target resources (owned apps, groups)
         ↓
Return filtered tool list
```

### 2. Tool Execution (Call Tool)

```
Client → MRS: call_tool(name, arguments)
         ↓
Tool Executor orchestrates:
         ↓
┌────────┴──────────────────────────────────────┐
│                                                │
│ Step 1: Lookup Tool Definition                │
│   • Find tool in registry                     │
│   • Return error if not found                 │
│                                                │
├────────────────────────────────────────────────┤
│                                                │
│ Step 2: Validate Authorization                │
│   • Check required capabilities               │
│   • Check required roles                      │
│   • Return error if missing                   │
│                                                │
├────────────────────────────────────────────────┤
│                                                │
│ Step 3: Validate Target Constraints           │
│   • Extract target resource ID (e.g., appId)  │
│   • Check if in user's targets                │
│   • Super Admin bypasses this check           │
│   • Return error if not owned                 │
│                                                │
├────────────────────────────────────────────────┤
│                                                │
│ Step 4: Resolve Required Scopes               │
│   • Get tool requirement from registry        │
│   • Extract required OAuth scopes             │
│   • Log scopes for audit                      │
│                                                │
├────────────────────────────────────────────────┤
│                                                │
│ Step 5: Execute Tool Handler                  │
│   • Tool handler gets access token            │
│   • Tool handler calls Okta APIs              │
│   • Tool handler formats response             │
│                                                │
├────────────────────────────────────────────────┤
│                                                │
│ Step 6: Handle Errors                         │
│   • Categorize error (401, 404, 429, etc.)    │
│   • Return user-friendly error message        │
│   • Log error for debugging                   │
│                                                │
└────────────────────────────────────────────────┘
```

## Implemented Components

### Tool Executor (`src/mrs/tool-executor.ts`)

Orchestrates the execution flow:

- **Authorization validation**: Checks capabilities and roles
- **Target constraint validation**: Ensures resource ownership
- **Scope resolution**: Extracts required OAuth scopes
- **Execution**: Calls tool handler
- **Error handling**: Categorizes and formats errors
- **Logging**: Comprehensive debug and audit logging

Key functions:
- `executeTool(request, context)` - Main execution orchestrator
- `validateTargetConstraints(toolName, args, context)` - Ownership validation
- `logExecutionStart/End(context)` - Execution tracking

### Tool Registry (`src/mrs/tool-registry.ts`)

Filters tools by authorization context:

- **Dynamic filtering**: Returns only tools user can access
- **Fast lookup**: O(n) scan with early exit
- **Role-based**: Considers all role types
- **Capability-based**: Checks required capabilities
- **Target-aware**: Considers owned resources

Key functions:
- `getAvailableTools(context)` - Filter tools by auth context
- `canUserAccessTool(toolName, context)` - Check specific tool access

### Okta API Clients

#### Apps Client (`src/okta/apps-client.ts`)

Interacts with Okta Applications API:

```typescript
// List all apps
const apps = await appsClient.list({
  filter: 'status eq "ACTIVE"',
  limit: 200
});

// Get specific app
const app = await appsClient.getById('0oa123456');

// Filter by IDs
const ownedApps = appsClient.filterByIds(allApps, targetAppIds);
```

Methods:
- `list(options)` - List applications with filters
- `getById(appId)` - Get single application
- `listOwnedApps(options)` - Helper for owned apps
- `filterByIds(apps, ids)` - Filter by ID list

#### System Log Client (`src/okta/systemlog-client.ts`)

Queries Okta System Log API:

```typescript
// Query logs with filters
const events = await systemLogClient.queryLogs({
  filter: 'target.id eq "0oa123456"',
  since: '2026-03-10T00:00:00.000Z',
  sortOrder: 'DESCENDING',
  limit: 1000
});

// Query logs for specific app
const appLogs = await systemLogClient.queryLogsForApp('0oa123456', {
  since: '2026-03-10T00:00:00.000Z'
});

// Get recent logs (last N days)
const recentLogs = await systemLogClient.queryRecentLogsForApp('0oa123456', 30);

// Count events by type
const counts = await systemLogClient.countEventsByType('0oa123456', 60);
```

Methods:
- `queryLogs(query)` - Query with full control
- `queryLogsForApp(appId, options)` - App-specific logs
- `queryRecentLogsForApp(appId, days)` - Recent logs
- `countEventsByType(appId, days)` - Event aggregation

## Implemented Tools

### 1. list_owned_apps

**Purpose**: List applications owned by the current user

**Authorization**:
- Required capabilities: `entitlements.manage.owned`, `labels.manage.owned`
- Required roles: `APP_ADMIN` or `SUPER_ADMIN`
- Target constraints: None (returns owned apps)

**Execution**:
1. Get service access token with `okta.apps.read` scope
2. Call `GET /api/v1/apps?filter=status eq "ACTIVE"`
3. Filter by user's target apps (unless Super Admin)
4. Return formatted app list

**Example Request**:
```json
{
  "name": "list_owned_apps",
  "arguments": {}
}
```

**Example Response**:
```json
{
  "total": 3,
  "apps": [
    { "id": "0oa111", "name": "app1", "label": "App 1", "status": "ACTIVE" },
    { "id": "0oa222", "name": "app2", "label": "App 2", "status": "ACTIVE" },
    { "id": "0oa333", "name": "app3", "label": "App 3", "status": "ACTIVE" }
  ]
}
```

### 2. generate_owned_app_syslog_report

**Purpose**: Generate system log activity report for an owned application

**Authorization**:
- Required capabilities: `reports.syslog.owned`
- Required roles: `APP_ADMIN` or `SUPER_ADMIN`
- Target constraints: `must_be_owned_app`

**Execution**:
1. Validate appId is in user's owned apps
2. Get service access token with `okta.logs.read`, `okta.apps.read` scopes
3. Call `GET /api/v1/apps/{appId}` to get app details
4. Call `GET /api/v1/logs?filter=target.id eq "{appId}"&since=...`
5. Aggregate events by type
6. Return formatted report

**Example Request**:
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

**Example Response**:
```json
{
  "app": {
    "id": "0oa111",
    "name": "app1",
    "label": "App 1",
    "status": "ACTIVE"
  },
  "reportPeriod": {
    "days": 30,
    "since": "2026-03-10T00:00:00.000Z",
    "until": "2026-04-09T00:00:00.000Z"
  },
  "summary": {
    "totalEvents": 1247,
    "uniqueActors": 23,
    "eventTypes": {
      "application.user_membership.add": 450,
      "application.user_membership.remove": 320,
      "user.authentication.sso": 477
    }
  },
  "recentEvents": [...]
}
```

## Stubbed Tools

The following tools are registered and enforce authorization but have placeholder execution:

1. **manage_owned_app_entitlements** - Manage entitlements for owned apps
2. **manage_owned_app_labels** - Manage labels for owned apps
3. **create_bundle_for_owned_app** - Create entitlement bundles
4. **create_campaign_for_owned_app** - Create access certification campaigns
5. **request_access_for_other_user_on_owned_app** - Request access for others
6. **create_access_request_workflow_for_owned_app** - Manage access request workflows

All stubbed tools:
- ✅ Validate authorization (capabilities + roles)
- ✅ Validate target constraints
- ❌ Return "not yet implemented" error

## Error Handling

The execution layer provides structured error handling:

### Authorization Errors

**Missing Capabilities**:
```
Access denied to tool 'list_owned_apps': Missing capabilities: entitlements.manage.owned
```

**Missing Roles**:
```
Access denied: You need APP_ADMIN or SUPER_ADMIN role
```

**Target Constraint Violation**:
```
Access denied: Application 0oaXXXXXX is not in your owned apps
```

### API Errors

**401/403 Unauthorized**:
```
Authorization error: Failed to list apps: 403 Forbidden

The service app may lack required OAuth scopes: okta.apps.read
```

**404 Not Found**:
```
Resource not found. Please verify the IDs provided are correct.
```

**429 Rate Limited**:
```
Rate limit exceeded. Please try again in a few moments.
```

**Network Errors**:
```
Tool execution failed: fetch failed
```

## Logging

### Execution Logging

All tool executions are logged:

```
[ToolExecutor] Starting tool execution: {
  tool: 'list_owned_apps',
  subject: '00uAppAdmin',
  timestamp: '2026-04-09T12:00:00.000Z',
  requiredScopes: ['okta.apps.read']
}
```

```
[ToolExecutor] Tool execution completed: {
  tool: 'list_owned_apps',
  subject: '00uAppAdmin',
  duration: '1234ms',
  success: true
}
```

### API Client Logging

```
[AppsClient] Listing apps: { url: '...', options: {...} }
[AppsClient] Retrieved 10 apps
```

```
[SystemLogClient] Querying logs: {
  filter: 'target.id eq "0oa111"',
  since: '2026-03-10T00:00:00.000Z'
}
[SystemLogClient] Retrieved 1247 log events
```

### Audit Logging

When `ENABLE_AUDIT_LOGGING=true`:

```
[AUDIT] Tool execution: list_owned_apps by user 00uAppAdmin {
  args: [],
  scopes: ['okta.apps.read']
}
```

## Testing

### Demo Script

Run the execution layer demonstration:

```bash
npm run demo-execution
```

Output shows:
- Tool availability by role
- Execution flow examples
- Authorization failures
- Target constraint violations
- Error handling scenarios

### Manual Testing

```typescript
// Create test context
const context: AuthorizationContext = {
  subject: '00uTestUser',
  roles: { appAdmin: true, ... },
  targets: { apps: ['0oa111'], groups: [] },
  capabilities: ['entitlements.manage.owned'],
  reviewer: { hasAssignedReviews: false, ... }
};

// Test tool execution
const result = await executeTool(
  {
    name: 'list_owned_apps',
    arguments: {}
  },
  context
);
```

## Performance

### Token Caching

- Tokens cached by scope set
- Refreshed 60 seconds before expiry
- Minimal token requests for repeated operations

### Tool Registry

- O(n) tool filtering (n = total tools, typically < 20)
- Early exit on capability mismatch
- No database queries required

### Logging

- Debug logging disabled in production
- Audit logging optional
- Minimal performance impact

## Security

### Authorization Re-validation

- Authorization checked on **every** tool invocation
- No caching of authorization decisions
- Cannot bypass by caching tool list

### Target Constraints

- Resource ownership enforced at execution time
- Super Admin can access all resources
- App Admin limited to target apps

### Scope Resolution

- Scopes determined by tool requirements
- Least-privilege: Request only needed scopes
- Token scoped to specific operations

### Error Messages

- No leaking of sensitive information
- Generic messages for security errors
- Detailed logging for debugging

## Next Steps

1. **Implement Remaining Tools**
   - Entitlement management
   - Label management
   - Campaign creation
   - Access request workflows

2. **Add Response Validation**
   - Validate API responses against schemas
   - Handle malformed responses gracefully

3. **Add Retry Logic**
   - Exponential backoff for transient failures
   - Respect rate limits
   - Circuit breaker pattern

4. **Add Metrics**
   - Track execution times
   - Monitor error rates
   - Cache hit rates

5. **Add Rate Limiting**
   - Per-user rate limits
   - Per-tool rate limits
   - Global rate limits

## Files

- `src/mrs/tool-executor.ts` - Execution orchestrator (200+ lines)
- `src/mrs/tool-registry.ts` - Tool filtering (65 lines)
- `src/okta/apps-client.ts` - Apps API client (130 lines)
- `src/okta/systemlog-client.ts` - System log client (160 lines)
- `src/tools/governance/list-owned-apps.ts` - List owned apps tool (85 lines)
- `src/tools/governance/generate-syslog-report.ts` - Syslog report tool (160 lines)
- `src/tools/governance/stubs.ts` - Stubbed tools (150 lines)
- `scripts/demo-execution-layer.ts` - Demonstration script (480 lines)

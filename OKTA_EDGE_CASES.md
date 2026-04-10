# Okta Integration Edge Cases

## Overview

This document provides detailed examples of edge cases and how the system handles them.

## Edge Case 1: User Not Found

**Scenario**: MCP token contains a valid subject, but user doesn't exist in Okta

### API Response

```http
GET /api/v1/users/00uNONEXISTENT/roles
Status: 404 Not Found

{
  "errorCode": "E0000007",
  "errorSummary": "Not found: Resource not found: 00uNONEXISTENT (User)",
  "errorId": "oae123abc"
}
```

### System Behavior

```
[RolesClient] Fetching roles for user: 00uNONEXISTENT
[RolesClient] Failed to list user roles: {
  userId: '00uNONEXISTENT',
  status: 404,
  error: 'Not found: Resource not found'
}
[RolesClient] User not found, returning empty roles

[AuthorizationContext] Retrieved roles from Okta: {
  subject: '00uNONEXISTENT',
  roleCount: 0,
  roleTypes: []
}

[AuthorizationContext] Context resolved successfully: {
  subject: '00uNONEXISTENT',
  roles: ['regularUser'],
  targetApps: 0,
  targetGroups: 0,
  capabilities: 5
}
```

### Result
- User treated as regular user
- Gets self-service capabilities only
- No governance tools visible
- No error thrown to client

---

## Edge Case 2: Service App Missing Scopes

**Scenario**: Service app lacks `okta.roles.read` scope

### API Response

```http
GET /api/v1/users/00u123456/roles
Status: 403 Forbidden

{
  "errorCode": "E0000006",
  "errorSummary": "You do not have permission to access the feature you are requesting",
  "errorId": "oae456def"
}
```

### System Behavior

```
[RolesClient] Fetching roles for user: 00u123456
[RolesClient] Failed to list user roles: {
  userId: '00u123456',
  status: 403,
  error: 'You do not have permission to access the feature you are requesting'
}
[RolesClient] Insufficient permissions to list user roles

[AuthorizationContext] Failed to resolve context from Okta: {
  subject: '00u123456',
  error: 'Insufficient permissions to list user roles'
}
[AuthorizationContext] Returning minimal context (regular user)
```

### Result
- Error thrown from rolesClient
- Caught by authorization context resolver
- Returns minimal context (fail-safe)
- User sees no governance tools
- **Action Required**: Grant `okta.roles.read` to service app

---

## Edge Case 3: APP_ADMIN Without Targets

**Scenario**: User has APP_ADMIN role but no app targets assigned

### API Responses

```http
GET /api/v1/users/00u123456/roles
Status: 200 OK

[
  {
    "id": "irb1234abc",
    "type": "APP_ADMIN",
    "label": "Application Administrator",
    "status": "ACTIVE"
  }
]

GET /api/v1/users/00u123456/roles/irb1234abc/targets/catalog/apps
Status: 200 OK

[]
```

### System Behavior

```
[RolesClient] Retrieved roles: {
  userId: '00u123456',
  count: 1,
  types: ['APP_ADMIN']
}

[AuthorizationContext] User is APP_ADMIN
[AuthorizationContext] Fetching APP_ADMIN targets from Okta...

[RolesClient] Retrieved app targets: {
  userId: '00u123456',
  roleId: 'irb1234abc',
  count: 0,
  appIds: []
}

[AuthorizationContext] Context resolved successfully: {
  subject: '00u123456',
  roles: ['appAdmin'],
  targetApps: 0,
  targetGroups: 0,
  capabilities: 7
}
```

### Result
- APP_ADMIN role recognized
- Capabilities assigned (`entitlements.manage.owned`, etc.)
- But `targets.apps = []`
- **Tool visibility**: 0 (tools require owned apps)
- **Action Required**: Assign app targets to role in Okta

---

## Edge Case 4: Multiple Roles with Overlapping Targets

**Scenario**: User has multiple APP_ADMIN roles targeting different apps

### API Responses

```http
GET /api/v1/users/00u123456/roles
Status: 200 OK

[
  {
    "id": "irb1234abc",
    "type": "APP_ADMIN",
    "label": "App Admin - Team A",
    "status": "ACTIVE"
  },
  {
    "id": "irb5678xyz",
    "type": "APP_ADMIN",
    "label": "App Admin - Team B",
    "status": "ACTIVE"
  }
]

GET /api/v1/users/00u123456/roles/irb1234abc/targets/catalog/apps
Status: 200 OK

[
  { "id": "0oa111", "name": "app1" },
  { "id": "0oa222", "name": "app2" }
]

GET /api/v1/users/00u123456/roles/irb5678xyz/targets/catalog/apps
Status: 200 OK

[
  { "id": "0oa222", "name": "app2" },
  { "id": "0oa333", "name": "app3" }
]
```

### System Behavior

```
[RolesClient] Retrieved roles: { count: 2, types: ['APP_ADMIN', 'APP_ADMIN'] }

[AuthorizationContext] User is APP_ADMIN
[RolesClient] Retrieved app targets: { count: 2, appIds: ['0oa111', '0oa222'] }

[AuthorizationContext] User is APP_ADMIN
[RolesClient] Retrieved app targets: { count: 2, appIds: ['0oa222', '0oa333'] }

[AuthorizationContext] Context resolved successfully: {
  subject: '00u123456',
  roles: ['appAdmin'],
  targetApps: 4,
  targetGroups: 0,
  capabilities: 7
}
```

### Result
- Both roles mapped to single `appAdmin` flag
- Targets accumulated: `['0oa111', '0oa222', '0oa222', '0oa333']`
- Duplicate `0oa222` (no deduplication currently)
- User can access all 3 unique apps
- Tool authorization works correctly despite duplicate

**Future Enhancement**: Deduplicate targets using Set

---

## Edge Case 5: Super Admin

**Scenario**: User is Super Admin

### API Response

```http
GET /api/v1/users/00u123456/roles
Status: 200 OK

[
  {
    "id": "irb9999abc",
    "type": "SUPER_ADMIN",
    "label": "Super Administrator",
    "status": "ACTIVE"
  }
]
```

### System Behavior

```
[RolesClient] Retrieved roles: { count: 1, types: ['SUPER_ADMIN'] }

[AuthorizationContext] User is SUPER_ADMIN

[AuthorizationContext] Context resolved successfully: {
  subject: '00u123456',
  roles: ['superAdmin'],
  targetApps: 0,
  targetGroups: 0,
  capabilities: 11
}
```

### Result
- **No target fetching** (Super Admin has access to all)
- All `.all` capabilities assigned
- Can access ANY resource (targets not checked)
- 0 governance tools visible currently (requires capability matching fix)

**Note**: Tool registry currently checks for `.owned` capabilities. Super Admins with `.all` capabilities may not see tools. This is a known limitation to be fixed.

---

## Edge Case 6: Network Timeout

**Scenario**: Okta API times out or network error

### API Response

```
GET /api/v1/users/00u123456/roles
Error: fetch failed (ETIMEDOUT)
```

### System Behavior

```
[RolesClient] Fetching roles for user: 00u123456
[RolesClient] Error listing user roles: {
  userId: '00u123456',
  error: 'fetch failed'
}

[AuthorizationContext] Failed to resolve context from Okta: {
  subject: '00u123456',
  error: 'fetch failed',
  stack: '...'
}
[AuthorizationContext] Returning minimal context (regular user)
```

### Result
- Error logged with full details
- Minimal context returned (fail-safe)
- User sees no governance tools
- **System stays up** (no crash)
- **Action Required**: Check network connectivity, Okta status

---

## Edge Case 7: Targets Fetch Fails, Roles Succeed

**Scenario**: Can fetch roles but target endpoint fails

### API Responses

```http
GET /api/v1/users/00u123456/roles
Status: 200 OK

[{ "id": "irb1234", "type": "APP_ADMIN", "status": "ACTIVE" }]

GET /api/v1/users/00u123456/roles/irb1234/targets/catalog/apps
Status: 500 Internal Server Error

{
  "errorCode": "E0000009",
  "errorSummary": "Internal Server Error"
}
```

### System Behavior

```
[RolesClient] Retrieved roles: { count: 1, types: ['APP_ADMIN'] }

[AuthorizationContext] User is APP_ADMIN
[AuthorizationContext] Fetching APP_ADMIN targets from Okta...

[RolesClient] Failed to list app targets: {
  userId: '00u123456',
  roleId: 'irb1234',
  status: 500,
  error: 'Internal Server Error'
}
[RolesClient] Returning empty app targets due to error

[AuthorizationContext] Retrieved APP_ADMIN targets: {
  roleId: 'irb1234',
  appCount: 0
}

[AuthorizationContext] Context resolved successfully: {
  subject: '00u123456',
  roles: ['appAdmin'],
  targetApps: 0,
  targetGroups: 0,
  capabilities: 7
}
```

### Result
- Role recognized correctly
- Target fetch error logged but caught
- **Continues with empty targets** (graceful degradation)
- User has role but no visible tools
- **System stays functional** (partial success)

---

## Edge Case 8: Mixed Role Types

**Scenario**: User has APP_ADMIN + GROUP_ADMIN + READ_ONLY_ADMIN

### API Response

```http
GET /api/v1/users/00u123456/roles
Status: 200 OK

[
  { "id": "irb111", "type": "APP_ADMIN" },
  { "id": "irb222", "type": "GROUP_ADMIN" },
  { "id": "irb333", "type": "READ_ONLY_ADMIN" }
]
```

### System Behavior

```
[RolesClient] Retrieved roles: {
  count: 3,
  types: ['APP_ADMIN', 'GROUP_ADMIN', 'READ_ONLY_ADMIN']
}

[AuthorizationContext] User is APP_ADMIN
[RolesClient] Retrieved app targets: { count: 2, appIds: ['0oa111', '0oa222'] }

[AuthorizationContext] User is GROUP_ADMIN
[RolesClient] Retrieved group targets: { count: 3, groupIds: ['00g111', '00g222', '00g333'] }

[AuthorizationContext] User is READ_ONLY_ADMIN

[AuthorizationContext] Context resolved successfully: {
  subject: '00u123456',
  roles: ['appAdmin', 'groupAdmin', 'readOnlyAdmin'],
  targetApps: 2,
  targetGroups: 3,
  capabilities: 9
}
```

### Result
- All roles recognized
- Both app and group targets fetched
- Capabilities: Union of APP_ADMIN + GROUP_ADMIN capabilities
- READ_ONLY_ADMIN doesn't add capabilities (read-only)
- User sees tools for both app and group management

---

## Edge Case 9: Deactivated Role

**Scenario**: User has role but it's INACTIVE status

### API Response

```http
GET /api/v1/users/00u123456/roles
Status: 200 OK

[
  {
    "id": "irb1234",
    "type": "APP_ADMIN",
    "status": "INACTIVE"
  }
]
```

### System Behavior

```
[RolesClient] Retrieved roles: { count: 1, types: ['APP_ADMIN'] }

[AuthorizationContext] User is APP_ADMIN
[RolesClient] Retrieved app targets: { count: 2, appIds: ['0oa111', '0oa222'] }

[AuthorizationContext] Context resolved successfully: {
  subject: '00u123456',
  roles: ['appAdmin'],
  targetApps: 2,
  capabilities: 7
}
```

### Result
- **Currently**: Role recognized even if INACTIVE
- System doesn't check status field
- **Future Enhancement**: Check `status === 'ACTIVE'` before mapping

---

## Edge Case 10: Unknown Role Type

**Scenario**: Okta returns a role type we don't recognize

### API Response

```http
GET /api/v1/users/00u123456/roles
Status: 200 OK

[
  {
    "id": "irb1234",
    "type": "CUSTOM_ADMIN",
    "label": "Custom Administrator"
  }
]
```

### System Behavior

```
[RolesClient] Retrieved roles: { count: 1, types: ['CUSTOM_ADMIN'] }

[AuthorizationContext] Ignoring role type: CUSTOM_ADMIN

[AuthorizationContext] Context resolved successfully: {
  subject: '00u123456',
  roles: ['regularUser'],
  targetApps: 0,
  targetGroups: 0,
  capabilities: 5
}
```

### Result
- Unknown role type logged and ignored
- User treated as regular user
- No error thrown
- **Future Enhancement**: Add support for custom admin roles

---

## Summary Matrix

| Edge Case | Behavior | Result | Fail-Safe |
|-----------|----------|--------|-----------|
| User not found (404) | Return empty roles | Regular user | ✅ Yes |
| Missing scopes (403) | Throw, catch at context level | Minimal context | ✅ Yes |
| No targets | Targets = [] | Role but no tools | ✅ Yes |
| Multiple roles | Accumulate targets | Union of capabilities | ✅ Yes |
| Super Admin | Skip target fetch | All .all capabilities | ✅ Yes |
| Network error | Catch at roles level | Minimal context | ✅ Yes |
| Targets fail | Catch, continue | Role with empty targets | ✅ Yes |
| Mixed roles | Fetch all targets | Union of capabilities | ✅ Yes |
| Inactive role | Not checked | Role recognized | ⚠️ No check |
| Unknown role | Ignore | Regular user | ✅ Yes |

## Testing Recommendations

1. **Test with real Okta tenant**
2. **Test each edge case**:
   - Create user without roles
   - Create APP_ADMIN without targets
   - Create user with multiple roles
   - Test with Super Admin
   - Temporarily remove service app scope
   - Simulate network issues
3. **Monitor logs for errors**
4. **Verify fail-safe behavior**

# Step 8: Risk-Based Governance Implementation Summary

## Overview

Implemented risk-based access governance using Okta System Log analysis to detect inactive users and generate access review candidates.

## ✅ What Was Implemented

### 1. Risk Engine (`src/policy/risk-engine.ts`)

**Purpose:** Analyze system logs to detect inactive users and assess risk levels

**Key Functions:**

```typescript
// Detect inactive users for a specific app
export async function detectInactiveUsers(
  appId: string,
  inactivityDays: number = 60
): Promise<InactiveUser[]>

// Detect low-usage apps across the organization
export async function detectLowUsageApps(
  usageThreshold: number = 5,
  lookbackDays: number = 60
): Promise<LowUsageApp[]>
```

**Risk Assessment Logic:**
- **HIGH Risk:** No access in >90 days OR 0 accesses OR (>60 days + <3 accesses)
- **MEDIUM Risk:** No access in >45 days OR <5 accesses
- **LOW Risk:** Some recent activity but declining usage

**System Log Integration:**
```typescript
const events = await systemLogClient.queryLogs({
  filter: `target.id eq "${appId}"`,
  since: sinceISO,
  limit: 1000,
  sortOrder: 'DESCENDING',
});
```

---

### 2. New MCP Tool (`src/tools/governance/generate-review-candidates.ts`)

**Tool Name:** `generate_access_review_candidates`

**Description:** Generate a list of users who should be reviewed for access removal based on inactivity and risk analysis

**Input Schema:**
```typescript
{
  appId: string;           // Required: Application ID to analyze
  inactivityDays?: number; // Optional: Lookback period (default: 60)
  minRiskLevel?: 'HIGH' | 'MEDIUM' | 'LOW'; // Optional: Min risk level (default: LOW)
}
```

**Output Format:**
```typescript
{
  app: {
    id: string;
    name: string;
    label: string;
    status: string;
  },
  analysisParameters: {
    inactivityDays: number;
    minRiskLevel: string;
    analyzedPeriod: {
      from: string;
      to: string;
    };
  },
  summary: {
    totalCandidates: number;
    riskDistribution: {
      high: number;
      medium: number;
      low: number;
    };
    recommendations: {
      immediate: number;  // HIGH risk count
      review: number;     // MEDIUM risk count
      monitor: number;    // LOW risk count
    };
  },
  candidates: Array<{
    userId: string;
    userLogin: string;
    lastAccess: string | null;
    daysSinceLastAccess: number | null;
    accessCount: number;
    riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    reason: string;
    recommendation: string;
  }>,
  nextSteps: string[];
}
```

---

### 3. Tool Requirements Registry Update (`src/catalog/tool-requirements.ts`)

**Added:**
```typescript
generate_access_review_candidates: {
  toolName: 'generate_access_review_candidates',
  description: 'Generate a list of users who should be reviewed for access removal based on inactivity and risk analysis',
  mappedEndpoints: ['Get System Log', 'Get Application'],
  endpointCategories: ['System Log', 'Apps', 'Campaigns'],
  requiredScopes: ['okta.logs.read', 'okta.apps.read'],
  requiredCapabilities: ['campaigns.manage.owned', 'reports.syslog.owned'],
  requiredRoles: ['APP_ADMIN', 'SUPER_ADMIN'],
  targetConstraints: ['must_be_owned_app'],
  requiresTargetResource: true,
  notes: 'Uses System Log API to detect inactive users. Analyzes access patterns and assigns risk levels (HIGH/MEDIUM/LOW). Does not trigger actual certification campaigns.',
  documentationRefs: [
    'https://developer.okta.com/docs/api/openapi/okta-management/management/tag/SystemLog/',
    'https://developer.okta.com/docs/api/openapi/okta-governance/governance/tag/Campaigns/',
  ],
}
```

---

### 4. Tool Exports Update (`src/tools/index.ts`)

**Added:**
```typescript
import { generateReviewCandidatesTool } from './governance/generate-review-candidates.js';

export const allTools: ToolDefinition[] = [
  // ... other tools
  generateReviewCandidatesTool,
];
```

---

## Authorization Flow

```
1. User calls tool with appId
   ↓
2. Tool validates:
   - User has required capabilities (campaigns.manage.owned, reports.syslog.owned)
   - User has required scopes (okta.logs.read, okta.apps.read)
   - App is in user's target list (unless SUPER_ADMIN)
   ↓
3. Tool calls risk engine:
   detectInactiveUsers(appId, inactivityDays)
   ↓
4. Risk engine queries system logs:
   GET /api/v1/logs?filter=target.id eq "{appId}"&since=...
   ↓
5. Risk engine builds user activity map
   ↓
6. Risk engine assesses risk for each user
   ↓
7. Tool filters by minRiskLevel
   ↓
8. Tool returns formatted report
```

---

## Example Usage

### Example 1: Find High-Risk Users

**Input:**
```json
{
  "appId": "0oa1abc2def3ghi4jkl5",
  "inactivityDays": 90,
  "minRiskLevel": "HIGH"
}
```

**Output:**
```json
{
  "app": {
    "id": "0oa1abc2def3ghi4jkl5",
    "name": "legacy_app",
    "label": "Legacy Application",
    "status": "ACTIVE"
  },
  "summary": {
    "totalCandidates": 5,
    "riskDistribution": {
      "high": 5,
      "medium": 0,
      "low": 0
    }
  },
  "candidates": [
    {
      "userId": "00u9xyz8wvu7tsr6qpo5",
      "userLogin": "inactive.user@example.com",
      "lastAccess": null,
      "daysSinceLastAccess": null,
      "accessCount": 0,
      "riskLevel": "HIGH",
      "reason": "No recorded access in lookback period",
      "recommendation": "Remove access immediately"
    }
  ]
}
```

---

## Key Features

### ✅ Evidence-Based Risk Assessment
- Uses real system log data (not estimates)
- Tracks last access date and frequency
- Provides clear risk reasons

### ✅ Configurable Analysis
- Adjustable lookback period (default 60 days)
- Filterable by risk level (HIGH/MEDIUM/LOW)
- Flexible risk thresholds

### ✅ Authorization Enforced
- Target constraint validation (must be owned app)
- Scope validation (okta.logs.read, okta.apps.read)
- Capability validation (campaigns.manage.owned, reports.syslog.owned)

### ✅ Actionable Output
- Clear recommendations for each user
- Risk distribution summary
- Next steps guidance

### ✅ Read-Only Operation
- Does NOT modify any data
- Does NOT trigger certification campaigns
- Does NOT revoke access

---

## System Log Query Details

### Filter Examples

```typescript
// App access events
filter: `target.id eq "0oa1abc2def3ghi4jkl5"`

// With date range
since: "2026-02-09T00:00:00.000Z"

// Sorted by most recent
sortOrder: "DESCENDING"

// Limit results
limit: 1000
```

### Event Types Tracked

The risk engine tracks various event types:
- `application.lifecycle.activate`
- `application.user_membership.add`
- `application.user_membership.remove`
- `user.authentication.sso`
- `user.session.start`
- And other app-related events

---

## Use Cases

### 1. Quarterly Access Review
Find all users who should be reviewed in Q2 2026:
```bash
generate_access_review_candidates \
  --appId "0oa1abc2def3ghi4jkl5" \
  --inactivityDays 90 \
  --minRiskLevel MEDIUM
```

### 2. Emergency Access Cleanup
Find users with zero usage for immediate removal:
```bash
generate_access_review_candidates \
  --appId "0oa1abc2def3ghi4jkl5" \
  --inactivityDays 120 \
  --minRiskLevel HIGH
```

### 3. App Decommissioning Analysis
Determine if an app is still being used:
```bash
generate_access_review_candidates \
  --appId "0oa5nml4kjh3gfe2dcb1" \
  --inactivityDays 180 \
  --minRiskLevel LOW
```

---

## Error Handling

### Access Denied
```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "Access denied: You do not have permission to review access for app 0oa1abc2def3ghi4jkl5"
    }
  ]
}
```

### Missing Required Argument
```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "Missing required argument: appId"
    }
  ]
}
```

### System Log Query Failure
```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "Failed to generate review candidates: Failed to query system logs"
    }
  ]
}
```

---

## Logging Output

### Successful Execution

```
[GenerateReviewCandidates] Executing tool: {
  subject: '00u123456',
  appId: '0oa1abc2def3ghi4jkl5',
  inactivityDays: 60,
  minRiskLevel: 'LOW'
}
[GenerateReviewCandidates] Fetching app details...
[GenerateReviewCandidates] Analyzing user activity...
[RiskEngine] Detecting inactive users: {
  appId: '0oa1abc2def3ghi4jkl5',
  inactivityDays: 60
}
[RiskEngine] Retrieved system log events: {
  appId: '0oa1abc2def3ghi4jkl5',
  eventCount: 234
}
[RiskEngine] Analyzed user activity: {
  appId: '0oa1abc2def3ghi4jkl5',
  uniqueUsers: 15
}
[RiskEngine] Inactive users detected: {
  appId: '0oa1abc2def3ghi4jkl5',
  totalInactive: 3,
  highRisk: 0,
  mediumRisk: 1,
  lowRisk: 2
}
[GenerateReviewCandidates] Detected 3 inactive users
[GenerateReviewCandidates] Filtered to 3 users meeting risk threshold
[GenerateReviewCandidates] Report generated successfully
```

### Access Denied

```
[GenerateReviewCandidates] Access denied - app not in targets: {
  appId: '0oa1abc2def3ghi4jkl5',
  userTargets: ['0oa5nml4kjh3gfe2dcb1']
}
```

---

## Files Created/Modified

| File | Status | Lines | Description |
|------|--------|-------|-------------|
| `src/policy/risk-engine.ts` | ✅ Created | 381 | Risk assessment engine |
| `src/tools/governance/generate-review-candidates.ts` | ✅ Created | 205 | MCP tool implementation |
| `src/catalog/tool-requirements.ts` | ✅ Updated | +21 | Added tool requirement |
| `src/tools/index.ts` | ✅ Updated | +2 | Added tool export |
| `RISK_ENGINE_EXAMPLE.md` | ✅ Created | 650+ | Examples and documentation |
| `STEP_8_SUMMARY.md` | ✅ Created | This file | Implementation summary |

---

## Build Status

```bash
$ npm run build
✅ Build succeeded - no errors
```

---

## What Was NOT Done

As requested:

❌ **Did NOT modify existing auth logic** - All authorization context resolution remains unchanged
❌ **Did NOT modify execution layer** - Tool execution flow unchanged
❌ **Did NOT modify OAuth client** - Service client integration unchanged
❌ **Did NOT trigger actual campaigns** - Tool only generates candidate lists (read-only)

---

## Testing Recommendations

### 1. Unit Testing
- Test risk assessment algorithm with various scenarios
- Test system log query filter construction
- Test authorization validation

### 2. Integration Testing
- Test with real Okta tenant and system logs
- Test with different role types (APP_ADMIN, SUPER_ADMIN)
- Test access denied scenarios

### 3. Performance Testing
- Test with large apps (1000+ users)
- Test with long lookback periods (180+ days)
- Measure system log query latency

### 4. Edge Cases
- No system log events found
- App with no assigned users
- User with access but no actor ID in logs
- System log API rate limiting

---

## Security Considerations

✅ **Authorization Enforced:**
- Tool requires `campaigns.manage.owned` capability
- Tool requires `reports.syslog.owned` capability
- App must be in user's target list (unless SUPER_ADMIN)

✅ **Scope Validation:**
- Requires `okta.logs.read` for system log access
- Requires `okta.apps.read` for app details

✅ **Read-Only Operation:**
- Does NOT modify user access
- Does NOT create campaigns
- Does NOT revoke permissions

✅ **Privacy:**
- Returns user IDs and logins only
- Does NOT expose sensitive user data
- Logs do NOT contain PII

---

## Integration with Other Tools

### Workflow: Access Review Campaign

```
Step 1: generate_access_review_candidates
        ↓ (identify high-risk users)

Step 2: create_campaign_for_owned_app
        ↓ (create certification campaign with candidates)

Step 3: (Users review access via campaign)
        ↓

Step 4: (System revokes access for denied users)
```

### Workflow: Emergency Access Removal

```
Step 1: generate_access_review_candidates (minRiskLevel=HIGH)
        ↓ (get immediate action list)

Step 2: (Manual review by APP_ADMIN)
        ↓

Step 3: (Revoke access via Okta admin console)
```

---

## Performance Metrics

### Expected Performance

| Metric | Value |
|--------|-------|
| System log query | 1-3 seconds |
| Activity analysis | <1 second |
| Risk assessment | <1 second |
| Total execution | 2-5 seconds |

### Limitations

- **System Log Retention:** Typically 90 days
- **Event Limit:** 1000 events per query
- **Rate Limiting:** Subject to Okta API rate limits
- **Historical Data:** No trending analysis (point-in-time only)

---

## Future Enhancements

Potential improvements (not implemented):

- [ ] Add trending analysis (usage increasing/decreasing)
- [ ] Add org-wide analysis (all apps at once)
- [ ] Add automatic campaign creation
- [ ] Add CSV/Excel export
- [ ] Add email notifications to app owners
- [ ] Add comparison to previous reports
- [ ] Add ML-based anomaly detection

---

## Summary

**✅ Implementation Complete:**
- Risk engine with system log analysis
- New MCP tool: `generate_access_review_candidates`
- Tool requirements registry updated
- Tool exports configured
- Build successful
- Examples and documentation provided

**✅ Requirements Met:**
- Detect inactive users using system logs ✓
- Return users with last access + risk level ✓
- Default 60-day lookback period ✓
- Use system log client ✓
- Integrate with tool registry ✓
- Require okta.logs.read scope ✓
- Did NOT modify auth/execution/OAuth logic ✓

**🎯 Ready For:**
- Production deployment
- Testing with real Okta tenant
- Integration with certification workflows
- APP_ADMIN usage

---

## Quick Reference

### Tool Call Example

```typescript
// MCP tool call
{
  "name": "generate_access_review_candidates",
  "arguments": {
    "appId": "0oa1abc2def3ghi4jkl5",
    "inactivityDays": 60,
    "minRiskLevel": "LOW"
  }
}
```

### Required Scopes

```typescript
const REQUIRED_SCOPES = [
  'okta.logs.read',      // System log access
  'okta.apps.read',      // App details
];
```

### Required Capabilities

```typescript
const REQUIRED_CAPABILITIES = [
  'campaigns.manage.owned',   // Campaign management for owned apps
  'reports.syslog.owned',     // System log reports for owned apps
];
```

### Risk Level Mapping

| Days Since Last Access | Access Count | Risk Level |
|------------------------|--------------|------------|
| Any | 0 | HIGH |
| >90 | Any | HIGH |
| >60 | <3 | HIGH |
| >45 | Any | MEDIUM |
| Any | <5 | MEDIUM |
| <45 | ≥5 | LOW |

---

**End of Step 8 Implementation Summary**

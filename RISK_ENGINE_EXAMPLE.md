# Risk-Based Governance Example

## Overview

This document demonstrates the **risk-based governance** feature using Okta System Log analysis to detect inactive users and generate access review candidates.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  MCP Tool: generate_access_review_candidates                │
│  (src/tools/governance/generate-review-candidates.ts)       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Risk Engine (src/policy/risk-engine.ts)                    │
│  ┌───────────────────────────────────────┐                  │
│  │ detectInactiveUsers(appId, days)      │                  │
│  │ - Query system logs                   │                  │
│  │ - Build user activity map             │                  │
│  │ - Assess risk levels                  │                  │
│  └───────────────────────────────────────┘                  │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  System Log Client (src/okta/systemlog-client.ts)          │
│  - GET /api/v1/logs?filter=...&since=...                   │
│  - Returns access events for app                            │
└─────────────────────────────────────────────────────────────┘
```

## Risk Assessment Logic

### Risk Levels

| Risk Level | Criteria | Recommendation |
|------------|----------|----------------|
| **HIGH** | No access in >90 days OR 0 accesses OR (>60 days + <3 accesses) | Remove access immediately |
| **MEDIUM** | No access in >45 days OR <5 accesses | Include in next access review |
| **LOW** | Some recent activity but declining usage | Monitor for continued inactivity |

### Assessment Algorithm

```typescript
function assessInactivityRisk(daysSinceAccess: number, accessCount: number): RiskLevel {
  // No activity at all - highest risk
  if (accessCount === 0) {
    return 'HIGH';
  }

  // Very infrequent access and long time since last access
  if (daysSinceAccess > 90 || (daysSinceAccess > 60 && accessCount < 3)) {
    return 'HIGH';
  }

  // Moderate inactivity
  if (daysSinceAccess > 45 || accessCount < 5) {
    return 'MEDIUM';
  }

  // Some activity but declining
  return 'LOW';
}
```

## Tool Usage

### Input Schema

```json
{
  "appId": "0oa1abc2def3ghi4jkl5",
  "inactivityDays": 60,
  "minRiskLevel": "LOW"
}
```

**Parameters:**
- `appId` (required): Application ID to analyze
- `inactivityDays` (optional, default 60): Lookback period in days
- `minRiskLevel` (optional, default "LOW"): Minimum risk level to include (HIGH, MEDIUM, or LOW)

### Authorization

**Required Scopes:**
- `okta.logs.read` - Read system logs
- `okta.apps.read` - Read app details

**Required Capabilities:**
- `campaigns.manage.owned` - Manage campaigns for owned apps
- `reports.syslog.owned` - Generate reports for owned apps

**Required Roles:**
- APP_ADMIN with app in targets, OR
- SUPER_ADMIN

**Target Constraint:**
- App must be in user's target list (unless SUPER_ADMIN)

## Example Output

### Example 1: Healthy App (Low Risk)

**Input:**
```json
{
  "appId": "0oa1abc2def3ghi4jkl5",
  "inactivityDays": 60,
  "minRiskLevel": "LOW"
}
```

**Output:**
```json
{
  "app": {
    "id": "0oa1abc2def3ghi4jkl5",
    "name": "salesforce",
    "label": "Salesforce Production",
    "status": "ACTIVE"
  },
  "analysisParameters": {
    "inactivityDays": 60,
    "minRiskLevel": "LOW",
    "analyzedPeriod": {
      "from": "2026-02-09T00:00:00.000Z",
      "to": "2026-04-09T00:00:00.000Z"
    }
  },
  "summary": {
    "totalCandidates": 3,
    "riskDistribution": {
      "high": 0,
      "medium": 1,
      "low": 2
    },
    "recommendations": {
      "immediate": 0,
      "review": 1,
      "monitor": 2
    }
  },
  "candidates": [
    {
      "userId": "00u9xyz8wvu7tsr6qpo5",
      "userLogin": "john.doe@example.com",
      "lastAccess": "2026-02-25T14:30:00.000Z",
      "daysSinceLastAccess": 43,
      "accessCount": 4,
      "riskLevel": "MEDIUM",
      "reason": "Low usage (4 accesses in 43 days)",
      "recommendation": "Include in next access review"
    },
    {
      "userId": "00u8wvu7tsr6qpo5nml4",
      "userLogin": "jane.smith@example.com",
      "lastAccess": "2026-03-15T09:15:00.000Z",
      "daysSinceLastAccess": 25,
      "accessCount": 12,
      "riskLevel": "LOW",
      "reason": "Declining usage (last access 25 days ago)",
      "recommendation": "Monitor for continued inactivity"
    },
    {
      "userId": "00u7tsr6qpo5nml4kjh3",
      "userLogin": "bob.jones@example.com",
      "lastAccess": "2026-03-20T16:45:00.000Z",
      "daysSinceLastAccess": 20,
      "accessCount": 8,
      "riskLevel": "LOW",
      "reason": "Declining usage (last access 20 days ago)",
      "recommendation": "Monitor for continued inactivity"
    }
  ],
  "nextSteps": [
    "Review high-risk candidates for immediate access removal",
    "Schedule access certification campaign for medium-risk users",
    "Monitor low-risk users for continued inactivity"
  ]
}
```

**Interpretation:**
- ✅ Healthy app usage overall
- ⚠️ 1 user needs review (medium risk)
- 👀 2 users to monitor

---

### Example 2: High-Risk App (Multiple Inactive Users)

**Input:**
```json
{
  "appId": "0oa5nml4kjh3gfe2dcb1",
  "inactivityDays": 90,
  "minRiskLevel": "MEDIUM"
}
```

**Output:**
```json
{
  "app": {
    "id": "0oa5nml4kjh3gfe2dcb1",
    "name": "legacy_crm",
    "label": "Legacy CRM System",
    "status": "ACTIVE"
  },
  "analysisParameters": {
    "inactivityDays": 90,
    "minRiskLevel": "MEDIUM",
    "analyzedPeriod": {
      "from": "2026-01-09T00:00:00.000Z",
      "to": "2026-04-09T00:00:00.000Z"
    }
  },
  "summary": {
    "totalCandidates": 8,
    "riskDistribution": {
      "high": 5,
      "medium": 3,
      "low": 0
    },
    "recommendations": {
      "immediate": 5,
      "review": 3,
      "monitor": 0
    }
  },
  "candidates": [
    {
      "userId": "00u2dcb1azy9xwv8uts7",
      "userLogin": "alice.inactive@example.com",
      "lastAccess": null,
      "daysSinceLastAccess": null,
      "accessCount": 0,
      "riskLevel": "HIGH",
      "reason": "No recorded access in lookback period",
      "recommendation": "Remove access immediately"
    },
    {
      "userId": "00u3efg2baz0yvx9wut8",
      "userLogin": "charlie.gone@example.com",
      "lastAccess": "2025-12-15T10:00:00.000Z",
      "daysSinceLastAccess": 115,
      "accessCount": 1,
      "riskLevel": "HIGH",
      "reason": "No access for 115 days",
      "recommendation": "Remove access immediately"
    },
    {
      "userId": "00u4fgh3cba1zwx0yvu9",
      "userLogin": "dana.left@example.com",
      "lastAccess": "2026-01-02T08:30:00.000Z",
      "daysSinceLastAccess": 97,
      "accessCount": 2,
      "riskLevel": "HIGH",
      "reason": "Very low usage (2 accesses)",
      "recommendation": "Remove access immediately"
    },
    {
      "userId": "00u5ghi4dcb2axy1zwv0",
      "userLogin": "evan.old@example.com",
      "lastAccess": "2026-01-10T14:15:00.000Z",
      "daysSinceLastAccess": 89,
      "accessCount": 1,
      "riskLevel": "HIGH",
      "reason": "Very low usage (1 access)",
      "recommendation": "Remove access immediately"
    },
    {
      "userId": "00u6hij5edc3byz2axy1",
      "userLogin": "frank.rarely@example.com",
      "lastAccess": "2026-02-01T11:20:00.000Z",
      "daysSinceLastAccess": 67,
      "accessCount": 2,
      "riskLevel": "HIGH",
      "reason": "Very low usage (2 accesses)",
      "recommendation": "Remove access immediately"
    },
    {
      "userId": "00u7ijk6fed4cza3byz2",
      "userLogin": "grace.sometimes@example.com",
      "lastAccess": "2026-02-15T13:45:00.000Z",
      "daysSinceLastAccess": 53,
      "accessCount": 4,
      "riskLevel": "MEDIUM",
      "reason": "Low usage (4 accesses in 53 days)",
      "recommendation": "Include in next access review"
    },
    {
      "userId": "00u8jkl7gfe5dab4cza3",
      "userLogin": "henry.occasional@example.com",
      "lastAccess": "2026-02-20T09:30:00.000Z",
      "daysSinceLastAccess": 48,
      "accessCount": 3,
      "riskLevel": "MEDIUM",
      "reason": "Low usage (3 accesses in 48 days)",
      "recommendation": "Include in next access review"
    },
    {
      "userId": "00u9klm8hgf6ebc5dab4",
      "userLogin": "iris.infrequent@example.com",
      "lastAccess": "2026-02-22T16:00:00.000Z",
      "daysSinceLastAccess": 46,
      "accessCount": 4,
      "riskLevel": "MEDIUM",
      "reason": "Low usage (4 accesses in 46 days)",
      "recommendation": "Include in next access review"
    }
  ],
  "nextSteps": [
    "Review high-risk candidates for immediate access removal",
    "Schedule access certification campaign for medium-risk users",
    "Monitor low-risk users for continued inactivity"
  ]
}
```

**Interpretation:**
- 🚨 **5 high-risk users** - immediate action required
- ⚠️ **3 medium-risk users** - include in next review
- 💡 This app may be a candidate for decommissioning

---

### Example 3: Filtering by Risk Level

**Input (HIGH only):**
```json
{
  "appId": "0oa5nml4kjh3gfe2dcb1",
  "inactivityDays": 90,
  "minRiskLevel": "HIGH"
}
```

**Output:**
```json
{
  "app": {
    "id": "0oa5nml4kjh3gfe2dcb1",
    "name": "legacy_crm",
    "label": "Legacy CRM System",
    "status": "ACTIVE"
  },
  "analysisParameters": {
    "inactivityDays": 90,
    "minRiskLevel": "HIGH",
    "analyzedPeriod": {
      "from": "2026-01-09T00:00:00.000Z",
      "to": "2026-04-09T00:00:00.000Z"
    }
  },
  "summary": {
    "totalCandidates": 5,
    "riskDistribution": {
      "high": 5,
      "medium": 0,
      "low": 0
    },
    "recommendations": {
      "immediate": 5,
      "review": 0,
      "monitor": 0
    }
  },
  "candidates": [
    {
      "userId": "00u2dcb1azy9xwv8uts7",
      "userLogin": "alice.inactive@example.com",
      "lastAccess": null,
      "daysSinceLastAccess": null,
      "accessCount": 0,
      "riskLevel": "HIGH",
      "reason": "No recorded access in lookback period",
      "recommendation": "Remove access immediately"
    },
    {
      "userId": "00u3efg2baz0yvx9wut8",
      "userLogin": "charlie.gone@example.com",
      "lastAccess": "2025-12-15T10:00:00.000Z",
      "daysSinceLastAccess": 115,
      "accessCount": 1,
      "riskLevel": "HIGH",
      "reason": "No access for 115 days",
      "recommendation": "Remove access immediately"
    },
    {
      "userId": "00u4fgh3cba1zwx0yvu9",
      "userLogin": "dana.left@example.com",
      "lastAccess": "2026-01-02T08:30:00.000Z",
      "daysSinceLastAccess": 97,
      "accessCount": 2,
      "riskLevel": "HIGH",
      "reason": "Very low usage (2 accesses)",
      "recommendation": "Remove access immediately"
    },
    {
      "userId": "00u5ghi4dcb2axy1zwv0",
      "userLogin": "evan.old@example.com",
      "lastAccess": "2026-01-10T14:15:00.000Z",
      "daysSinceLastAccess": 89,
      "accessCount": 1,
      "riskLevel": "HIGH",
      "reason": "Very low usage (1 access)",
      "recommendation": "Remove access immediately"
    },
    {
      "userId": "00u6hij5edc3byz2axy1",
      "userLogin": "frank.rarely@example.com",
      "lastAccess": "2026-02-01T11:20:00.000Z",
      "daysSinceLastAccess": 67,
      "accessCount": 2,
      "riskLevel": "HIGH",
      "reason": "Very low usage (2 accesses)",
      "recommendation": "Remove access immediately"
    }
  ],
  "nextSteps": [
    "Review high-risk candidates for immediate access removal",
    "Schedule access certification campaign for medium-risk users",
    "Monitor low-risk users for continued inactivity"
  ]
}
```

**Interpretation:**
- 🎯 Focused view on immediate action items
- ✅ Ready to create access removal requests

---

## System Log Query Details

### Query Filter

```typescript
const events = await systemLogClient.queryLogs({
  filter: `target.id eq "${appId}"`,
  since: sinceISO, // e.g., "2026-02-09T00:00:00.000Z"
  limit: 1000,
  sortOrder: 'DESCENDING',
});
```

### Event Types Tracked

The risk engine tracks various event types:
- `application.lifecycle.activate`
- `application.user_membership.add`
- `application.user_membership.remove`
- `user.authentication.sso`
- `user.session.start`
- And other app-related events

### Activity Aggregation

```typescript
// Build map of user activity
const userActivity = new Map<string, {
  userId: string;
  userLogin: string;
  lastAccess: string;
  accessCount: number;
  eventTypes: Set<string>;
}>();

for (const event of events) {
  if (!event.actor?.id) continue;

  const userId = event.actor.id;
  // Track most recent access
  // Count all accesses
  // Record event types
}
```

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

### App Not Found

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "Failed to generate review candidates: Application not found"
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

## Logging Output

### Successful Analysis

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
[RiskEngine] Querying system logs for app access: {
  appId: '0oa1abc2def3ghi4jkl5',
  since: '2026-02-09T00:00:00.000Z'
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

## Use Cases

### 1. Quarterly Access Review

**Goal:** Find all users who should be reviewed in Q2 2026

```bash
# Generate candidates for each owned app
for appId in $(list owned apps); do
  generate_access_review_candidates \
    --appId "$appId" \
    --inactivityDays 90 \
    --minRiskLevel MEDIUM
done
```

### 2. Emergency Access Cleanup

**Goal:** Find users with zero usage for immediate removal

```bash
generate_access_review_candidates \
  --appId "0oa1abc2def3ghi4jkl5" \
  --inactivityDays 120 \
  --minRiskLevel HIGH
```

### 3. App Decommissioning Analysis

**Goal:** Determine if an app is still being used

```bash
# Check for ANY usage in last 180 days
generate_access_review_candidates \
  --appId "0oa5nml4kjh3gfe2dcb1" \
  --inactivityDays 180 \
  --minRiskLevel LOW

# If total candidates equals total assigned users → app is unused
```

### 4. Compliance Reporting

**Goal:** Generate risk report for auditors

```bash
generate_access_review_candidates \
  --appId "0oa1abc2def3ghi4jkl5" \
  --inactivityDays 60 \
  --minRiskLevel LOW > compliance-report-$(date +%Y%m%d).json
```

## Integration with Other Tools

### Workflow Example

```
1. generate_access_review_candidates
   ↓ (identify high-risk users)

2. create_campaign_for_owned_app
   ↓ (create certification campaign)

3. request_access_for_other_user_on_owned_app
   ↓ (provision replacement users)

4. (Revoke access for inactive users via campaign)
```

## Performance Considerations

- **System Log Limit:** 1000 events per query
- **Lookback Period:** Longer periods = more events to process
- **App Size:** Large apps with many users take longer to analyze
- **Caching:** Consider caching results for large apps

## Security Notes

- ✅ **Target Validation:** App must be in user's target list
- ✅ **Scope Validation:** Requires `okta.logs.read` and `okta.apps.read`
- ✅ **Capability Validation:** Requires `campaigns.manage.owned` and `reports.syslog.owned`
- ✅ **Read-Only:** Does NOT modify any data
- ✅ **Privacy:** Returns user IDs and logins only (no sensitive data)

## Limitations

1. **Historical Data:** Limited by Okta System Log retention (typically 90 days)
2. **Event Sampling:** High-volume apps may have sampled logs
3. **Event Types:** Only tracks system log events (not all app activity)
4. **No Direct Assignments:** Does not show assigned users who have never accessed
5. **Point-in-Time:** Analysis is based on current moment, not historical trends

## Future Enhancements

- [ ] Add trending analysis (usage increasing/decreasing over time)
- [ ] Add org-wide analysis (all apps at once)
- [ ] Add comparison to previous reports
- [ ] Add automatic campaign creation
- [ ] Add notification of high-risk users to app owners
- [ ] Add export to CSV/Excel

## Summary

The risk-based governance feature provides:

✅ **Automated Risk Detection** - No manual log analysis required
✅ **Evidence-Based Decisions** - Real usage data, not guesswork
✅ **Compliance Support** - Clear audit trail and risk levels
✅ **Time Savings** - Analyze 1000s of users in seconds
✅ **Actionable Output** - Clear recommendations for each user
✅ **Authorization Enforced** - Only owned apps, proper scopes required

This feature enables APP_ADMINs to make data-driven decisions about access governance without manually reviewing system logs.

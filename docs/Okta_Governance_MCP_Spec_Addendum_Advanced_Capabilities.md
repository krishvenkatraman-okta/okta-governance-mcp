# Okta Governance MCP — Spec Addendum: Advanced Governance Capabilities

> **Companion document to** `Okta Governance MCP Server Specification.md`
> This addendum extends the base spec with capabilities not available out-of-the-box in Okta today: role/entitlement mining, peer-relative outlier detection, access path explainability, and intelligent certification campaigns.

---

## A.1 Purpose

The base spec defines the governance control plane and OOTB Okta-aligned tool surface (entitlements, labels, bundles, campaigns, syslog reporting). This addendum introduces a new **analytics layer** and four advanced governance tools that operate on live Okta data to deliver capabilities Okta does not natively provide:

| Capability | What it does | Closest Okta OOTB equivalent |
|---|---|---|
| **Role Mining** | Cluster users by their actual access patterns and propose candidate roles where common patterns emerge | None — manually defined groups only |
| **Entitlement Outlier Detection** | Flag users whose access deviates from their peer group (department / title / manager) | None |
| **Access Path Explainer** | Trace and explain in plain English how a user came to have a specific access | None — admins must manually walk groups/rules |
| **Smart Certification Campaigns** | Build campaigns scoped to anomalies, outliers, and dormant access only — not blanket reviews | Campaigns exist but have no built-in risk ranking |

These capabilities slot into the existing MCP architecture without altering the auth flow, MAS/MRS separation, or scope model.

---

## A.2 Core Principle Extension

The base spec asserts: *Not everything is an MCP tool.* This addendum extends that:

> **Analytics is always an MCP tool.** Mining, outlier detection, and campaign assembly are inherently privileged operations: they require reading data across many users, comparing access patterns, and computing recommendations that influence administrative decisions. There is no end-user counterpart for these capabilities — they live exclusively in the MCP governance layer.

---

## A.3 Architecture Additions

### A.3.1 New Module: `src/analytics/`

A new analytics layer sits between the Okta API clients and the MCP tools. It is responsible for:

- Building in-memory access graphs from live Okta data
- Computing peer groups from user profile attributes
- Running clustering, similarity, and outlier-detection algorithms
- Tracing access paths for explainability
- Assembling smart-campaign item sets

```
src/analytics/
├── access-graph.ts        # User → Group → App → Entitlement graph builder
├── peer-grouper.ts        # Bucket users by department / title / manager
├── role-miner.ts          # Hierarchical clustering for candidate roles
├── outlier-detector.ts    # Peer-relative entitlement outlier detection
├── access-explainer.ts    # Path tracing for explainability
├── campaign-builder.ts    # Smart-campaign item assembly
├── jaccard.ts             # Similarity primitives (shared utility)
└── types.ts               # Shared analytics types
```

### A.3.2 Data Strategy

All analytics tools operate on **live Okta data** fetched per-invocation. There is no persistent cache. Within a single tool invocation, repeated lookups for the same entity are memoized to avoid redundant API calls.

Trade-off: Higher latency per invocation in exchange for always-fresh results and zero cache-invalidation complexity. This is acceptable because analytics tools are deliberately invoked, not high-frequency.

### A.3.3 Required Okta APIs

The analytics layer depends on:

- **Users API** — Profile attributes (department, title, manager) for peer grouping
- **Groups API** — Group membership for assignment matrices
- **Apps API** — App assignments and entitlements per user
- **Governance Entitlements API** — Entitlement bundles per app
- **System Log API** — Optional: usage frequency to weight risk

No new Okta APIs are required.

---

## A.4 Tool Specifications

### A.4.1 `mine_candidate_roles`

**Purpose:** Discover candidate roles by clustering users with similar access patterns.

**Algorithm:**
1. Build a user × access matrix where rows are users (in scope), columns are (group | app | entitlement) assignments, cells are 0/1
2. Compute Jaccard similarity between users
3. Apply hierarchical clustering with a configurable similarity threshold (default 0.7)
4. For each cluster of ≥ N users (default 5), extract the access set shared by ≥ T% of cluster members (default 80%)
5. Score each candidate role by cluster size, intra-cluster cohesion, and access uniformity
6. Return top K candidate roles ranked by score

**Inputs:**
```typescript
{
  scopeType: "app" | "group" | "department" | "all",
  scopeId?: string,                  // App ID, Group ID, or department name
  minClusterSize?: number,           // Default 5
  similarityThreshold?: number,      // Default 0.7
  commonAccessThreshold?: number,    // Default 0.8 (80% of cluster shares the access)
  maxResults?: number                // Default 10
}
```

**Output:**
```typescript
{
  scopeDescription: string,
  totalUsersAnalyzed: number,
  candidateRoles: Array<{
    proposedName: string,            // LLM-generated based on common attributes
    confidence: number,              // 0-1, based on cluster cohesion
    memberCount: number,
    members: Array<{ userId, login, department, title }>,
    commonAccess: Array<{ type: "group" | "app" | "entitlement", id, name, coverage: number }>,
    suggestedAction: string,         // "Create as Group" | "Refine - low cohesion" | etc.
    rationale: string                // Plain-English explanation
  }>,
  summary: { highConfidenceCount, totalProposed, estimatedAccessReduction }
}
```

**Authorization:**
- Capabilities (any of): `analytics.mining.owned`, `analytics.mining.all`
- Scopes: `okta.users.read`, `okta.groups.read`, `okta.apps.read`
- Constraints: `scope_to_owned_apps_or_all` — `APP_ADMIN` users can only mine within their target apps; `ORG_ADMIN`/`SUPER_ADMIN` can mine org-wide

---

### A.4.2 `detect_entitlement_outliers`

**Purpose:** Identify users whose access deviates significantly from their peer group.

**Algorithm:**
1. Determine peer group for each user (default: same department + same title; fallback: same manager)
2. For each entitlement held by the user, compute coverage = % of peers who also have it
3. Flag entitlements where coverage falls below a threshold (default 10%) as outliers
4. Compute outlier score = sum of (1 - coverage) for each outlier entitlement, weighted by entitlement sensitivity
5. Return ranked list of users with their outlier entitlements

**Inputs:**
```typescript
{
  scopeType: "app" | "group" | "department" | "all",
  scopeId?: string,
  peerGroupingStrategy?: "department_title" | "manager" | "department",   // Default "department_title"
  outlierThreshold?: number,           // Default 0.10 (less than 10% of peers)
  minPeerGroupSize?: number,           // Default 5
  maxResults?: number                   // Default 25
}
```

**Output:**
```typescript
{
  scopeDescription: string,
  peerGroupingStrategy: string,
  totalUsersAnalyzed: number,
  totalPeerGroups: number,
  outliers: Array<{
    userId: string,
    login: string,
    department: string,
    title: string,
    peerGroupSize: number,
    outlierScore: number,
    outlierEntitlements: Array<{
      entitlementId: string,
      entitlementName: string,
      appName: string,
      peerCoverage: number,             // 0-1
      grantedDate?: string,
      grantedBy?: string,
      lastUsed?: string,
      recommendation: string            // "Review" | "Likely revoke" | "Investigate"
    }>,
    overallRecommendation: string
  }>,
  summary: { highRiskOutliers, totalOutlierEntitlements, mostCommonOutlierApp }
}
```

**Authorization:**
- Capabilities (any of): `analytics.outliers.owned`, `analytics.outliers.all`
- Scopes: `okta.users.read`, `okta.groups.read`, `okta.apps.read`
- Constraints: `scope_to_owned_apps_or_all`

---

### A.4.3 `explain_user_access`

**Purpose:** Trace and explain how a specific user came to have a specific access.

**Algorithm:**
1. Identify the target access (entitlement, app, or group)
2. Walk the assignment graph backwards: direct assignments → group memberships → group rules → role assignments → policy grants
3. Construct a tree of all paths from user to access
4. Annotate each node with timestamps, granters, and policy references where available
5. Generate a plain-English narrative summarizing the most direct path and any redundant paths

**Inputs:**
```typescript
{
  userId: string,                       // User ID or login
  targetType: "app" | "entitlement" | "group",
  targetId: string,
  includeRedundantPaths?: boolean       // Default true
}
```

**Output:**
```typescript
{
  user: { id, login, displayName, department, title },
  target: { type, id, name },
  hasAccess: boolean,
  paths: Array<{
    pathType: "direct" | "group_membership" | "group_rule" | "role_assignment",
    isPrimary: boolean,
    nodes: Array<{
      nodeType: "user" | "group" | "rule" | "role" | "app" | "entitlement",
      id: string,
      name: string,
      grantedDate?: string,
      grantedBy?: string,
      ruleExpression?: string           // For group rules
    }>,
    narrative: string                   // Plain English explanation of THIS path
  }>,
  summary: {
    totalPaths: number,
    redundantPathCount: number,
    earliestGrant: string,
    explanation: string                 // Plain English consolidated explanation
  }
}
```

**Authorization:**
- Capabilities: `analytics.explain.read`
- Scopes: `okta.users.read`, `okta.groups.read`, `okta.apps.read`, `okta.governance.entitlements.read`
- Constraints: none — read-only and broadly useful

---

### A.4.4 `generate_smart_campaign`

**Purpose:** Build a certification campaign scoped only to anomalies, outliers, and dormant access — not blanket reviews.

**Algorithm:**
1. Run `detect_entitlement_outliers` on the requested scope
2. Run dormant-access detection (extends existing `risk-engine`) on the same scope
3. Optionally include direct assignments (no group inheritance) and recently-granted access
4. Deduplicate and rank items by composite risk score
5. Map each item to its appropriate reviewer (manager, app owner, or resource owner)
6. Output a campaign-ready item list

**Inputs:**
```typescript
{
  scopeType: "app" | "group" | "department" | "all",
  scopeId?: string,
  includeRules?: {
    outliers?: boolean,                 // Default true
    dormantAccess?: boolean,            // Default true
    directAssignments?: boolean,        // Default false
    recentGrants?: boolean              // Default false (last 30 days)
  },
  reviewerStrategy?: "manager" | "app_owner" | "resource_owner",  // Default "manager"
  campaignName?: string,
  dryRun?: boolean                      // Default true — returns items without creating campaign
}
```

**Output:**
```typescript
{
  campaignName: string,
  scopeDescription: string,
  itemCount: number,
  estimatedReviewerLoad: Array<{ reviewerId, reviewerName, itemCount }>,
  itemsByCategory: {
    outliers: number,
    dormantAccess: number,
    directAssignments: number,
    recentGrants: number
  },
  items: Array<{
    userId: string,
    userLogin: string,
    accessType: "app" | "entitlement",
    accessId: string,
    accessName: string,
    reviewer: string,
    reasonForInclusion: Array<string>,  // ["outlier", "dormant_60d"]
    riskScore: number,
    recommendedDecision: "REVOKE" | "APPROVE" | "REVIEW"
  }>,
  campaignId?: string,                  // Present only if dryRun = false and creation succeeded
  nextSteps: string[]
}
```

**Authorization:**
- Capabilities (any of): `analytics.campaigns.owned`, `analytics.campaigns.all`
- Scopes: `okta.users.read`, `okta.groups.read`, `okta.apps.read`, `okta.governance.accessCertifications.manage`
- Constraints: `scope_to_owned_apps_or_all`

---

## A.5 Capability Model Additions

The base spec defines a capability model with `*.owned` and `*.all` patterns. This addendum adds:

```typescript
// New capabilities
'analytics.mining.owned'      // Mine roles within owned apps/groups
'analytics.mining.all'        // Mine roles org-wide
'analytics.outliers.owned'    // Detect outliers within owned apps/groups
'analytics.outliers.all'      // Detect outliers org-wide
'analytics.explain.read'      // Use access explainer (broad - any admin)
'analytics.campaigns.owned'   // Build smart campaigns for owned apps
'analytics.campaigns.all'     // Build smart campaigns org-wide
```

### Role-to-Capability Mapping

| Role | Analytics capabilities granted |
|---|---|
| `SUPER_ADMIN` | All `*.all` capabilities + `analytics.explain.read` |
| `ORG_ADMIN` | All `*.all` capabilities + `analytics.explain.read` |
| `APP_ADMIN` (with targets) | `analytics.mining.owned`, `analytics.outliers.owned`, `analytics.campaigns.owned`, `analytics.explain.read` |
| `GROUP_ADMIN` (with targets) | `analytics.explain.read` only — analytics tools require app context |
| `READ_ONLY_ADMIN` | `analytics.explain.read` only |
| Regular user | None — analytics is admin-only |

The `.all` → `.owned` capability satisfaction logic from the base spec applies here unchanged.

---

## A.6 Tool Requirements Registry Entries

Each new tool registers like the OOTB tools, following the existing schema:

```typescript
{
  tool: "mine_candidate_roles",
  requiredCapabilities: ["analytics.mining.owned", "analytics.mining.all"],  // ANY
  requiredScopes: ["okta.users.read", "okta.groups.read", "okta.apps.read"], // ALL
  requiredRoles: ["APP_ADMIN", "ORG_ADMIN", "SUPER_ADMIN"],
  constraints: ["scope_to_owned_apps_or_all"]
}
```

The new constraint `scope_to_owned_apps_or_all` is enforced as follows:
- If user has `*.all` capability → no scope restriction
- If user has `*.owned` capability + `scopeType="app"` + `scopeId` → must be in `targets.apps`
- If user has `*.owned` capability + `scopeType="all"` → reject with policy error

---

## A.7 Frontend Additions

### A.7.1 New Hub: Insights

A new top-level navigation entry opens an Insights hub modeled after the existing Tool Explorer modal, but tabbed:

- **🪙 Discover** — Role mining results
- **🛡️ Risks** — Outlier detection
- **💡 Explain** — Access path explainer
- **📋 Campaigns** — Smart campaign builder

### A.7.2 New Components

```
frontend/components/insights/
├── InsightsHub.tsx              # Tabbed container, top-level entry
├── RoleMiningResults.tsx        # Card-based candidate role display
├── OutlierReport.tsx            # Heat-table view of outliers per user
├── AccessExplainer.tsx          # Tree visualization of access paths
└── SmartCampaignBuilder.tsx     # Toggle-rules campaign assembly UI
```

### A.7.3 Chat Integration Pattern

Each new tool returns rich structured output that does not render well as raw JSON in chat. The pattern is:

1. The MCP tool returns the full structured payload
2. The chat layer renders a **summary card** with key stats and a "View details" CTA
3. Clicking "View details" opens the appropriate Insights component in a side panel or modal, pre-loaded with the tool's output

A new shared component handles this:

```
frontend/components/chat/
└── ToolResultSummary.tsx        # Renders summary cards + opens detail components
```

### A.7.4 Rendering Conventions

- **Role mining results** → cards with proposed name, member count, common access bar, confidence %, and `Adopt as Group` action
- **Outlier reports** → heat-table with users as rows, entitlements as columns, cells colored by peer coverage. Click cell → opens Access Explainer pre-filled with that user/entitlement
- **Access explainer** → tree/graph view showing all paths from user to access, annotated with grant timestamps
- **Smart campaign builder** → toggleable inclusion rules with live item count; preview list before campaign creation

---

## A.8 Security Principles (Reinforced)

All base-spec security principles apply to analytics tools without exception:

- ✅ Real Okta APIs only — no synthetic data
- ✅ Re-authorization on every invocation — capability + scope + role + target
- ✅ Audit log every analytics invocation including scope and result counts
- ✅ Outputs from `mine_candidate_roles` and `generate_smart_campaign` are **proposals only** — actual group creation or campaign launch requires a separate explicit tool invocation
- ✅ `explain_user_access` reveals access paths but never sensitive payloads (e.g., role definitions, policy expressions are surfaced; user PII beyond login/displayName is not)

---

## A.9 Demo Narrative

The four tools tell one continuous story for a hackathon demo:

1. **Discover** — "Mine candidate roles in our Salesforce app" → shows three proposed roles: Sales Reps, Sales Managers, Sales Operations
2. **Risk** — "Detect outliers among Sales Operations users" → flags one user with prod database write access that no peer has
3. **Explain** — "Why does Sarah have prod database write access?" → traces back to a one-off direct grant from 14 months ago, never reviewed
4. **Fix** — "Generate a smart campaign for outliers and dormant access in Sales Operations" → produces a focused 12-item campaign instead of a 2,000-item blanket review

This arc demonstrates: discovery → detection → explanation → remediation, all on live Okta data, all enforced by the MCP governance layer.

---

## A.10 Open Items (Future Work)

Out of scope for the hackathon but recognized as natural extensions:

- **SoD detection** — Toxic-combination policy evaluation across apps
- **Role consolidation** — Merge proposals for groups/roles with high overlap
- **Birthright mining** — Identify access that should be auto-provisioned by department/title
- **Predict reviewer decisions** — ML on past review outcomes to pre-fill recommendations
- **Persistent analytics cache** — Redis or SQLite layer for sub-second repeated queries
- **Custom SoD policy storage** — DB-backed policy management with admin UI

---

*End of Addendum*

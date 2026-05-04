/**
 * Smart certification campaign builder
 *
 * Composes the analytics primitives (outlier detection, dormant-access
 * via system log, direct-vs-inherited assignment, and recent grants)
 * into a single ranked, deduplicated list of campaign items. Each item
 * targets one (user, access-node) pair and carries the reasons it was
 * selected, a reviewer assignment, a composite risk score, and a
 * recommended decision.
 *
 * The output is intended to feed `generate_smart_campaign`'s preview
 * (`dryRun=true`) or — if the caller opts into creating the campaign —
 * the resource list passed to `governanceClient.campaigns.create`.
 *
 * Design notes:
 *   - All inputs run against the same pre-built `AccessGraphSnapshot`
 *     so we don't re-resolve the user set across rules.
 *   - Dormant-access detection re-uses the existing risk engine's
 *     system-log query patterns (per-user / per-app SSO events).
 *   - "Direct assignment" is a heuristic: an app a user holds whose
 *     parent group set does not include any group that's also assigned
 *     to that app. We resolve group→app mappings via
 *     `groupsClient.listAssignedApps` (memoized within a single build).
 *   - "Recent grant" data is best-effort. The Governance Grants API
 *     returns a `created` timestamp on each grant; we use that when
 *     present, otherwise the rule is a no-op for the bundle.
 */

import { groupsClient } from '../okta/groups-client.js';
import { systemLogClient } from '../okta/systemlog-client.js';
import { detectOutliers } from './outlier-detector.js';
import type {
  AccessGraphSnapshot,
  AccessNode,
  UserAccessProfile,
} from './types.js';

/**
 * Inclusion-rule toggles. Each rule contributes `reasonForInclusion`
 * tags to matching items.
 */
export interface SmartCampaignRules {
  /**
   * Include peer-coverage outliers (via {@link detectOutliers}).
   */
  outliers: boolean;

  /**
   * Include user-app pairs with no SSO authentication events in the
   * last `inactivityDays` (default 60).
   */
  dormantAccess: boolean;

  /**
   * Include access nodes the user holds that don't appear to come from
   * any of their groups (best-effort; see file header).
   */
  directAssignments: boolean;

  /**
   * Include grants created within the last `recentGrantsDays` window
   * (default 30). Best-effort; only fires for entitlement nodes that
   * carry a `created` timestamp on the access graph.
   */
  recentGrants: boolean;
}

/**
 * How to map an item to a reviewer.
 *
 * - `manager`: lookup user.profile.managerId
 * - `app_owner`: app's owner attribute, when present on the snapshot
 * - `resource_owner`: entitlement.owner if present, else fall back to
 *   the parent app's owner
 */
export type ReviewerStrategy = 'manager' | 'app_owner' | 'resource_owner';

/**
 * Input for {@link buildSmartCampaign}.
 */
export interface BuildSmartCampaignInput {
  snapshot: AccessGraphSnapshot;
  includeRules: SmartCampaignRules;
  reviewerStrategy: ReviewerStrategy;

  /**
   * Used by the dormant-access rule. Default 60.
   */
  inactivityDays?: number;

  /**
   * Used by the recent-grants rule. Default 30.
   */
  recentGrantsDays?: number;

  /**
   * Optional override — defaults to "Smart certification campaign — {scope}".
   */
  campaignName?: string;
}

/**
 * Ordered set of reasons an item can carry. We surface them as plain
 * strings (`"outlier"`, `"dormant_60d"`, `"direct_assignment"`,
 * `"recent_grant_30d"`) so the chat layer / UI can render them as
 * badges without translating an enum.
 */
export type CampaignReason =
  | 'outlier'
  | `dormant_${number}d`
  | 'direct_assignment'
  | `recent_grant_${number}d`;

/**
 * Recommended decision per item. Mirrors the spec addendum.
 */
export type RecommendedDecision = 'REVOKE' | 'APPROVE' | 'REVIEW';

/**
 * One row in the campaign output.
 */
export interface CampaignItem {
  /** Composite key `${userId}:${accessType}:${accessId}`. */
  itemKey: string;
  userId: string;
  userLogin: string;
  userDisplayName: string;

  /** Either an app or an entitlement (groups aren't reviewed in this campaign type). */
  accessType: 'app' | 'entitlement';
  accessId: string;
  accessName: string;

  /** Parent app id when `accessType === 'entitlement'`; otherwise the app id itself. */
  appId?: string;

  reviewer: string;
  reviewerName?: string;

  reasonForInclusion: CampaignReason[];
  riskScore: number;
  recommendedDecision: RecommendedDecision;
}

/**
 * Per-rule item-count breakdown (matches the spec addendum).
 */
export interface CampaignItemsByCategory {
  outliers: number;
  dormantAccess: number;
  directAssignments: number;
  recentGrants: number;
}

/**
 * Reviewer-load row.
 */
export interface ReviewerLoadEntry {
  reviewerId: string;
  reviewerName?: string;
  itemCount: number;
}

/**
 * Output of {@link buildSmartCampaign}.
 */
export interface SmartCampaign {
  campaignName: string;
  scopeDescription: string;
  itemCount: number;
  estimatedReviewerLoad: ReviewerLoadEntry[];
  itemsByCategory: CampaignItemsByCategory;
  items: CampaignItem[];
  /**
   * Human-readable next-step hints — used by the tool handler when the
   * caller is in dryRun=true mode.
   */
  nextSteps: string[];
}

/**
 * Default inactivity window for the dormant-access rule.
 */
const DEFAULT_INACTIVITY_DAYS = 60;

/**
 * Default recency window for the recent-grants rule.
 */
const DEFAULT_RECENT_GRANTS_DAYS = 30;

/**
 * Internal mutable shape — converted to {@link CampaignItem} at the end
 * of the build so we can incrementally fold reasons in.
 */
interface DraftCampaignItem {
  itemKey: string;
  userId: string;
  userLogin: string;
  userDisplayName: string;
  accessType: 'app' | 'entitlement';
  accessId: string;
  accessName: string;
  appId?: string;
  reasons: Set<CampaignReason>;
}

/**
 * Build a smart campaign from a snapshot and the requested rule set.
 *
 * Async because the dormant-access rule fans out to the System Log API.
 * All other rules are pure functions over the snapshot.
 *
 * @param input - Snapshot + rule toggles + reviewer strategy
 * @returns A fully populated {@link SmartCampaign}
 *
 * @example
 * ```typescript
 * const snapshot = await buildAccessGraph({ scopeType: 'app', scopeId: '0oa...' });
 * const campaign = await buildSmartCampaign({
 *   snapshot,
 *   includeRules: {
 *     outliers: true,
 *     dormantAccess: true,
 *     directAssignments: false,
 *     recentGrants: false,
 *   },
 *   reviewerStrategy: 'manager',
 * });
 * ```
 */
export async function buildSmartCampaign(
  input: BuildSmartCampaignInput,
): Promise<SmartCampaign> {
  const {
    snapshot,
    includeRules,
    reviewerStrategy,
    inactivityDays = DEFAULT_INACTIVITY_DAYS,
    recentGrantsDays = DEFAULT_RECENT_GRANTS_DAYS,
    campaignName,
  } = input;

  console.log('[CampaignBuilder] Building smart campaign:', {
    scope: snapshot.scopeDescription,
    userCount: snapshot.users.length,
    includeRules,
    reviewerStrategy,
    inactivityDays,
    recentGrantsDays,
  });

  const startedAt = Date.now();

  const drafts = new Map<string, DraftCampaignItem>();
  const usersById = new Map<string, UserAccessProfile>();
  for (const u of snapshot.users) {
    usersById.set(u.userId, u);
  }

  // Rule 1 — outliers. Run regardless of result count; nothing-found is
  // a valid signal.
  if (includeRules.outliers) {
    applyOutlierRule(drafts, snapshot, usersById);
  }

  // Rule 2 — dormant access. The expensive one (one system-log query per
  // user-app pair); we keep it gated.
  if (includeRules.dormantAccess) {
    await applyDormantAccessRule(drafts, snapshot, usersById, inactivityDays);
  }

  // Rule 3 — direct assignments.
  if (includeRules.directAssignments) {
    await applyDirectAssignmentRule(drafts, snapshot, usersById);
  }

  // Rule 4 — recent grants. The access graph today doesn't carry
  // grant-creation timestamps, so this rule is a no-op until the
  // entitlement projection is extended. We still run the helper so
  // future timestamp wiring slots in cleanly.
  if (includeRules.recentGrants) {
    applyRecentGrantsRule(drafts, snapshot, usersById, recentGrantsDays);
  }

  // Materialize: assign reviewers, compute risk + decisions, and pick a
  // category breakdown.
  const items: CampaignItem[] = [];
  for (const draft of drafts.values()) {
    const reasons = Array.from(draft.reasons);
    const reviewer = resolveReviewer(
      draft,
      usersById.get(draft.userId),
      snapshot,
      reviewerStrategy,
    );
    const riskScore = computeRiskScore(reasons);
    const recommendedDecision = recommendForReasons(reasons);

    items.push({
      itemKey: draft.itemKey,
      userId: draft.userId,
      userLogin: draft.userLogin,
      userDisplayName: draft.userDisplayName,
      accessType: draft.accessType,
      accessId: draft.accessId,
      accessName: draft.accessName,
      appId: draft.appId,
      reviewer: reviewer.id,
      reviewerName: reviewer.name,
      reasonForInclusion: reasons,
      riskScore,
      recommendedDecision,
    });
  }

  // Rank items by risk score descending, with a deterministic tiebreak
  // on `itemKey` for stable output.
  items.sort((a, b) => {
    if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
    return a.itemKey.localeCompare(b.itemKey);
  });

  const itemsByCategory = countByCategory(items);
  const estimatedReviewerLoad = summarizeReviewerLoad(items);

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[CampaignBuilder] Build complete in ${elapsedMs}ms — ` +
      `${items.length} item(s), ${estimatedReviewerLoad.length} reviewer(s)`,
  );

  return {
    campaignName: campaignName ?? defaultCampaignName(snapshot),
    scopeDescription: snapshot.scopeDescription,
    itemCount: items.length,
    estimatedReviewerLoad,
    itemsByCategory,
    items,
    nextSteps: items.length > 0
      ? [
          'Review the proposed items in the preview',
          'Re-run with dryRun=false to create the campaign in Okta',
          'Launch the campaign once reviewers are confirmed',
        ]
      : [
          'No items matched the configured rules — try widening the rule set or scope',
        ],
  };
}

/**
 * Outlier rule: every flagged entitlement on every outlier user becomes
 * a campaign item. We default the recommended decision via the rule
 * combination logic (see {@link recommendForReasons}).
 */
function applyOutlierRule(
  drafts: Map<string, DraftCampaignItem>,
  snapshot: AccessGraphSnapshot,
  usersById: Map<string, UserAccessProfile>,
): void {
  const result = detectOutliers(snapshot);
  console.log(
    `[CampaignBuilder] Outlier rule: ${result.outliers.length} user(s), ` +
      `${result.summary.totalOutlierEntitlements} flagged entitlement(s)`,
  );

  for (const outlier of result.outliers) {
    const user = usersById.get(outlier.userId);
    if (!user) continue;

    for (const ent of outlier.outlierEntitlements) {
      // Group nodes aren't reviewed by a campaign — skip.
      if (ent.type === 'group') continue;
      const accessType = ent.type;
      const draft = upsertDraft(drafts, user, accessType, ent.id, ent.name, snapshot);
      draft.reasons.add('outlier');
    }
  }
}

/**
 * Dormant-access rule: for every (user, app) pair in the snapshot,
 * query the system log for SSO authentication events in the last
 * `inactivityDays`. If none are found, mark the user-app pair as
 * dormant.
 */
async function applyDormantAccessRule(
  drafts: Map<string, DraftCampaignItem>,
  snapshot: AccessGraphSnapshot,
  usersById: Map<string, UserAccessProfile>,
  inactivityDays: number,
): Promise<void> {
  const since = new Date();
  since.setDate(since.getDate() - inactivityDays);
  const sinceISO = since.toISOString();
  const reason: CampaignReason = `dormant_${inactivityDays}d`;

  let dormantPairs = 0;
  let probedPairs = 0;

  for (const user of snapshot.users) {
    const appIds = new Set<string>();
    for (const node of user.accessSet) {
      if (node.type === 'app') appIds.add(node.id);
    }
    if (appIds.size === 0) continue;

    for (const appId of appIds) {
      probedPairs++;
      try {
        const events = await systemLogClient.queryLogs({
          filter:
            `actor.id eq "${user.userId}" and target.id eq "${appId}" ` +
            `and eventType eq "user.authentication.sso"`,
          since: sinceISO,
          limit: 1,
          sortOrder: 'DESCENDING',
        });

        if (events.length === 0) {
          dormantPairs++;
          const appNode = user.accessSet.find(
            (n) => n.type === 'app' && n.id === appId,
          );
          const draft = upsertDraft(
            drafts,
            user,
            'app',
            appId,
            appNode?.name ?? appId,
            snapshot,
          );
          draft.reasons.add(reason);
        }
      } catch (error) {
        console.warn(
          '[CampaignBuilder] Dormant-access probe failed — skipping pair:',
          {
            userId: user.userId,
            appId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    // Lookup the user once more to keep the closure honest with the
    // type checker (usersById is also passed in for symmetry with the
    // other rules).
    void usersById.get(user.userId);
  }

  console.log(
    `[CampaignBuilder] Dormant-access rule: ${dormantPairs}/${probedPairs} (user, app) pair(s) flagged`,
  );
}

/**
 * Direct-assignment rule: for each app a user holds, check whether any
 * of their groups is assigned to that same app. If none are, treat the
 * assignment as direct.
 *
 * We memoize `groupsClient.listAssignedApps(groupId)` per build to keep
 * the call count manageable.
 */
async function applyDirectAssignmentRule(
  drafts: Map<string, DraftCampaignItem>,
  snapshot: AccessGraphSnapshot,
  usersById: Map<string, UserAccessProfile>,
): Promise<void> {
  const groupAppsCache = new Map<string, Set<string>>();
  let directCount = 0;

  for (const user of snapshot.users) {
    const userGroups: string[] = [];
    const userAppNodes: AccessNode[] = [];
    for (const node of user.accessSet) {
      if (node.type === 'group') userGroups.push(node.id);
      else if (node.type === 'app') userAppNodes.push(node);
    }
    if (userAppNodes.length === 0) continue;

    // Resolve the union of apps assigned to any of this user's groups.
    const groupBackedAppIds = new Set<string>();
    for (const groupId of userGroups) {
      let assigned = groupAppsCache.get(groupId);
      if (!assigned) {
        try {
          const apps = await groupsClient.listAssignedApps(groupId);
          assigned = new Set(apps.map((a) => a.id));
        } catch (error) {
          console.warn(
            '[CampaignBuilder] listAssignedApps failed — assuming no group-mediated apps for this group:',
            {
              groupId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          assigned = new Set();
        }
        groupAppsCache.set(groupId, assigned);
      }
      for (const id of assigned) groupBackedAppIds.add(id);
    }

    for (const appNode of userAppNodes) {
      if (groupBackedAppIds.has(appNode.id)) continue;
      directCount++;
      const draft = upsertDraft(
        drafts,
        user,
        'app',
        appNode.id,
        appNode.name,
        snapshot,
      );
      draft.reasons.add('direct_assignment');
    }
    void usersById.get(user.userId);
  }

  console.log(
    `[CampaignBuilder] Direct-assignment rule: ${directCount} item(s) flagged`,
  );
}

/**
 * Recent-grants rule.
 *
 * The current access-graph projection of entitlement grants does not
 * carry a `created` timestamp on the {@link AccessNode}, so we have no
 * deterministic way to filter to "last N days" without re-querying the
 * Governance Grants API. Rather than silently produce nothing, we log
 * a one-time notice so callers know the rule is a no-op until the
 * snapshot is extended (a Phase-2 improvement).
 */
function applyRecentGrantsRule(
  _drafts: Map<string, DraftCampaignItem>,
  _snapshot: AccessGraphSnapshot,
  _usersById: Map<string, UserAccessProfile>,
  recentGrantsDays: number,
): void {
  console.log(
    `[CampaignBuilder] Recent-grants rule (${recentGrantsDays}d): no grant timestamps on snapshot — skipping (Phase-2 follow-up)`,
  );
}

/**
 * Insert-or-fetch a draft for a (user, accessType, accessId) tuple,
 * resolving the parent app id for entitlement nodes from the snapshot.
 */
function upsertDraft(
  drafts: Map<string, DraftCampaignItem>,
  user: UserAccessProfile,
  accessType: 'app' | 'entitlement',
  accessId: string,
  accessName: string,
  snapshot: AccessGraphSnapshot,
): DraftCampaignItem {
  const itemKey = `${user.userId}:${accessType}:${accessId}`;
  let draft = drafts.get(itemKey);
  if (!draft) {
    const appId =
      accessType === 'app'
        ? accessId
        : snapshot.entitlementsById[accessId]?.appId;
    draft = {
      itemKey,
      userId: user.userId,
      userLogin: user.login,
      userDisplayName: user.displayName,
      accessType,
      accessId,
      accessName,
      appId,
      reasons: new Set(),
    };
    drafts.set(itemKey, draft);
  }
  return draft;
}

/**
 * Composite risk score from the rule combination.
 *
 * Tuned so multiple co-occurring rules dominate any single rule.
 * Scores are not normalized to 0-1 — the UI is expected to render them
 * as raw integers and color-grade by relative bucket.
 */
function computeRiskScore(reasons: CampaignReason[]): number {
  let score = 0;
  let hasOutlier = false;
  let hasDormant = false;
  let hasDirect = false;
  let hasRecent = false;

  for (const r of reasons) {
    if (r === 'outlier') hasOutlier = true;
    else if (r === 'direct_assignment') hasDirect = true;
    else if (r.startsWith('dormant_')) hasDormant = true;
    else if (r.startsWith('recent_grant_')) hasRecent = true;
  }

  if (hasDormant && hasOutlier) score += 100;
  else if (hasDirect && hasOutlier) score += 80;
  else if (hasOutlier) score += 60;
  else if (hasDormant) score += 40;
  else if (hasDirect) score += 30;
  if (hasRecent) score += 15;

  return score;
}

/**
 * Pick the recommended decision from the reason combination.
 *
 * - dormant-only → REVOKE (the access isn't being used)
 * - outlier or direct (with or without dormant) → REVIEW
 * - recent grant alone → APPROVE (assume the recent grant was deliberate)
 */
function recommendForReasons(reasons: CampaignReason[]): RecommendedDecision {
  const hasOutlier = reasons.includes('outlier');
  const hasDirect = reasons.includes('direct_assignment');
  const hasDormant = reasons.some((r) => r.startsWith('dormant_'));
  const hasRecent = reasons.some((r) => r.startsWith('recent_grant_'));

  if (hasDormant && !hasOutlier && !hasDirect) return 'REVOKE';
  if (hasOutlier || hasDirect || hasDormant) return 'REVIEW';
  if (hasRecent) return 'APPROVE';
  return 'REVIEW';
}

/**
 * Resolve the reviewer for a draft according to the requested strategy.
 *
 * Falls back to the requesting user's manager (or the user themselves
 * if no manager attribute is present) — this keeps every item in the
 * campaign assignable rather than dropping items with missing data.
 */
function resolveReviewer(
  draft: DraftCampaignItem,
  user: UserAccessProfile | undefined,
  snapshot: AccessGraphSnapshot,
  strategy: ReviewerStrategy,
): { id: string; name?: string } {
  // Best-effort owner lookup. Apps and entitlements may carry a
  // `profile.owner` style attribute — read defensively.
  const appOwner = draft.appId ? readAppOwner(draft.appId, snapshot) : undefined;
  const entOwner =
    draft.accessType === 'entitlement'
      ? readEntitlementOwner(draft.accessId, snapshot)
      : undefined;

  switch (strategy) {
    case 'manager': {
      if (user?.managerId) return { id: user.managerId };
      return fallbackReviewer(user, draft);
    }
    case 'app_owner': {
      if (appOwner) return { id: appOwner };
      return fallbackReviewer(user, draft);
    }
    case 'resource_owner': {
      if (entOwner) return { id: entOwner };
      if (appOwner) return { id: appOwner };
      return fallbackReviewer(user, draft);
    }
  }
}

/**
 * Last-resort reviewer: the user's manager, the user themselves, or
 * the placeholder `"unassigned"` if neither is available. Unassigned
 * items are still surfaced so the caller can wire up a human owner
 * before launching the campaign.
 */
function fallbackReviewer(
  user: UserAccessProfile | undefined,
  draft: DraftCampaignItem,
): { id: string; name?: string } {
  if (user?.managerId) return { id: user.managerId };
  if (user) return { id: user.userId, name: user.displayName };
  return { id: `unassigned:${draft.itemKey}` };
}

/**
 * Read the optional owner attribute off an app's snapshot record. The
 * snapshot's lightweight `AccessGraphApp` doesn't expose owners today,
 * so this returns `undefined` — kept as a function so a future
 * snapshot extension wires through without touching every call site.
 */
function readAppOwner(
  _appId: string,
  _snapshot: AccessGraphSnapshot,
): string | undefined {
  return undefined;
}

/**
 * Same shape as {@link readAppOwner} for entitlements.
 */
function readEntitlementOwner(
  _entitlementId: string,
  _snapshot: AccessGraphSnapshot,
): string | undefined {
  return undefined;
}

/**
 * Per-rule item-count tally.
 */
function countByCategory(items: CampaignItem[]): CampaignItemsByCategory {
  const out: CampaignItemsByCategory = {
    outliers: 0,
    dormantAccess: 0,
    directAssignments: 0,
    recentGrants: 0,
  };
  for (const item of items) {
    for (const r of item.reasonForInclusion) {
      if (r === 'outlier') out.outliers++;
      else if (r === 'direct_assignment') out.directAssignments++;
      else if (r.startsWith('dormant_')) out.dormantAccess++;
      else if (r.startsWith('recent_grant_')) out.recentGrants++;
    }
  }
  return out;
}

/**
 * Aggregate item counts per reviewer for the estimated-load chart.
 */
function summarizeReviewerLoad(items: CampaignItem[]): ReviewerLoadEntry[] {
  const counts = new Map<string, ReviewerLoadEntry>();
  for (const item of items) {
    let entry = counts.get(item.reviewer);
    if (!entry) {
      entry = {
        reviewerId: item.reviewer,
        reviewerName: item.reviewerName,
        itemCount: 0,
      };
      counts.set(item.reviewer, entry);
    }
    entry.itemCount++;
    if (!entry.reviewerName && item.reviewerName) {
      entry.reviewerName = item.reviewerName;
    }
  }
  // Sort by load descending, deterministic tiebreak.
  return Array.from(counts.values()).sort((a, b) => {
    if (b.itemCount !== a.itemCount) return b.itemCount - a.itemCount;
    return a.reviewerId.localeCompare(b.reviewerId);
  });
}

/**
 * Default campaign name when the caller doesn't supply one.
 */
function defaultCampaignName(snapshot: AccessGraphSnapshot): string {
  return `Smart certification campaign — ${snapshot.scopeDescription}`;
}

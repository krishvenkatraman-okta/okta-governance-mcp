/**
 * Entitlement outlier detector
 *
 * Identifies users whose access deviates significantly from their peer
 * group (default: same department + title). The detector consumes a
 * fully-built `AccessGraphSnapshot` and emits a ranked list of outlier
 * users together with the specific access nodes they hold that are
 * uncommon among their peers.
 *
 * Algorithm overview:
 *   1. Bucket users into peer groups via {@link computePeerGroups}.
 *   2. For each user in a peer group of size ≥ `minPeerGroupSize`, walk
 *      their access set. For each access node, compute `peerCoverage` =
 *      fraction of peers (excluding the user) who also hold that node.
 *   3. Mark any node with `peerCoverage < outlierThreshold` as an
 *      outlier for that user.
 *   4. Score each user by the sum of `(1 - peerCoverage)` across their
 *      outlier entitlements, weighted by `sensitivityWeights[id]` if a
 *      weight is provided (default weight 1.0).
 *   5. Rank users by score descending and return the top `maxResults`.
 *   6. Per-entitlement recommendations:
 *        - "Likely revoke" when peerCoverage < 0.05 AND peer group > 5
 *        - "Review"        when peerCoverage < outlierThreshold
 *        - "Investigate"   otherwise (only emitted as adjacent context;
 *          we don't currently surface non-outlier nodes in the result)
 *      Per-user `overallRecommendation` picks the strongest individual
 *      recommendation.
 */

import {
  DEFAULT_MIN_PEER_GROUP_SIZE,
  computePeerGroups,
} from './peer-grouper.js';
import type { PeerGroupingStrategy } from './peer-grouper.js';
import type {
  AccessGraphSnapshot,
  AccessNode,
  UserAccessProfile,
} from './types.js';

/**
 * Default fraction of peers that must hold an access node for it to be
 * considered "common" — anything below this is flagged as an outlier.
 */
export const DEFAULT_OUTLIER_THRESHOLD = 0.10;

/**
 * Default cap on the number of outlier users returned.
 */
export const DEFAULT_MAX_RESULTS = 25;

/**
 * Default peer-grouping strategy.
 */
export const DEFAULT_PEER_GROUPING_STRATEGY: PeerGroupingStrategy = 'department_title';

/**
 * Options for {@link detectOutliers}.
 */
export interface DetectOutliersOptions {
  /**
   * How to bucket users into peer groups. Defaults to
   * `'department_title'`.
   */
  peerGroupingStrategy?: PeerGroupingStrategy;

  /**
   * Fraction (0-1). Access nodes held by fewer than this fraction of a
   * user's peers are flagged as outliers. Default 0.10.
   */
  outlierThreshold?: number;

  /**
   * Drop peer groups with fewer than this many members. Default 5.
   */
  minPeerGroupSize?: number;

  /**
   * Cap on the number of outlier users in the result. Default 25.
   */
  maxResults?: number;

  /**
   * Optional per-entitlement multiplier on the contribution to the
   * outlier score. Keyed by access-node id (NOT the `${type}:${id}`
   * composite). A weight > 1 amplifies an entitlement's impact, < 1
   * dampens it. Missing keys default to 1.0.
   */
  sensitivityWeights?: Record<string, number>;
}

/**
 * Per-entitlement detail row in an outlier user's report.
 */
export interface OutlierEntitlement {
  /** Underlying access node type. */
  type: AccessNode['type'];
  /** Access node id (group / app / entitlement id). */
  id: string;
  /** Friendly name resolved from the snapshot (or the node itself). */
  name: string;
  /**
   * Fraction (0-1) of peers (excluding the user) who also hold this
   * access node.
   */
  peerCoverage: number;
  /**
   * Number of peers (excluding the user) sharing this access node.
   */
  peersWithAccess: number;
  /** Recommendation severity: 'Likely revoke' | 'Review'. */
  recommendation: OutlierRecommendation;
  /** Sensitivity weight applied to this entitlement's score (default 1.0). */
  weight: number;
}

/**
 * Per-user outlier record.
 */
export interface OutlierUser {
  userId: string;
  login: string;
  displayName: string;
  department?: string;
  title?: string;
  /** The peer-group key that this user was bucketed into. */
  peerGroupKey: string;
  /** Total members of the peer group (including the user). */
  peerGroupSize: number;
  /**
   * Sum of `(1 - peerCoverage) * weight` across outlier entitlements.
   * Higher = more anomalous.
   */
  outlierScore: number;
  /** The access nodes flagged as outliers for this user. */
  outlierEntitlements: OutlierEntitlement[];
  /** Strongest individual entitlement recommendation. */
  overallRecommendation: OutlierRecommendation;
}

/**
 * Recommendation severities, ordered weak → strong.
 */
export type OutlierRecommendation = 'Investigate' | 'Review' | 'Likely revoke';

/**
 * Result of {@link detectOutliers}.
 */
export interface OutlierResult {
  /** Top outlier users, ranked by `outlierScore` descending. */
  outliers: OutlierUser[];
  summary: {
    /** Number of users in `outliers`. */
    totalOutliers: number;
    /** Sum of `outlierEntitlements.length` across all returned users. */
    totalOutlierEntitlements: number;
    /** Number of distinct peer groups represented in `outliers`. */
    peerGroupsRepresented: number;
    /**
     * App label most frequently appearing as an outlier across the
     * returned users; `undefined` if no outlier nodes are app-typed.
     */
    mostCommonOutlierApp?: string;
  };
}

/**
 * Detect entitlement outliers in an access graph snapshot.
 *
 * @param snapshot - Access graph from {@link buildAccessGraph}
 * @param options - Tuning knobs (see {@link DetectOutliersOptions})
 * @returns Ranked outlier users + summary stats
 *
 * @example
 * ```typescript
 * const snapshot = await buildAccessGraph({ scopeType: 'all' });
 * const result = detectOutliers(snapshot, { outlierThreshold: 0.05 });
 * for (const user of result.outliers) {
 *   console.log(user.login, user.outlierScore, user.outlierEntitlements.length);
 * }
 * ```
 */
export function detectOutliers(
  snapshot: AccessGraphSnapshot,
  options: DetectOutliersOptions = {},
): OutlierResult {
  const peerGroupingStrategy =
    options.peerGroupingStrategy ?? DEFAULT_PEER_GROUPING_STRATEGY;
  const outlierThreshold = options.outlierThreshold ?? DEFAULT_OUTLIER_THRESHOLD;
  const minPeerGroupSize = options.minPeerGroupSize ?? DEFAULT_MIN_PEER_GROUP_SIZE;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const sensitivityWeights = options.sensitivityWeights ?? {};

  console.log('[OutlierDetector] Detecting outliers:', {
    userCount: snapshot.users.length,
    peerGroupingStrategy,
    outlierThreshold,
    minPeerGroupSize,
    maxResults,
  });

  const startedAt = Date.now();

  // 1. Compute peer groups under the requested strategy.
  const peerGroups = computePeerGroups(snapshot.users, peerGroupingStrategy, {
    minPeerGroupSize,
  });

  if (peerGroups.length === 0) {
    console.log(
      `[OutlierDetector] No peer groups large enough (minPeerGroupSize=${minPeerGroupSize}) — nothing to score`,
    );
    return {
      outliers: [],
      summary: {
        totalOutliers: 0,
        totalOutlierEntitlements: 0,
        peerGroupsRepresented: 0,
      },
    };
  }

  // 2. Index users by id once for lookups.
  const usersById = new Map<string, UserAccessProfile>();
  for (const u of snapshot.users) {
    usersById.set(u.userId, u);
  }

  // 3. Per peer group, pre-compute the count of holders for each access
  //    node key. We then derive peerCoverage for each (user, node) pair
  //    by subtracting the user's own contribution.
  const outlierUsers: OutlierUser[] = [];

  for (const peerGroup of peerGroups) {
    const memberCount = peerGroup.userIds.length;
    if (memberCount < minPeerGroupSize) continue;

    const holdersByKey = new Map<string, number>();
    for (const memberId of peerGroup.userIds) {
      const member = usersById.get(memberId);
      if (!member) continue;
      const seen = new Set<string>();
      for (const node of member.accessSet) {
        const key = nodeKey(node);
        if (seen.has(key)) continue;
        seen.add(key);
        holdersByKey.set(key, (holdersByKey.get(key) ?? 0) + 1);
      }
    }

    for (const memberId of peerGroup.userIds) {
      const member = usersById.get(memberId);
      if (!member) continue;

      const memberKeys = new Set<string>();
      for (const node of member.accessSet) {
        memberKeys.add(nodeKey(node));
      }

      const flagged: OutlierEntitlement[] = [];
      let score = 0;

      for (const node of member.accessSet) {
        const key = nodeKey(node);
        // Skip duplicates within the same user's accessSet.
        if (!memberKeys.has(key)) continue;
        memberKeys.delete(key);

        const totalHolders = holdersByKey.get(key) ?? 0;
        const peersWithAccess = Math.max(0, totalHolders - 1); // exclude self
        const peerDenominator = memberCount - 1;
        const peerCoverage = peerDenominator <= 0 ? 0 : peersWithAccess / peerDenominator;

        if (peerCoverage >= outlierThreshold) continue;

        const weight = resolveWeight(node, sensitivityWeights);
        const recommendation = recommendForCoverage(
          peerCoverage,
          memberCount - 1,
          outlierThreshold,
        );

        flagged.push({
          type: node.type,
          id: node.id,
          name: resolveNodeName(node, snapshot),
          peerCoverage,
          peersWithAccess,
          recommendation,
          weight,
        });

        score += (1 - peerCoverage) * weight;
      }

      if (flagged.length === 0) continue;

      // Stable sort: strongest recommendations first, then by lowest
      // peerCoverage (most anomalous).
      flagged.sort((a, b) => {
        const sevDelta = severityRank(b.recommendation) - severityRank(a.recommendation);
        if (sevDelta !== 0) return sevDelta;
        return a.peerCoverage - b.peerCoverage;
      });

      outlierUsers.push({
        userId: member.userId,
        login: member.login,
        displayName: member.displayName,
        department: member.department,
        title: member.title,
        peerGroupKey: peerGroup.key,
        peerGroupSize: memberCount,
        outlierScore: score,
        outlierEntitlements: flagged,
        overallRecommendation: pickStrongestRecommendation(flagged),
      });
    }
  }

  // 4. Rank by score and trim.
  outlierUsers.sort((a, b) => b.outlierScore - a.outlierScore);
  const top = outlierUsers.slice(0, maxResults);

  const summary = summarize(top, snapshot);

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[OutlierDetector] Complete in ${elapsedMs}ms — ` +
      `${top.length} outlier user(s) returned, ` +
      `${summary.totalOutlierEntitlements} flagged entitlement(s)`,
  );

  return {
    outliers: top,
    summary,
  };
}

/**
 * `${type}:${id}` access node key — matches the role-miner convention.
 */
function nodeKey(node: AccessNode): string {
  return `${node.type}:${node.id}`;
}

/**
 * Resolve a sensitivity weight for an access node. We accept lookups by
 * either the bare `id` or the composite `${type}:${id}` form.
 */
function resolveWeight(
  node: AccessNode,
  weights: Record<string, number>,
): number {
  const composite = nodeKey(node);
  const w = weights[composite] ?? weights[node.id];
  if (typeof w === 'number' && Number.isFinite(w) && w > 0) return w;
  return 1;
}

/**
 * Friendly name for an access node, preferring the snapshot's lookup
 * tables (which carry app `label`s, group names, etc.).
 */
function resolveNodeName(
  node: AccessNode,
  snapshot: AccessGraphSnapshot,
): string {
  if (node.type === 'group') {
    return snapshot.groupsById[node.id]?.name ?? node.name;
  }
  if (node.type === 'app') {
    const app = snapshot.appsById[node.id];
    return app?.label || app?.name || node.name;
  }
  return snapshot.entitlementsById[node.id]?.name ?? node.name;
}

/**
 * Map (peerCoverage, peerCount) into a recommendation severity.
 */
function recommendForCoverage(
  peerCoverage: number,
  peerCount: number,
  outlierThreshold: number,
): OutlierRecommendation {
  if (peerCoverage < 0.05 && peerCount > 5) return 'Likely revoke';
  if (peerCoverage < outlierThreshold) return 'Review';
  return 'Investigate';
}

/**
 * Numeric rank for sorting recommendations weak → strong.
 */
function severityRank(rec: OutlierRecommendation): number {
  switch (rec) {
    case 'Likely revoke':
      return 2;
    case 'Review':
      return 1;
    case 'Investigate':
      return 0;
  }
}

/**
 * Pick the strongest recommendation among the user's flagged entitlements.
 */
function pickStrongestRecommendation(
  entitlements: OutlierEntitlement[],
): OutlierRecommendation {
  let best: OutlierRecommendation = 'Investigate';
  for (const e of entitlements) {
    if (severityRank(e.recommendation) > severityRank(best)) {
      best = e.recommendation;
    }
  }
  return best;
}

/**
 * Build the top-level summary block.
 */
function summarize(
  outliers: OutlierUser[],
  snapshot: AccessGraphSnapshot,
): OutlierResult['summary'] {
  let totalOutlierEntitlements = 0;
  const peerGroupKeys = new Set<string>();
  const appCounts = new Map<string, number>();

  for (const user of outliers) {
    totalOutlierEntitlements += user.outlierEntitlements.length;
    peerGroupKeys.add(user.peerGroupKey);
    for (const e of user.outlierEntitlements) {
      const appLabel = appLabelForNode(e, snapshot);
      if (!appLabel) continue;
      appCounts.set(appLabel, (appCounts.get(appLabel) ?? 0) + 1);
    }
  }

  let mostCommonOutlierApp: string | undefined;
  let mostCommonCount = 0;
  for (const [label, count] of appCounts) {
    if (count > mostCommonCount) {
      mostCommonCount = count;
      mostCommonOutlierApp = label;
    }
  }

  return {
    totalOutliers: outliers.length,
    totalOutlierEntitlements,
    peerGroupsRepresented: peerGroupKeys.size,
    mostCommonOutlierApp,
  };
}

/**
 * Resolve the most useful "app label" for an outlier node, used only
 * for the summary's `mostCommonOutlierApp` tally.
 *
 * - `app` nodes: the app's own label.
 * - `entitlement` nodes: the parent app's label, if known.
 * - `group` nodes: no app association — returns undefined.
 */
function appLabelForNode(
  node: { type: AccessNode['type']; id: string },
  snapshot: AccessGraphSnapshot,
): string | undefined {
  if (node.type === 'app') {
    const app = snapshot.appsById[node.id];
    return app?.label || app?.name;
  }
  if (node.type === 'entitlement') {
    const ent = snapshot.entitlementsById[node.id];
    if (!ent) return undefined;
    const app = snapshot.appsById[ent.appId];
    return app?.label || app?.name;
  }
  return undefined;
}

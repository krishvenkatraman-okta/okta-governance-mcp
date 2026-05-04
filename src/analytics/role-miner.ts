/**
 * Role miner
 *
 * Discovers candidate roles by clustering users with similar access
 * patterns within an `AccessGraphSnapshot`. The output is a ranked list
 * of *proposals* — concrete group creation is a separate, explicit step.
 *
 * Algorithm overview:
 *   1. Convert each user's `accessSet` to a `Set<string>` of node keys
 *      (`${type}:${id}`).
 *   2. Compute pairwise Jaccard similarity for all user pairs.
 *   3. Run agglomerative hierarchical clustering with single-linkage
 *      (merge the two clusters whose closest members are most similar)
 *      until the next merge would fall below `similarityThreshold`.
 *   4. Drop clusters smaller than `minClusterSize`.
 *   5. For each surviving cluster, compute the "common access set" —
 *      access nodes held by ≥ `commonAccessThreshold` of cluster members.
 *   6. Score each cluster by intra-cluster cohesion + size; return the
 *      top `maxResults` ranked by confidence descending.
 */

import { jaccardSimilarity } from './jaccard.js';
import type {
  AccessGraphSnapshot,
  AccessNode,
  UserAccessProfile,
} from './types.js';

/**
 * Default minimum cluster size — clusters smaller than this are
 * dropped because they don't represent a meaningful "role".
 */
export const DEFAULT_MIN_CLUSTER_SIZE = 5;

/**
 * Default Jaccard similarity threshold for cluster merges.
 * Empirically tuned: 0.7 catches "obvious peers" without merging
 * loosely-related clusters.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.7;

/**
 * Default fraction of cluster members that must hold an access node
 * for it to be considered part of the cluster's "common access set".
 */
export const DEFAULT_COMMON_ACCESS_THRESHOLD = 0.8;

/**
 * Default cap on the number of candidate roles returned.
 */
export const DEFAULT_MAX_RESULTS = 10;

/**
 * Options for {@link mineRoles}.
 */
export interface MineRolesOptions {
  /** Minimum cluster size (default 5). */
  minClusterSize?: number;
  /** Jaccard similarity threshold for merges (default 0.7). */
  similarityThreshold?: number;
  /** Fraction of cluster members that must share an access node (default 0.8). */
  commonAccessThreshold?: number;
  /** Maximum number of candidate roles returned (default 10). */
  maxResults?: number;
}

/**
 * One member of a candidate role.
 */
export interface CandidateRoleMember {
  userId: string;
  login: string;
  department?: string;
  title?: string;
}

/**
 * One access node in a candidate role's "common access set".
 */
export interface CandidateRoleAccess {
  type: AccessNode['type'];
  id: string;
  name: string;
  /** Fraction of cluster members holding this access (0-1). */
  coverage: number;
}

/**
 * A single candidate role proposal.
 */
export interface CandidateRole {
  /** Human-readable name suggestion (e.g. "Engineering — Senior SWE (cluster of 12)"). */
  proposedName: string;
  /** Confidence score in [0, 1]. */
  confidence: number;
  /** Cluster cohesion (mean pairwise Jaccard similarity within the cluster). */
  cohesion: number;
  /** Number of users in the cluster. */
  memberCount: number;
  /** Cluster members. */
  members: CandidateRoleMember[];
  /** Access nodes held by ≥ `commonAccessThreshold` of cluster members. */
  commonAccess: CandidateRoleAccess[];
  /** Action recommendation derived from confidence. */
  suggestedAction: string;
  /** Plain-English rationale for this proposal. */
  rationale: string;
}

/**
 * Result of {@link mineRoles}.
 */
export interface MiningResult {
  /** Top candidate roles ranked by confidence descending. */
  candidateRoles: CandidateRole[];
  summary: {
    /** Number of roles with confidence ≥ 0.85. */
    highConfidenceCount: number;
    /** Total number of proposed roles in `candidateRoles`. */
    totalProposed: number;
    /**
     * Rough estimate of the number of redundant access assignments
     * that would be replaced if every proposed role became a group.
     * Equals the sum of `(memberCount - 1) * commonAccess.length`
     * across surviving clusters — i.e., the assignments that would
     * collapse into a single "user is in this role" link per member
     * after the first.
     */
    estimatedAccessReduction: number;
  };
}

/**
 * Mine candidate roles from a fully-built access graph snapshot.
 *
 * @param snapshot - Access graph from {@link buildAccessGraph}.
 * @param options - Tuning knobs (see {@link MineRolesOptions}).
 * @returns Ranked candidate roles + summary stats.
 *
 * @example
 * ```typescript
 * const snapshot = await buildAccessGraph({ scopeType: 'app', scopeId });
 * const result = mineRoles(snapshot, { similarityThreshold: 0.8 });
 * for (const role of result.candidateRoles) {
 *   console.log(role.proposedName, role.confidence);
 * }
 * ```
 */
export function mineRoles(
  snapshot: AccessGraphSnapshot,
  options: MineRolesOptions = {}
): MiningResult {
  const minClusterSize = options.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;
  const similarityThreshold =
    options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const commonAccessThreshold =
    options.commonAccessThreshold ?? DEFAULT_COMMON_ACCESS_THRESHOLD;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

  console.log('[RoleMiner] Mining candidate roles:', {
    userCount: snapshot.users.length,
    minClusterSize,
    similarityThreshold,
    commonAccessThreshold,
    maxResults,
  });

  if (snapshot.users.length < minClusterSize) {
    console.log(
      `[RoleMiner] Skipping clustering — only ${snapshot.users.length} user(s) in scope (< ${minClusterSize})`
    );
    return {
      candidateRoles: [],
      summary: {
        highConfidenceCount: 0,
        totalProposed: 0,
        estimatedAccessReduction: 0,
      },
    };
  }

  const startedAt = Date.now();

  // 1. Build per-user access key sets and a parallel index.
  const accessSets: Set<string>[] = snapshot.users.map((user) =>
    accessNodesToKeySet(user.accessSet)
  );

  // 2. Run agglomerative hierarchical clustering with single-linkage.
  const clusterIndices = clusterUsers(accessSets, similarityThreshold);
  console.log(
    `[RoleMiner] Produced ${clusterIndices.length} raw cluster(s) before size filter`
  );

  // 3. Filter clusters that are too small.
  const surviving = clusterIndices.filter(
    (indices) => indices.length >= minClusterSize
  );
  console.log(
    `[RoleMiner] ${surviving.length} cluster(s) survive minClusterSize=${minClusterSize}`
  );

  // 4. Build candidate roles (with cohesion, common access, naming, etc.).
  const candidates: CandidateRole[] = surviving.map((indices) =>
    buildCandidateRole(indices, snapshot.users, accessSets, snapshot, commonAccessThreshold)
  );

  // 5. Rank by confidence and trim to maxResults.
  candidates.sort((a, b) => b.confidence - a.confidence);
  const top = candidates.slice(0, maxResults);

  const highConfidenceCount = top.filter((c) => c.confidence >= 0.85).length;
  const estimatedAccessReduction = top.reduce(
    (acc, c) => acc + Math.max(0, c.memberCount - 1) * c.commonAccess.length,
    0
  );

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[RoleMiner] Mining complete in ${elapsedMs}ms — ` +
      `${top.length} candidate(s) returned, ${highConfidenceCount} high-confidence`
  );

  return {
    candidateRoles: top,
    summary: {
      highConfidenceCount,
      totalProposed: top.length,
      estimatedAccessReduction,
    },
  };
}

/**
 * Convert a user's access nodes to a `Set<string>` of `${type}:${id}` keys.
 */
function accessNodesToKeySet(nodes: AccessNode[]): Set<string> {
  const set = new Set<string>();
  for (const node of nodes) {
    set.add(`${node.type}:${node.id}`);
  }
  return set;
}

/**
 * Agglomerative hierarchical clustering with single-linkage similarity.
 *
 * Each user starts in its own cluster. We repeatedly merge the pair of
 * clusters whose closest members are most similar (single-linkage). The
 * algorithm halts when the best available merge similarity falls below
 * `similarityThreshold`, preserving the partition at that point.
 *
 * Returns the final partitioning as arrays of indices into `accessSets`.
 *
 * Complexity is O(n^3) which is fine at our user cap (≤ 500).
 */
function clusterUsers(
  accessSets: Set<string>[],
  similarityThreshold: number
): number[][] {
  const n = accessSets.length;
  let clusters: number[][] = Array.from({ length: n }, (_, i) => [i]);

  // Memoize pairwise user similarities to avoid recomputing.
  const userSim = new Map<string, number>();
  const simKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const getUserSim = (a: number, b: number): number => {
    const key = simKey(a, b);
    let v = userSim.get(key);
    if (v === undefined) {
      v = jaccardSimilarity(accessSets[a], accessSets[b]);
      userSim.set(key, v);
    }
    return v;
  };

  // Single-linkage similarity between two clusters = the max user-pair
  // similarity across the two members.
  const clusterSim = (a: number[], b: number[]): number => {
    let best = 0;
    for (const ua of a) {
      for (const ub of b) {
        const s = getUserSim(ua, ub);
        if (s > best) best = s;
      }
    }
    return best;
  };

  while (clusters.length > 1) {
    let bestI = -1;
    let bestJ = -1;
    let bestSim = -1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const s = clusterSim(clusters[i], clusters[j]);
        if (s > bestSim) {
          bestSim = s;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestSim < similarityThreshold || bestI < 0) break;

    // Merge bestJ into bestI (drop bestJ).
    const merged = clusters[bestI].concat(clusters[bestJ]);
    const next: number[][] = [];
    for (let k = 0; k < clusters.length; k++) {
      if (k === bestI) {
        next.push(merged);
      } else if (k !== bestJ) {
        next.push(clusters[k]);
      }
    }
    clusters = next;
  }

  return clusters;
}

/**
 * Build a {@link CandidateRole} from a cluster of user indices.
 */
function buildCandidateRole(
  indices: number[],
  users: UserAccessProfile[],
  accessSets: Set<string>[],
  snapshot: AccessGraphSnapshot,
  commonAccessThreshold: number
): CandidateRole {
  const memberCount = indices.length;

  // Cohesion = mean pairwise Jaccard similarity within the cluster.
  let cohesion = 1;
  if (memberCount > 1) {
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        sum += jaccardSimilarity(accessSets[indices[i]], accessSets[indices[j]]);
        pairs++;
      }
    }
    cohesion = pairs === 0 ? 1 : sum / pairs;
  }

  // Confidence = cohesion damped by cluster size (rewards clusters
  // approaching the "10+ user" comfort zone, capped at 1.0).
  const confidence = clamp01(cohesion * Math.min(1, memberCount / 10));

  // Tally access-node coverage across the cluster.
  const coverageByKey = new Map<
    string,
    { node: AccessNode; count: number }
  >();
  for (const idx of indices) {
    const seen = new Set<string>();
    for (const node of users[idx].accessSet) {
      const key = `${node.type}:${node.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = coverageByKey.get(key);
      if (entry) {
        entry.count++;
      } else {
        coverageByKey.set(key, { node, count: 1 });
      }
    }
  }

  const commonAccess: CandidateRoleAccess[] = [];
  for (const [, { node, count }] of coverageByKey) {
    const coverage = count / memberCount;
    if (coverage >= commonAccessThreshold) {
      commonAccess.push({
        type: node.type,
        id: node.id,
        name: resolveAccessName(node, snapshot),
        coverage,
      });
    }
  }
  // Most-shared access first.
  commonAccess.sort((a, b) => b.coverage - a.coverage);

  const members: CandidateRoleMember[] = indices.map((idx) => {
    const u = users[idx];
    return {
      userId: u.userId,
      login: u.login,
      department: u.department,
      title: u.title,
    };
  });

  const proposedName = deriveProposedName(members, memberCount);
  const suggestedAction = deriveSuggestedAction(confidence);
  const rationale = deriveRationale(
    memberCount,
    cohesion,
    commonAccess.length,
    confidence
  );

  return {
    proposedName,
    confidence,
    cohesion,
    memberCount,
    members,
    commonAccess,
    suggestedAction,
    rationale,
  };
}

/**
 * Resolve a friendly name for an access node, preferring the snapshot's
 * lookup tables (which carry app `label`s, group `name`s, etc.) and
 * falling back to whatever the node already carries.
 */
function resolveAccessName(
  node: AccessNode,
  snapshot: AccessGraphSnapshot
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
 * Pick the most common (department, title) pair to derive a name like
 * `"Engineering — Senior SWE (cluster of 12)"`. Falls back gracefully
 * if either attribute is missing across the cluster.
 */
function deriveProposedName(
  members: CandidateRoleMember[],
  memberCount: number
): string {
  const deptCounts = new Map<string, number>();
  const titleCounts = new Map<string, number>();

  for (const m of members) {
    if (m.department) {
      deptCounts.set(m.department, (deptCounts.get(m.department) ?? 0) + 1);
    }
    if (m.title) {
      titleCounts.set(m.title, (titleCounts.get(m.title) ?? 0) + 1);
    }
  }

  const topDept = pickTopKey(deptCounts);
  const topTitle = pickTopKey(titleCounts);

  if (topDept && topTitle) {
    return `${topDept} — ${topTitle} (cluster of ${memberCount})`;
  }
  if (topDept) {
    return `${topDept} (cluster of ${memberCount})`;
  }
  if (topTitle) {
    return `${topTitle} (cluster of ${memberCount})`;
  }
  return `Candidate role (cluster of ${memberCount})`;
}

/**
 * Pick the most-frequent key from a tally map; returns `undefined` if
 * the map is empty.
 */
function pickTopKey(counts: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [k, v] of counts) {
    if (v > bestCount) {
      best = k;
      bestCount = v;
    }
  }
  return best;
}

/**
 * Map confidence to an action recommendation.
 */
function deriveSuggestedAction(confidence: number): string {
  if (confidence >= 0.85) return 'Create as Group';
  if (confidence >= 0.6) return 'Review — moderate cohesion';
  return 'Refine — low cohesion';
}

/**
 * One- or two-sentence plain-English explanation of the cluster.
 */
function deriveRationale(
  memberCount: number,
  cohesion: number,
  commonAccessCount: number,
  confidence: number
): string {
  const cohesionPct = Math.round(cohesion * 100);
  const confidencePct = Math.round(confidence * 100);

  if (commonAccessCount === 0) {
    return (
      `Clustered ${memberCount} users with ${cohesionPct}% mean pairwise similarity, ` +
      `but no individual access item is shared by enough members to anchor a role at the current threshold ` +
      `(confidence ${confidencePct}%).`
    );
  }

  return (
    `Clustered ${memberCount} users sharing ${commonAccessCount} common access item${
      commonAccessCount === 1 ? '' : 's'
    } at ${cohesionPct}% mean pairwise similarity, ` +
    `yielding confidence ${confidencePct}%.`
  );
}

/**
 * Clamp a number to the [0, 1] interval.
 */
function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

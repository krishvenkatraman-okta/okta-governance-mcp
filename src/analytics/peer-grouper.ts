/**
 * Peer grouping
 *
 * Buckets users into peer groups by an attribute strategy
 * (department + title, department alone, or shared manager).
 * Outlier detection compares each user's access against their bucket.
 */

import type { PeerGroup, UserAccessProfile } from './types.js';

/**
 * Available peer-grouping strategies.
 */
export type PeerGroupingStrategy = 'department_title' | 'department' | 'manager';

/**
 * Default minimum cluster size — buckets smaller than this are dropped
 * because they don't yield statistically meaningful peer comparisons.
 */
export const DEFAULT_MIN_PEER_GROUP_SIZE = 5;

/**
 * Options for computePeerGroups.
 */
export interface ComputePeerGroupsOptions {
  /**
   * Drop peer groups with fewer than this many members
   * (default: 5).
   */
  minPeerGroupSize?: number;
}

/**
 * Compute peer groups from a list of user profiles.
 *
 * Users without the attributes required by the strategy (e.g. a user
 * with no department under the `department_title` strategy) are
 * excluded from all peer groups.
 *
 * @param users - Profiles to bucket
 * @param strategy - Bucketing key derivation
 * @param options - Filter knobs
 * @returns Peer groups large enough to be useful
 *
 * @example
 * ```typescript
 * const groups = computePeerGroups(snapshot.users, 'department_title');
 * ```
 */
export function computePeerGroups(
  users: UserAccessProfile[],
  strategy: PeerGroupingStrategy,
  options: ComputePeerGroupsOptions = {}
): PeerGroup[] {
  const minSize = options.minPeerGroupSize ?? DEFAULT_MIN_PEER_GROUP_SIZE;

  console.debug('[PeerGrouper] Computing peer groups:', {
    strategy,
    userCount: users.length,
    minSize,
  });

  const buckets = new Map<string, string[]>();

  for (const user of users) {
    const key = derivePeerKey(user, strategy);
    if (key === null) continue;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(user.userId);
  }

  const peerGroups: PeerGroup[] = [];
  for (const [key, userIds] of buckets) {
    if (userIds.length >= minSize) {
      peerGroups.push({ strategy, key, userIds });
    }
  }

  console.debug(
    `[PeerGrouper] Produced ${peerGroups.length} peer group(s) (filtered from ${buckets.size} raw bucket(s))`
  );

  return peerGroups;
}

/**
 * Find the peer group containing a specific user.
 *
 * If the user appears in multiple groups (shouldn't happen with the
 * current strategies, but defensive against future strategies), returns
 * the first match.
 *
 * @param userId - User to look up
 * @param groups - Output of computePeerGroups
 * @returns Matching peer group, or undefined if the user isn't in any
 */
export function findPeerGroup(
  userId: string,
  groups: PeerGroup[]
): PeerGroup | undefined {
  for (const group of groups) {
    if (group.userIds.includes(userId)) {
      return group;
    }
  }
  return undefined;
}

/**
 * Derive the bucket key for a user under a given strategy.
 *
 * Returns `null` when required attributes are missing — those users are
 * excluded from peer analysis.
 */
function derivePeerKey(
  user: UserAccessProfile,
  strategy: PeerGroupingStrategy
): string | null {
  switch (strategy) {
    case 'department_title': {
      if (!user.department || !user.title) return null;
      return `${user.department}|${user.title}`;
    }
    case 'department': {
      if (!user.department) return null;
      return user.department;
    }
    case 'manager': {
      if (!user.managerId) return null;
      return user.managerId;
    }
    default: {
      const _exhaustive: never = strategy;
      throw new Error(`Unknown peer-grouping strategy: ${_exhaustive}`);
    }
  }
}

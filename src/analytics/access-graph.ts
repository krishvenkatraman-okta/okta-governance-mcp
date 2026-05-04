/**
 * Access graph builder
 *
 * Materializes a point-in-time `AccessGraphSnapshot` for a given scope
 * (single app, single group, department, or org-wide). The snapshot is
 * the shared input to every advanced analytics module — role mining,
 * outlier detection, access explainability, and smart campaigns.
 *
 * Building the snapshot is intentionally bounded:
 *   - User set is capped at `MAX_USERS` (a warning is logged on overflow).
 *   - Per-user fan-out (groups + apps) runs in batches of `BATCH_SIZE`
 *     to limit Okta API concurrency.
 *
 * Entitlements are NOT yet attached — Prompt 4 wires that up. Until then,
 * the `entitlementsById` map is empty and `accessSet` only contains
 * `group:` and `app:` nodes.
 */

import { appsClient } from '../okta/apps-client.js';
import { groupsClient } from '../okta/groups-client.js';
import { usersClient } from '../okta/users-client.js';
import type { OktaApp, OktaGroup, OktaUser } from '../types/index.js';
import type {
  AccessGraphApp,
  AccessGraphGroup,
  AccessGraphSnapshot,
  AccessNode,
  UserAccessProfile,
} from './types.js';

/**
 * Hard cap on users included in a single access graph build.
 *
 * The graph is intended for analyst-driven scopes (one app, one
 * department, etc.). If the scope resolves to more than this many users,
 * we still build a graph for the first slice and emit a warning so the
 * caller knows results are partial.
 */
const MAX_USERS = 500;

/**
 * Number of per-user fetches (groups + apps) issued in parallel.
 *
 * Tuned low to avoid tripping Okta's per-org rate limits on the
 * `okta.users.read` / `okta.apps.read` scopes.
 */
const BATCH_SIZE = 5;

/**
 * Options for buildAccessGraph.
 */
export interface BuildAccessGraphOptions {
  scopeType: 'app' | 'group' | 'department' | 'all';

  /**
   * Required for `app` (app id), `group` (group id), and `department`
   * (department name). Ignored for `all`.
   */
  scopeId?: string;
}

/**
 * Build a snapshot of users + their access for the requested scope.
 *
 * @param options - Scope selector
 * @returns Fully materialized snapshot
 *
 * @example
 * ```typescript
 * const snapshot = await buildAccessGraph({ scopeType: 'app', scopeId: '0oa...' });
 * console.log(snapshot.users.length, 'users in scope');
 * ```
 */
export async function buildAccessGraph(
  options: BuildAccessGraphOptions
): Promise<AccessGraphSnapshot> {
  const { scopeType, scopeId } = options;

  console.log('[AccessGraph] Building snapshot:', { scopeType, scopeId });

  if ((scopeType === 'app' || scopeType === 'group' || scopeType === 'department') && !scopeId) {
    throw new Error(`scopeId is required when scopeType is "${scopeType}"`);
  }

  const startedAt = Date.now();

  // 1. Resolve the user set in scope.
  const inScopeUsers = await resolveScopeUsers(scopeType, scopeId);
  console.log(`[AccessGraph] Resolved ${inScopeUsers.length} user(s) in scope`);

  // 2. Cap at MAX_USERS to keep build time bounded.
  let users = inScopeUsers;
  if (users.length > MAX_USERS) {
    console.warn(
      `[AccessGraph] Scope contains ${users.length} users; capping at ${MAX_USERS}. ` +
        `Results will be partial — narrow the scope for full coverage.`
    );
    users = users.slice(0, MAX_USERS);
  }

  // 3. Fan out group + app fetches per user, in batches.
  const groupsById = new Map<string, AccessGraphGroup>();
  const appsById = new Map<string, AccessGraphApp>();
  const profiles: UserAccessProfile[] = [];

  let processed = 0;
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    const batchProfiles = await Promise.all(
      batch.map((user) => buildUserProfile(user, groupsById, appsById))
    );

    profiles.push(...batchProfiles);
    processed += batch.length;

    if (processed % 25 === 0 || processed === users.length) {
      console.log(`[AccessGraph] Progress: ${processed}/${users.length} users processed`);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[AccessGraph] Built snapshot in ${elapsedMs}ms — ` +
      `${profiles.length} users, ${groupsById.size} groups, ${appsById.size} apps`
  );

  return {
    users: profiles,
    groupsById: Object.fromEntries(groupsById),
    appsById: Object.fromEntries(appsById),
    entitlementsById: {},
    scopeDescription: describeScope(scopeType, scopeId),
    builtAt: new Date().toISOString(),
  };
}

/**
 * Resolve the user set for a scope.
 *
 * Implementation notes (verified against current clients):
 *   - 'app': uses `appsClient.listAppUsers` (added for analytics).
 *   - 'group': uses the existing `groupsClient.listMembers`.
 *   - 'department': uses `usersClient.listWithFilter` with a
 *      `profile.department eq "..."` filter.
 *   - 'all': uses `usersClient.listWithFilter('status eq "ACTIVE"')`.
 */
async function resolveScopeUsers(
  scopeType: BuildAccessGraphOptions['scopeType'],
  scopeId?: string
): Promise<OktaUser[]> {
  switch (scopeType) {
    case 'app':
      return appsClient.listAppUsers(scopeId!);
    case 'group':
      // groupsClient.listMembers already returns OktaUser[] from shared types.
      return groupsClient.listMembers(scopeId!);
    case 'department': {
      // listWithFilter returns the users-client's local OktaUser shape.
      // It's structurally compatible at runtime, but the shared OktaUser
      // declares an `[key: string]: unknown` index signature that the
      // local type doesn't, so cast through `unknown`.
      const filter = `profile.department eq "${escapeFilterValue(scopeId!)}"`;
      return (await usersClient.listWithFilter(filter)) as unknown as OktaUser[];
    }
    case 'all':
      return (await usersClient.listWithFilter('status eq "ACTIVE"')) as unknown as OktaUser[];
    default: {
      const _exhaustive: never = scopeType;
      throw new Error(`Unknown scopeType: ${_exhaustive}`);
    }
  }
}

/**
 * Escape a value for inclusion inside an Okta SCIM filter string literal.
 *
 * Okta accepts the standard SCIM rule of doubling embedded double quotes,
 * but in practice we just defensively strip them — department names with
 * literal quotes are extremely uncommon and the alternative is a
 * filter-injection footgun.
 */
function escapeFilterValue(value: string): string {
  return value.replace(/"/g, '');
}

/**
 * Build the access profile for one user (groups + assigned apps).
 *
 * Mutates the shared `groupsById` / `appsById` lookup maps with anything
 * newly seen so the caller doesn't need to do a second pass.
 */
async function buildUserProfile(
  user: OktaUser,
  groupsById: Map<string, AccessGraphGroup>,
  appsById: Map<string, AccessGraphApp>
): Promise<UserAccessProfile> {
  // Profile fields are loosely typed — Okta does not commit to which
  // attributes are present. Read defensively.
  const profile = (user.profile ?? {}) as Record<string, unknown>;
  const firstName = typeof profile.firstName === 'string' ? profile.firstName : '';
  const lastName = typeof profile.lastName === 'string' ? profile.lastName : '';
  const displayName = `${firstName} ${lastName}`.trim() || (profile.login as string) || user.id;
  const department = typeof profile.department === 'string' ? profile.department : undefined;
  const title = typeof profile.title === 'string' ? profile.title : undefined;
  const managerId = typeof profile.managerId === 'string' ? profile.managerId : undefined;

  const accessSet: AccessNode[] = [];

  // Fetch groups + apps in parallel for this user.
  const [groups, apps] = await Promise.all([
    safeListGroups(user.id),
    safeListUserApps(user.id),
  ]);

  for (const group of groups) {
    const id = group.id;
    const name = group.profile?.name ?? id;
    if (!groupsById.has(id)) {
      groupsById.set(id, { id, name, type: group.type });
    }
    accessSet.push({ type: 'group', id, name });
  }

  for (const app of apps) {
    const id = app.id;
    if (!appsById.has(id)) {
      appsById.set(id, { id, name: app.name, label: app.label });
    }
    accessSet.push({ type: 'app', id, name: app.label || app.name });
  }

  // TODO(prompt-4): attach entitlement nodes here once the governance
  // entitlements client exposes a per-user listing. Until then, the
  // accessSet contains only group + app nodes.

  return {
    userId: user.id,
    login: (profile.login as string) ?? user.id,
    displayName,
    department,
    title,
    managerId,
    accessSet,
  };
}

/**
 * Lookup a user's groups, swallowing errors so one bad user doesn't
 * break the whole graph build.
 */
async function safeListGroups(userId: string): Promise<OktaGroup[]> {
  try {
    return await usersClient.listGroups(userId);
  } catch (error) {
    console.warn('[AccessGraph] Failed to list groups for user — continuing without:', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Lookup a user's assigned apps, with the same fail-open semantics.
 */
async function safeListUserApps(userId: string): Promise<OktaApp[]> {
  try {
    return await appsClient.listUserApps(userId);
  } catch (error) {
    console.warn('[AccessGraph] Failed to list apps for user — continuing without:', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Human-readable scope label for telemetry / UI.
 */
function describeScope(
  scopeType: BuildAccessGraphOptions['scopeType'],
  scopeId?: string
): string {
  switch (scopeType) {
    case 'app':
      return `app:${scopeId}`;
    case 'group':
      return `group:${scopeId}`;
    case 'department':
      return `department:${scopeId}`;
    case 'all':
      return 'org-wide (active users)';
  }
}

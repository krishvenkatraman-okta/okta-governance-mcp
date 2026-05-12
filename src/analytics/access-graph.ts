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
 * Entitlements are attached for any app whose `settings.emOptInStatus`
 * is `'ENABLED'`. The per-app entitlement bundle list is memoized
 * (the same list applies to every user assigned to that app), so each
 * app is hit at most once per build.
 */

import { appsClient } from '../okta/apps-client.js';
import { governanceClient } from '../okta/governance-client.js';
import { groupsClient } from '../okta/groups-client.js';
import { usersClient } from '../okta/users-client.js';
import type { OktaApp, OktaGroup, OktaUser } from '../types/index.js';
import type {
  AccessGraphApp,
  AccessGraphEntitlement,
  AccessGraphGroup,
  AccessGraphSnapshot,
  AccessNode,
  UserAccessProfile,
} from './types.js';

/**
 * OAuth scope used for the Governance Grants API call.
 */
const ENTITLEMENT_READ_SCOPE = 'okta.governance.entitlements.read';

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
  const entitlementsById = new Map<string, AccessGraphEntitlement>();

  // Per-app caches: avoids re-hitting Okta for the same app across users.
  const appDetailsCache = new Map<string, OktaApp | null>();
  const appEmEnabledCache = new Map<string, boolean>();

  const profiles: UserAccessProfile[] = [];

  let processed = 0;
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    const batchProfiles = await Promise.all(
      batch.map((user) =>
        buildUserProfile(user, groupsById, appsById, entitlementsById, {
          appDetailsCache,
          appEmEnabledCache,
        })
      )
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
      `${profiles.length} users, ${groupsById.size} groups, ` +
      `${appsById.size} apps, ${entitlementsById.size} entitlement(s)`
  );

  return {
    users: profiles,
    groupsById: Object.fromEntries(groupsById),
    appsById: Object.fromEntries(appsById),
    entitlementsById: Object.fromEntries(entitlementsById),
    scopeDescription: describeScope(scopeType, scopeId),
    builtAt: new Date().toISOString(),
  };
}

/**
 * Per-build caches for app-level metadata used by the entitlement fan-out.
 *
 * `appDetailsCache` memoizes the full `getById` payload (or `null` if the
 * lookup failed) so we don't refetch it once per assigned user.
 *
 * `appEmEnabledCache` memoizes the boolean derived from
 * `settings.emOptInStatus === 'ENABLED'` for the same reason — this is
 * the gate we use to decide whether to fan out to the Grants API at all.
 */
interface AppEntitlementCaches {
  appDetailsCache: Map<string, OktaApp | null>;
  appEmEnabledCache: Map<string, boolean>;
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
    case 'app': {
      // /apps/{id}/users returns AppUser objects whose `profile` is the
      // app-scoped profile (e.g. role/region for that app), not the user's
      // global profile. Peer-grouping reads global fields like department
      // and title, so we expand each AppUser to its full Okta user.
      const appUsers = await appsClient.listAppUsers(scopeId!);
      const expanded = await Promise.all(
        appUsers.map((u) => usersClient.getUserById(u.id)),
      );
      return expanded.filter((u) => u !== null) as unknown as OktaUser[];
    }
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
 * Build the access profile for one user (groups + assigned apps +
 * entitlement grants on governance-enabled apps).
 *
 * Mutates the shared `groupsById` / `appsById` / `entitlementsById`
 * lookup maps with anything newly seen so the caller doesn't need to do
 * a second pass.
 */
async function buildUserProfile(
  user: OktaUser,
  groupsById: Map<string, AccessGraphGroup>,
  appsById: Map<string, AccessGraphApp>,
  entitlementsById: Map<string, AccessGraphEntitlement>,
  caches: AppEntitlementCaches,
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

  // Fan out to the Governance Grants API for any assigned app that has
  // entitlement management enabled. The per-app `emOptInStatus` and the
  // entitlement bundle list are looked up once per build via the caches.
  for (const app of apps) {
    const isEmEnabled = await isEntitlementManagementEnabled(app, caches);
    if (!isEmEnabled) continue;

    const grants = await safeListUserGrants(user.id, app.id);
    for (const node of grantsToAccessNodes(grants)) {
      const key = node.id;
      if (!entitlementsById.has(key)) {
        entitlementsById.set(key, {
          id: node.id,
          name: node.name,
          appId: app.id,
        });
      }
      accessSet.push(node);
    }
  }

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
 * Resolve whether an app has entitlement management opted in.
 *
 * The list endpoint that returns user-assigned apps does not always
 * include `settings.emOptInStatus`, so we round-trip through `getById`
 * (cached) when the field isn't present on the assigned-app payload.
 */
async function isEntitlementManagementEnabled(
  app: OktaApp,
  caches: AppEntitlementCaches,
): Promise<boolean> {
  const cached = caches.appEmEnabledCache.get(app.id);
  if (cached !== undefined) return cached;

  // Fast path: the assigned-app payload may already carry settings.
  const inlineEmStatus = (app as any).settings?.emOptInStatus;
  if (typeof inlineEmStatus === 'string') {
    const enabled = inlineEmStatus === 'ENABLED';
    caches.appEmEnabledCache.set(app.id, enabled);
    return enabled;
  }

  // Slow path: getById, then memoize.
  let details = caches.appDetailsCache.get(app.id);
  if (details === undefined) {
    try {
      details = await appsClient.getById(app.id);
    } catch (error) {
      console.warn(
        '[AccessGraph] Failed to fetch app details — assuming no entitlement management:',
        {
          appId: app.id,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      details = null;
    }
    caches.appDetailsCache.set(app.id, details);
  }

  const emStatus = (details as any)?.settings?.emOptInStatus;
  const enabled = emStatus === 'ENABLED';
  caches.appEmEnabledCache.set(app.id, enabled);
  return enabled;
}

/**
 * Fetch a user's entitlement grants on a specific app, returning `[]`
 * (with a warning) on any error so the rest of the pipeline keeps going.
 */
async function safeListUserGrants(userId: string, appId: string): Promise<any[]> {
  try {
    return await governanceClient.entitlements.listForUser(
      userId,
      appId,
      ENTITLEMENT_READ_SCOPE,
    );
  } catch (error) {
    console.warn('[AccessGraph] Failed to list entitlement grants — continuing without:', {
      userId,
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Project a list of grant objects (Governance API "List all grants"
 * payloads) into the access-graph entitlement node shape.
 *
 * Grant payloads come in a few flavors. We surface entitlement-value
 * granularity when `include=full_entitlements` expanded the response;
 * otherwise we fall back to the entitlement-bundle id. Either way the
 * resulting nodes get `type: 'entitlement'`.
 */
function grantsToAccessNodes(grants: any[]): AccessNode[] {
  const out: AccessNode[] = [];
  const seen = new Set<string>();

  for (const grant of grants) {
    if (!grant || typeof grant !== 'object') continue;
    if (grant.status && grant.status !== 'ACTIVE') continue;

    // Preferred: the expanded `entitlements` array carries id/name pairs.
    const expanded = Array.isArray(grant.entitlements) ? grant.entitlements : [];
    for (const ent of expanded) {
      if (!ent?.id) continue;
      const id = String(ent.id);
      if (!seen.has(id)) {
        seen.add(id);
        out.push({
          type: 'entitlement',
          id,
          name: typeof ent.name === 'string' && ent.name ? ent.name : id,
        });
      }

      const values = Array.isArray(ent.values) ? ent.values : [];
      for (const v of values) {
        if (!v?.id) continue;
        const vid = String(v.id);
        if (seen.has(vid)) continue;
        seen.add(vid);
        out.push({
          type: 'entitlement',
          id: vid,
          name: typeof v.name === 'string' && v.name
            ? `${ent.name ?? 'entitlement'} = ${v.name}`
            : vid,
        });
      }
    }

    // Fallback: at minimum surface the bundle id as one entitlement node
    // so users with bundle-only grants still contribute to similarity /
    // peer-coverage math.
    if (expanded.length === 0 && typeof grant.entitlementBundleId === 'string') {
      const id = `bundle:${grant.entitlementBundleId}`;
      if (!seen.has(id)) {
        seen.add(id);
        out.push({
          type: 'entitlement',
          id,
          name: `Entitlement bundle ${grant.entitlementBundleId}`,
        });
      }
    }
  }

  return out;
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

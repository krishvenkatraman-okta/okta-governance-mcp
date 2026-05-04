/**
 * Access explainer
 *
 * Traces in plain English how a single user came to hold access to a
 * specific target (app, group, or entitlement). The result is a list of
 * `paths`, each with structured node hops AND a natural-language
 * narrative — the narratives are what make the tool feel "magical" in
 * the demo.
 *
 * Today we walk three kinds of paths:
 *   - **direct**: the user is directly assigned to the target.
 *   - **group_membership**: the user is in a group, and that group is
 *     assigned to / contains the target.
 *   - **group_rule** (best effort): one of the user's groups is the
 *     target of a group rule whose expression mentions a profile
 *     attribute the user has.
 *
 * Role-assignment paths are stubbed as a Phase-2 follow-up (the rest of
 * the analytics pipeline does not need them today).
 *
 * The shortest path is marked `isPrimary: true`; the others are
 * "redundant" — useful for the cleanup motion ("this access is granted
 * three ways; consolidate to one").
 *
 * @example
 * ```typescript
 * const result = await explainAccess({
 *   userId: 'sarah@example.com',
 *   targetType: 'app',
 *   targetId: '0oa1abc...',
 * });
 * // result.summary.explanation === "Sarah has access to Salesforce
 * //   through the 'Sales Admins' group, which she joined on 2024-03-15."
 * ```
 */

import { appsClient } from '../okta/apps-client.js';
import { governanceClient } from '../okta/governance-client.js';
import { groupsClient, type OktaGroupRule } from '../okta/groups-client.js';
import { systemLogClient } from '../okta/systemlog-client.js';
import { usersClient } from '../okta/users-client.js';
import type { OktaApp, OktaGroup, OktaUser } from '../types/index.js';

/**
 * OAuth scope used for the Governance Grants API call when reading
 * entitlement grants for the user-on-app pair we're explaining.
 */
const ENTITLEMENT_READ_SCOPE = 'okta.governance.entitlements.read';

/**
 * Input to `explainAccess`.
 */
export interface ExplainAccessInput {
  /**
   * User ID or login. Resolved via `usersClient.getByIdOrLogin`.
   */
  userId: string;

  /**
   * What kind of target the caller is asking about.
   */
  targetType: 'app' | 'entitlement' | 'group';

  /**
   * Target identifier:
   *   - `app`: app ID
   *   - `group`: group ID
   *   - `entitlement`: entitlement ID; the caller MUST also provide
   *     `entitlementAppId` so we know which app to read grants on.
   */
  targetId: string;

  /**
   * Required when `targetType === 'entitlement'`. The Okta Governance
   * Grants API is keyed by (user, app), so explaining an entitlement
   * needs the parent app's ID.
   */
  entitlementAppId?: string;

  /**
   * Whether to include redundant (non-shortest) paths. Default true.
   */
  includeRedundantPaths?: boolean;
}

/**
 * One step in an access path. Mirrors the spec addendum (A.4.3) shape.
 */
export interface ExplanationNode {
  nodeType: 'user' | 'group' | 'rule' | 'role' | 'app' | 'entitlement';
  id: string;
  name: string;
  grantedDate?: string;
  grantedBy?: string;
  ruleExpression?: string;
}

/**
 * One end-to-end path explaining an access grant.
 */
export interface ExplanationPath {
  pathType: 'direct' | 'group_membership' | 'group_rule' | 'role_assignment';
  isPrimary: boolean;
  nodes: ExplanationNode[];
  narrative: string;
}

/**
 * Final result returned by `explainAccess`.
 */
export interface ExplanationResult {
  user: {
    id: string;
    login: string;
    displayName: string;
    department?: string;
    title?: string;
  };
  target: {
    type: 'app' | 'entitlement' | 'group';
    id: string;
    name: string;
  };
  hasAccess: boolean;
  paths: ExplanationPath[];
  summary: {
    totalPaths: number;
    redundantPathCount: number;
    earliestGrant?: string;
    explanation: string;
  };
}

/**
 * Trace the access paths from `input.userId` to `input.targetId`.
 *
 * @param input - Lookup parameters
 * @returns Structured paths + a plain-English narrative
 *
 * @example
 * ```typescript
 * const r = await explainAccess({
 *   userId: '00u1abc...',
 *   targetType: 'group',
 *   targetId: '00g2def...',
 * });
 * console.log(r.summary.explanation);
 * ```
 */
export async function explainAccess(
  input: ExplainAccessInput
): Promise<ExplanationResult> {
  const includeRedundant = input.includeRedundantPaths ?? true;

  console.log('[AccessExplainer] Explaining access:', {
    userId: input.userId,
    targetType: input.targetType,
    targetId: input.targetId,
  });

  // 1. Resolve the user (ID or login). The users-client declares its
  // own narrower `OktaUser` shape that's missing the shared type's
  // string index signature; cast through `unknown` so the helpers
  // below (typed against the shared `OktaUser`) accept it.
  const user = (await usersClient.getByIdOrLogin(input.userId)) as unknown as OktaUser;
  const userProfile = user.profile as Record<string, unknown>;
  const firstName = typeof userProfile.firstName === 'string' ? userProfile.firstName : '';
  const lastName = typeof userProfile.lastName === 'string' ? userProfile.lastName : '';
  const displayName = `${firstName} ${lastName}`.trim() || user.profile.login;
  const department = typeof userProfile.department === 'string' ? userProfile.department : undefined;
  const title = typeof userProfile.title === 'string' ? userProfile.title : undefined;

  // 2. Resolve the target (name + existence check).
  const target = await resolveTarget(input);

  // 3. Discover paths.
  const rawPaths: ExplanationPath[] = [];

  if (input.targetType === 'app') {
    rawPaths.push(...(await findAppPaths(user, target.id)));
  } else if (input.targetType === 'group') {
    rawPaths.push(...(await findGroupPaths(user, target.id)));
  } else {
    rawPaths.push(
      ...(await findEntitlementPaths(user, target.id, input.entitlementAppId))
    );
  }

  // 4. Mark shortest path as primary; optionally drop redundants.
  const allPaths = markPrimaryPath(rawPaths);
  const paths = includeRedundant
    ? allPaths
    : allPaths.filter((p) => p.isPrimary);

  // 5. Build summary.
  const earliestGrant = paths
    .flatMap((p) => p.nodes.map((n) => n.grantedDate))
    .filter((d): d is string => !!d)
    .sort()[0];

  const hasAccess = allPaths.length > 0;
  const summaryExplanation = buildSummaryExplanation({
    displayName,
    target,
    paths,
    hasAccess,
  });

  console.log(
    `[AccessExplainer] Found ${allPaths.length} path(s) — primary: ${paths.find((p) => p.isPrimary)?.pathType ?? 'none'}`
  );

  return {
    user: {
      id: user.id,
      login: user.profile.login,
      displayName,
      department,
      title,
    },
    target,
    hasAccess,
    paths,
    summary: {
      totalPaths: allPaths.length,
      redundantPathCount: Math.max(0, allPaths.length - 1),
      earliestGrant,
      explanation: summaryExplanation,
    },
  };
}

/**
 * Resolve the human-readable name of the target. Throws if the target
 * does not exist (a request to explain a deleted resource is a bug, not
 * silent zero results).
 */
async function resolveTarget(
  input: ExplainAccessInput
): Promise<ExplanationResult['target']> {
  if (input.targetType === 'app') {
    const app = await appsClient.getById(input.targetId);
    return { type: 'app', id: app.id, name: app.label || app.name };
  }
  if (input.targetType === 'group') {
    const group = await groupsClient.getById(input.targetId);
    return { type: 'group', id: group.id, name: group.profile?.name ?? group.id };
  }
  // entitlement: we don't have a direct getById endpoint, so pull the
  // entitlement metadata out of the grants list for the parent app
  // (if the user has it). Fall back to the bare ID as the name.
  return {
    type: 'entitlement',
    id: input.targetId,
    name: input.targetId,
  };
}

/**
 * Discover all paths from `user` to `appId`.
 *
 * - direct: `appsClient.listUserApps(user.id)` includes `appId`
 * - group_membership: any of the user's groups is assigned to `appId`
 * - group_rule: any of those groups was assigned to the user via a
 *   group rule (best effort)
 */
async function findAppPaths(user: OktaUser, appId: string): Promise<ExplanationPath[]> {
  const paths: ExplanationPath[] = [];

  // Direct assignment via /users/{id}/appLinks (backed by listUserApps).
  const userApps = await safe(() => appsClient.listUserApps(user.id), [] as OktaApp[]);
  const directApp = userApps.find((a) => a.id === appId);

  // Pre-fetch user groups once — used by group_membership and group_rule passes.
  const userGroups = await safe(() => usersClient.listGroups(user.id), [] as OktaGroup[]);

  // For group_membership, find any group assigned to the app that the user is in.
  // The cheapest direction is per-user-group: list each group's assigned apps.
  const matchingGroups: OktaGroup[] = [];
  for (const group of userGroups) {
    try {
      const groupApps = await groupsClient.listAssignedApps(group.id);
      if (groupApps.some((ga) => ga.id === appId)) {
        matchingGroups.push(group);
      }
    } catch (error) {
      console.warn('[AccessExplainer] Failed to list apps for group — skipping:', {
        groupId: group.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // If a group-mediated path exists, the direct-assignment "path" likely
  // duplicates it. Okta surfaces both a per-user appLink and the group
  // assignment via the same /appLinks list. We still report the direct
  // path only when there's no group path, to avoid double-counting.
  if (directApp && matchingGroups.length === 0) {
    const directGrant = await fetchAppAssignmentEvent(user.id, appId);
    paths.push({
      pathType: 'direct',
      isPrimary: false,
      nodes: [
        userNode(user),
        {
          nodeType: 'app',
          id: appId,
          name: directApp.label || directApp.name,
          grantedDate: directGrant?.published,
          grantedBy: directGrant?.actorDisplayName,
        },
      ],
      narrative: directNarrative({
        userDisplayName: displayNameOf(user),
        targetName: directApp.label || directApp.name,
        targetType: 'app',
        grantedDate: directGrant?.published,
        grantedBy: directGrant?.actorDisplayName,
      }),
    });
  }

  for (const group of matchingGroups) {
    const groupName = group.profile?.name ?? group.id;
    const membershipGrant = await fetchGroupMembershipEvent(user.id, group.id);
    const appAssignmentGrant = await fetchAppToGroupAssignmentEvent(group.id, appId);

    paths.push({
      pathType: 'group_membership',
      isPrimary: false,
      nodes: [
        userNode(user),
        {
          nodeType: 'group',
          id: group.id,
          name: groupName,
          grantedDate: membershipGrant?.published,
          grantedBy: membershipGrant?.actorDisplayName,
        },
        {
          nodeType: 'app',
          id: appId,
          name: directApp?.label || directApp?.name || appId,
          grantedDate: appAssignmentGrant?.published,
          grantedBy: appAssignmentGrant?.actorDisplayName,
        },
      ],
      narrative: groupMembershipNarrative({
        userDisplayName: displayNameOf(user),
        groupName,
        targetName: directApp?.label || directApp?.name || appId,
        targetType: 'app',
        membershipGrantedDate: membershipGrant?.published,
        membershipGrantedBy: membershipGrant?.actorDisplayName,
      }),
    });

    // group_rule: did a rule add the user to this group?
    const rules = await groupsClient.listRulesForGroup(group.id);
    for (const rule of rules) {
      if (!ruleLikelyMatchesUser(rule, user)) continue;
      paths.push({
        pathType: 'group_rule',
        isPrimary: false,
        nodes: [
          userNode(user),
          {
            nodeType: 'rule',
            id: rule.id,
            name: rule.name,
            ruleExpression: rule.conditions?.expression?.value,
          },
          {
            nodeType: 'group',
            id: group.id,
            name: groupName,
          },
          {
            nodeType: 'app',
            id: appId,
            name: directApp?.label || directApp?.name || appId,
          },
        ],
        narrative: groupRuleNarrative({
          userDisplayName: displayNameOf(user),
          ruleName: rule.name,
          ruleExpression: rule.conditions?.expression?.value,
          groupName,
          targetName: directApp?.label || directApp?.name || appId,
          targetType: 'app',
        }),
      });
    }
  }

  return paths;
}

/**
 * Discover all paths from `user` to `groupId` (group-as-target).
 *
 * - direct: user is a member of the group
 * - group_rule: a rule's `assignUserToGroups` includes the group AND
 *   the rule expression appears to match the user's profile
 */
async function findGroupPaths(user: OktaUser, groupId: string): Promise<ExplanationPath[]> {
  const paths: ExplanationPath[] = [];

  const userGroups = await safe(() => usersClient.listGroups(user.id), [] as OktaGroup[]);
  const target = userGroups.find((g) => g.id === groupId);

  if (!target) return paths;

  const targetName = target.profile?.name ?? groupId;
  const membershipGrant = await fetchGroupMembershipEvent(user.id, groupId);

  paths.push({
    pathType: 'direct',
    isPrimary: false,
    nodes: [
      userNode(user),
      {
        nodeType: 'group',
        id: groupId,
        name: targetName,
        grantedDate: membershipGrant?.published,
        grantedBy: membershipGrant?.actorDisplayName,
      },
    ],
    narrative: directNarrative({
      userDisplayName: displayNameOf(user),
      targetName,
      targetType: 'group',
      grantedDate: membershipGrant?.published,
      grantedBy: membershipGrant?.actorDisplayName,
    }),
  });

  // Rule-mediated membership.
  const rules = await groupsClient.listRulesForGroup(groupId);
  for (const rule of rules) {
    if (!ruleLikelyMatchesUser(rule, user)) continue;
    paths.push({
      pathType: 'group_rule',
      isPrimary: false,
      nodes: [
        userNode(user),
        {
          nodeType: 'rule',
          id: rule.id,
          name: rule.name,
          ruleExpression: rule.conditions?.expression?.value,
        },
        {
          nodeType: 'group',
          id: groupId,
          name: targetName,
        },
      ],
      narrative: groupRuleNarrative({
        userDisplayName: displayNameOf(user),
        ruleName: rule.name,
        ruleExpression: rule.conditions?.expression?.value,
        groupName: targetName,
        targetName: targetName,
        targetType: 'group',
      }),
    });
  }

  return paths;
}

/**
 * Discover all paths from `user` to a specific entitlement on `appId`.
 *
 * Uses `governanceClient.entitlements.listForUser` — if the user has
 * the entitlement, we get back a grant payload that includes the
 * grant's id, status, and (when expanded) the entitlement values. Each
 * grant is reported as one path; bundle-mediated grants are flagged.
 */
async function findEntitlementPaths(
  user: OktaUser,
  entitlementId: string,
  appId?: string
): Promise<ExplanationPath[]> {
  if (!appId) {
    console.warn(
      '[AccessExplainer] entitlementAppId not provided — cannot trace entitlement grants'
    );
    return [];
  }

  const grants = await safe(
    () => governanceClient.entitlements.listForUser(user.id, appId, ENTITLEMENT_READ_SCOPE),
    [] as any[]
  );

  const matching = grants.filter((g) => grantMentionsEntitlement(g, entitlementId));
  if (matching.length === 0) return [];

  const paths: ExplanationPath[] = [];
  const app = await safe(() => appsClient.getById(appId), null as OktaApp | null);
  const appName = app?.label || app?.name || appId;
  const entitlementName = extractEntitlementName(matching[0], entitlementId);

  for (const grant of matching) {
    const grantedDate = typeof grant.created === 'string' ? grant.created : undefined;
    const grantedBy = typeof grant.createdBy === 'string' ? grant.createdBy : undefined;

    paths.push({
      pathType: 'direct',
      isPrimary: false,
      nodes: [
        userNode(user),
        {
          nodeType: 'app',
          id: appId,
          name: appName,
        },
        {
          nodeType: 'entitlement',
          id: entitlementId,
          name: entitlementName,
          grantedDate,
          grantedBy,
        },
      ],
      narrative: entitlementGrantNarrative({
        userDisplayName: displayNameOf(user),
        appName,
        entitlementName,
        grantType: typeof grant.type === 'string' ? grant.type : undefined,
        grantedDate,
        grantedBy,
      }),
    });
  }

  return paths;
}

/**
 * Mark the shortest (fewest-hops) path as `isPrimary: true`. Stable
 * fallback: prefer `direct` over `group_membership` over `group_rule`.
 */
function markPrimaryPath(paths: ExplanationPath[]): ExplanationPath[] {
  if (paths.length === 0) return paths;

  const order = (p: ExplanationPath): number => {
    if (p.pathType === 'direct') return 0;
    if (p.pathType === 'group_membership') return 1;
    if (p.pathType === 'group_rule') return 2;
    return 3;
  };

  let bestIdx = 0;
  for (let i = 1; i < paths.length; i++) {
    const a = paths[bestIdx];
    const b = paths[i];
    if (b.nodes.length < a.nodes.length) {
      bestIdx = i;
    } else if (b.nodes.length === a.nodes.length && order(b) < order(a)) {
      bestIdx = i;
    }
  }

  return paths.map((p, i) => ({ ...p, isPrimary: i === bestIdx }));
}

/**
 * Build the consolidated top-level summary explanation.
 */
function buildSummaryExplanation(args: {
  displayName: string;
  target: ExplanationResult['target'];
  paths: ExplanationPath[];
  hasAccess: boolean;
}): string {
  const { displayName, target, paths, hasAccess } = args;
  if (!hasAccess) {
    return `${displayName} does not currently have access to ${target.type} "${target.name}". This may mean the access was recently removed, or it was never granted.`;
  }

  const primary = paths.find((p) => p.isPrimary) ?? paths[0];
  const redundantCount = Math.max(0, paths.length - 1);
  const tail =
    redundantCount > 0
      ? ` There ${redundantCount === 1 ? 'is' : 'are'} also ${redundantCount} additional redundant path${redundantCount === 1 ? '' : 's'} — consider consolidating.`
      : '';

  return `${primary.narrative}${tail}`;
}

/**
 * Build a `user` explanation node.
 */
function userNode(user: OktaUser): ExplanationNode {
  return {
    nodeType: 'user',
    id: user.id,
    name: displayNameOf(user),
  };
}

/**
 * Render a friendly display name from an OktaUser.
 */
function displayNameOf(user: OktaUser): string {
  const profile = user.profile as Record<string, unknown>;
  const firstName = typeof profile.firstName === 'string' ? profile.firstName : '';
  const lastName = typeof profile.lastName === 'string' ? profile.lastName : '';
  const dn = `${firstName} ${lastName}`.trim();
  return dn || user.profile.login;
}

/**
 * Run a fetch and degrade gracefully — explainability should never
 * 500 because of one missing data source.
 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.warn('[AccessExplainer] Sub-fetch failed — using fallback:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

/**
 * Look up the system-log event recording when a user was added to a group.
 *
 * Returns the most recent matching event, or `null` if the system log
 * is unavailable or no such event exists. Used purely for narrative
 * enrichment (date + actor) — never load-bearing.
 */
async function fetchGroupMembershipEvent(
  userId: string,
  groupId: string
): Promise<{ published: string; actorDisplayName?: string } | null> {
  return safe(async () => {
    const events = await systemLogClient.queryLogs({
      filter: `eventType eq "group.user_membership.add" and target.id eq "${userId}"`,
      limit: 50,
      sortOrder: 'DESCENDING',
    });
    for (const ev of events) {
      const targets = ev.target ?? [];
      if (targets.some((t) => t.id === groupId)) {
        return {
          published: ev.published,
          actorDisplayName: ev.actor?.displayName ?? ev.actor?.alternateId,
        };
      }
    }
    return null;
  }, null);
}

/**
 * Look up the system-log event recording when an app was assigned to a group.
 */
async function fetchAppToGroupAssignmentEvent(
  groupId: string,
  appId: string
): Promise<{ published: string; actorDisplayName?: string } | null> {
  return safe(async () => {
    const events = await systemLogClient.queryLogs({
      filter: `eventType eq "application.user_membership.add" and target.id eq "${appId}"`,
      limit: 50,
      sortOrder: 'DESCENDING',
    });
    for (const ev of events) {
      const targets = ev.target ?? [];
      if (targets.some((t) => t.id === groupId)) {
        return {
          published: ev.published,
          actorDisplayName: ev.actor?.displayName ?? ev.actor?.alternateId,
        };
      }
    }
    return null;
  }, null);
}

/**
 * Look up the system-log event recording when a user was directly
 * assigned to an app (not via group).
 */
async function fetchAppAssignmentEvent(
  userId: string,
  appId: string
): Promise<{ published: string; actorDisplayName?: string } | null> {
  return safe(async () => {
    const events = await systemLogClient.queryLogs({
      filter: `eventType eq "application.user_membership.add" and target.id eq "${userId}"`,
      limit: 50,
      sortOrder: 'DESCENDING',
    });
    for (const ev of events) {
      const targets = ev.target ?? [];
      if (targets.some((t) => t.id === appId)) {
        return {
          published: ev.published,
          actorDisplayName: ev.actor?.displayName ?? ev.actor?.alternateId,
        };
      }
    }
    return null;
  }, null);
}

/**
 * Heuristic: does this group rule's expression mention any of the
 * user's profile values? Full Okta Expression Language evaluation is
 * out of scope; we just substring-match common attributes (department,
 * title, login, email) against the rule expression.
 */
function ruleLikelyMatchesUser(rule: OktaGroupRule, user: OktaUser): boolean {
  const expr = rule.conditions?.expression?.value;
  if (!expr || typeof expr !== 'string') return false;

  const profile = user.profile as Record<string, unknown>;
  const candidates = [
    profile.department,
    profile.title,
    profile.login,
    profile.email,
    profile.userType,
    profile.organization,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);

  return candidates.some((value) => expr.includes(value));
}

/**
 * Test whether a grant payload mentions a specific entitlement ID. The
 * Governance Grants API can deliver entitlement IDs at three depths:
 * top-level `entitlementId`, expanded `entitlements[*].id`, and
 * expanded `entitlements[*].values[*].id`.
 */
function grantMentionsEntitlement(grant: any, entitlementId: string): boolean {
  if (!grant || typeof grant !== 'object') return false;
  if (grant.entitlementId === entitlementId) return true;
  const expanded = Array.isArray(grant.entitlements) ? grant.entitlements : [];
  for (const ent of expanded) {
    if (ent?.id === entitlementId) return true;
    const values = Array.isArray(ent?.values) ? ent.values : [];
    if (values.some((v: any) => v?.id === entitlementId)) return true;
  }
  return false;
}

/**
 * Pull a friendly entitlement name out of a grant payload, falling
 * back to the bare ID.
 */
function extractEntitlementName(grant: any, entitlementId: string): string {
  if (!grant || typeof grant !== 'object') return entitlementId;
  const expanded = Array.isArray(grant.entitlements) ? grant.entitlements : [];
  for (const ent of expanded) {
    if (ent?.id === entitlementId && typeof ent.name === 'string' && ent.name) {
      return ent.name;
    }
    const values = Array.isArray(ent?.values) ? ent.values : [];
    for (const v of values) {
      if (v?.id === entitlementId && typeof v.name === 'string' && v.name) {
        return `${ent.name ?? 'entitlement'} = ${v.name}`;
      }
    }
  }
  return entitlementId;
}

/**
 * Render a "direct assignment" narrative.
 *
 * @example
 *   "Sarah was directly assigned to Salesforce on 2024-03-15 by admin@example.com."
 *   "Sarah is directly a member of the 'Sales Admins' group."
 */
function directNarrative(args: {
  userDisplayName: string;
  targetName: string;
  targetType: 'app' | 'group';
  grantedDate?: string;
  grantedBy?: string;
}): string {
  const { userDisplayName, targetName, targetType, grantedDate, grantedBy } = args;
  const verb = targetType === 'app' ? 'was directly assigned to' : 'is a direct member of';
  const dateClause = grantedDate ? ` on ${formatDate(grantedDate)}` : '';
  const byClause = grantedBy ? ` by ${grantedBy}` : '';
  const targetClause = targetType === 'group' ? `the "${targetName}" group` : `${targetName}`;
  return `${userDisplayName} ${verb} ${targetClause}${dateClause}${byClause}.`;
}

/**
 * Render a "group membership grants access" narrative.
 *
 * @example
 *   "Sarah was added to the 'Sales Admins' group on 2024-03-15 by admin@example.com,
 *    which grants access to Salesforce."
 */
function groupMembershipNarrative(args: {
  userDisplayName: string;
  groupName: string;
  targetName: string;
  targetType: 'app' | 'group';
  membershipGrantedDate?: string;
  membershipGrantedBy?: string;
}): string {
  const {
    userDisplayName,
    groupName,
    targetName,
    targetType,
    membershipGrantedDate,
    membershipGrantedBy,
  } = args;
  const dateClause = membershipGrantedDate ? ` on ${formatDate(membershipGrantedDate)}` : '';
  const byClause = membershipGrantedBy ? ` by ${membershipGrantedBy}` : '';
  const grants = targetType === 'app' ? 'which grants access to' : 'which is';
  return `${userDisplayName} was added to the "${groupName}" group${dateClause}${byClause}, ${grants} ${targetName}.`;
}

/**
 * Render a "group rule auto-assigned the user" narrative.
 *
 * @example
 *   "The group rule 'Sales by Department' (expression:
 *    user.department == "Sales") auto-assigned Sarah to the 'Sales
 *    Admins' group, which grants access to Salesforce."
 */
function groupRuleNarrative(args: {
  userDisplayName: string;
  ruleName: string;
  ruleExpression?: string;
  groupName: string;
  targetName: string;
  targetType: 'app' | 'group';
}): string {
  const { userDisplayName, ruleName, ruleExpression, groupName, targetName, targetType } = args;
  const exprClause = ruleExpression ? ` (expression: ${ruleExpression})` : '';
  const tail =
    targetType === 'app'
      ? `, which grants access to ${targetName}`
      : groupName === targetName
        ? ''
        : `, which grants access to "${targetName}"`;
  return `The group rule "${ruleName}"${exprClause} auto-assigned ${userDisplayName} to the "${groupName}" group${tail}.`;
}

/**
 * Render an entitlement-grant narrative.
 *
 * @example
 *   "Sarah was granted the 'Approver Role' entitlement on Salesforce
 *    on 2024-04-02 by admin@example.com (grant type: ENTITLEMENT)."
 */
function entitlementGrantNarrative(args: {
  userDisplayName: string;
  appName: string;
  entitlementName: string;
  grantType?: string;
  grantedDate?: string;
  grantedBy?: string;
}): string {
  const { userDisplayName, appName, entitlementName, grantType, grantedDate, grantedBy } = args;
  const dateClause = grantedDate ? ` on ${formatDate(grantedDate)}` : '';
  const byClause = grantedBy ? ` by ${grantedBy}` : '';
  const typeClause = grantType ? ` (grant type: ${grantType})` : '';
  return `${userDisplayName} was granted the "${entitlementName}" entitlement on ${appName}${dateClause}${byClause}${typeClause}.`;
}

/**
 * Render an ISO timestamp as `YYYY-MM-DD` for narrative readability.
 */
function formatDate(iso: string): string {
  const idx = iso.indexOf('T');
  return idx === -1 ? iso : iso.slice(0, idx);
}

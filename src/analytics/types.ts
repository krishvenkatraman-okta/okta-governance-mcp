/**
 * Analytics types
 *
 * Foundational types shared by the role mining, outlier detection,
 * access explainability, and smart campaign analytics modules.
 *
 * These types describe a denormalized "access graph" snapshot — a
 * point-in-time view of users and the access they hold (groups, apps,
 * entitlements). Downstream analytics treat the snapshot as immutable.
 */

/**
 * A single node in the access graph.
 *
 * Represents one piece of access a user holds. The composite key for
 * uniqueness across types is `${type}:${id}`.
 */
export interface AccessNode {
  type: 'group' | 'app' | 'entitlement';
  id: string;
  name: string;
}

/**
 * A user with their flattened access set.
 *
 * Profile attributes (`department`, `title`, `managerId`) are best-effort
 * — Okta user profiles are loosely typed and these fields may be absent.
 */
export interface UserAccessProfile {
  userId: string;
  login: string;
  displayName: string;
  department?: string;
  title?: string;
  managerId?: string;
  accessSet: AccessNode[];
}

/**
 * A peer group derived from user attributes (department, title, manager).
 *
 * `key` is the strategy-specific clustering key, e.g. for the
 * `department_title` strategy: `${department}|${title}`.
 */
export interface PeerGroup {
  strategy: string;
  key: string;
  userIds: string[];
}

/**
 * Lightweight lookup record for a group node.
 */
export interface AccessGraphGroup {
  id: string;
  name: string;
  type: string;
}

/**
 * Lightweight lookup record for an app node.
 */
export interface AccessGraphApp {
  id: string;
  name: string;
  label: string;
}

/**
 * Lightweight lookup record for an entitlement node.
 */
export interface AccessGraphEntitlement {
  id: string;
  name: string;
  appId: string;
}

/**
 * Full access graph snapshot for a given scope.
 *
 * Built by `buildAccessGraph` in `access-graph.ts`. All downstream
 * analytics (mining, outliers, explain, campaigns) consume this single
 * data structure.
 */
export interface AccessGraphSnapshot {
  users: UserAccessProfile[];
  groupsById: Record<string, AccessGraphGroup>;
  appsById: Record<string, AccessGraphApp>;
  entitlementsById: Record<string, AccessGraphEntitlement>;
  scopeDescription: string;
  builtAt: string;
}

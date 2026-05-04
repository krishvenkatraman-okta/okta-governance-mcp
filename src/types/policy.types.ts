/**
 * Policy and authorization types
 */

import { OktaRoleType } from './okta.types.js';

/**
 * User capability
 */
export type Capability =
  // End-user capabilities (typically direct API, not MCP)
  | 'resource_catalog.search'
  | 'access_requests.self'
  | 'reviews.assigned'
  | 'security_access_reviews.self'
  | 'settings.self.manage'
  // Delegated admin capabilities
  | 'entitlements.manage.owned'
  | 'labels.manage.owned'
  | 'bundles.manage.owned'
  | 'campaigns.manage.owned'
  | 'request_for_others.owned'
  | 'workflow.manage.owned'
  | 'reports.syslog.owned'
  | 'groups.manage.owned'
  // Super admin capabilities
  | 'entitlements.manage.all'
  | 'labels.manage.all'
  | 'bundles.manage.all'
  | 'campaigns.manage.all'
  | 'request_for_others.all'
  | 'workflow.manage.all'
  | 'reports.syslog.all'
  | 'groups.manage.all'
  | 'settings.governance.manage'
  | 'roles.manage'
  | 'apps.manage'
  | 'groups.manage'
  // Advanced analytics capabilities (delegated, scoped to owned targets)
  | 'analytics.mining.owned'
  | 'analytics.outliers.owned'
  | 'analytics.campaigns.owned'
  // Advanced analytics capabilities (org-wide)
  | 'analytics.mining.all'
  | 'analytics.outliers.all'
  | 'analytics.campaigns.all'
  // Read-only analytics capability (any admin can explain access)
  | 'analytics.explain.read';

/**
 * Authorization context for a user session
 */
export interface AuthorizationContext {
  subject: string; // User ID
  roles: {
    superAdmin: boolean;
    orgAdmin: boolean;
    appAdmin: boolean;
    groupAdmin: boolean;
    readOnlyAdmin: boolean;
    regularUser: boolean;
  };
  targets: {
    apps: string[]; // App IDs this user can administer
    groups: string[]; // Group IDs this user can administer
  };
  reviewer: {
    hasAssignedReviews: boolean;
    hasSecurityAccessReviews: boolean;
  };
  capabilities: Capability[];
}

/**
 * Role mapping configuration
 */
export interface RoleMapping {
  oktaRole: OktaRoleType;
  capabilities: Capability[];
  requiresTargets?: boolean;
}

/**
 * Target constraint
 */
export type TargetConstraint =
  | 'must_be_owned_app'
  | 'must_be_owned_group'
  | 'no_constraint'
  | 'scope_to_owned_apps_or_all';

/**
 * Policy evaluation result
 */
export interface PolicyEvaluationResult {
  allowed: boolean;
  reason?: string;
  missingCapabilities?: Capability[];
  missingScopes?: string[];
  targetViolation?: {
    required: string;
    actual?: string;
  };
}

/**
 * Authorization check request
 */
export interface AuthorizationCheckRequest {
  toolName: string;
  resourceId?: string;
  context: AuthorizationContext;
}

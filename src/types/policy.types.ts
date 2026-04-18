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
  | 'groups.manage';

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
export type TargetConstraint = 'must_be_owned_app' | 'must_be_owned_group' | 'no_constraint';

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

/**
 * Capability mapper
 *
 * Maps Okta roles and targets to capabilities
 */

import type { Capability, AuthorizationContext } from '../types/index.js';

/**
 * Map roles and targets to capabilities
 */
function mapRolesToCapabilities(
  roles: AuthorizationContext['roles'],
  targets: AuthorizationContext['targets']
): Capability[] {
  const capabilities: Capability[] = [];

  // Super admin gets all capabilities
  if (roles.superAdmin) {
    return [
      'entitlements.manage.all',
      'labels.manage.all',
      'bundles.manage.all',
      'campaigns.manage.all',
      'request_for_others.all',
      'workflow.manage.all',
      'reports.syslog.all',
      'settings.governance.manage',
      'roles.manage',
      'apps.manage',
      'groups.manage',
    ];
  }

  // Org admin gets most capabilities
  if (roles.orgAdmin) {
    return [
      'entitlements.manage.all',
      'labels.manage.all',
      'bundles.manage.all',
      'campaigns.manage.all',
      'request_for_others.all',
      'workflow.manage.all',
      'reports.syslog.all',
      'settings.governance.manage',
    ];
  }

  // App admin with targets
  if (roles.appAdmin && targets.apps.length > 0) {
    capabilities.push(
      'entitlements.manage.owned',
      'labels.manage.owned',
      'bundles.manage.owned',
      'campaigns.manage.owned',
      'request_for_others.owned',
      'workflow.manage.owned',
      'reports.syslog.owned'
    );
  }

  // Group admin with targets
  if (roles.groupAdmin && targets.groups.length > 0) {
    capabilities.push('campaigns.manage.owned', 'reports.syslog.owned');
  }

  // Read-only admin gets no mutation capabilities
  if (roles.readOnlyAdmin) {
    // No capabilities for read-only admin in governance context
    // They would use direct API for read operations
  }

  // Regular users get end-user capabilities (but these use direct API, not MCP)
  if (roles.regularUser) {
    capabilities.push(
      'resource_catalog.search',
      'access_requests.self',
      'reviews.assigned',
      'security_access_reviews.self',
      'settings.self.manage'
    );
  }

  return capabilities;
}

/**
 * Check if user has a specific capability
 */
function hasCapability(capabilities: Capability[], required: Capability): boolean {
  return capabilities.includes(required);
}

/**
 * Check if user has any of the required capabilities
 */
function hasAnyCapability(capabilities: Capability[], required: Capability[]): boolean {
  return required.some((cap) => capabilities.includes(cap));
}

/**
 * Check if user has all required capabilities
 */
function hasAllCapabilities(capabilities: Capability[], required: Capability[]): boolean {
  return required.every((cap) => capabilities.includes(cap));
}

export const capabilityMapper = {
  mapRolesToCapabilities,
  hasCapability,
  hasAnyCapability,
  hasAllCapabilities,
};

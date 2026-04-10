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
 * Check if a capability satisfies a requirement
 *
 * Logic:
 * - Exact match: capability === required (e.g., 'campaigns.manage.owned' === 'campaigns.manage.owned')
 * - Elevated match: capability with '.all' satisfies requirement with '.owned'
 *   (e.g., 'campaigns.manage.all' satisfies 'campaigns.manage.owned')
 *
 * This allows SUPER_ADMIN and ORG_ADMIN users (who have .all capabilities)
 * to access tools that require .owned capabilities.
 *
 * @param capability - The capability the user has
 * @param required - The capability required by the tool
 * @returns true if the capability satisfies the requirement
 */
function capabilitySatisfiesRequirement(capability: Capability, required: Capability): boolean {
  // Exact match
  if (capability === required) {
    return true;
  }

  // Check if .all capability satisfies .owned requirement
  // Example: 'campaigns.manage.all' satisfies 'campaigns.manage.owned'
  if (required.endsWith('.owned')) {
    const baseCapability = required.slice(0, -6); // Remove '.owned'
    const allCapability = `${baseCapability}.all` as Capability;
    if (capability === allCapability) {
      return true;
    }
  }

  return false;
}

/**
 * Check if user has a specific capability
 *
 * Recognizes that .all capabilities satisfy .owned requirements.
 */
function hasCapability(capabilities: Capability[], required: Capability): boolean {
  return capabilities.some((cap) => capabilitySatisfiesRequirement(cap, required));
}

/**
 * Check if user has any of the required capabilities
 *
 * Recognizes that .all capabilities satisfy .owned requirements.
 */
function hasAnyCapability(capabilities: Capability[], required: Capability[]): boolean {
  return required.some((req) => hasCapability(capabilities, req));
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

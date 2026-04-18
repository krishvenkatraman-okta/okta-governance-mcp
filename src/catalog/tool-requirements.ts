/**
 * Tool requirements registry
 *
 * Maintains requirements for each MCP tool including:
 * - Required OAuth scopes
 * - Required capabilities
 * - Target constraints
 * - Endpoint families
 * - Mapped endpoints
 */

import type { ToolRequirement, ToolRequirementsRegistry } from '../types/index.js';

/**
 * Tool requirements registry
 *
 * Each tool declares its requirements for authorization validation and explainability
 */
const requirements: Record<string, ToolRequirement> = {
  /**
   * ==========================================
   * METADATA / EXPLAINABILITY TOOLS
   * ==========================================
   */

  get_tool_requirements: {
    toolName: 'get_tool_requirements',
    description: 'Get scope and capability requirements for a specific tool',
    mappedEndpoints: [],
    endpointCategories: [],
    requiredScopes: [],
    requiredCapabilities: [],
    targetConstraints: ['no_constraint'],
    isMetadataTool: true,
    notes: 'Read-only metadata tool, no special permissions required',
  },

  get_operation_requirements: {
    toolName: 'get_operation_requirements',
    description: 'Get requirements for a specific API operation',
    mappedEndpoints: [],
    endpointCategories: [],
    requiredScopes: [],
    requiredCapabilities: [],
    targetConstraints: ['no_constraint'],
    isMetadataTool: true,
    notes: 'Read-only metadata tool, queries endpoint registry',
  },

  explain_why_tool_is_unavailable: {
    toolName: 'explain_why_tool_is_unavailable',
    description: 'Explain why a tool is not available to the current user',
    mappedEndpoints: [],
    endpointCategories: [],
    requiredScopes: [],
    requiredCapabilities: [],
    targetConstraints: ['no_constraint'],
    isMetadataTool: true,
    notes: 'Read-only metadata tool, analyzes authorization context',
  },

  list_available_tools_for_current_user: {
    toolName: 'list_available_tools_for_current_user',
    description: 'List all tools available to the current user',
    mappedEndpoints: [],
    endpointCategories: [],
    requiredScopes: [],
    requiredCapabilities: [],
    targetConstraints: ['no_constraint'],
    isMetadataTool: true,
    notes: 'Read-only metadata tool, filters tool list by authorization',
  },

  /**
   * ==========================================
   * GOVERNANCE TOOLS
   * ==========================================
   */

  list_manageable_apps: {
    toolName: 'list_manageable_apps',
    description: 'List applications manageable in your current authorization scope (all apps for organization-wide access, owned apps for scoped access)',
    mappedEndpoints: ['List all apps', 'Get Application'], // Will map to Apps API
    endpointCategories: ['Apps'],
    requiredScopes: ['okta.apps.read'],
    // Accept either .owned OR .all capabilities (SUPER_ADMIN has .all, APP_ADMIN has .owned)
    requiredCapabilities: [
      'entitlements.manage.owned',
      'labels.manage.owned',
      'entitlements.manage.all',
      'labels.manage.all',
    ],
    requiredRoles: ['APP_ADMIN', 'SUPER_ADMIN'],
    targetConstraints: ['no_constraint'],
    requiresTargetResource: false,
    notes: 'Uses Apps API (not in Governance collection). Returns all apps for SUPER_ADMIN/ORG_ADMIN, only owned apps for APP_ADMIN.',
    documentationRefs: ['https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Application/'],
  },

  /**
   * ==========================================
   * ENTITLEMENT MANAGEMENT TOOLS
   * ==========================================
   */

  manage_app_entitlements: {
    toolName: 'manage_app_entitlements',
    description: 'Manage entitlements for applications within your authorization scope (requires app context)',
    mappedEndpoints: [
      'List all entitlements',
      'Create an entitlement',
      'Retrieve an entitlement',
      'Update an entitlement',
      'Delete an entitlement',
    ],
    endpointCategories: ['Entitlements'],
    requiredScopes: ['okta.governance.entitlements.read', 'okta.governance.entitlements.manage'],
    requiredCapabilities: ['entitlements.manage.owned', 'entitlements.manage.all'],
    requiredRoles: ['APP_ADMIN', 'SUPER_ADMIN'],
    targetConstraints: ['must_be_owned_app'],
    requiresTargetResource: true,
    conditionalScopes: [
      {
        condition: 'When listing entitlements only',
        scopes: ['okta.governance.entitlements.read'],
        description: 'Read-only access for listing',
      },
      {
        condition: 'When creating/updating/deleting',
        scopes: ['okta.governance.entitlements.read', 'okta.governance.entitlements.manage'],
        description: 'Full management access required',
      },
    ],
    notes: 'User must be APP_ADMIN with target app in their role targets',
    documentationRefs: [
      'https://developer.okta.com/docs/api/openapi/okta-governance/governance/tag/Entitlements/',
    ],
  },

  /**
   * ==========================================
   * LABEL MANAGEMENT TOOLS
   * ==========================================
   */

  manage_app_labels: {
    toolName: 'manage_app_labels',
    description: 'Manage labels for applications within your authorization scope (requires app context)',
    mappedEndpoints: [
      'List all labels',
      'Create a label',
      'Retrieve a label',
      'Update a label',
      'Delete a label',
      'List all labeled resources',
      'List all resources for a label',
    ],
    endpointCategories: ['Labels'],
    requiredScopes: ['okta.governance.labels.read', 'okta.governance.labels.manage', 'okta.apps.read'],
    requiredCapabilities: ['labels.manage.owned', 'labels.manage.all'],
    requiredRoles: ['APP_ADMIN', 'SUPER_ADMIN'],
    targetConstraints: ['must_be_owned_app'],
    requiresTargetResource: true,
    conditionalScopes: [
      {
        condition: 'When listing labels only',
        scopes: ['okta.governance.labels.read'],
        description: 'Read-only access',
      },
      {
        condition: 'When creating/updating/deleting labels',
        scopes: ['okta.governance.labels.read', 'okta.governance.labels.manage'],
        description: 'Full label management',
      },
      {
        condition: 'When applying labels to apps',
        scopes: [
          'okta.governance.labels.read',
          'okta.governance.labels.manage',
          'okta.apps.read',
        ],
        description: 'Label management + app read access',
      },
    ],
    notes: 'Labels can be applied to apps, entitlements, and bundles',
    documentationRefs: [
      'https://developer.okta.com/docs/api/openapi/okta-governance/governance/tag/Labels/',
    ],
  },

  /**
   * ==========================================
   * COLLECTION (BUNDLE) TOOLS
   * ==========================================
   */

  manage_app_bundles: {
    toolName: 'manage_app_bundles',
    description: 'Create and manage entitlement bundles (collections) for applications within your authorization scope',
    mappedEndpoints: [
      'Create a resource collection',
      'List all resource collections',
      'Retrieve a resource collection',
      'Update a resource collection',
      'Delete a resource collection',
    ],
    endpointCategories: ['Collections'],
    requiredScopes: [
      'okta.governance.collections.read',
      'okta.governance.collections.manage',
      'okta.governance.entitlements.read',
    ],
    requiredCapabilities: ['bundles.manage.owned', 'bundles.manage.all'],
    requiredRoles: ['APP_ADMIN', 'SUPER_ADMIN'],
    targetConstraints: ['must_be_owned_app'],
    requiresTargetResource: true,
    conditionalScopes: [
      {
        condition: 'When creating/updating bundles',
        scopes: [
          'okta.governance.collections.manage',
          'okta.governance.collections.read',
          'okta.governance.entitlements.read',
        ],
        description: 'Bundle management + entitlement read access',
      },
    ],
    notes: 'Bundles (collections) group entitlements for easier assignment',
    documentationRefs: [
      'https://developer.okta.com/docs/api/openapi/okta-governance/governance/tag/Collections/',
    ],
  },

  /**
   * ==========================================
   * CAMPAIGN (CERTIFICATION) TOOLS
   * ==========================================
   */

  manage_app_campaigns: {
    toolName: 'manage_app_campaigns',
    description: 'Create and manage access certification campaigns for applications within your authorization scope',
    mappedEndpoints: [
      'Create a campaign',
      'List all campaigns',
      'Retrieve a campaign',
      'Delete a campaign',
      'Launch a campaign',
      'End a campaign',
    ],
    endpointCategories: ['Campaigns'],
    requiredScopes: [
      'okta.governance.accessCertifications.read',
      'okta.governance.accessCertifications.manage',
      'okta.apps.read',
    ],
    requiredCapabilities: ['campaigns.manage.owned', 'campaigns.manage.all'],
    requiredRoles: ['APP_ADMIN', 'SUPER_ADMIN'],
    targetConstraints: ['must_be_owned_app'],
    requiresTargetResource: true,
    conditionalScopes: [
      {
        condition: 'When listing campaigns only',
        scopes: ['okta.governance.accessCertifications.read'],
        description: 'Read-only access',
      },
      {
        condition: 'When creating/launching/ending campaigns',
        scopes: [
          'okta.governance.accessCertifications.read',
          'okta.governance.accessCertifications.manage',
          'okta.apps.read',
        ],
        description: 'Full campaign management + app access',
      },
    ],
    notes: 'Campaigns enable periodic access reviews for compliance',
    documentationRefs: [
      'https://developer.okta.com/docs/api/openapi/okta-governance/governance/tag/Campaigns/',
    ],
  },

  /**
   * ==========================================
   * ACCESS REQUEST TOOLS
   * ==========================================
   */

  create_delegated_access_request: {
    toolName: 'create_delegated_access_request',
    description: 'Request access on behalf of another user for applications within your authorization scope',
    mappedEndpoints: [
      'Create a request',
      'List all requests',
      'Retrieve a request',
      'Cancel a request',
    ],
    endpointCategories: ['Access Requests - V1', 'Access Requests - V2'],
    requiredScopes: [
      'okta.accessRequests.request.read',
      'okta.accessRequests.request.manage',
      'okta.accessRequests.catalog.read',
    ],
    requiredCapabilities: ['request_for_others.owned', 'request_for_others.all'],
    requiredRoles: ['APP_ADMIN', 'SUPER_ADMIN'],
    targetConstraints: ['must_be_owned_app'],
    requiresTargetResource: true,
    conditionalScopes: [
      {
        condition: 'When browsing catalog',
        scopes: ['okta.accessRequests.catalog.read'],
        description: 'Read catalog to find requestable resources',
      },
      {
        condition: 'When creating requests',
        scopes: [
          'okta.accessRequests.request.manage',
          'okta.accessRequests.request.read',
          'okta.accessRequests.catalog.read',
        ],
        description: 'Full request management',
      },
    ],
    notes: 'Delegated request creation on behalf of other users',
    documentationRefs: [
      'https://developer.okta.com/docs/api/openapi/okta-governance/governance/tag/Access-Requests-V2/',
    ],
  },

  /**
   * ==========================================
   * WORKFLOW TOOLS
   * ==========================================
   */

  manage_app_workflows: {
    toolName: 'manage_app_workflows',
    description: 'Manage access request workflows and approval conditions for applications within your authorization scope',
    mappedEndpoints: [
      'List all resource request conditions',
      'Create a request condition',
      'Retrieve a resource request condition',
      'Update a resource request condition',
      'Delete a resource request condition',
    ],
    endpointCategories: ['Access Requests - V2'],
    requiredScopes: [
      'okta.accessRequests.condition.read',
      'okta.accessRequests.condition.manage',
    ],
    requiredCapabilities: ['workflow.manage.owned', 'workflow.manage.all'],
    requiredRoles: ['APP_ADMIN', 'SUPER_ADMIN'],
    targetConstraints: ['must_be_owned_app'],
    requiresTargetResource: true,
    conditionalScopes: [
      {
        condition: 'When viewing workflows only',
        scopes: ['okta.accessRequests.condition.read'],
        description: 'Read-only access to conditions',
      },
      {
        condition: 'When modifying workflows',
        scopes: [
          'okta.accessRequests.condition.read',
          'okta.accessRequests.condition.manage',
        ],
        description: 'Full workflow management',
      },
    ],
    notes: 'Request conditions define approval workflows and requirements',
    documentationRefs: [
      'https://developer.okta.com/docs/api/openapi/okta-governance/governance/tag/Access-Requests-V2/',
    ],
  },

  /**
   * ==========================================
   * REPORTING TOOLS
   * ==========================================
   */

  generate_app_activity_report: {
    toolName: 'generate_app_activity_report',
    description: 'Generate activity and audit reports from system logs for applications within your authorization scope',
    mappedEndpoints: ['Get System Log'], // System Log API, not in Governance collection
    endpointCategories: ['System Log'],
    requiredScopes: ['okta.logs.read', 'okta.apps.read'],
    requiredCapabilities: ['reports.syslog.owned', 'reports.syslog.all'],
    requiredRoles: ['APP_ADMIN', 'SUPER_ADMIN'],
    targetConstraints: ['must_be_owned_app'],
    requiresTargetResource: true,
    notes:
      'Uses System Log API (not in Governance collection). Filters logs by target app for APP_ADMIN, all apps for SUPER_ADMIN.',
    documentationRefs: [
      'https://developer.okta.com/docs/api/openapi/okta-management/management/tag/SystemLog/',
    ],
  },

  /**
   * ==========================================
   * GOVERNANCE & RISK TOOLS
   * ==========================================
   */

  generate_access_review_candidates: {
    toolName: 'generate_access_review_candidates',
    description:
      'Generate risk-ranked candidates for access review based on activity analysis within your authorization scope',
    mappedEndpoints: ['Get System Log', 'Get Application'],
    endpointCategories: ['System Log', 'Apps', 'Campaigns'],
    requiredScopes: ['okta.logs.read', 'okta.apps.read'],
    requiredCapabilities: [
      'campaigns.manage.owned',
      'reports.syslog.owned',
      'campaigns.manage.all',
      'reports.syslog.all',
    ],
    requiredRoles: ['APP_ADMIN', 'SUPER_ADMIN'],
    targetConstraints: ['must_be_owned_app'],
    requiresTargetResource: true,
    notes:
      'Uses System Log API to detect inactive users. Analyzes access patterns and assigns risk levels (HIGH/MEDIUM/LOW). Works with owned apps for APP_ADMIN, all apps for SUPER_ADMIN. Does not trigger actual certification campaigns.',
    documentationRefs: [
      'https://developer.okta.com/docs/api/openapi/okta-management/management/tag/SystemLog/',
      'https://developer.okta.com/docs/api/openapi/okta-governance/governance/tag/Campaigns/',
    ],
  },

  /**
   * ==========================================
   * GROUP MANAGEMENT TOOLS
   * ==========================================
   */

  list_manageable_groups: {
    toolName: 'list_manageable_groups',
    description: 'List groups manageable in your current authorization scope (all groups for organization-wide access, owned groups for scoped access)',
    mappedEndpoints: ['List all groups', 'Get Group'],
    endpointCategories: ['Groups'],
    requiredScopes: ['okta.groups.read'],
    requiredCapabilities: [
      'groups.manage.owned',
      'groups.manage.all',
    ],
    requiredRoles: ['GROUP_ADMIN', 'SUPER_ADMIN', 'ORG_ADMIN'],
    targetConstraints: ['no_constraint'],
    requiresTargetResource: false,
    notes: 'Returns all groups for SUPER_ADMIN/ORG_ADMIN, only owned groups for GROUP_ADMIN.',
    documentationRefs: ['https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Group/'],
  },

  list_group_members: {
    toolName: 'list_group_members',
    description: 'List members of a group you have permission to manage',
    mappedEndpoints: ['List Group users', 'Get Group'],
    endpointCategories: ['Groups'],
    requiredScopes: ['okta.groups.read', 'okta.users.read'],
    requiredCapabilities: [
      'groups.manage.owned',
      'groups.manage.all',
    ],
    requiredRoles: ['GROUP_ADMIN', 'SUPER_ADMIN', 'ORG_ADMIN'],
    targetConstraints: ['must_be_owned_group'],
    requiresTargetResource: true,
    notes: 'User must be GROUP_ADMIN with target group in their role targets, or SUPER_ADMIN/ORG_ADMIN',
    documentationRefs: ['https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Group/'],
  },

  manage_group_membership: {
    toolName: 'manage_group_membership',
    description: 'Manage group membership - check if user is in group, add user to group, or remove user from group',
    mappedEndpoints: ['Add User to Group', 'Remove User from Group', 'List Group users'],
    endpointCategories: ['Groups'],
    requiredScopes: ['okta.groups.read', 'okta.groups.manage', 'okta.users.read'],
    requiredCapabilities: [
      'groups.manage.owned',
      'groups.manage.all',
    ],
    requiredRoles: ['GROUP_ADMIN', 'SUPER_ADMIN', 'ORG_ADMIN'],
    targetConstraints: ['must_be_owned_group'],
    requiresTargetResource: true,
    conditionalScopes: [
      {
        condition: 'When checking membership only',
        scopes: ['okta.groups.read', 'okta.users.read'],
        description: 'Read-only access',
      },
      {
        condition: 'When adding/removing members',
        scopes: ['okta.groups.read', 'okta.groups.manage', 'okta.users.read'],
        description: 'Full group management',
      },
    ],
    notes: 'User must be GROUP_ADMIN with target group in their role targets, or SUPER_ADMIN/ORG_ADMIN',
    documentationRefs: ['https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Group/'],
  },

  manage_group_campaigns: {
    toolName: 'manage_group_campaigns',
    description: 'Create and manage access certification campaigns for groups you have permission to manage',
    mappedEndpoints: [
      'Create a campaign',
      'List all campaigns',
      'Retrieve a campaign',
      'Launch a campaign',
    ],
    endpointCategories: ['Campaigns', 'Groups'],
    requiredScopes: [
      'okta.governance.accessCertifications.read',
      'okta.governance.accessCertifications.manage',
      'okta.groups.read',
    ],
    requiredCapabilities: [
      'groups.manage.owned',
      'campaigns.manage.owned',
      'groups.manage.all',
      'campaigns.manage.all',
    ],
    requiredRoles: ['GROUP_ADMIN', 'SUPER_ADMIN', 'ORG_ADMIN'],
    targetConstraints: ['must_be_owned_group'],
    requiresTargetResource: true,
    conditionalScopes: [
      {
        condition: 'When listing campaigns only',
        scopes: ['okta.governance.accessCertifications.read'],
        description: 'Read-only access',
      },
      {
        condition: 'When creating/launching campaigns',
        scopes: [
          'okta.governance.accessCertifications.read',
          'okta.governance.accessCertifications.manage',
          'okta.groups.read',
        ],
        description: 'Full campaign management + group access',
      },
    ],
    notes: 'User must be GROUP_ADMIN with target group in their role targets, or SUPER_ADMIN/ORG_ADMIN. Creates GROUP_MEMBERSHIP campaigns.',
    documentationRefs: [
      'https://developer.okta.com/docs/api/openapi/okta-governance/governance/tag/Campaigns/',
      'https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Group/',
    ],
  },
};

/**
 * Get tool requirement by name
 */
export function getToolRequirement(toolName: string): ToolRequirement | undefined {
  return requirements[toolName];
}

/**
 * Get all tool requirements
 */
export function getAllToolRequirements(): ToolRequirementsRegistry {
  return { requirements };
}

/**
 * Register a new tool requirement
 */
export function registerToolRequirement(requirement: ToolRequirement): void {
  requirements[requirement.toolName] = requirement;
}

/**
 * Check if tool is registered
 */
export function isToolRegistered(toolName: string): boolean {
  return toolName in requirements;
}

/**
 * Get all registered tool names
 */
export function getRegisteredToolNames(): string[] {
  return Object.keys(requirements);
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: string): ToolRequirement[] {
  return Object.values(requirements).filter((req) => req.endpointCategories.includes(category));
}

/**
 * Get tools requiring specific scope
 */
export function getToolsRequiringScope(scope: string): ToolRequirement[] {
  return Object.values(requirements).filter((req) => req.requiredScopes.includes(scope));
}

/**
 * Get tools requiring specific capability
 */
export function getToolsRequiringCapability(capability: string): ToolRequirement[] {
  return Object.values(requirements).filter((req) =>
    req.requiredCapabilities.includes(capability as any)
  );
}

/**
 * Get metadata-only tools
 */
export function getMetadataTools(): ToolRequirement[] {
  return Object.values(requirements).filter((req) => req.isMetadataTool === true);
}

/**
 * Get tools that require target resources
 */
export function getToolsRequiringTargets(): ToolRequirement[] {
  return Object.values(requirements).filter((req) => req.requiresTargetResource === true);
}

/**
 * Get governance tools (non-metadata)
 */
export function getGovernanceTools(): ToolRequirement[] {
  return Object.values(requirements).filter((req) => req.isMetadataTool !== true);
}

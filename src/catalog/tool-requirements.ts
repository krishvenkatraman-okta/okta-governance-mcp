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
   * APP ADMIN TOOLS
   * ==========================================
   */

  list_owned_apps: {
    toolName: 'list_owned_apps',
    description: 'List applications owned/administered by the current user',
    mappedEndpoints: ['List all apps', 'Get Application'], // Will map to Apps API
    endpointCategories: ['Apps'],
    requiredScopes: ['okta.apps.read'],
    requiredCapabilities: ['entitlements.manage.owned', 'labels.manage.owned'],
    requiredRoles: ['APP_ADMIN', 'SUPER_ADMIN'],
    targetConstraints: ['no_constraint'],
    requiresTargetResource: false,
    notes: 'Uses Apps API (not in Governance collection). Returns only apps user can administer.',
    documentationRefs: ['https://developer.okta.com/docs/api/openapi/okta-management/management/tag/Application/'],
  },

  /**
   * ==========================================
   * ENTITLEMENT MANAGEMENT TOOLS
   * ==========================================
   */

  manage_owned_app_entitlements: {
    toolName: 'manage_owned_app_entitlements',
    description: 'Manage entitlements for an owned application',
    mappedEndpoints: [
      'List all entitlements',
      'Create an entitlement',
      'Retrieve an entitlement',
      'Update an entitlement',
      'Delete an entitlement',
    ],
    endpointCategories: ['Entitlements'],
    requiredScopes: ['okta.governance.entitlements.read', 'okta.governance.entitlements.manage'],
    requiredCapabilities: ['entitlements.manage.owned'],
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

  manage_owned_app_labels: {
    toolName: 'manage_owned_app_labels',
    description: 'Manage labels for an owned application',
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
    requiredCapabilities: ['labels.manage.owned'],
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

  create_bundle_for_owned_app: {
    toolName: 'create_bundle_for_owned_app',
    description: 'Create an entitlement bundle for an owned application',
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
    requiredCapabilities: ['bundles.manage.owned'],
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

  create_campaign_for_owned_app: {
    toolName: 'create_campaign_for_owned_app',
    description: 'Create an access certification campaign for an owned application',
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
    requiredCapabilities: ['campaigns.manage.owned'],
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

  request_access_for_other_user_on_owned_app: {
    toolName: 'request_access_for_other_user_on_owned_app',
    description: 'Request access on behalf of another user for an owned application',
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
    requiredCapabilities: ['request_for_others.owned'],
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

  create_access_request_workflow_for_owned_app: {
    toolName: 'create_access_request_workflow_for_owned_app',
    description: 'Create or update access request workflows for an owned application',
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
    requiredCapabilities: ['workflow.manage.owned'],
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

  generate_owned_app_syslog_report: {
    toolName: 'generate_owned_app_syslog_report',
    description: 'Generate system log reports for owned applications',
    mappedEndpoints: ['Get System Log'], // System Log API, not in Governance collection
    endpointCategories: ['System Log'],
    requiredScopes: ['okta.logs.read', 'okta.apps.read'],
    requiredCapabilities: ['reports.syslog.owned'],
    requiredRoles: ['APP_ADMIN', 'SUPER_ADMIN'],
    targetConstraints: ['must_be_owned_app'],
    requiresTargetResource: true,
    notes:
      'Uses System Log API (not in Governance collection). Filters logs by target app.',
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
      'Generate a list of users who should be reviewed for access removal based on inactivity and risk analysis',
    mappedEndpoints: ['Get System Log', 'Get Application'],
    endpointCategories: ['System Log', 'Apps', 'Campaigns'],
    requiredScopes: ['okta.logs.read', 'okta.apps.read'],
    requiredCapabilities: ['campaigns.manage.owned', 'reports.syslog.owned'],
    requiredRoles: ['APP_ADMIN', 'SUPER_ADMIN'],
    targetConstraints: ['must_be_owned_app'],
    requiresTargetResource: true,
    notes:
      'Uses System Log API to detect inactive users. Analyzes access patterns and assigns risk levels (HIGH/MEDIUM/LOW). Does not trigger actual certification campaigns.',
    documentationRefs: [
      'https://developer.okta.com/docs/api/openapi/okta-management/management/tag/SystemLog/',
      'https://developer.okta.com/docs/api/openapi/okta-governance/governance/tag/Campaigns/',
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

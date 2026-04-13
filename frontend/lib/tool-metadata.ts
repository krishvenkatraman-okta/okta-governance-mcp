/**
 * Tool Metadata and Classification
 *
 * Provides classification, categorization, and metadata for all MCP governance tools.
 * Used for tool explorer, documentation, and execution policy enforcement.
 */

export interface ToolMetadata {
  name: string;
  description: string;
  category: 'metadata' | 'discovery' | 'reporting' | 'governance' | 'management';
  type: 'read' | 'write';
  implementationStatus: 'implemented' | 'stub' | 'partial';
  requirements: {
    scopes?: string[];
    capabilities?: string[];
    roles?: string[];
    requiresTargetResource: boolean;
  };
  notes?: string;
  exampleUsage?: string;
}

/**
 * Tool metadata registry
 */
export const TOOL_METADATA: Record<string, ToolMetadata> = {
  // ==========================================
  // METADATA TOOLS
  // ==========================================

  get_tool_requirements: {
    name: 'get_tool_requirements',
    description: 'Get scope and capability requirements for a specific tool',
    category: 'metadata',
    type: 'read',
    implementationStatus: 'implemented',
    requirements: {
      requiresTargetResource: false,
    },
    exampleUsage: 'What are the requirements for list_manageable_apps?',
  },

  get_operation_requirements: {
    name: 'get_operation_requirements',
    description: 'Get requirements for a specific API operation',
    category: 'metadata',
    type: 'read',
    implementationStatus: 'implemented',
    requirements: {
      requiresTargetResource: false,
    },
    exampleUsage: 'What are the requirements for the Apps API?',
  },

  explain_why_tool_is_unavailable: {
    name: 'explain_why_tool_is_unavailable',
    description: 'Explain why a tool is not available to the current user',
    category: 'metadata',
    type: 'read',
    implementationStatus: 'implemented',
    requirements: {
      requiresTargetResource: false,
    },
    exampleUsage: 'Why can\'t I use manage_app_entitlements?',
  },

  list_available_tools_for_current_user: {
    name: 'list_available_tools_for_current_user',
    description: 'List all tools available to the current user based on authorization',
    category: 'metadata',
    type: 'read',
    implementationStatus: 'implemented',
    requirements: {
      requiresTargetResource: false,
    },
    exampleUsage: 'What governance tools can I use?',
  },

  // ==========================================
  // DISCOVERY TOOLS
  // ==========================================

  list_manageable_apps: {
    name: 'list_manageable_apps',
    description: 'List governance-enabled applications manageable in your current authorization scope',
    category: 'discovery',
    type: 'read',
    implementationStatus: 'implemented',
    requirements: {
      scopes: ['okta.apps.read'],
      capabilities: ['entitlements.manage.owned', 'labels.manage.owned', 'entitlements.manage.all', 'labels.manage.all'],
      roles: ['APP_ADMIN', 'SUPER_ADMIN'],
      requiresTargetResource: false,
    },
    exampleUsage: 'What apps can I manage?',
  },

  // ==========================================
  // REPORTING TOOLS
  // ==========================================

  generate_app_activity_report: {
    name: 'generate_app_activity_report',
    description: 'Generate activity and audit reports from system logs for applications (last 60 days by default)',
    category: 'reporting',
    type: 'read',
    implementationStatus: 'implemented',
    requirements: {
      scopes: ['okta.logs.read'],
      capabilities: ['systemlogs.read.owned', 'systemlogs.read.all'],
      requiresTargetResource: true,
    },
    exampleUsage: 'Generate activity report for Salesforce.com',
  },

  generate_access_review_candidates: {
    name: 'generate_access_review_candidates',
    description: 'Generate list of inactive users for access certification review',
    category: 'reporting',
    type: 'read',
    implementationStatus: 'implemented',
    requirements: {
      scopes: ['okta.apps.read', 'okta.users.read'],
      capabilities: ['users.read.owned', 'users.read.all'],
      requiresTargetResource: true,
    },
    exampleUsage: 'Show inactive users for Salesforce.com',
  },

  // ==========================================
  // GOVERNANCE TOOLS (WRITE)
  // ==========================================

  manage_app_labels: {
    name: 'manage_app_labels',
    description: 'Intelligently manage governance labels for applications (create, apply, remove, list, verify)',
    category: 'governance',
    type: 'write',
    implementationStatus: 'implemented',
    requirements: {
      scopes: ['okta.governance.labels.read', 'okta.governance.labels.manage'],
      capabilities: ['labels.manage.owned', 'labels.manage.all'],
      roles: ['APP_ADMIN', 'SUPER_ADMIN'],
      requiresTargetResource: true,
    },
    notes: 'Uses Postman endpoint registry for accurate API calls. Smart workflow creates labels if needed.',
    exampleUsage: 'Create a label called high-risk for Salesforce.com',
  },

  manage_app_campaigns: {
    name: 'manage_app_campaigns',
    description: 'Create and manage access certification campaigns for applications',
    category: 'governance',
    type: 'write',
    implementationStatus: 'stub',
    requirements: {
      scopes: ['okta.governance.campaigns.read', 'okta.governance.campaigns.manage'],
      capabilities: ['campaigns.manage.owned', 'campaigns.manage.all'],
      roles: ['APP_ADMIN', 'SUPER_ADMIN'],
      requiresTargetResource: true,
    },
    notes: 'Requires confirmation before execution. Backend currently stubbed.',
    exampleUsage: 'Create review campaign for Salesforce.com',
  },

  manage_app_entitlements: {
    name: 'manage_app_entitlements',
    description: 'Manage application entitlements (roles, permissions, access levels)',
    category: 'management',
    type: 'write',
    implementationStatus: 'stub',
    requirements: {
      scopes: ['okta.governance.entitlements.read', 'okta.governance.entitlements.manage'],
      capabilities: ['entitlements.manage.owned', 'entitlements.manage.all'],
      roles: ['APP_ADMIN', 'SUPER_ADMIN'],
      requiresTargetResource: true,
    },
    notes: 'Requires confirmation before execution. Backend currently stubbed.',
    exampleUsage: 'List entitlements for Salesforce.com',
  },

  manage_app_bundles: {
    name: 'manage_app_bundles',
    description: 'Manage application bundles (collections of apps for provisioning)',
    category: 'management',
    type: 'write',
    implementationStatus: 'stub',
    requirements: {
      scopes: ['okta.governance.bundles.read', 'okta.governance.bundles.manage'],
      capabilities: ['bundles.manage.owned', 'bundles.manage.all'],
      roles: ['APP_ADMIN', 'SUPER_ADMIN'],
      requiresTargetResource: false,
    },
    notes: 'Requires confirmation before execution. Backend currently stubbed.',
    exampleUsage: 'Create bundle for new hires',
  },

  create_delegated_access_request: {
    name: 'create_delegated_access_request',
    description: 'Create access requests on behalf of users (delegated request)',
    category: 'management',
    type: 'write',
    implementationStatus: 'stub',
    requirements: {
      scopes: ['okta.governance.accessRequests.manage'],
      capabilities: ['accessRequests.manage.owned', 'accessRequests.manage.all'],
      roles: ['APP_ADMIN', 'SUPER_ADMIN'],
      requiresTargetResource: true,
    },
    notes: 'Requires confirmation before execution. Backend currently stubbed.',
    exampleUsage: 'Request Salesforce access for john@example.com',
  },

  manage_app_workflows: {
    name: 'manage_app_workflows',
    description: 'Manage governance workflows for applications (approval flows, automation)',
    category: 'management',
    type: 'write',
    implementationStatus: 'stub',
    requirements: {
      scopes: ['okta.governance.workflows.read', 'okta.governance.workflows.manage'],
      capabilities: ['workflows.manage.owned', 'workflows.manage.all'],
      roles: ['APP_ADMIN', 'SUPER_ADMIN'],
      requiresTargetResource: true,
    },
    notes: 'Requires confirmation before execution. Backend currently stubbed.',
    exampleUsage: 'Configure approval workflow for Salesforce.com',
  },
};

/**
 * Get metadata for a specific tool
 */
export function getToolMetadata(toolName: string): ToolMetadata | null {
  return TOOL_METADATA[toolName] || null;
}

/**
 * Get all tools in a category
 */
export function getToolsByCategory(category: ToolMetadata['category']): ToolMetadata[] {
  return Object.values(TOOL_METADATA).filter((tool) => tool.category === category);
}

/**
 * Get all tools by type
 */
export function getToolsByType(type: ToolMetadata['type']): ToolMetadata[] {
  return Object.values(TOOL_METADATA).filter((tool) => tool.type === type);
}

/**
 * Get all tools by implementation status
 */
export function getToolsByStatus(status: ToolMetadata['implementationStatus']): ToolMetadata[] {
  return Object.values(TOOL_METADATA).filter((tool) => tool.implementationStatus === status);
}

/**
 * Check if a tool is a write operation
 */
export function isWriteTool(toolName: string): boolean {
  const metadata = getToolMetadata(toolName);
  return metadata?.type === 'write';
}

/**
 * Check if a tool is implemented
 */
export function isToolImplemented(toolName: string): boolean {
  const metadata = getToolMetadata(toolName);
  return metadata?.implementationStatus === 'implemented';
}

/**
 * Get tool badge labels
 */
export function getToolBadges(toolName: string): string[] {
  const metadata = getToolMetadata(toolName);
  if (!metadata) return [];

  const badges: string[] = [];

  // Type badge
  badges.push(metadata.type.toUpperCase());

  // Implementation status badge
  if (metadata.implementationStatus === 'implemented') {
    badges.push('READY');
  } else if (metadata.implementationStatus === 'stub') {
    badges.push('PREVIEW');
  } else if (metadata.implementationStatus === 'partial') {
    badges.push('PARTIAL');
  }

  // Category badge
  badges.push(metadata.category.toUpperCase());

  return badges;
}

/**
 * Get all tool names
 */
export function getAllToolNames(): string[] {
  return Object.keys(TOOL_METADATA);
}

/**
 * Get tool count by status
 */
export function getToolStats() {
  const all = Object.values(TOOL_METADATA);
  return {
    total: all.length,
    implemented: all.filter((t) => t.implementationStatus === 'implemented').length,
    stub: all.filter((t) => t.implementationStatus === 'stub').length,
    read: all.filter((t) => t.type === 'read').length,
    write: all.filter((t) => t.type === 'write').length,
  };
}

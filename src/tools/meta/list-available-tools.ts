/**
 * List available tools
 *
 * Lists all tools available to the current user based on their authorization context
 */

import { getAllToolRequirements } from '../../catalog/tool-requirements.js';
import { canAccessTool } from '../../policy/policy-engine.js';
import type { ToolDefinition } from '../types.js';
import { createJsonResponse } from '../types.js';

export const listAvailableToolsTool: ToolDefinition = {
  definition: {
    name: 'list_available_tools_for_current_user',
    description:
      'List all MCP tools available to the current user based on their roles, capabilities, and permissions. Use this to discover what actions the user can perform.',
    inputSchema: {
      type: 'object',
      properties: {
        includeUnavailable: {
          type: 'boolean',
          description: 'If true, also include tools that are unavailable with reasons why',
        },
        filterByCategory: {
          type: 'string',
          description: 'Filter tools by endpoint category (e.g., "Campaigns", "Labels")',
        },
        includeMetadata: {
          type: 'boolean',
          description: 'If true, include metadata tools (default: true)',
        },
      },
    },
  },

  async handler(args, context) {
    const {
      includeUnavailable = false,
      filterByCategory,
      includeMetadata = true,
    } = args as {
      includeUnavailable?: boolean;
      filterByCategory?: string;
      includeMetadata?: boolean;
    };

    const allRequirements = getAllToolRequirements();
    const available: Array<{
      name: string;
      description: string;
      available: boolean;
      reason?: string;
      requiredScopes?: string[];
      requiredCapabilities?: string[];
      requiredRoles?: string[];
      requiresTargetResource?: boolean;
      endpointCategories?: string[];
      isMetadataTool?: boolean;
    }> = [];

    for (const [name, requirement] of Object.entries(allRequirements.requirements)) {
      // Filter out metadata tools if requested
      if (!includeMetadata && requirement.isMetadataTool) {
        continue;
      }

      // Filter by category if requested
      if (filterByCategory) {
        if (!requirement.endpointCategories.includes(filterByCategory)) {
          continue;
        }
      }

      const canAccess = canAccessTool(context, requirement);

      if (canAccess || includeUnavailable) {
        const entry = {
          name,
          description: requirement.description,
          available: canAccess,
          requiredScopes: requirement.requiredScopes,
          requiredCapabilities: requirement.requiredCapabilities,
          requiredRoles: requirement.requiredRoles,
          requiresTargetResource: requirement.requiresTargetResource,
          endpointCategories: requirement.endpointCategories,
          isMetadataTool: requirement.isMetadataTool,
          ...((!canAccess && {
            reason: getMissingReason(context, requirement),
          }) as { reason?: string }),
        };

        available.push(entry);
      }
    }

    // Organize by category
    const byCategory: Record<string, typeof available> = {};
    const metadataTools: typeof available = [];
    const uncategorized: typeof available = [];

    for (const tool of available) {
      if (tool.isMetadataTool) {
        metadataTools.push(tool);
      } else if (tool.endpointCategories && tool.endpointCategories.length > 0) {
        for (const cat of tool.endpointCategories) {
          if (!byCategory[cat]) {
            byCategory[cat] = [];
          }
          byCategory[cat].push(tool);
        }
      } else {
        uncategorized.push(tool);
      }
    }

    const summary = {
      totalTools: available.length,
      availableTools: available.filter((t) => t.available).length,
      unavailableTools: available.filter((t) => !t.available).length,
      metadataTools: metadataTools.length,
      governanceTools: available.length - metadataTools.length,

      userContext: {
        roles: context.roles,
        capabilities: context.capabilities,
        ownedApps: context.targets.apps.length,
        ownedGroups: context.targets.groups.length,
      },

      tools: {
        metadata: metadataTools,
        byCategory,
        uncategorized,
      },

      // Flat list for backwards compatibility
      allTools: available,
    };

    return createJsonResponse(summary);
  },
};

/**
 * Get reason why tool is unavailable
 */
function getMissingReason(context: any, requirement: any): string {
  const missingCapabilities = requirement.requiredCapabilities.filter(
    (cap: string) => !context.capabilities.includes(cap)
  );

  if (missingCapabilities.length > 0) {
    return `Missing capabilities: ${missingCapabilities.join(', ')}`;
  }

  // Check roles
  if (requirement.requiredRoles && requirement.requiredRoles.length > 0) {
    const hasRole = requirement.requiredRoles.some((role: string) => {
      switch (role) {
        case 'SUPER_ADMIN':
          return context.roles.superAdmin;
        case 'APP_ADMIN':
          return context.roles.appAdmin;
        case 'GROUP_ADMIN':
          return context.roles.groupAdmin;
        default:
          return false;
      }
    });

    if (!hasRole) {
      return `Requires one of: ${requirement.requiredRoles.join(', ')}`;
    }
  }

  // Check targets
  if (requirement.requiresTargetResource) {
    const hasTargets =
      (requirement.targetConstraints.includes('must_be_owned_app') &&
        context.targets.apps.length > 0) ||
      (requirement.targetConstraints.includes('must_be_owned_group') &&
        context.targets.groups.length > 0);

    if (!hasTargets) {
      return `Requires owned resources (apps or groups)`;
    }
  }

  return 'Unknown reason';
}

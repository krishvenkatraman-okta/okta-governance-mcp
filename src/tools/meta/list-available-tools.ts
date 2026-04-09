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
      },
    },
  },

  async handler(args, context) {
    const { includeUnavailable = false } = args as { includeUnavailable?: boolean };

    const allRequirements = getAllToolRequirements();
    const available: Array<{
      name: string;
      description: string;
      available: boolean;
      reason?: string;
    }> = [];

    for (const [name, requirement] of Object.entries(allRequirements.requirements)) {
      const canAccess = canAccessTool(context, requirement);

      if (canAccess || includeUnavailable) {
        const entry = {
          name,
          description: requirement.description,
          available: canAccess,
          ...((!canAccess && {
            reason: getMissingReason(context, requirement),
          }) as { reason?: string }),
        };

        available.push(entry);
      }
    }

    const summary = {
      totalTools: available.length,
      availableTools: available.filter((t) => t.available).length,
      unavailableTools: available.filter((t) => !t.available).length,
      userRoles: context.roles,
      userCapabilities: context.capabilities,
      tools: available,
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

  return 'Unknown reason';
}

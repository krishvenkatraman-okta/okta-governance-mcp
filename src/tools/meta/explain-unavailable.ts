/**
 * Explain why tool is unavailable
 *
 * Provides explanation for why a tool is not available to the current user
 */

import { getToolRequirement } from '../../catalog/tool-requirements.js';
import { canAccessTool } from '../../policy/policy-engine.js';
import type { ToolDefinition } from '../types.js';
import { createTextResponse, createErrorResponse } from '../types.js';

export const explainUnavailableTool: ToolDefinition = {
  definition: {
    name: 'explain_why_tool_is_unavailable',
    description:
      'Explain why a specific tool is not available to the current user. Use this when a user asks why they cannot use a particular tool or feature.',
    inputSchema: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description: 'The name of the tool to explain',
        },
      },
      required: ['toolName'],
    },
  },

  async handler(args, context) {
    const { toolName } = args as { toolName: string };

    if (!toolName) {
      return createErrorResponse('toolName parameter is required');
    }

    const requirement = getToolRequirement(toolName);

    if (!requirement) {
      return createTextResponse(
        `The tool '${toolName}' is not registered in the system. This could mean:\n` +
          `- The tool name is misspelled\n` +
          `- The tool has not been implemented yet\n` +
          `- The tool is not part of the Okta Governance MCP server`
      );
    }

    // Check if user can access this tool
    const canAccess = canAccessTool(context, requirement);

    if (canAccess) {
      return createTextResponse(
        `The tool '${toolName}' is available to you. You have the required capabilities to use it.`
      );
    }

    // Tool is unavailable - explain why
    const missingCapabilities = requirement.requiredCapabilities.filter(
      (cap) => !context.capabilities.includes(cap)
    );

    let explanation = `The tool '${toolName}' is not available to you because:\n\n`;

    if (missingCapabilities.length > 0) {
      explanation += `**Missing Capabilities:**\n`;
      for (const cap of missingCapabilities) {
        explanation += `- ${cap}\n`;
      }
      explanation += `\n`;
    }

    if (requirement.requiredScopes.length > 0) {
      explanation += `**Required OAuth Scopes:**\n`;
      for (const scope of requirement.requiredScopes) {
        explanation += `- ${scope}\n`;
      }
      explanation += `\n`;
    }

    if (requirement.targetConstraints.length > 0 && requirement.targetConstraints[0] !== 'no_constraint') {
      explanation += `**Target Constraints:**\n`;
      for (const constraint of requirement.targetConstraints) {
        explanation += `- ${constraint}\n`;
      }
      explanation += `\n`;
    }

    explanation += `**What you need:**\n`;

    if (context.roles.regularUser && !context.roles.appAdmin && !context.roles.groupAdmin) {
      explanation += `You need to be assigned an admin role (such as App Admin or Super Admin) to access this tool.\n`;
    } else if (context.roles.appAdmin || context.roles.groupAdmin) {
      explanation += `You may need additional role assignments or resource targets (apps/groups) to access this tool.\n`;
    }

    return createTextResponse(explanation);
  },
};

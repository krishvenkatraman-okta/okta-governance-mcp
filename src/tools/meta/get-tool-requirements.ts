/**
 * Get tool requirements
 *
 * Returns scope and capability requirements for a specific tool
 */

import { getToolRequirement } from '../../catalog/tool-requirements.js';
import type { ToolDefinition } from '../types.js';
import { createTextResponse, createErrorResponse, createJsonResponse } from '../types.js';

export const getToolRequirementsTool: ToolDefinition = {
  definition: {
    name: 'get_tool_requirements',
    description:
      'Get the required OAuth scopes, capabilities, and constraints for a specific MCP tool. Use this to understand what permissions are needed to use a tool.',
    inputSchema: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description: 'The name of the tool to get requirements for',
        },
      },
      required: ['toolName'],
    },
  },

  async handler(args) {
    const { toolName } = args as { toolName: string };

    if (!toolName) {
      return createErrorResponse('toolName parameter is required');
    }

    const requirement = getToolRequirement(toolName);

    if (!requirement) {
      return createTextResponse(`Tool '${toolName}' is not registered in the system.`);
    }

    return createJsonResponse({
      tool: requirement.tool,
      description: requirement.description,
      requiredScopes: requirement.requiredScopes,
      optionalScopes: requirement.optionalScopes || [],
      requiredCapabilities: requirement.requiredCapabilities,
      targetConstraints: requirement.targetConstraints,
      endpointFamilies: requirement.endpointFamilies,
      documentation: requirement.documentation,
    });
  },
};

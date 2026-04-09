/**
 * Get tool requirements
 *
 * Returns scope and capability requirements for a specific tool
 */

import { getToolRequirement } from '../../catalog/tool-requirements.js';
import type { ToolDefinition } from '../types.js';
import type { AuthorizationContext, MissingRequirements } from '../../types/index.js';
import { createTextResponse, createErrorResponse, createJsonResponse } from '../types.js';

export const getToolRequirementsTool: ToolDefinition = {
  definition: {
    name: 'get_tool_requirements',
    description:
      'Get the required OAuth scopes, capabilities, roles, and constraints for a specific MCP tool. Use this to understand what permissions are needed to use a tool.',
    inputSchema: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description: 'The name of the tool to get requirements for',
        },
        includeAuthContext: {
          type: 'boolean',
          description: 'If true and authorization context is available, include missing requirements analysis',
        },
      },
      required: ['toolName'],
    },
  },

  async handler(args, context?: AuthorizationContext) {
    const { toolName, includeAuthContext = false } = args as {
      toolName: string;
      includeAuthContext?: boolean;
    };

    if (!toolName) {
      return createErrorResponse('toolName parameter is required');
    }

    const requirement = getToolRequirement(toolName);

    if (!requirement) {
      return createTextResponse(`Tool '${toolName}' is not registered in the system.`);
    }

    // Build base response
    const response: any = {
      tool: requirement.toolName,
      description: requirement.description,

      // Scope requirements
      requiredScopes: requirement.requiredScopes,
      conditionalScopes: requirement.conditionalScopes || [],

      // Authorization requirements
      requiredCapabilities: requirement.requiredCapabilities,
      requiredRoles: requirement.requiredRoles || [],
      targetConstraints: requirement.targetConstraints,

      // Endpoint mapping
      mappedEndpoints: requirement.mappedEndpoints,
      endpointCategories: requirement.endpointCategories,

      // Metadata
      isMetadataTool: requirement.isMetadataTool || false,
      requiresTargetResource: requirement.requiresTargetResource || false,

      // Documentation
      documentation: requirement.documentationRefs || [],
      notes: requirement.notes,
    };

    // Add missing requirements analysis if context provided
    if (includeAuthContext && context) {
      const missing = analyzeMissingRequirements(requirement, context);
      response.authorizationAnalysis = {
        canUse: missing.scopes.length === 0 &&
                missing.capabilities.length === 0 &&
                missing.roles.length === 0,
        missingRequirements: missing,
      };
    }

    return createJsonResponse(response);
  },
};

/**
 * Analyze what requirements are missing for the user
 */
function analyzeMissingRequirements(
  requirement: any,
  context: AuthorizationContext
): MissingRequirements {
  const missing: MissingRequirements = {
    scopes: [],
    capabilities: [],
    roles: [],
    targetConstraints: [],
    reason: '',
  };

  // Check capabilities
  for (const requiredCap of requirement.requiredCapabilities || []) {
    if (!context.capabilities.includes(requiredCap)) {
      missing.capabilities.push(requiredCap);
    }
  }

  // Check roles
  if (requirement.requiredRoles && requirement.requiredRoles.length > 0) {
    const hasRequiredRole = requirement.requiredRoles.some((role: string) => {
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

    if (!hasRequiredRole) {
      missing.roles = requirement.requiredRoles;
    }
  }

  // Check target constraints
  if (requirement.requiresTargetResource) {
    const hasTargets =
      (requirement.targetConstraints.includes('must_be_owned_app') &&
        context.targets.apps.length > 0) ||
      (requirement.targetConstraints.includes('must_be_owned_group') &&
        context.targets.groups.length > 0);

    if (!hasTargets) {
      missing.targetConstraints = requirement.targetConstraints;
    }
  }

  // Build reason
  if (missing.capabilities.length > 0) {
    missing.reason = `Missing capabilities: ${missing.capabilities.join(', ')}`;
  } else if (missing.roles.length > 0) {
    missing.reason = `Requires one of these roles: ${missing.roles.join(', ')}`;
  } else if (missing.targetConstraints.length > 0) {
    missing.reason = `Requires owned resources: ${missing.targetConstraints.join(', ')}`;
  }

  // Note: We don't check scopes here as they're validated server-side via OAuth

  return missing;
}

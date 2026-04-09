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

    const missingRoles = requirement.requiredRoles
      ? requirement.requiredRoles.filter((role) => {
          switch (role) {
            case 'SUPER_ADMIN':
              return !context.roles.superAdmin;
            case 'APP_ADMIN':
              return !context.roles.appAdmin;
            case 'GROUP_ADMIN':
              return !context.roles.groupAdmin;
            default:
              return true;
          }
        })
      : [];

    let explanation = `The tool '${toolName}' is not available to you.\n\n`;

    explanation += `**Tool Description:**\n${requirement.description}\n\n`;

    // Explain missing capabilities
    if (missingCapabilities.length > 0) {
      explanation += `**Missing Capabilities:**\n`;
      for (const cap of missingCapabilities) {
        explanation += `- ${cap}\n`;
      }
      explanation += `\n`;
    }

    // Explain missing roles
    if (missingRoles.length > 0) {
      explanation += `**Required Roles (you need at least one):**\n`;
      for (const role of requirement.requiredRoles || []) {
        const hasRole = !missingRoles.includes(role);
        explanation += `${hasRole ? '✓' : '✗'} ${role}\n`;
      }
      explanation += `\n`;
    }

    // Explain required scopes
    if (requirement.requiredScopes.length > 0) {
      explanation += `**Required OAuth Scopes:**\n`;
      for (const scope of requirement.requiredScopes) {
        explanation += `- ${scope}\n`;
      }
      explanation += `\n`;
    }

    // Explain target constraints
    if (requirement.requiresTargetResource) {
      explanation += `**Target Resource Required:**\n`;
      explanation += `This tool requires you to have ownership of specific resources.\n`;

      if (requirement.targetConstraints.includes('must_be_owned_app')) {
        const hasApps = context.targets.apps.length > 0;
        explanation += `${hasApps ? '✓' : '✗'} Owned Applications: ${
          hasApps ? context.targets.apps.length : 'None'
        }\n`;
      }

      if (requirement.targetConstraints.includes('must_be_owned_group')) {
        const hasGroups = context.targets.groups.length > 0;
        explanation += `${hasGroups ? '✓' : '✗'} Owned Groups: ${
          hasGroups ? context.targets.groups.length : 'None'
        }\n`;
      }
      explanation += `\n`;
    }

    // Explain conditional scopes if present
    if (requirement.conditionalScopes && requirement.conditionalScopes.length > 0) {
      explanation += `**Conditional Requirements:**\n`;
      for (const conditional of requirement.conditionalScopes) {
        explanation += `${conditional.condition}:\n`;
        for (const scope of conditional.scopes) {
          explanation += `  - ${scope}\n`;
        }
      }
      explanation += `\n`;
    }

    // Provide actionable guidance
    explanation += `**What you need:**\n`;

    if (context.roles.regularUser && !context.roles.appAdmin && !context.roles.groupAdmin) {
      explanation += `You need to be assigned an admin role. Contact your Okta administrator to request:\n`;
      explanation += `- App Admin role (with specific app targets)\n`;
      explanation += `- Or Super Admin role for full access\n`;
    } else if (context.roles.appAdmin && context.targets.apps.length === 0) {
      explanation += `You have the App Admin role but no app targets assigned.\n`;
      explanation += `Contact your Okta administrator to assign specific apps to your admin role.\n`;
    } else if (context.roles.groupAdmin && context.targets.groups.length === 0) {
      explanation += `You have the Group Admin role but no group targets assigned.\n`;
      explanation += `Contact your Okta administrator to assign specific groups to your admin role.\n`;
    } else {
      explanation += `You may need additional permissions or role assignments.\n`;
      explanation += `Contact your Okta administrator for assistance.\n`;
    }

    // Add notes if available
    if (requirement.notes) {
      explanation += `\n**Additional Notes:**\n${requirement.notes}\n`;
    }

    return createTextResponse(explanation);
  },
};

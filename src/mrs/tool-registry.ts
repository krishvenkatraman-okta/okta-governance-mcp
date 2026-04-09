/**
 * Dynamic tool registry
 *
 * Filters and exposes tools based on user authorization context
 */

import { getAllTools } from '../tools/index.js';
import { canAccessTool } from '../policy/policy-engine.js';
import type { AuthorizationContext, McpTool, Capability } from '../types/index.js';
import type { ToolDefinition } from '../tools/types.js';

/**
 * Get tools available to a user
 *
 * Filters the full tool list based on user's authorization context
 */
export function getAvailableTools(context: AuthorizationContext): McpTool[] {
  const allTools = getAllTools();
  const availableTools: McpTool[] = [];

  for (const tool of allTools) {
    // Get tool requirement from catalog
    const requirement = getToolRequirementForTool(tool);

    if (!requirement) {
      // If no requirement found, tool is metadata/explainability - always available
      availableTools.push(tool.definition);
      continue;
    }

    // Check if user can access this tool
    if (canAccessTool(context, requirement)) {
      availableTools.push(tool.definition);
    }
  }

  return availableTools;
}

/**
 * Get tool requirement from tool definition
 */
function getToolRequirementForTool(tool: ToolDefinition) {
  // Import dynamically to avoid circular dependency
  const { getToolRequirement } = require('../catalog/tool-requirements.js');
  return getToolRequirement(tool.definition.name);
}

/**
 * Check if user can access a specific tool
 */
export function canUserAccessTool(
  toolName: string,
  context: AuthorizationContext
): { allowed: boolean; reason?: string } {
  const { getToolRequirement } = require('../catalog/tool-requirements.js');
  const requirement = getToolRequirement(toolName);

  if (!requirement) {
    // Metadata tools are always accessible
    return { allowed: true };
  }

  const allowed = canAccessTool(context, requirement);

  if (!allowed) {
    const missingCapabilities = requirement.requiredCapabilities.filter(
      (cap: Capability) => !context.capabilities.includes(cap)
    );

    return {
      allowed: false,
      reason: `Missing capabilities: ${missingCapabilities.join(', ')}`,
    };
  }

  return { allowed: true };
}

/**
 * Tool requirements registry
 *
 * Maintains requirements for each MCP tool including:
 * - Required OAuth scopes
 * - Required capabilities
 * - Target constraints
 * - Endpoint families
 */

import type { ToolRequirement, ToolRequirementsRegistry } from '../types/index.js';

/**
 * Tool requirements registry
 *
 * This will be populated as concrete governance tools are implemented.
 * For now, it contains only the metadata/explainability tools.
 */
const requirements: Record<string, ToolRequirement> = {
  get_tool_requirements: {
    tool: 'get_tool_requirements',
    description: 'Get scope and capability requirements for a specific tool',
    requiredScopes: [],
    requiredCapabilities: [],
    targetConstraints: ['no_constraint'],
    endpointFamilies: [],
    documentation: 'Read-only metadata tool, no special permissions required',
  },

  get_operation_requirements: {
    tool: 'get_operation_requirements',
    description: 'Get requirements for a specific API operation',
    requiredScopes: [],
    requiredCapabilities: [],
    targetConstraints: ['no_constraint'],
    endpointFamilies: [],
    documentation: 'Read-only metadata tool, no special permissions required',
  },

  explain_why_tool_is_unavailable: {
    tool: 'explain_why_tool_is_unavailable',
    description: 'Explain why a tool is not available to the current user',
    requiredScopes: [],
    requiredCapabilities: [],
    targetConstraints: ['no_constraint'],
    endpointFamilies: [],
    documentation: 'Read-only metadata tool, no special permissions required',
  },

  list_available_tools_for_current_user: {
    tool: 'list_available_tools_for_current_user',
    description: 'List all tools available to the current user',
    requiredScopes: [],
    requiredCapabilities: [],
    targetConstraints: ['no_constraint'],
    endpointFamilies: [],
    documentation: 'Read-only metadata tool, no special permissions required',
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
  requirements[requirement.tool] = requirement;
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

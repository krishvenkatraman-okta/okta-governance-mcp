/**
 * Tool exports
 *
 * Central registry for all MCP tools
 */

import type { ToolDefinition } from './types.js';

// Metadata/explainability tools
import { getToolRequirementsTool } from './meta/get-tool-requirements.js';
import { getOperationRequirementsTool } from './meta/get-operation-requirements.js';
import { explainUnavailableTool } from './meta/explain-unavailable.js';
import { listAvailableToolsTool } from './meta/list-available-tools.js';

/**
 * All available tools
 *
 * Additional governance and admin tools will be added here as they are implemented
 */
export const allTools: ToolDefinition[] = [
  // Metadata/explainability tools (always available)
  getToolRequirementsTool,
  getOperationRequirementsTool,
  explainUnavailableTool,
  listAvailableToolsTool,

  // Governance tools will be added here:
  // - Campaign management
  // - Collection/bundle management
  // - Label management
  // - Entitlement management
  // - Access request workflows

  // Admin tools will be added here:
  // - App management (scoped)
  // - Group management (scoped)
  // - Role management

  // Reporting tools will be added here:
  // - System log reports (scoped)
];

/**
 * Get all tool definitions
 */
export function getAllTools(): ToolDefinition[] {
  return allTools;
}

/**
 * Get tool by name
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return allTools.find((tool) => tool.definition.name === name);
}

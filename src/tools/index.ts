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

// Implemented governance tools
import { listOwnedAppsTool } from './governance/list-owned-apps.js';
import { generateSyslogReportTool } from './governance/generate-syslog-report.js';
import { generateReviewCandidatesTool } from './governance/generate-review-candidates.js';

// Stubbed governance tools (authorization checks only)
import {
  manageOwnedAppEntitlementsTool,
  manageOwnedAppLabelsTool,
  createBundleForOwnedAppTool,
  createCampaignForOwnedAppTool,
  requestAccessForOtherUserTool,
  createAccessRequestWorkflowTool,
} from './governance/stubs.js';

/**
 * All available tools
 *
 * Tools are divided into:
 * - Metadata tools (always available, no special permissions)
 * - Implemented tools (fully functional)
 * - Stubbed tools (authorization checks only, execution pending)
 */
export const allTools: ToolDefinition[] = [
  // Metadata/explainability tools (always available)
  getToolRequirementsTool,
  getOperationRequirementsTool,
  explainUnavailableTool,
  listAvailableToolsTool,

  // Implemented governance tools
  listOwnedAppsTool,
  generateSyslogReportTool,
  generateReviewCandidatesTool,

  // Stubbed governance tools (authorization enforced, execution pending)
  manageOwnedAppEntitlementsTool,
  manageOwnedAppLabelsTool,
  createBundleForOwnedAppTool,
  createCampaignForOwnedAppTool,
  requestAccessForOtherUserTool,
  createAccessRequestWorkflowTool,
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

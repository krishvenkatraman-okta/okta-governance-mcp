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
import { listManageableAppsTool } from './governance/list-manageable-apps.js';
import { generateAppActivityReportTool } from './governance/generate-app-activity-report.js';
import { generateReviewCandidatesTool } from './governance/generate-review-candidates.js';
import { manageAppLabelsTool } from './governance/manage-app-labels.js';

// Stubbed governance tools (authorization checks only)
import {
  manageAppEntitlementsTool,
  manageAppBundlesTool,
  manageAppCampaignsTool,
  createDelegatedAccessRequestTool,
  manageAppWorkflowsTool,
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
  listManageableAppsTool,
  generateAppActivityReportTool,
  generateReviewCandidatesTool,

  // Stubbed governance tools (authorization enforced, execution pending)
  manageAppEntitlementsTool,
  manageAppLabelsTool,
  manageAppBundlesTool,
  manageAppCampaignsTool,
  createDelegatedAccessRequestTool,
  manageAppWorkflowsTool,
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

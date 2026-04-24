/**
 * Scope registry
 *
 * Extracts and aggregates all OAuth scopes required by MCP tools
 * from the tool requirements catalog.
 */

import { getAllToolRequirements } from '../catalog/tool-requirements.js';
import type { ToolRequirement } from '../types/index.js';

/**
 * Get all unique OAuth scopes from tool requirements
 *
 * Iterates through all registered tools and collects their required scopes.
 * Returns deduplicated, sorted list of scopes.
 *
 * @returns Array of unique scope strings
 */
export function getAllToolScopes(): string[] {
  const scopeSet = new Set<string>();

  const allRequirements = getAllToolRequirements();

  Object.values(allRequirements).forEach((req: ToolRequirement) => {
    req.requiredScopes.forEach((scope: string) => scopeSet.add(scope));
  });

  return Array.from(scopeSet).sort();
}

/**
 * Get tool capabilities grouped by category
 *
 * Returns structured information about what the MCP server can do,
 * organized by capability area with associated scopes.
 */
export function getToolCapabilities() {
  return {
    governance: {
      description: 'Access certification and campaign management',
      scopes: ['okta.governance.accessCertifications.read', 'okta.governance.accessCertifications.manage'],
      tools: ['manage_app_campaigns', 'manage_group_campaigns', 'generate_access_review_candidates'],
    },
    access_requests: {
      description: 'Access request management',
      scopes: ['okta.accessRequests.request.read'],
      tools: ['create_access_request', 'list_access_requests'],
    },
    app_management: {
      description: 'Application management and monitoring',
      scopes: ['okta.apps.read', 'okta.apps.manage'],
      tools: ['list_manageable_apps', 'generate_app_activity_report', 'manage_app_labels'],
    },
    group_management: {
      description: 'Group membership management',
      scopes: ['okta.groups.read', 'okta.groups.manage'],
      tools: ['list_manageable_groups', 'manage_group_membership', 'list_group_members', 'manage_group_campaigns'],
    },
    risk_analysis: {
      description: 'Risk detection and user activity analysis',
      scopes: ['okta.logs.read', 'okta.users.read'],
      tools: ['generate_app_activity_report', 'generate_access_review_candidates'],
    },
  };
}

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

  try {
    const allRequirements = getAllToolRequirements();

    if (!allRequirements) {
      console.warn('[ScopeRegistry] Tool requirements not available, using default scopes');
      return getDefaultScopes();
    }

    Object.values(allRequirements).forEach((req: ToolRequirement) => {
      if (req?.requiredScopes && Array.isArray(req.requiredScopes)) {
        req.requiredScopes.forEach((scope: string) => scopeSet.add(scope));
      }
    });

    // If no scopes found, return defaults
    if (scopeSet.size === 0) {
      console.warn('[ScopeRegistry] No scopes found in tool requirements, using defaults');
      return getDefaultScopes();
    }

    return Array.from(scopeSet).sort();
  } catch (error) {
    console.error('[ScopeRegistry] Error extracting scopes from tool requirements:', error);
    return getDefaultScopes();
  }
}

/**
 * Default scopes when tool requirements are not available
 */
function getDefaultScopes(): string[] {
  return [
    'okta.apps.read',
    'okta.apps.manage',
    'okta.groups.read',
    'okta.groups.manage',
    'okta.users.read',
    'okta.governance.accessCertifications.read',
    'okta.governance.accessCertifications.manage',
    'okta.accessRequests.request.read',
    'okta.logs.read',
    'okta.roles.read',
  ].sort();
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

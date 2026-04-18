/**
 * Tool: list_manageable_groups
 *
 * Lists groups manageable by the current user based on their GROUP_ADMIN role.
 * For Super Admins/Org Admins, returns all groups.
 * For Group Admins, returns only groups in their role targets.
 */

import { groupsClient } from '../../okta/groups-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse, OktaGroup } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Tool handler
 */
async function handler(
  _args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  console.log('[ListManageableGroups] Executing tool:', {
    subject: context.subject,
    roles: context.roles,
    targetGroupsCount: context.targets.groups.length,
  });

  try {
    // Check if user has any admin role that can manage groups
    if (context.roles.regularUser && !context.roles.groupAdmin && !context.roles.superAdmin && !context.roles.orgAdmin) {
      return createErrorResponse('Access denied: You do not have permission to manage groups. Requires GROUP_ADMIN, SUPER_ADMIN, or ORG_ADMIN role.');
    }

    // Get all groups from Okta
    const allGroups = await groupsClient.list({
      limit: 200,
    });

    console.log(`[ListManageableGroups] Retrieved ${allGroups.length} total groups`);

    // Filter by manageable groups based on authorization scope
    let manageableGroups: OktaGroup[];

    if (context.roles.superAdmin || context.roles.orgAdmin) {
      // Super Admin/Org Admin can see all groups (organization-wide scope)
      manageableGroups = allGroups;
      console.log('[ListManageableGroups] User has organization-wide access - returning all groups');
    } else if (context.roles.groupAdmin && context.targets.groups.length > 0) {
      // Group Admin can only see their target groups (scoped access)
      manageableGroups = groupsClient.filterByIds(allGroups, context.targets.groups);
      console.log(
        `[ListManageableGroups] User has scoped access - filtered to ${manageableGroups.length} manageable groups`
      );
    } else {
      // No groups manageable
      manageableGroups = [];
      console.log('[ListManageableGroups] User has no manageable groups');
    }

    // Format response
    const response = {
      total: manageableGroups.length,
      groups: manageableGroups.map((group) => ({
        id: group.id,
        name: group.profile.name,
        description: group.profile.description || null,
        type: group.type,
        created: group.created,
        lastUpdated: group.lastUpdated,
        lastMembershipUpdated: group.lastMembershipUpdated,
      })),
    };

    console.log(`[ListManageableGroups] Returning ${response.total} manageable groups`);

    return createJsonResponse(response);
  } catch (error) {
    console.error('[ListManageableGroups] Error:', error);
    return createErrorResponse(
      `Failed to list manageable groups: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Tool definition
 */
export const listManageableGroupsTool: ToolDefinition = {
  definition: {
    name: 'list_manageable_groups',
    description: 'List groups manageable in your current authorization scope. For organization-wide admins, returns all groups. For Group Admins, returns only groups in their role targets.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler,
};

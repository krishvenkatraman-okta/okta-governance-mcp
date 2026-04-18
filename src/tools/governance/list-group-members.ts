/**
 * Tool: list_group_members
 *
 * Lists members of a group. Enforces authorization - only group admins
 * can list members of groups they manage.
 */

import { groupsClient } from '../../okta/groups-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Tool arguments
 */
interface ListGroupMembersArgs {
  /**
   * Group ID to list members for
   */
  groupId: string;

  /**
   * Maximum number of members to return (default: 200)
   */
  limit?: number;
}

/**
 * Tool handler
 */
async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const { groupId, limit = 200 } = args as Partial<ListGroupMembersArgs>;

  console.log('[ListGroupMembers] Executing tool:', {
    subject: context.subject,
    groupId,
    limit,
  });

  // Validate required arguments
  if (!groupId) {
    return createErrorResponse('Missing required argument: groupId');
  }

  try {
    // Authorization check: Verify user can manage this group
    if (!context.roles.superAdmin && !context.roles.orgAdmin) {
      // Group Admin must have this group in their targets
      if (!context.roles.groupAdmin || !context.targets.groups.includes(groupId)) {
        console.warn('[ListGroupMembers] Access denied - group not in targets:', {
          groupId,
          userTargets: context.targets.groups,
        });
        return createErrorResponse(
          `Access denied: You do not have permission to manage group ${groupId}`
        );
      }
    }

    console.log('[ListGroupMembers] Fetching group details...');

    // Get group details
    const group = await groupsClient.getById(groupId);

    console.log('[ListGroupMembers] Fetching group members...');

    // Get group members
    const members = await groupsClient.listMembers(groupId, limit as number);

    console.log(`[ListGroupMembers] Found ${members.length} members in group ${group.profile.name}`);

    // Build response
    const response = {
      group: {
        id: group.id,
        name: group.profile.name,
        description: group.profile.description || null,
        type: group.type,
      },
      memberCount: members.length,
      members: members.map((member) => ({
        id: member.id,
        status: member.status,
        created: member.created,
        activated: member.activated,
        statusChanged: member.statusChanged,
        lastLogin: member.lastLogin,
        lastUpdated: member.lastUpdated,
        profile: {
          firstName: member.profile.firstName,
          lastName: member.profile.lastName,
          email: member.profile.email,
          login: member.profile.login,
        },
      })),
    };

    console.log('[ListGroupMembers] Report generated successfully');

    return createJsonResponse(response);
  } catch (error) {
    console.error('[ListGroupMembers] Error:', error);
    return createErrorResponse(
      `Failed to list group members: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Tool definition
 */
export const listGroupMembersTool: ToolDefinition = {
  definition: {
    name: 'list_group_members',
    description:
      'List members of a group. Only returns members for groups you have permission to manage.',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: {
          type: 'string',
          description: 'Group ID (e.g., 00g123456)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of members to return (default: 200)',
          default: 200,
        },
      },
      required: ['groupId'],
    },
  },
  handler,
};

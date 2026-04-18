/**
 * Tool: manage_group_membership
 *
 * Manage group membership - add/remove users or check membership.
 * Enforces authorization based on GROUP_ADMIN role targets.
 */

import { groupsClient } from '../../okta/groups-client.js';
import { usersClient } from '../../okta/users-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Tool arguments
 */
interface ManageGroupMembershipArgs {
  /**
   * Group ID
   */
  groupId: string;

  /**
   * User ID or login/email
   */
  userId: string;

  /**
   * Action to perform: check, add, remove
   */
  action: 'check' | 'add' | 'remove';
}

/**
 * Tool handler
 */
async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const { groupId, userId, action } = args as Partial<ManageGroupMembershipArgs>;

  console.log('[ManageGroupMembership] Executing tool:', {
    subject: context.subject,
    groupId,
    userId,
    action,
  });

  // Validate required arguments
  if (!groupId || !userId || !action) {
    return createErrorResponse('Missing required arguments: groupId, userId, action');
  }

  if (!['check', 'add', 'remove'].includes(action)) {
    return createErrorResponse('Invalid action. Must be one of: check, add, remove');
  }

  try {
    // Authorization check: Verify user can manage this group
    if (!context.roles.superAdmin && !context.roles.orgAdmin) {
      if (!context.roles.groupAdmin || !context.targets.groups.includes(groupId)) {
        console.warn('[ManageGroupMembership] Access denied - group not in targets:', {
          groupId,
          userTargets: context.targets.groups,
        });
        return createErrorResponse(
          `Access denied: You do not have permission to manage group ${groupId}`
        );
      }
    }

    console.log('[ManageGroupMembership] Fetching group details...');
    const group = await groupsClient.getById(groupId);

    console.log('[ManageGroupMembership] Resolving user...');
    const user = await usersClient.getByIdOrLogin(userId);

    // Execute action
    let result: any;

    switch (action) {
      case 'check': {
        console.log('[ManageGroupMembership] Checking membership...');
        const isMember = await groupsClient.isMember(groupId, user.id);
        result = {
          action: 'check',
          group: {
            id: group.id,
            name: group.profile.name,
          },
          user: {
            id: user.id,
            login: user.profile.login,
            email: user.profile.email,
            name: `${user.profile.firstName} ${user.profile.lastName}`,
          },
          isMember,
          message: isMember
            ? `User ${user.profile.login} is a member of group ${group.profile.name}`
            : `User ${user.profile.login} is NOT a member of group ${group.profile.name}`,
        };
        break;
      }

      case 'add': {
        console.log('[ManageGroupMembership] Adding user to group...');

        // Check if already a member
        const alreadyMember = await groupsClient.isMember(groupId, user.id);
        if (alreadyMember) {
          result = {
            action: 'add',
            group: {
              id: group.id,
              name: group.profile.name,
            },
            user: {
              id: user.id,
              login: user.profile.login,
              email: user.profile.email,
              name: `${user.profile.firstName} ${user.profile.lastName}`,
            },
            alreadyMember: true,
            message: `User ${user.profile.login} is already a member of group ${group.profile.name}`,
          };
        } else {
          await groupsClient.addMember(groupId, user.id);
          result = {
            action: 'add',
            group: {
              id: group.id,
              name: group.profile.name,
            },
            user: {
              id: user.id,
              login: user.profile.login,
              email: user.profile.email,
              name: `${user.profile.firstName} ${user.profile.lastName}`,
            },
            success: true,
            message: `Successfully added ${user.profile.login} to group ${group.profile.name}`,
          };
        }
        break;
      }

      case 'remove': {
        console.log('[ManageGroupMembership] Removing user from group...');

        // Check if user is a member
        const isMember = await groupsClient.isMember(groupId, user.id);
        if (!isMember) {
          result = {
            action: 'remove',
            group: {
              id: group.id,
              name: group.profile.name,
            },
            user: {
              id: user.id,
              login: user.profile.login,
              email: user.profile.email,
              name: `${user.profile.firstName} ${user.profile.lastName}`,
            },
            notMember: true,
            message: `User ${user.profile.login} is not a member of group ${group.profile.name}`,
          };
        } else {
          await groupsClient.removeMember(groupId, user.id);
          result = {
            action: 'remove',
            group: {
              id: group.id,
              name: group.profile.name,
            },
            user: {
              id: user.id,
              login: user.profile.login,
              email: user.profile.email,
              name: `${user.profile.firstName} ${user.profile.lastName}`,
            },
            success: true,
            message: `Successfully removed ${user.profile.login} from group ${group.profile.name}`,
          };
        }
        break;
      }
    }

    console.log('[ManageGroupMembership] Operation completed successfully');

    return createJsonResponse(result);
  } catch (error) {
    console.error('[ManageGroupMembership] Error:', error);
    return createErrorResponse(
      `Failed to manage group membership: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Tool definition
 */
export const manageGroupMembershipTool: ToolDefinition = {
  definition: {
    name: 'manage_group_membership',
    description:
      'Manage group membership - check if a user is in a group, add a user to a group, or remove a user from a group. Only works for groups you have permission to manage.',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: {
          type: 'string',
          description: 'Group ID (e.g., 00g123456)',
        },
        userId: {
          type: 'string',
          description: 'User ID (e.g., 00u123456) or login/email',
        },
        action: {
          type: 'string',
          enum: ['check', 'add', 'remove'],
          description: 'Action to perform: check (check membership), add (add user to group), remove (remove user from group)',
        },
      },
      required: ['groupId', 'userId', 'action'],
    },
  },
  handler,
};

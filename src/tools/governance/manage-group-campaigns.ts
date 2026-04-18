/**
 * Tool: manage_group_campaigns
 *
 * Create and manage access certification campaigns for groups.
 * Only group admins can create campaigns for groups they manage.
 */

import { groupsClient } from '../../okta/groups-client.js';
import { governanceClient } from '../../okta/governance-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Tool arguments
 */
interface ManageGroupCampaignsArgs {
  /**
   * Group ID
   */
  groupId: string;

  /**
   * Action to perform
   */
  action: 'list' | 'create' | 'launch';

  /**
   * Campaign name (required for create action)
   */
  name?: string;

  /**
   * Campaign ID (required for launch action)
   */
  campaignId?: string;

  /**
   * Campaign duration in days (default: 7)
   */
  durationInDays?: number;

  /**
   * Campaign description
   */
  description?: string;
}

/**
 * Tool handler
 */
async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const {
    groupId,
    action,
    name,
    campaignId,
    durationInDays = 7,
    description,
  } = args as Partial<ManageGroupCampaignsArgs>;

  console.log('[ManageGroupCampaigns] Executing tool:', {
    subject: context.subject,
    groupId,
    action,
  });

  // Validate required arguments
  if (!groupId || !action) {
    return createErrorResponse('Missing required arguments: groupId, action');
  }

  if (!['list', 'create', 'launch'].includes(action)) {
    return createErrorResponse('Invalid action. Must be one of: list, create, launch');
  }

  if (action === 'create' && !name) {
    return createErrorResponse('Missing required argument for create action: name');
  }

  if (action === 'launch' && !campaignId) {
    return createErrorResponse('Missing required argument for launch action: campaignId');
  }

  try {
    // Authorization check: Verify user can manage this group
    if (!context.roles.superAdmin && !context.roles.orgAdmin) {
      if (!context.roles.groupAdmin || !context.targets.groups.includes(groupId)) {
        console.warn('[ManageGroupCampaigns] Access denied - group not in targets:', {
          groupId,
          userTargets: context.targets.groups,
        });
        return createErrorResponse(
          `Access denied: You do not have permission to manage group ${groupId}`
        );
      }
    }

    console.log('[ManageGroupCampaigns] Fetching group details...');
    const group = await groupsClient.getById(groupId);

    // Build scopes string for governance API
    const scopes = 'okta.governance.accessCertifications.manage okta.governance.accessCertifications.read';

    // Execute action
    let result: any;

    switch (action) {
      case 'list': {
        console.log('[ManageGroupCampaigns] Listing campaigns...');
        const campaigns = await governanceClient.campaigns.list(scopes);

        // Filter campaigns related to this group
        const groupCampaigns = campaigns.filter((campaign: any) => {
          // Check if campaign targets this group
          const targetGroups = campaign.principalScopeSettings?.groupIds || [];
          return targetGroups.includes(groupId);
        });

        result = {
          action: 'list',
          group: {
            id: group.id,
            name: group.profile.name,
          },
          campaignCount: groupCampaigns.length,
          campaigns: groupCampaigns.map((campaign: any) => ({
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            campaignType: campaign.campaignType,
            created: campaign.created,
            lastUpdated: campaign.lastUpdated,
          })),
        };
        break;
      }

      case 'create': {
        console.log('[ManageGroupCampaigns] Creating campaign...');

        const now = new Date();
        const endDate = new Date(now.getTime() + (durationInDays as number) * 24 * 60 * 60 * 1000);

        // Create campaign payload
        const campaignData = {
          campaignType: 'GROUP_MEMBERSHIP',
          name: name as string,
          description: description || `Access review for group ${group.profile.name}`,
          status: 'SCHEDULED',
          scheduleSettings: {
            type: 'ONE_OFF',
            startDate: now.toISOString(),
            endDate: endDate.toISOString(),
            timeZone: 'UTC',
          },
          principalScopeSettings: {
            type: 'GROUP',
            groupIds: [groupId],
          },
          reviewerSettings: {
            type: 'GROUP_OWNER',
            selfReviewDisabled: false,
            justificationRequired: true,
          },
          remediationSettings: {
            accessRevoked: 'REMOVE',
            accessApproved: 'NO_ACTION',
            noResponse: 'NO_ACTION',
          },
        };

        const campaign = await governanceClient.campaigns.create(campaignData, scopes);

        result = {
          action: 'create',
          group: {
            id: group.id,
            name: group.profile.name,
          },
          campaign: {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            created: campaign.created,
          },
          message: `Campaign '${name}' created successfully for group ${group.profile.name}`,
          nextSteps: [
            `Launch the campaign using action 'launch' with campaignId '${campaign.id}'`,
            'Campaign will review group membership and allow reviewers to approve or deny access',
          ],
        };
        break;
      }

      case 'launch': {
        console.log('[ManageGroupCampaigns] Launching campaign...');

        await governanceClient.campaigns.launch(campaignId as string, scopes);

        result = {
          action: 'launch',
          group: {
            id: group.id,
            name: group.profile.name,
          },
          campaignId: campaignId as string,
          message: `Campaign launched successfully for group ${group.profile.name}`,
        };
        break;
      }
    }

    console.log('[ManageGroupCampaigns] Operation completed successfully');

    return createJsonResponse(result);
  } catch (error) {
    console.error('[ManageGroupCampaigns] Error:', error);
    return createErrorResponse(
      `Failed to manage group campaigns: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Tool definition
 */
export const manageGroupCampaignsTool: ToolDefinition = {
  definition: {
    name: 'manage_group_campaigns',
    description:
      'Create and manage access certification campaigns for groups. List existing campaigns, create new campaigns to review group membership, or launch campaigns. Only works for groups you have permission to manage.',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: {
          type: 'string',
          description: 'Group ID (e.g., 00g123456)',
        },
        action: {
          type: 'string',
          enum: ['list', 'create', 'launch'],
          description: 'Action: list (list campaigns for group), create (create new campaign), launch (launch a campaign)',
        },
        name: {
          type: 'string',
          description: 'Campaign name (required for create action)',
        },
        campaignId: {
          type: 'string',
          description: 'Campaign ID (required for launch action)',
        },
        durationInDays: {
          type: 'number',
          description: 'Campaign duration in days (default: 7)',
          default: 7,
        },
        description: {
          type: 'string',
          description: 'Campaign description (optional)',
        },
      },
      required: ['groupId', 'action'],
    },
  },
  handler,
};

/**
 * Tool: manage_app_campaigns
 *
 * Create and manage access certification campaigns for applications.
 * Supports creating campaigns, launching them, and listing existing campaigns.
 */

import { governanceClient } from '../../okta/governance-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Tool arguments
 */
interface ManageCampaignsArgs {
  /**
   * Application ID to create campaign for
   */
  appId: string;

  /**
   * Action to perform
   */
  action: 'list' | 'create' | 'launch';

  /**
   * Campaign name (required for create action)
   */
  name?: string;

  /**
   * Campaign description (optional for create action)
   */
  description?: string;

  /**
   * Campaign ID (required for launch action)
   */
  campaignId?: string;

  /**
   * User ID to create self-review campaign for (optional for create action)
   * If provided, creates a campaign where this user reviews their own access
   */
  userId?: string;

  /**
   * Duration in days for the campaign (default: 7)
   */
  durationInDays?: number;
}

/**
 * Tool handler
 */
async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const {
    appId,
    action,
    name,
    description,
    campaignId,
    userId,
    durationInDays = 7,
  } = args as Partial<ManageCampaignsArgs>;

  console.log('[ManageCampaigns] Executing tool:', {
    subject: context.subject,
    appId,
    action,
    campaignId,
    userId,
  });

  // Validate required arguments
  if (!appId || !action) {
    return createErrorResponse('Missing required arguments: appId and action');
  }

  // Validate action-specific requirements
  if (action === 'create' && !name) {
    return createErrorResponse('Missing required argument for create action: name');
  }

  if (action === 'launch' && !campaignId) {
    return createErrorResponse('Missing required argument for launch action: campaignId');
  }

  try {
    // Validate ownership: Check if app is in user's targets
    if (!context.roles.superAdmin && !context.targets.apps.includes(appId)) {
      console.warn('[ManageCampaigns] Access denied - app not in targets:', {
        appId,
        userTargets: context.targets.apps,
      });
      return createErrorResponse(
        `Access denied: You do not have permission to manage campaigns for app ${appId}`
      );
    }

    // Execute action
    switch (action) {
      case 'list':
        return await listCampaigns(appId, context);

      case 'create':
        return await createCampaign(
          appId,
          name!,
          description,
          userId,
          durationInDays,
          context
        );

      case 'launch':
        return await launchCampaign(campaignId!, context);

      default:
        return createErrorResponse(`Invalid action: ${action}`);
    }
  } catch (error) {
    console.error('[ManageCampaigns] Error:', error);
    return createErrorResponse(
      `Failed to ${action} campaign: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * List campaigns for an app
 */
async function listCampaigns(
  appId: string,
  _context: AuthorizationContext
): Promise<McpToolCallResponse> {
  console.log('[ManageCampaigns] Listing campaigns for app:', appId);

  const campaigns = await governanceClient.campaigns.list(
    'okta.governance.accessCertifications.read'
  );

  // Filter campaigns for this specific app
  const appCampaigns = campaigns.filter((campaign: any) => {
    const resourceSettings = campaign.resourceSettings;
    if (!resourceSettings?.targetResources) return false;

    return resourceSettings.targetResources.some(
      (resource: any) =>
        resource.resourceType === 'APPLICATION' && resource.resourceId === appId
    );
  });

  console.log(`[ManageCampaigns] Found ${appCampaigns.length} campaigns for app ${appId}`);

  return createJsonResponse({
    appId,
    totalCampaigns: appCampaigns.length,
    campaigns: appCampaigns.map((campaign: any) => ({
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      status: campaign.status,
      campaignType: campaign.campaignType,
      created: campaign.created,
      lastUpdated: campaign.lastUpdated,
    })),
  });
}

/**
 * Create a campaign for an app
 */
async function createCampaign(
  appId: string,
  name: string,
  description: string | undefined,
  userId: string | undefined,
  durationInDays: number,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  console.log('[ManageCampaigns] Creating campaign:', {
    appId,
    name,
    userId,
    durationInDays,
  });

  // Build campaign payload
  const startDate = new Date();
  const campaignPayload: any = {
    campaignType: 'RESOURCE',
    name,
    description: description || `Access review for application ${appId}`,
    status: 'ACTIVE',
    scheduleSettings: {
      type: 'ONE_OFF',
      startDate: startDate.toISOString(),
      durationInDays,
      timeZone: 'UTC',
    },
    resourceSettings: {
      targetTypes: ['APPLICATION'],
      targetResources: [
        {
          resourceType: 'APPLICATION',
          resourceId: appId,
        },
      ],
    },
    principalScopeSettings: {
      type: 'USERS',
    },
    remediationSettings: {
      accessRevoked: 'DENY',
      accessApproved: 'NO_ACTION',
      noResponse: 'NO_ACTION',
    },
  };

  // If userId is provided, create a self-review campaign for that specific user
  if (userId) {
    campaignPayload.principalScopeSettings.userIds = [userId];
    campaignPayload.reviewerSettings = {
      type: 'USER',
      reviewerId: userId,
      selfReviewDisabled: false,
      justificationRequired: false,
    };
  } else {
    // Default reviewer settings for general campaigns
    campaignPayload.reviewerSettings = {
      type: 'USER',
      reviewerId: context.subject,
      selfReviewDisabled: true,
      justificationRequired: true,
    };
  }

  // Create campaign
  const campaign = await governanceClient.campaigns.create(
    campaignPayload,
    'okta.governance.accessCertifications.manage'
  );

  console.log('[ManageCampaigns] Campaign created:', campaign.id);

  return createJsonResponse({
    success: true,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      status: campaign.status,
      campaignType: campaign.campaignType,
      created: campaign.created,
      scheduleSettings: campaign.scheduleSettings,
    },
    message: `Campaign "${name}" created successfully`,
  });
}

/**
 * Launch a campaign
 */
async function launchCampaign(
  campaignId: string,
  _context: AuthorizationContext
): Promise<McpToolCallResponse> {
  console.log('[ManageCampaigns] Launching campaign:', campaignId);

  await governanceClient.campaigns.launch(campaignId, 'okta.governance.accessCertifications.manage');

  console.log('[ManageCampaigns] Campaign launched successfully');

  return createJsonResponse({
    success: true,
    campaignId,
    message: 'Campaign launched successfully',
  });
}

/**
 * Tool definition
 */
export const manageAppCampaignsTool: ToolDefinition = {
  definition: {
    name: 'manage_app_campaigns',
    description:
      'Create and manage access certification campaigns for applications within your authorization scope',
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Application ID (e.g., 0oa123456)',
        },
        action: {
          type: 'string',
          enum: ['list', 'create', 'launch'],
          description: 'Action to perform: list campaigns, create a new campaign, or launch an existing campaign',
        },
        name: {
          type: 'string',
          description: 'Campaign name (required for create action)',
        },
        description: {
          type: 'string',
          description: 'Campaign description (optional for create action)',
        },
        campaignId: {
          type: 'string',
          description: 'Campaign ID (required for launch action)',
        },
        userId: {
          type: 'string',
          description:
            'User ID to create self-review campaign for (optional for create action). If provided, creates a campaign where this user reviews their own access',
        },
        durationInDays: {
          type: 'number',
          description: 'Duration in days for the campaign (default: 7)',
          default: 7,
        },
      },
      required: ['appId', 'action'],
    },
  },
  handler,
};

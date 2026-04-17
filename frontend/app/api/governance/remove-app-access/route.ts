/**
 * API Route: /api/governance/remove-app-access
 *
 * Creates a self-review campaign to remove a user's access to an application.
 * Uses the MCP server's manage_app_campaigns tool to create and launch the campaign.
 *
 * Flow:
 * 1. Get user session and MCP access token
 * 2. Validate request body (appId and userId)
 * 3. Call manage_app_campaigns MCP tool to create a self-review campaign
 * 4. Call manage_app_campaigns MCP tool to launch the campaign
 * 5. Return success response with campaign ID
 *
 * Campaign Approach:
 * - Creates a RESOURCE-type campaign targeting the specific app
 * - User is both the principal (being reviewed) and the reviewer (self-review)
 * - User can then deny their own access through the campaign to remove it
 * - This approach:
 *   - Uses existing Okta governance workflows
 *   - Creates audit trail of access removal
 *   - Allows user to change mind if needed
 *
 * Required:
 * - User must be authenticated (session.userId exists)
 * - Session must contain mcpAccessToken
 *
 * Request Body:
 * {
 *   appId: string,
 *   userId: string (optional, defaults to current user)
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   campaignId: string,
 *   message: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getMcpAccessToken } from '@/lib/token-cookies';
import { config } from '@/lib/config';

interface RemoveAccessRequest {
  appId: string;
  userId?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Step 1: Get user session
    const session = await getSession();

    if (!session.userId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'User not authenticated',
          },
        },
        { status: 401 }
      );
    }

    // Step 2: Get MCP access token
    const mcpAccessToken = await getMcpAccessToken();

    if (!mcpAccessToken) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NO_MCP_TOKEN',
            message: 'MCP access token not found in session',
          },
        },
        { status: 401 }
      );
    }

    // Step 3: Parse and validate request body
    const body: RemoveAccessRequest = await request.json();
    const { appId, userId = session.userId } = body;

    if (!appId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing required field: appId',
          },
        },
        { status: 400 }
      );
    }

    // Security check: Only allow users to remove their own access
    if (userId !== session.userId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You can only remove your own access',
          },
        },
        { status: 403 }
      );
    }

    console.log(`[RemoveAppAccess] Creating self-review campaign for user ${userId} and app ${appId}`);

    // Step 4: Create campaign using MCP tool
    const createResponse = await fetch(config.mcp.endpoints.toolsCall, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mcpAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'manage_app_campaigns',
        arguments: {
          appId,
          action: 'create',
          name: `Self-Review: Remove Access`,
          description: `User-initiated access removal for unused application`,
          userId, // Creates self-review campaign for this user
          durationInDays: 7,
        },
      }),
    });

    if (!createResponse.ok) {
      console.error('[RemoveAppAccess] Failed to create campaign:', createResponse.statusText);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CAMPAIGN_CREATE_ERROR',
            message: 'Failed to create access removal campaign',
          },
        },
        { status: 500 }
      );
    }

    const createResult = await createResponse.json();

    // Parse campaign creation response
    if (!createResult.content || createResult.content.length === 0) {
      console.error('[RemoveAppAccess] Invalid campaign creation response');
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_RESPONSE',
            message: 'Invalid response from campaign creation',
          },
        },
        { status: 500 }
      );
    }

    const createContent = createResult.content[0];
    let campaignId: string;

    if (createContent.type === 'text' && createContent.text) {
      const data = JSON.parse(createContent.text);
      campaignId = data.campaign?.id;

      if (!campaignId) {
        console.error('[RemoveAppAccess] No campaign ID in response');
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'NO_CAMPAIGN_ID',
              message: 'Campaign created but no ID returned',
            },
          },
          { status: 500 }
        );
      }
    } else {
      console.error('[RemoveAppAccess] Unexpected response format');
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_RESPONSE',
            message: 'Unexpected response format from campaign creation',
          },
        },
        { status: 500 }
      );
    }

    console.log(`[RemoveAppAccess] Campaign created: ${campaignId}, launching...`);

    // Step 5: Launch the campaign
    const launchResponse = await fetch(config.mcp.endpoints.toolsCall, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mcpAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'manage_app_campaigns',
        arguments: {
          appId,
          action: 'launch',
          campaignId,
        },
      }),
    });

    if (!launchResponse.ok) {
      console.error('[RemoveAppAccess] Failed to launch campaign:', launchResponse.statusText);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CAMPAIGN_LAUNCH_ERROR',
            message: `Campaign created (${campaignId}) but failed to launch`,
          },
          campaignId, // Return campaign ID so user can manually launch if needed
        },
        { status: 500 }
      );
    }

    console.log(`[RemoveAppAccess] Campaign ${campaignId} launched successfully`);

    // Step 6: Return success response
    return NextResponse.json({
      success: true,
      campaignId,
      message: `Access removal campaign created and launched. You can now review and confirm the removal in your access certification dashboard.`,
    });
  } catch (error: any) {
    console.error('[RemoveAppAccess] Unexpected error:', error);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: error?.message || 'Unknown error occurred',
        },
      },
      { status: 500 }
    );
  }
}

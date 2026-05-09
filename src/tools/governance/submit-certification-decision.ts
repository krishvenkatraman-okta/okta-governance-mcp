/**
 * Tool: submit_certification_decision
 *
 * Submits an approve or revoke decision for a certification review item.
 * Uses the authenticated user's token (not the service app) since this
 * is a user-scoped action — the reviewer is making the decision.
 */

import { governanceClient } from '../../okta/governance-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

interface SubmitDecisionArgs {
  campaignId: string;
  reviewItemId: string;
  decision: 'APPROVE' | 'REVOKE';
  reviewerLevelId?: string;
  note?: string;
}

async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const {
    campaignId,
    reviewItemId,
    decision,
    reviewerLevelId = 'ONE',
    note,
  } = args as Partial<SubmitDecisionArgs>;

  // Validate required arguments
  if (!campaignId) {
    return createErrorResponse('Missing required argument: campaignId');
  }
  if (!reviewItemId) {
    return createErrorResponse('Missing required argument: reviewItemId');
  }
  if (!decision || !['APPROVE', 'REVOKE'].includes(decision)) {
    return createErrorResponse('Missing or invalid argument: decision (must be "APPROVE" or "REVOKE")');
  }

  // This tool requires the user's token for the API call
  if (!context.userToken) {
    return createErrorResponse(
      'User token not available. The certification decision endpoint requires the reviewer\'s own access token. ' +
      'Ensure you are authenticated with a user token (not just a service token).'
    );
  }

  console.log('[SubmitCertDecision] Executing:', {
    subject: context.subject,
    campaignId,
    reviewItemId,
    decision,
    reviewerLevelId,
    hasNote: !!note,
  });

  try {
    const result = await governanceClient.reviews.submitDecision(
      campaignId,
      reviewItemId,
      decision,
      reviewerLevelId,
      note,
      context.userToken
    );

    console.log('[SubmitCertDecision] Decision submitted successfully:', {
      reviewItemId,
      decision,
    });

    return createJsonResponse({
      success: true,
      reviewItemId,
      decision,
      note: note || null,
      message: `Successfully ${decision === 'APPROVE' ? 'approved' : 'revoked'} review item ${reviewItemId}`,
      result,
    });
  } catch (error) {
    console.error('[SubmitCertDecision] Error:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Provide helpful context for common errors
    if (errorMessage.includes('401') || errorMessage.includes('403')) {
      return createErrorResponse(
        `Authorization error submitting decision: ${errorMessage}\n\n` +
        'This may mean:\n' +
        '- Your token has expired (re-authenticate)\n' +
        '- You are not the designated reviewer for this item\n' +
        '- The campaign is not in an active state'
      );
    }

    if (errorMessage.includes('404')) {
      return createErrorResponse(
        `Review item not found: ${errorMessage}\n\n` +
        'Verify the campaignId and reviewItemId are correct.'
      );
    }

    return createErrorResponse(
      `Failed to submit decision: ${errorMessage}`
    );
  }
}

export const submitCertificationDecisionTool: ToolDefinition = {
  definition: {
    name: 'submit_certification_decision',
    description:
      'Submit an approve or revoke decision for a certification review item. ' +
      'This action is performed as the authenticated reviewer. ' +
      'Use list_my_certification_reviews first to get the campaignId and reviewItemId, ' +
      'then use get_certification_review_detail to understand the context before deciding.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: {
          type: 'string',
          description: 'The campaign ID that contains the review item.',
        },
        reviewItemId: {
          type: 'string',
          description: 'The review item ID to submit a decision for.',
        },
        decision: {
          type: 'string',
          enum: ['APPROVE', 'REVOKE'],
          description: 'The decision: APPROVE to keep access, REVOKE to remove access.',
        },
        reviewerLevelId: {
          type: 'string',
          description: 'The reviewer level ID for multi-level campaigns. Default: "ONE" (first level). Use the currReviewerLevel from the review detail.',
        },
        note: {
          type: 'string',
          description: 'Optional justification note for the decision.',
        },
      },
      required: ['campaignId', 'reviewItemId', 'decision'],
    },
  },
  handler,
};

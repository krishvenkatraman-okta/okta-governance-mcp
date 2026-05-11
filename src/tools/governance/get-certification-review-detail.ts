/**
 * Tool: get_certification_review_detail
 *
 * Gets full details on a specific certification review item from the
 * end-user Governance API, including contextual info, risk analysis,
 * AI recommendation, and entitlement details.
 */

import { governanceClient } from '../../okta/governance-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

interface GetCertReviewDetailArgs {
  campaignId: string;
  reviewItemId: string;
}

async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const { campaignId, reviewItemId } = args as Partial<GetCertReviewDetailArgs>;

  if (!campaignId) {
    return createErrorResponse('Missing required argument: campaignId');
  }
  if (!reviewItemId) {
    return createErrorResponse('Missing required argument: reviewItemId');
  }
  if (!context.userToken) {
    return createErrorResponse(
      'User token not available. This tool requires the reviewer\'s Org Auth Server token.'
    );
  }

  console.log('[GetCertReviewDetail] Executing:', {
    subject: context.subject,
    campaignId,
    reviewItemId,
  });

  try {
    // Fetch the user's review items and find the specific one
    // The end-user API doesn't have a single-item GET — we search by filter
    const items = await governanceClient.reviews.listMyReviewItems(
      campaignId,
      context.userToken,
      { limit: 200 }
    );

    const allItems = Array.isArray(items) ? items : [];
    const review = allItems.find((r: any) => r.id === reviewItemId);

    if (!review) {
      return createErrorResponse(
        `Review item ${reviewItemId} not found in campaign ${campaignId}. ` +
        'It may not be assigned to you or may have already been decided.'
      );
    }

    // Build comprehensive detail response
    const detail = {
      reviewItemId: review.id,
      campaignId: review.campaignId,
      decision: review.decision,
      remediationStatus: review.remediationStatus,
      reviewerLevel: review.currReviewerLevel,
      delegated: review.delegated || false,

      // Principal being reviewed
      principal: {
        id: review.principalProfile?.id,
        firstName: review.principalProfile?.firstName,
        lastName: review.principalProfile?.lastName,
        email: review.principalProfile?.email,
        status: review.principalProfile?.status,
      },

      // User contextual info (richer than principalProfile)
      userContext: review.reviewItemContextualInfo?.userInfo || null,

      // Resource/app being reviewed
      resource: {
        id: review.resourceUnderReview?.id,
        type: review.resourceUnderReview?.type,
        name: review.reviewItemContextualInfo?.appInfo?.label
          || review.reviewItemContextualInfo?.groupInfo?.name
          || null,
      },

      // App-specific context
      appContext: review.reviewItemContextualInfo?.appInfo ? {
        assignedDate: review.reviewItemContextualInfo.appInfo.assignedDate,
        assignmentType: review.reviewItemContextualInfo.appInfo.assignmentType,
        applicationUsage: review.reviewItemContextualInfo.appInfo.applicationUsage,
        groups: review.reviewItemContextualInfo.appInfo.groupMembershipAssignedTo?.map(
          (g: any) => ({ id: g.id, name: g.name })
        ) || [],
        entitlements: review.reviewItemContextualInfo.appInfo.activeEntitlements?.map(
          (e: any) => ({
            setName: e.name,
            values: e.values?.map((v: any) => ({ id: v.id, name: v.name })),
          })
        ) || [],
      } : null,

      // Risk analysis
      riskItems: (review.riskItems || []).map((ri: any) => ({
        attribute: ri.riskAttribute,
        label: ri.riskLabel,
        level: ri.riskLevel,
        reason: ri.reason?.message?.replace(
          /\{(\d+)\}/g,
          (_: string, i: string) => ri.reason?.args?.[parseInt(i)]?.value || `{${i}}`
        ),
      })),

      // SOD conflicts
      sodConflicts: review.sodConflicts || [],

      // AI recommendation
      aiRecommendation: review.govAnalyzerRecommendationContext?.recommendedReviewDecision || null,

      // Previous note
      note: review.note?.note || null,

      // Metadata
      created: review.createdDate,
      lastUpdated: review.lastUpdate,
    };

    return createJsonResponse(detail);
  } catch (error) {
    console.error('[GetCertReviewDetail] Error:', error);
    return createErrorResponse(
      `Failed to get review detail: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export const getCertificationReviewDetailTool: ToolDefinition = {
  definition: {
    name: 'get_certification_review_detail',
    description:
      'Get full details on a specific certification review item including ' +
      'the principal\'s profile, app/entitlement details, risk analysis, ' +
      'SOD conflicts, AI recommendation, and assignment context. ' +
      'Requires both campaignId and reviewItemId.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: {
          type: 'string',
          description: 'The campaign ID containing the review item.',
        },
        reviewItemId: {
          type: 'string',
          description: 'The review item ID to get details for.',
        },
      },
      required: ['campaignId', 'reviewItemId'],
    },
  },
  handler,
};

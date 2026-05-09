/**
 * Tool: get_certification_review_detail
 *
 * Gets full details on a specific certification review item, including
 * the principal's profile, entitlement details, risk rule conflicts,
 * and the multi-level reviewer chain.
 */

import { governanceClient } from '../../okta/governance-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

const SCOPES = 'okta.governance.accessCertifications.read';

interface GetCertReviewDetailArgs {
  reviewId: string;
}

async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const { reviewId } = args as Partial<GetCertReviewDetailArgs>;

  if (!reviewId) {
    return createErrorResponse('Missing required argument: reviewId');
  }

  console.log('[GetCertReviewDetail] Executing:', {
    subject: context.subject,
    reviewId,
  });

  try {
    // Use service app token (with ACCESS_CERTIFICATIONS_ADMIN role) for reads
    const review = await governanceClient.reviews.getById(reviewId, SCOPES);

    // Verify the authenticated user is a reviewer on this item
    // context.subject may be login/email or Okta user ID, so check both
    const matchesUser = (profile: any) =>
      profile?.id === context.subject || profile?.email === context.subject;
    const isReviewer =
      matchesUser(review.reviewerProfile) ||
      review.allReviewerLevels?.some((l: any) => matchesUser(l.reviewerProfile));

    if (!isReviewer && !context.roles.superAdmin && !context.roles.orgAdmin) {
      return createErrorResponse(
        `Access denied: You are not a reviewer on item ${reviewId}`
      );
    }

    // Build a comprehensive detail response
    const detail = {
      reviewId: review.id,
      campaignId: review.campaignId,
      decision: review.decision,
      decidedAt: review.decided || null,
      remediationStatus: review.remediationStatus,

      // Who is being reviewed
      principal: {
        id: review.principalProfile?.id,
        firstName: review.principalProfile?.firstName,
        lastName: review.principalProfile?.lastName,
        email: review.principalProfile?.email,
        status: review.principalProfile?.status,
        type: review.principalProfile?.type,
      },

      // What access is being reviewed
      entitlement: {
        bundleName: review.entitlementBundle?.name || null,
        bundleId: review.entitlementBundle?.id || null,
        valueName: review.entitlementValue?.name || null,
        valueId: review.entitlementValue?.id || null,
        externalValue: review.entitlementValue?.externalValue || null,
      },

      // Resource being accessed
      resourceId: review.resourceId,
      assignmentType: review.assignmentType,

      // Risk information
      riskRuleConflicts: review.riskRuleConflicts || [],
      hasRiskConflicts: (review.riskRuleConflicts?.length || 0) > 0,

      // Review chain
      currentReviewerLevel: review.currentReviewerLevel,
      delegated: review.delegated || false,
      reviewerChain: (review.allReviewerLevels || []).map((level: any) => ({
        level: level.reviewerLevel,
        decision: level.decision,
        reviewer: {
          id: level.reviewerProfile?.id,
          name: `${level.reviewerProfile?.firstName || ''} ${level.reviewerProfile?.lastName || ''}`.trim(),
          email: level.reviewerProfile?.email,
        },
        decidedAt: level.lastUpdated,
      })),

      // Previous note if any
      note: review.note?.note || null,

      // Metadata
      created: review.created,
      lastUpdated: review.lastUpdated,
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
      'Get full details on a specific certification review item. ' +
      'Returns the principal being reviewed, their entitlement/access details, ' +
      'risk rule conflicts, the multi-level reviewer chain, and current decision status. ' +
      'Use this to understand the context before making an approve/revoke decision.',
    inputSchema: {
      type: 'object',
      properties: {
        reviewId: {
          type: 'string',
          description: 'The review item ID to get details for.',
        },
      },
      required: ['reviewId'],
    },
  },
  handler,
};

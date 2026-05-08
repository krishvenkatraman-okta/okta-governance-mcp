/**
 * Tool: list_my_certification_reviews
 *
 * Lists pending certification review items assigned to the authenticated user.
 * Filters reviews from the Okta Governance API to only show items where the
 * current user is the reviewer.
 */

import { governanceClient } from '../../okta/governance-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

const SCOPES = 'okta.governance.accessCertifications.read';

interface ListCertReviewsArgs {
  campaignId?: string;
  status?: 'UNREVIEWED' | 'APPROVE' | 'REVOKE';
  limit?: number;
}

async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const {
    campaignId,
    status = 'UNREVIEWED',
    limit = 50,
  } = args as Partial<ListCertReviewsArgs>;

  console.log('[ListCertReviews] Executing:', {
    subject: context.subject,
    campaignId,
    status,
    limit,
  });

  try {
    // Build filter — always filter by decision status
    let filter = `decision eq "${status}"`;
    if (campaignId) {
      filter += ` and campaignId eq "${campaignId}"`;
    }

    const reviews = await governanceClient.reviews.list(filter, limit, SCOPES);

    // Normalize response — API may return array or {data: [...]}
    const items = Array.isArray(reviews) ? reviews : (reviews as any).data || [reviews];

    // Filter to only reviews assigned to the current user
    const myReviews = items.filter((r: any) => {
      // Check if user is the reviewer at any level
      if (r.reviewerProfile?.id === context.subject) return true;
      if (r.allReviewerLevels?.some((l: any) => l.reviewerProfile?.id === context.subject)) return true;
      return false;
    });

    // Simplify the response for the LLM
    const simplified = myReviews.map((r: any) => ({
      reviewId: r.id,
      campaignId: r.campaignId,
      decision: r.decision,
      principal: {
        id: r.principalProfile?.id,
        name: `${r.principalProfile?.firstName || ''} ${r.principalProfile?.lastName || ''}`.trim(),
        email: r.principalProfile?.email,
        status: r.principalProfile?.status,
      },
      entitlement: r.entitlementBundle?.name || r.entitlementValue?.name || 'Unknown',
      entitlementDetail: r.entitlementValue?.externalValue || null,
      resourceId: r.resourceId,
      assignmentType: r.assignmentType,
      currentReviewerLevel: r.currentReviewerLevel,
      riskConflicts: r.riskRuleConflicts?.length || 0,
      delegated: r.delegated || false,
    }));

    return createJsonResponse({
      totalFound: items.length,
      assignedToYou: simplified.length,
      filter: { status, campaignId: campaignId || 'all' },
      reviews: simplified,
    });
  } catch (error) {
    console.error('[ListCertReviews] Error:', error);
    return createErrorResponse(
      `Failed to list certification reviews: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export const listMyCertificationReviewsTool: ToolDefinition = {
  definition: {
    name: 'list_my_certification_reviews',
    description:
      'List pending access certification review items assigned to you. ' +
      'Returns review items with principal (user being reviewed), entitlement details, ' +
      'risk conflicts, and current decision status. Use this to see what needs your review.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: {
          type: 'string',
          description: 'Filter to a specific campaign ID. Omit to see reviews across all campaigns.',
        },
        status: {
          type: 'string',
          enum: ['UNREVIEWED', 'APPROVE', 'REVOKE'],
          description: 'Filter by decision status. Default: UNREVIEWED (pending items).',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of reviews to return. Default: 50.',
        },
      },
    },
  },
  handler,
};

/**
 * Tool: list_my_certification_reviews
 *
 * Lists pending certification review items assigned to the authenticated user.
 * Uses the end-user Governance API (/api/v1/governance/) which is pre-filtered
 * to the reviewer and returns rich contextual data.
 */

import { governanceClient } from '../../okta/governance-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

interface ListCertReviewsArgs {
  campaignId?: string;
  status?: 'UNREVIEWED' | 'APPROVE' | 'REVOKE';
  limit?: number;
  search?: string;
  sortBy?: string;
}

async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const {
    campaignId,
    status = 'UNREVIEWED',
    limit = 50,
    search,
    sortBy,
  } = args as Partial<ListCertReviewsArgs>;

  if (!context.userToken) {
    return createErrorResponse(
      'User token not available. This tool requires the reviewer\'s Org Auth Server token. ' +
      'Ensure bearer-passthrough is configured on the adapter.'
    );
  }

  console.log('[ListCertReviews] Executing:', {
    subject: context.subject,
    campaignId,
    status,
    limit,
    search,
  });

  try {
    // If no campaignId, first list the user's campaigns
    if (!campaignId) {
      const campaigns = await governanceClient.reviews.listMyCampaigns(
        context.userToken,
        { status: 'READY', sortBy: 'endTime', sortOrder: 'ASC', limit: 10 }
      );

      const campaignList = Array.isArray(campaigns) ? campaigns : [];

      if (campaignList.length === 0) {
        return createJsonResponse({
          message: 'No active certification campaigns assigned to you.',
          campaigns: [],
        });
      }

      // Return campaign list with summary counts and reviewer level context
      return createJsonResponse({
        message: `You have ${campaignList.length} active campaign(s). Specify a campaignId to see review items.`,
        campaigns: campaignList.map((c: any) => ({
          campaignId: c.id,
          name: c.template?.name || 'Unknown',
          status: c.status,
          summary: c.campaignSummary,
          yourReviewerLevel: c.reviewerLevelOfReviewer,
          assignedLevels: c.assignedReviewerLevels,
          dueDate: c.endDateForReviewerLevel || c.endTime,
        })),
        note: 'Multi-level campaigns have separate reviewer levels. ' +
          'Items at currReviewerLevel matching your level are ready for YOUR review. ' +
          'Items at a different level are waiting for another reviewer at that level.',
      });
    }

    // List review items for a specific campaign
    const filter = status ? `decision eq "${status}"` : undefined;
    const items = await governanceClient.reviews.listMyReviewItems(
      campaignId,
      context.userToken,
      { filter, search, sortBy, sortOrder: sortBy ? 'ASC' : undefined, limit }
    );

    const reviewItems = Array.isArray(items) ? items : [];

    // Simplify for the LLM — include the rich contextual data
    const simplified = reviewItems.map((r: any) => ({
      reviewItemId: r.id,
      campaignId: r.campaignId,
      decision: r.decision,
      currentItemLevel: r.currReviewerLevel,
      readyForYourReview: r.decision === 'UNREVIEWED',
      levelNote: r.currReviewerLevel === 'ONE'
        ? 'Level 1 review (manager review) — ready for your action'
        : r.currReviewerLevel === 'TWO'
          ? 'Level 2 review (resource owner review) — Level 1 was already approved'
          : `Level ${r.currReviewerLevel} review`,

      // Who is being reviewed
      principal: {
        name: `${r.principalProfile?.firstName || ''} ${r.principalProfile?.lastName || ''}`.trim(),
        email: r.principalProfile?.email,
        status: r.principalProfile?.status,
      },

      // What resource/app
      resource: r.reviewItemContextualInfo?.appInfo?.label
        || r.reviewItemContextualInfo?.groupInfo?.name
        || r.resourceUnderReview?.type
        || 'Unknown',

      // Entitlements
      entitlements: r.reviewItemContextualInfo?.appInfo?.activeEntitlements?.map((e: any) => ({
        name: e.name,
        values: e.values?.map((v: any) => v.name),
      })) || [],

      // Assignment details
      assignmentType: r.assignmentType,
      assignedVia: r.reviewItemContextualInfo?.appInfo?.groupMembershipAssignedTo?.map(
        (g: any) => g.name
      ) || [],
      assignedDate: r.reviewItemContextualInfo?.appInfo?.assignedDate,
      applicationUsage: r.reviewItemContextualInfo?.appInfo?.applicationUsage,

      // Risk analysis
      riskItems: r.riskItems?.map((ri: any) => ({
        label: ri.riskLabel,
        level: ri.riskLevel,
        reason: ri.reason?.message?.replace(
          /\{(\d+)\}/g,
          (_: string, i: string) => ri.reason?.args?.[parseInt(i)]?.value || `{${i}}`
        ),
      })) || [],

      // AI recommendation
      recommendation: r.govAnalyzerRecommendationContext?.recommendedReviewDecision || null,

      // SOD conflicts
      sodConflicts: r.sodConflicts?.length || 0,
    }));

    // Summarize by reviewer level
    const byLevel: Record<string, number> = {};
    for (const item of simplified) {
      const level = item.currentItemLevel || 'UNKNOWN';
      byLevel[level] = (byLevel[level] || 0) + 1;
    }

    return createJsonResponse({
      totalItems: simplified.length,
      itemsByLevel: byLevel,
      filter: { status, campaignId, search: search || null },
      note: 'Items are shown at their CURRENT reviewer level. ' +
        'All items returned are assigned to you for review at their respective levels. ' +
        'Level ONE items are first-level (manager) reviews. ' +
        'Level TWO items already passed Level 1 and are now at resource-owner review.',
      reviewItems: simplified,
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
      'List your pending access certification review items. ' +
      'Without a campaignId, returns your active campaigns with summary counts. ' +
      'With a campaignId, returns review items with risk analysis, AI recommendations, ' +
      'entitlement details, and assignment context.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: {
          type: 'string',
          description: 'Campaign ID to list review items for. Omit to see your active campaigns first.',
        },
        status: {
          type: 'string',
          enum: ['UNREVIEWED', 'APPROVE', 'REVOKE'],
          description: 'Filter by decision status. Default: UNREVIEWED.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of items to return. Default: 50.',
        },
        search: {
          type: 'string',
          description: 'Free-text search across review items (name, email, etc).',
        },
        sortBy: {
          type: 'string',
          description: 'Sort field. Examples: decision, principal.firstName, govAnalyzerRecommendationContext.recommendedReviewDecision',
        },
      },
    },
  },
  handler,
};

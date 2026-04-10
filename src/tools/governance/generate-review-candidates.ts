/**
 * Tool: generate_access_review_candidates
 *
 * Generates a list of users who should be reviewed for access removal.
 * Uses system log analysis to identify inactive users with high-risk access.
 *
 * Risk-based criteria:
 * - HIGH: No access in >90 days or 0 accesses
 * - MEDIUM: No access in >45 days or <5 accesses
 * - LOW: Some activity but declining usage
 */

import { appsClient } from '../../okta/apps-client.js';
import { detectInactiveUsers } from '../../policy/risk-engine.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Tool arguments
 */
interface GenerateReviewCandidatesArgs {
  /**
   * Application ID to analyze
   */
  appId: string;

  /**
   * Number of days to look back for inactivity (default: 60)
   */
  inactivityDays?: number;

  /**
   * Minimum risk level to include (default: LOW, includes all)
   */
  minRiskLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
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
    inactivityDays = 60,
    minRiskLevel = 'LOW',
  } = args as Partial<GenerateReviewCandidatesArgs>;

  console.log('[GenerateReviewCandidates] Executing tool:', {
    subject: context.subject,
    appId,
    inactivityDays,
    minRiskLevel,
  });

  // Validate required argument
  if (!appId) {
    return createErrorResponse('Missing required argument: appId');
  }

  try {
    // Validate ownership: Check if app is in user's targets
    if (!context.roles.superAdmin && !context.targets.apps.includes(appId)) {
      console.warn('[GenerateReviewCandidates] Access denied - app not in targets:', {
        appId,
        userTargets: context.targets.apps,
      });
      return createErrorResponse(
        `Access denied: You do not have permission to review access for app ${appId}`
      );
    }

    console.log('[GenerateReviewCandidates] Fetching app details...');

    // Get app details
    const app = await appsClient.getById(appId);

    console.log('[GenerateReviewCandidates] Analyzing user activity...');

    // Detect inactive users using risk engine
    const inactiveUsers = await detectInactiveUsers(appId, inactivityDays);

    console.log(`[GenerateReviewCandidates] Detected ${inactiveUsers.length} inactive users`);

    // Filter by minimum risk level
    const riskOrder = { HIGH: 2, MEDIUM: 1, LOW: 0 };
    const minRiskValue = riskOrder[minRiskLevel];
    const filteredUsers = inactiveUsers.filter(
      (user) => riskOrder[user.riskLevel] >= minRiskValue
    );

    console.log(`[GenerateReviewCandidates] Filtered to ${filteredUsers.length} users meeting risk threshold`);

    // Calculate risk distribution
    const riskDistribution = {
      high: filteredUsers.filter((u) => u.riskLevel === 'HIGH').length,
      medium: filteredUsers.filter((u) => u.riskLevel === 'MEDIUM').length,
      low: filteredUsers.filter((u) => u.riskLevel === 'LOW').length,
    };

    // Build response
    const response = {
      app: {
        id: app.id,
        name: app.name,
        label: app.label,
        status: app.status,
      },
      analysisParameters: {
        inactivityDays,
        minRiskLevel,
        analyzedPeriod: {
          from: new Date(Date.now() - inactivityDays * 24 * 60 * 60 * 1000).toISOString(),
          to: new Date().toISOString(),
        },
      },
      summary: {
        totalCandidates: filteredUsers.length,
        riskDistribution,
        recommendations: {
          immediate: riskDistribution.high,
          review: riskDistribution.medium,
          monitor: riskDistribution.low,
        },
      },
      candidates: filteredUsers.map((user) => ({
        userId: user.userId,
        userLogin: user.userLogin,
        lastAccess: user.lastAccess,
        daysSinceLastAccess: user.daysSinceLastAccess,
        accessCount: user.accessCount,
        riskLevel: user.riskLevel,
        reason: user.reason,
        recommendation: getRecommendation(user.riskLevel),
      })),
      nextSteps: [
        'Review high-risk candidates for immediate access removal',
        'Schedule access certification campaign for medium-risk users',
        'Monitor low-risk users for continued inactivity',
      ],
    };

    console.log('[GenerateReviewCandidates] Report generated successfully');

    return createJsonResponse(response);
  } catch (error) {
    console.error('[GenerateReviewCandidates] Error:', error);
    return createErrorResponse(
      `Failed to generate review candidates: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get action recommendation based on risk level
 */
function getRecommendation(riskLevel: string): string {
  switch (riskLevel) {
    case 'HIGH':
      return 'Remove access immediately';
    case 'MEDIUM':
      return 'Include in next access review';
    case 'LOW':
      return 'Monitor for continued inactivity';
    default:
      return 'Review manually';
  }
}

/**
 * Tool definition
 */
export const generateReviewCandidatesTool: ToolDefinition = {
  definition: {
    name: 'generate_access_review_candidates',
    description:
      'Generate a list of users who should be reviewed for access removal based on inactivity and risk analysis',
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Application ID to analyze (e.g., 0oa123456)',
        },
        inactivityDays: {
          type: 'number',
          description: 'Number of days to look back for inactivity (default: 60)',
          default: 60,
        },
        minRiskLevel: {
          type: 'string',
          enum: ['HIGH', 'MEDIUM', 'LOW'],
          description: 'Minimum risk level to include in results (default: LOW, includes all)',
          default: 'LOW',
        },
      },
      required: ['appId'],
    },
  },
  handler,
};

/**
 * Tool: detect_entitlement_outliers
 *
 * Identifies users whose access deviates significantly from their peer
 * group (default: same department + title). Returns a ranked list of
 * outlier users along with their outlier entitlements and per-item
 * peer coverage stats.
 */

import { buildAccessGraph } from '../../analytics/access-graph.js';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_OUTLIER_THRESHOLD,
  DEFAULT_PEER_GROUPING_STRATEGY,
  detectOutliers,
} from '../../analytics/outlier-detector.js';
import {
  DEFAULT_MIN_PEER_GROUP_SIZE,
  type PeerGroupingStrategy,
} from '../../analytics/peer-grouper.js';
import { checkScopeToOwnedAppsOrAll } from '../../policy/scope-constraint.js';
import { createErrorResponse, createJsonResponse } from '../types.js';
import type {
  AuthorizationContext,
  McpToolCallResponse,
} from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Tool arguments for `detect_entitlement_outliers`.
 */
interface DetectOutliersArgs {
  scopeType: 'app' | 'group' | 'department' | 'all';
  scopeId?: string;
  peerGroupingStrategy?: PeerGroupingStrategy;
  outlierThreshold?: number;
  minPeerGroupSize?: number;
  maxResults?: number;
}

const VALID_SCOPE_TYPES = ['app', 'group', 'department', 'all'] as const;
const VALID_PEER_STRATEGIES: PeerGroupingStrategy[] = [
  'department_title',
  'department',
  'manager',
];

async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext,
): Promise<McpToolCallResponse> {
  const {
    scopeType,
    scopeId,
    peerGroupingStrategy,
    outlierThreshold,
    minPeerGroupSize,
    maxResults,
  } = args as Partial<DetectOutliersArgs>;

  console.log('[DetectEntitlementOutliers] Executing tool:', {
    subject: context.subject,
    scopeType,
    scopeId,
    peerGroupingStrategy,
    outlierThreshold,
    minPeerGroupSize,
    maxResults,
  });

  if (!scopeType) {
    return createErrorResponse('Missing required argument: scopeType');
  }

  if (!VALID_SCOPE_TYPES.includes(scopeType as (typeof VALID_SCOPE_TYPES)[number])) {
    return createErrorResponse(
      `Invalid scopeType: ${scopeType}. Must be one of: ${VALID_SCOPE_TYPES.join(', ')}`,
    );
  }

  if (scopeType !== 'all' && !scopeId) {
    return createErrorResponse(
      `scopeId is required when scopeType is "${scopeType}"`,
    );
  }

  if (
    peerGroupingStrategy !== undefined &&
    !VALID_PEER_STRATEGIES.includes(peerGroupingStrategy as PeerGroupingStrategy)
  ) {
    return createErrorResponse(
      `Invalid peerGroupingStrategy: ${peerGroupingStrategy}. Must be one of: ${VALID_PEER_STRATEGIES.join(', ')}`,
    );
  }

  if (
    outlierThreshold !== undefined &&
    (outlierThreshold < 0 || outlierThreshold > 1)
  ) {
    return createErrorResponse('outlierThreshold must be between 0 and 1');
  }

  if (minPeerGroupSize !== undefined && minPeerGroupSize < 2) {
    return createErrorResponse('minPeerGroupSize must be at least 2');
  }

  // Arg-aware scope constraint check (after the policy engine has already
  // confirmed the user holds either analytics.outliers.owned or .all).
  const constraint = checkScopeToOwnedAppsOrAll(
    context,
    { scopeType, scopeId },
    'analytics.outliers.all',
  );
  if (!constraint.allowed) {
    console.log(
      '[DetectEntitlementOutliers] Scope constraint rejected:',
      constraint.reason,
    );
    return createErrorResponse(constraint.reason ?? 'Scope check failed');
  }

  try {
    console.log('[DetectEntitlementOutliers] Building access graph...');
    const snapshot = await buildAccessGraph({ scopeType, scopeId });

    console.log(
      `[DetectEntitlementOutliers] Snapshot ready (${snapshot.users.length} users) — running detector`,
    );
    const result = detectOutliers(snapshot, {
      peerGroupingStrategy,
      outlierThreshold,
      minPeerGroupSize,
      maxResults,
    });

    console.log(
      `[DetectEntitlementOutliers] Detection complete — ${result.outliers.length} outlier(s) returned`,
    );

    return createJsonResponse({
      scopeDescription: snapshot.scopeDescription,
      totalUsersAnalyzed: snapshot.users.length,
      analysisParameters: {
        peerGroupingStrategy:
          peerGroupingStrategy ?? DEFAULT_PEER_GROUPING_STRATEGY,
        outlierThreshold: outlierThreshold ?? DEFAULT_OUTLIER_THRESHOLD,
        minPeerGroupSize: minPeerGroupSize ?? DEFAULT_MIN_PEER_GROUP_SIZE,
        maxResults: maxResults ?? DEFAULT_MAX_RESULTS,
      },
      outliers: result.outliers,
      summary: result.summary,
    });
  } catch (error) {
    console.error('[DetectEntitlementOutliers] Error:', error);
    return createErrorResponse(
      `Failed to detect entitlement outliers: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
}

export const detectEntitlementOutliersTool: ToolDefinition = {
  definition: {
    name: 'detect_entitlement_outliers',
    description:
      'Identifies users whose access deviates significantly from their peer group (default: same department + title). Returns a ranked list of users with their outlier entitlements and per-item peer coverage stats.',
    inputSchema: {
      type: 'object',
      properties: {
        scopeType: {
          type: 'string',
          enum: ['app', 'group', 'department', 'all'],
          description:
            'Scope of users to analyze: a single app, a single group, a department, or all active users.',
        },
        scopeId: {
          type: 'string',
          description:
            'Required unless scopeType is "all". App ID, Group ID, or department name as appropriate.',
        },
        peerGroupingStrategy: {
          type: 'string',
          enum: ['department_title', 'department', 'manager'],
          description:
            'How to bucket users into peer groups (default: department_title).',
          default: 'department_title',
        },
        outlierThreshold: {
          type: 'number',
          description:
            'Fraction (0-1). Access nodes held by fewer than this fraction of a user\'s peers are flagged as outliers (default 0.10).',
          default: 0.10,
        },
        minPeerGroupSize: {
          type: 'number',
          description:
            'Drop peer groups smaller than this — they don\'t yield statistically meaningful comparisons (default 5).',
          default: 5,
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of outlier users to return (default 25).',
          default: 25,
        },
      },
      required: ['scopeType'],
    },
  },
  handler,
};

/**
 * Tool: mine_candidate_roles
 *
 * Discovers candidate roles by clustering users with similar access
 * patterns within a scope. Returns proposals ranked by confidence,
 * with member lists and common access sets. Outputs are PROPOSALS —
 * actual group creation requires a separate explicit tool invocation.
 */

import { buildAccessGraph } from '../../analytics/access-graph.js';
import { mineRoles } from '../../analytics/role-miner.js';
import { checkScopeToOwnedAppsOrAll } from '../../policy/scope-constraint.js';
import { createErrorResponse, createJsonResponse } from '../types.js';
import type {
  AuthorizationContext,
  McpToolCallResponse,
} from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Tool arguments for `mine_candidate_roles`.
 */
interface MineCandidateRolesArgs {
  scopeType: 'app' | 'group' | 'department' | 'all';
  scopeId?: string;
  minClusterSize?: number;
  similarityThreshold?: number;
  commonAccessThreshold?: number;
  maxResults?: number;
}

const VALID_SCOPE_TYPES = ['app', 'group', 'department', 'all'] as const;

async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const {
    scopeType,
    scopeId,
    minClusterSize,
    similarityThreshold,
    commonAccessThreshold,
    maxResults,
  } = args as Partial<MineCandidateRolesArgs>;

  console.log('[MineCandidateRoles] Executing tool:', {
    subject: context.subject,
    scopeType,
    scopeId,
    minClusterSize,
    similarityThreshold,
    commonAccessThreshold,
    maxResults,
  });

  if (!scopeType) {
    return createErrorResponse('Missing required argument: scopeType');
  }

  if (!VALID_SCOPE_TYPES.includes(scopeType as (typeof VALID_SCOPE_TYPES)[number])) {
    return createErrorResponse(
      `Invalid scopeType: ${scopeType}. Must be one of: ${VALID_SCOPE_TYPES.join(', ')}`
    );
  }

  if (scopeType !== 'all' && !scopeId) {
    return createErrorResponse(
      `scopeId is required when scopeType is "${scopeType}"`
    );
  }

  // Arg-aware scope constraint check (after the policy engine has already
  // confirmed the user holds either analytics.mining.owned or .all).
  const constraint = checkScopeToOwnedAppsOrAll(
    context,
    { scopeType, scopeId },
    'analytics.mining.all'
  );
  if (!constraint.allowed) {
    console.log('[MineCandidateRoles] Scope constraint rejected:', constraint.reason);
    return createErrorResponse(constraint.reason ?? 'Scope check failed');
  }

  if (similarityThreshold !== undefined && (similarityThreshold < 0 || similarityThreshold > 1)) {
    return createErrorResponse('similarityThreshold must be between 0 and 1');
  }
  if (
    commonAccessThreshold !== undefined &&
    (commonAccessThreshold < 0 || commonAccessThreshold > 1)
  ) {
    return createErrorResponse('commonAccessThreshold must be between 0 and 1');
  }

  try {
    console.log('[MineCandidateRoles] Building access graph...');
    const snapshot = await buildAccessGraph({ scopeType, scopeId });

    console.log(
      `[MineCandidateRoles] Snapshot ready (${snapshot.users.length} users) — running miner`
    );
    const result = mineRoles(snapshot, {
      minClusterSize,
      similarityThreshold,
      commonAccessThreshold,
      maxResults,
    });

    console.log(
      `[MineCandidateRoles] Mining complete — ${result.candidateRoles.length} candidate(s) returned`
    );

    return createJsonResponse({
      scopeDescription: snapshot.scopeDescription,
      totalUsersAnalyzed: snapshot.users.length,
      candidateRoles: result.candidateRoles,
      summary: result.summary,
    });
  } catch (error) {
    console.error('[MineCandidateRoles] Error:', error);
    return createErrorResponse(
      `Failed to mine candidate roles: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

export const mineCandidateRolesTool: ToolDefinition = {
  definition: {
    name: 'mine_candidate_roles',
    description:
      'Discovers candidate roles by clustering users with similar access patterns within a scope. Returns proposed roles ranked by confidence, with member lists and common access sets. Outputs are PROPOSALS — actual group creation requires a separate tool.',
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
        minClusterSize: {
          type: 'number',
          description: 'Minimum users per cluster to be considered a candidate role (default 5).',
          default: 5,
        },
        similarityThreshold: {
          type: 'number',
          description:
            'Jaccard similarity threshold (0-1) for hierarchical merges (default 0.7).',
          default: 0.7,
        },
        commonAccessThreshold: {
          type: 'number',
          description:
            'Fraction of cluster members (0-1) that must share an access node for it to be considered "common" to the role (default 0.8).',
          default: 0.8,
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of candidate roles to return (default 10).',
          default: 10,
        },
      },
      required: ['scopeType'],
    },
  },
  handler,
};

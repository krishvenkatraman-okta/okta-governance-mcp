/**
 * Tool: explain_user_access
 *
 * Traces and explains in plain English how a specific user came to
 * have access to a target (app, entitlement, or group). Returns all
 * access paths with grant timestamps, granters, and rule expressions
 * where applicable.
 *
 * This is the most user-facing of the four advanced analytics tools —
 * the narratives are the demo's "wow" moment. Most of the heavy
 * lifting lives in `src/analytics/access-explainer.ts`; the handler
 * here just validates args and surfaces a helpful error if a target
 * isn't found.
 *
 * Authorization: requires `analytics.explain.read` (granted to all
 * admin roles). No target-ownership constraint — explainability is
 * read-only and broadly useful.
 */

import { explainAccess } from '../../analytics/access-explainer.js';
import { createErrorResponse, createJsonResponse } from '../types.js';
import type {
  AuthorizationContext,
  McpToolCallResponse,
} from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Input arguments for `explain_user_access`.
 */
interface ExplainUserAccessArgs {
  /**
   * User ID (e.g. `00u...`) or login (`user@example.com`).
   */
  userId: string;

  /**
   * What kind of target to explain access to.
   */
  targetType: 'app' | 'entitlement' | 'group';

  /**
   * The app/group/entitlement ID being explained.
   */
  targetId: string;

  /**
   * Required when `targetType === 'entitlement'`. The Governance
   * Grants API is keyed by (user, app); we need the parent app ID
   * to look up entitlement grants.
   */
  entitlementAppId?: string;

  /**
   * Whether to include redundant (non-shortest) paths. Default true.
   */
  includeRedundantPaths?: boolean;
}

const VALID_TARGET_TYPES = ['app', 'entitlement', 'group'] as const;

async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const {
    userId,
    targetType,
    targetId,
    entitlementAppId,
    includeRedundantPaths,
  } = args as Partial<ExplainUserAccessArgs>;

  console.log('[ExplainUserAccess] Executing tool:', {
    subject: context.subject,
    userId,
    targetType,
    targetId,
    includeRedundantPaths,
  });

  if (!userId) {
    return createErrorResponse('Missing required argument: userId');
  }
  if (!targetType) {
    return createErrorResponse('Missing required argument: targetType');
  }
  if (!VALID_TARGET_TYPES.includes(targetType as (typeof VALID_TARGET_TYPES)[number])) {
    return createErrorResponse(
      `Invalid targetType: ${targetType}. Must be one of: ${VALID_TARGET_TYPES.join(', ')}`
    );
  }
  if (!targetId) {
    return createErrorResponse('Missing required argument: targetId');
  }
  if (targetType === 'entitlement' && !entitlementAppId) {
    return createErrorResponse(
      'entitlementAppId is required when targetType is "entitlement" (the Governance Grants API is keyed by (user, app))'
    );
  }

  try {
    const result = await explainAccess({
      userId,
      targetType,
      targetId,
      entitlementAppId,
      includeRedundantPaths,
    });

    console.log(
      `[ExplainUserAccess] Returned ${result.paths.length} path(s) — hasAccess: ${result.hasAccess}`
    );

    return createJsonResponse(result);
  } catch (error) {
    console.error('[ExplainUserAccess] Error:', error);
    return createErrorResponse(
      `Failed to explain user access: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export const explainUserAccessTool: ToolDefinition = {
  definition: {
    name: 'explain_user_access',
    description:
      'Trace and explain in plain English how a specific user came to have access to a target (app, entitlement, or group). Returns all access paths with grant timestamps, granters, and rule expressions where applicable. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID (e.g. 00u123abc) or login/email (e.g. user@example.com)',
        },
        targetType: {
          type: 'string',
          enum: ['app', 'entitlement', 'group'],
          description: 'What kind of access target to explain',
        },
        targetId: {
          type: 'string',
          description:
            'The app, group, or entitlement ID. For entitlements, also provide entitlementAppId.',
        },
        entitlementAppId: {
          type: 'string',
          description:
            'Required when targetType is "entitlement" — the parent app ID. The Governance Grants API is keyed by (user, app).',
        },
        includeRedundantPaths: {
          type: 'boolean',
          description:
            'Whether to include redundant (non-shortest) access paths. Default true.',
          default: true,
        },
      },
      required: ['userId', 'targetType', 'targetId'],
    },
  },
  handler,
};

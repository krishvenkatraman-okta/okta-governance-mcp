/**
 * Tool: generate_smart_campaign
 *
 * Build a certification campaign scoped only to anomalies, outliers,
 * and dormant access — not blanket reviews. Defaults to dryRun=true
 * so the caller previews items before any campaign is created in
 * Okta. With dryRun=false, the tool calls
 * `governanceClient.campaigns.create` directly (bypassing the stubbed
 * `manage_app_campaigns` wrapper) and returns the new campaign id.
 *
 * Authorization: requires `analytics.campaigns.owned` or
 * `analytics.campaigns.all`. Uses the arg-aware
 * `scope_to_owned_apps_or_all` constraint, evaluated in this handler.
 */

import { buildAccessGraph } from '../../analytics/access-graph.js';
import {
  buildSmartCampaign,
  type CampaignItem,
  type ReviewerStrategy,
  type SmartCampaign,
  type SmartCampaignRules,
} from '../../analytics/campaign-builder.js';
import { governanceClient } from '../../okta/governance-client.js';
import { checkScopeToOwnedAppsOrAll } from '../../policy/scope-constraint.js';
import { createErrorResponse, createJsonResponse } from '../types.js';
import type {
  AuthorizationContext,
  McpToolCallResponse,
} from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Tool arguments for `generate_smart_campaign`.
 */
interface GenerateSmartCampaignArgs {
  scopeType: 'app' | 'group' | 'department' | 'all';
  scopeId?: string;
  includeRules?: Partial<SmartCampaignRules>;
  reviewerStrategy?: ReviewerStrategy;
  inactivityDays?: number;
  recentGrantsDays?: number;
  campaignName?: string;
  durationInDays?: number;
  /**
   * `true` (default) returns the preview only. `false` actually creates
   * the campaign in Okta.
   */
  dryRun?: boolean;
}

const VALID_SCOPE_TYPES = ['app', 'group', 'department', 'all'] as const;
const VALID_REVIEWER_STRATEGIES: ReviewerStrategy[] = [
  'manager',
  'app_owner',
  'resource_owner',
];

/**
 * Default rule toggles per the spec addendum:
 *   - outliers: ON
 *   - dormantAccess: ON
 *   - directAssignments: OFF
 *   - recentGrants: OFF
 */
const DEFAULT_RULES: SmartCampaignRules = {
  outliers: true,
  dormantAccess: true,
  directAssignments: false,
  recentGrants: false,
};

const DEFAULT_REVIEWER_STRATEGY: ReviewerStrategy = 'manager';

const DEFAULT_DURATION_IN_DAYS = 14;

async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext,
): Promise<McpToolCallResponse> {
  const {
    scopeType,
    scopeId,
    includeRules,
    reviewerStrategy,
    inactivityDays,
    recentGrantsDays,
    campaignName,
    durationInDays,
    dryRun = true,
  } = args as Partial<GenerateSmartCampaignArgs>;

  console.log('[GenerateSmartCampaign] Executing tool:', {
    subject: context.subject,
    scopeType,
    scopeId,
    includeRules,
    reviewerStrategy,
    inactivityDays,
    recentGrantsDays,
    dryRun,
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
    reviewerStrategy !== undefined &&
    !VALID_REVIEWER_STRATEGIES.includes(reviewerStrategy as ReviewerStrategy)
  ) {
    return createErrorResponse(
      `Invalid reviewerStrategy: ${reviewerStrategy}. Must be one of: ${VALID_REVIEWER_STRATEGIES.join(', ')}`,
    );
  }

  if (inactivityDays !== undefined && inactivityDays < 1) {
    return createErrorResponse('inactivityDays must be a positive integer');
  }
  if (recentGrantsDays !== undefined && recentGrantsDays < 1) {
    return createErrorResponse('recentGrantsDays must be a positive integer');
  }
  if (durationInDays !== undefined && durationInDays < 1) {
    return createErrorResponse('durationInDays must be a positive integer');
  }

  const constraint = checkScopeToOwnedAppsOrAll(
    context,
    { scopeType, scopeId },
    'analytics.campaigns.all',
  );
  if (!constraint.allowed) {
    console.log(
      '[GenerateSmartCampaign] Scope constraint rejected:',
      constraint.reason,
    );
    return createErrorResponse(constraint.reason ?? 'Scope check failed');
  }

  const rules: SmartCampaignRules = {
    ...DEFAULT_RULES,
    ...(includeRules ?? {}),
  };

  try {
    console.log('[GenerateSmartCampaign] Building access graph...');
    const snapshot = await buildAccessGraph({ scopeType, scopeId });

    console.log(
      `[GenerateSmartCampaign] Snapshot ready (${snapshot.users.length} users) — building campaign`,
    );
    const campaign = await buildSmartCampaign({
      snapshot,
      includeRules: rules,
      reviewerStrategy: (reviewerStrategy as ReviewerStrategy | undefined) ??
        DEFAULT_REVIEWER_STRATEGY,
      inactivityDays,
      recentGrantsDays,
      campaignName,
    });

    if (dryRun) {
      console.log(
        `[GenerateSmartCampaign] Dry-run preview — ${campaign.itemCount} item(s); not creating campaign in Okta`,
      );
      return createJsonResponse({
        ...campaign,
        dryRun: true,
      });
    }

    if (campaign.itemCount === 0) {
      return createErrorResponse(
        'No items matched the configured rules — refusing to create an empty campaign. Re-run with dryRun=true to inspect rule output.',
      );
    }

    // Smart campaigns target multiple apps; assert that every targeted
    // app is in the caller's administrative scope (unless they have the
    // .all capability). We already passed the scope-constraint check
    // above, but for the .owned variant the user could have proposed
    // entitlements from apps outside their scope (e.g. via cross-app
    // group membership). Belt-and-braces.
    const appIds = collectTargetedAppIds(campaign.items);
    const hasAll = context.capabilities.includes('analytics.campaigns.all');
    if (!hasAll) {
      const ownedSet = new Set(context.targets.apps);
      const outOfScope = appIds.filter((id) => !ownedSet.has(id));
      if (outOfScope.length > 0) {
        return createErrorResponse(
          `Refusing to create campaign — proposed items target app(s) outside your administrative scope: ${outOfScope.join(', ')}. Re-run with a narrower scopeId.`,
        );
      }
    }

    if (appIds.length === 0) {
      return createErrorResponse(
        'No app-typed items in the campaign — entitlement-only campaigns are not yet supported by the Okta Campaigns API.',
      );
    }

    console.log(
      `[GenerateSmartCampaign] Creating campaign in Okta — ${campaign.itemCount} item(s) across ${appIds.length} app(s)`,
    );

    const created = await createCampaignInOkta({
      campaign,
      appIds,
      durationInDays: durationInDays ?? DEFAULT_DURATION_IN_DAYS,
      requestingUserId: context.subject,
    });

    console.log('[GenerateSmartCampaign] Campaign created:', created.id);

    return createJsonResponse({
      ...campaign,
      dryRun: false,
      campaignId: created.id,
      campaignStatus: created.status,
      message: `Campaign "${campaign.campaignName}" created successfully (id: ${created.id}).`,
    });
  } catch (error) {
    console.error('[GenerateSmartCampaign] Error:', error);
    return createErrorResponse(
      `Failed to generate smart campaign: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
}

/**
 * Collect every distinct app id targeted by the campaign's items. Used
 * both for the per-app scope check and for the campaign payload's
 * `resourceSettings.targetResources` list.
 */
function collectTargetedAppIds(items: CampaignItem[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.appId) ids.add(item.appId);
  }
  return Array.from(ids);
}

/**
 * Create the campaign in Okta. Mirrors the payload shape used by
 * `manage_app_campaigns.createCampaign`, but targets the union of apps
 * referenced by the smart-campaign items rather than a single app id.
 */
async function createCampaignInOkta(input: {
  campaign: SmartCampaign;
  appIds: string[];
  durationInDays: number;
  requestingUserId: string;
}): Promise<{ id: string; status?: string }> {
  const { campaign, appIds, durationInDays, requestingUserId } = input;
  const startDate = new Date();

  const payload = {
    campaignType: 'RESOURCE',
    name: campaign.campaignName,
    description: `Smart campaign: ${campaign.itemCount} item(s) selected by anomaly / dormancy rules across ${appIds.length} app(s).`,
    status: 'ACTIVE',
    scheduleSettings: {
      type: 'ONE_OFF',
      startDate: startDate.toISOString(),
      durationInDays,
      timeZone: 'UTC',
    },
    resourceSettings: {
      targetTypes: ['APPLICATION'],
      targetResources: appIds.map((id) => ({
        resourceType: 'APPLICATION',
        resourceId: id,
      })),
    },
    principalScopeSettings: {
      type: 'USERS',
      userIds: Array.from(new Set(campaign.items.map((i) => i.userId))),
    },
    reviewerSettings: {
      type: 'USER',
      reviewerId: requestingUserId,
      selfReviewDisabled: true,
      justificationRequired: true,
    },
    remediationSettings: {
      accessRevoked: 'DENY',
      accessApproved: 'NO_ACTION',
      noResponse: 'NO_ACTION',
    },
  };

  const created = await governanceClient.campaigns.create(
    payload,
    'okta.governance.accessCertifications.manage',
  );

  return { id: created.id, status: created.status };
}

export const generateSmartCampaignTool: ToolDefinition = {
  definition: {
    name: 'generate_smart_campaign',
    description:
      'Build a certification campaign scoped only to anomalies, outliers, and dormant access — not blanket reviews. Defaults to dryRun=true (returns a preview); set dryRun=false to actually create the campaign in Okta.',
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
        includeRules: {
          type: 'object',
          description:
            'Toggle which inclusion rules contribute items. Any omitted key falls back to the spec defaults: outliers=true, dormantAccess=true, directAssignments=false, recentGrants=false.',
          properties: {
            outliers: { type: 'boolean' },
            dormantAccess: { type: 'boolean' },
            directAssignments: { type: 'boolean' },
            recentGrants: { type: 'boolean' },
          },
          additionalProperties: false,
        },
        reviewerStrategy: {
          type: 'string',
          enum: ['manager', 'app_owner', 'resource_owner'],
          description:
            'How to assign reviewers to items. Default "manager".',
          default: 'manager',
        },
        inactivityDays: {
          type: 'number',
          description:
            'Days of inactivity required for the dormantAccess rule to flag a (user, app) pair (default 60).',
          default: 60,
        },
        recentGrantsDays: {
          type: 'number',
          description:
            'Recency window for the recentGrants rule (default 30).',
          default: 30,
        },
        campaignName: {
          type: 'string',
          description: 'Optional override for the campaign name.',
        },
        durationInDays: {
          type: 'number',
          description:
            'Duration to set on the created Okta campaign (default 14). Only used when dryRun=false.',
          default: 14,
        },
        dryRun: {
          type: 'boolean',
          description:
            'When true (default) returns the preview only. When false, creates the campaign in Okta.',
          default: true,
        },
      },
      required: ['scopeType'],
    },
  },
  handler,
};

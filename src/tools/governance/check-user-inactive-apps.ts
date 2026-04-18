/**
 * Tool: check_user_inactive_apps
 *
 * Checks which apps a specific user has not used in 60+ days.
 * Uses system log analysis to identify apps the user has access to but hasn't accessed recently.
 *
 * This tool is designed for self-service governance where users can review their own unused access.
 */

import { usersClient } from '../../okta/users-client.js';
import { appsClient } from '../../okta/apps-client.js';
import { systemLogClient } from '../../okta/systemlog-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Tool arguments
 */
interface CheckUserInactiveAppsArgs {
  /**
   * User ID or login to check (required)
   */
  userId: string;

  /**
   * Number of days to look back for inactivity (default: 60)
   */
  inactivityDays?: number;
}

/**
 * Inactive app result
 */
interface InactiveApp {
  appId: string;
  appName: string;
  appLabel: string;
  lastAccess: string | null;
  daysSinceLastAccess: number | null;
  recommendation: string;
}

/**
 * Tool handler
 */
async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const {
    userId,
    inactivityDays = 60,
  } = args as Partial<CheckUserInactiveAppsArgs>;

  console.log('[CheckUserInactiveApps] Executing tool:', {
    subject: context.subject,
    userId,
    inactivityDays,
  });

  // Validate required argument
  if (!userId) {
    return createErrorResponse('Missing required argument: userId');
  }

  try {
    console.log('[CheckUserInactiveApps] Resolving user...');

    // Resolve user (by ID or login)
    const user = await usersClient.getByIdOrLogin(userId);

    console.log('[CheckUserInactiveApps] Fetching all active apps...');

    // Get all active apps from the org
    const allApps = await appsClient.list({
      filter: 'status eq "ACTIVE"',
      limit: 200,
    });

    console.log(`[CheckUserInactiveApps] Found ${allApps.length} total active apps`);

    // Filter for governance-enabled apps only
    console.log('[CheckUserInactiveApps] Filtering for governance-enabled apps...');
    const governanceEnabledApps = [];

    for (const app of allApps) {
      try {
        // Fetch full app details to check governance status
        const appDetails = await appsClient.getById(app.id);

        // Check if governance features (Entitlement Management) are enabled
        const settings = (appDetails as any).settings;
        const emOptInStatus = settings?.emOptInStatus || 'DISABLED';

        if (emOptInStatus === 'ENABLED') {
          governanceEnabledApps.push(appDetails);
        }
      } catch (error) {
        console.warn(`[CheckUserInactiveApps] Failed to check governance status for app ${app.id}:`, error);
      }
    }

    console.log(`[CheckUserInactiveApps] Found ${governanceEnabledApps.length} governance-enabled apps (filtered from ${allApps.length})`);

    // Get user's app assignments
    console.log('[CheckUserInactiveApps] Fetching user app assignments...');
    const assignedApps = await appsClient.listUserApps(user.id);
    const assignedAppIds = new Set(assignedApps.map(app => app.id));

    console.log(`[CheckUserInactiveApps] User is assigned to ${assignedApps.length} apps`);

    // Filter governance-enabled apps to only those assigned to the user
    const userGovernanceApps = governanceEnabledApps.filter(app => assignedAppIds.has(app.id));

    console.log(`[CheckUserInactiveApps] User has ${userGovernanceApps.length} governance-enabled apps assigned`);

    if (userGovernanceApps.length === 0) {
      return createJsonResponse({
        user: {
          id: user.id,
          login: user.profile.login,
          email: user.profile.email,
        },
        inactiveApps: [],
        summary: {
          totalApps: assignedApps.length,
          governanceEnabledApps: 0,
          inactiveApps: 0,
          message: 'User has no governance-enabled app assignments',
        },
      });
    }

    // Calculate date range for inactivity check
    const since = new Date();
    since.setDate(since.getDate() - inactivityDays);
    const sinceISO = since.toISOString();

    console.log('[CheckUserInactiveApps] Analyzing app usage from system logs...');

    const inactiveApps: InactiveApp[] = [];
    const now = new Date();

    // Check each user's governance-enabled app for SSO authentication activity
    for (const app of userGovernanceApps) {
      try {
        console.log(`[CheckUserInactiveApps] Checking app: ${app.label} (${app.id})`);

        // Query system logs for user's SSO authentication to this app
        // Use specific event type for SSO authentication
        const events = await systemLogClient.queryLogs({
          filter: `actor.id eq "${user.id}" and target.id eq "${app.id}" and eventType eq "user.authentication.sso"`,
          since: sinceISO,
          limit: 10,
          sortOrder: 'DESCENDING',
        });

        console.log(`[CheckUserInactiveApps] Found ${events.length} SSO authentication events for app ${app.label}`);

        // Find most recent access
        let lastAccessDate: Date | null = null;
        let lastAccessISO: string | null = null;

        for (const event of events) {
          const eventDate = new Date(event.published);
          if (!lastAccessDate || eventDate > lastAccessDate) {
            lastAccessDate = eventDate;
            lastAccessISO = event.published;
          }
        }

        // Calculate days since last access
        let daysSinceAccess: number | null = null;
        if (lastAccessDate) {
          daysSinceAccess = Math.floor(
            (now.getTime() - lastAccessDate.getTime()) / (1000 * 60 * 60 * 24)
          );
        }

        // If no access found OR last access was beyond the threshold
        if (!lastAccessDate || (daysSinceAccess !== null && daysSinceAccess >= inactivityDays)) {
          inactiveApps.push({
            appId: app.id,
            appName: app.name,
            appLabel: app.label,
            lastAccess: lastAccessISO,
            daysSinceLastAccess: daysSinceAccess,
            recommendation: lastAccessDate
              ? `No access for ${daysSinceAccess} days - consider removing`
              : `No recorded access in last ${inactivityDays} days - consider removing`,
          });

          console.log(`[CheckUserInactiveApps] ⚠️  Inactive: ${app.label} (last: ${daysSinceAccess || 'never'} days ago)`);
        } else {
          console.log(`[CheckUserInactiveApps] ✓ Active: ${app.label} (last: ${daysSinceAccess} days ago)`);
        }
      } catch (error) {
        console.warn(`[CheckUserInactiveApps] Failed to check app ${app.label}:`, error);
        // Continue with other apps - don't fail the whole request
      }
    }

    console.log(`[CheckUserInactiveApps] Analysis complete: ${inactiveApps.length} inactive apps found`);

    // Build response
    const response = {
      user: {
        id: user.id,
        login: user.profile.login,
        email: user.profile.email,
      },
      analysisParameters: {
        inactivityDays,
        analyzedPeriod: {
          from: sinceISO,
          to: new Date().toISOString(),
        },
        governanceEnabledOnly: true,
      },
      summary: {
        totalApps: assignedApps.length,
        totalGovernanceEnabledApps: governanceEnabledApps.length,
        userGovernanceEnabledApps: userGovernanceApps.length,
        inactiveApps: inactiveApps.length,
        message: inactiveApps.length > 0
          ? `Found ${inactiveApps.length} governance-enabled app${inactiveApps.length === 1 ? '' : 's'} not used in ${inactivityDays}+ days`
          : `All governance-enabled apps have been accessed within the last ${inactivityDays} days`,
      },
      inactiveApps: inactiveApps.map((app) => ({
        appId: app.appId,
        appName: app.appName,
        appLabel: app.appLabel,
        lastAccess: app.lastAccess,
        daysSinceLastAccess: app.daysSinceLastAccess,
        recommendation: app.recommendation,
      })),
      nextSteps: inactiveApps.length > 0
        ? [
            'Review inactive apps and determine if access is still needed',
            'Remove access to unused apps to reduce security risk',
            'Create self-certification campaign to formally remove access',
          ]
        : ['Continue monitoring app usage regularly'],
    };

    console.log('[CheckUserInactiveApps] Report generated successfully');

    return createJsonResponse(response);
  } catch (error) {
    console.error('[CheckUserInactiveApps] Error:', error);
    return createErrorResponse(
      `Failed to check user inactive apps: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Tool definition
 */
export const checkUserInactiveAppsTool: ToolDefinition = {
  definition: {
    name: 'check_user_inactive_apps',
    description:
      'Check which governance-enabled apps a specific user has not used in 60+ days by analyzing system logs. Only checks apps where emOptInStatus=ENABLED. Returns list of inactive apps with recommendations for access removal.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID (e.g., 00u123456) or login (e.g., john.doe@example.com)',
        },
        inactivityDays: {
          type: 'number',
          description: 'Number of days to look back for inactivity (default: 60)',
          default: 60,
        },
      },
      required: ['userId'],
    },
  },
  handler,
};

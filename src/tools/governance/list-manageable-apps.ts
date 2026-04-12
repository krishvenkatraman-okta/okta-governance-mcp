/**
 * Tool: list_manageable_apps
 *
 * Lists governance-enabled applications manageable by the current user.
 * Only returns apps where settings.emOptInStatus === "ENABLED".
 * For App Admins, this returns only apps in their role targets.
 * For Super Admins/Org Admins, this returns all apps.
 */

import { appsClient } from '../../okta/apps-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse, OktaApp } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Tool handler
 */
async function handler(
  _args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  console.log('[ListManageableApps] Executing tool:', {
    subject: context.subject,
    roles: context.roles,
    targetAppsCount: context.targets.apps.length,
  });

  try {
    // Get all apps from Okta
    const allApps = await appsClient.list({
      filter: 'status eq "ACTIVE"',
      limit: 200,
    });

    console.log(`[ListManageableApps] Retrieved ${allApps.length} total apps`);

    // Filter by manageable apps based on authorization scope
    let manageableApps: OktaApp[];

    if (context.roles.superAdmin || context.roles.orgAdmin) {
      // Super Admin/Org Admin can see all apps (organization-wide scope)
      manageableApps = allApps;
      console.log('[ListManageableApps] User has organization-wide access - returning all apps');
    } else if (context.roles.appAdmin && context.targets.apps.length > 0) {
      // App Admin can only see their target apps (scoped access)
      manageableApps = appsClient.filterByIds(allApps, context.targets.apps);
      console.log(
        `[ListManageableApps] User has scoped access - filtered to ${manageableApps.length} manageable apps`
      );
    } else {
      // No apps manageable
      manageableApps = [];
      console.log('[ListManageableApps] User has no manageable apps');
    }

    // Filter to governance-enabled apps only
    console.log(`[ListManageableApps] Filtering ${manageableApps.length} apps for governance enablement`);

    const governanceEnabledApps: Array<{
      id: string;
      name: string;
      label: string;
      status: string;
      emOptInStatus: string;
    }> = [];

    for (const app of manageableApps) {
      try {
        // Fetch full app details to check governance status
        const appDetails = await appsClient.getById(app.id);

        // Check if governance is enabled
        const settings = (appDetails as any).settings;
        const emOptInStatus = settings?.emOptInStatus || 'DISABLED';

        if (emOptInStatus === 'ENABLED') {
          governanceEnabledApps.push({
            id: appDetails.id,
            name: appDetails.name,
            label: appDetails.label,
            status: appDetails.status,
            emOptInStatus,
          });
        }
      } catch (error) {
        console.warn(`[ListManageableApps] Failed to fetch details for app ${app.id}:`, error);
        // Skip this app if we can't fetch details
      }
    }

    console.log(`[ListManageableApps] Found ${governanceEnabledApps.length} governance-enabled apps (filtered from ${manageableApps.length})`);

    // Format response
    const response = {
      total: governanceEnabledApps.length,
      apps: governanceEnabledApps,
    };

    console.log(`[ListManageableApps] Returning ${response.total} governance-enabled apps`);

    return createJsonResponse(response);
  } catch (error) {
    console.error('[ListManageableApps] Error:', error);
    return createErrorResponse(
      `Failed to list manageable apps: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Tool definition
 */
export const listManageableAppsTool: ToolDefinition = {
  definition: {
    name: 'list_manageable_apps',
    description: 'List governance-enabled applications manageable in your current authorization scope. Only returns apps where governance is enabled (emOptInStatus = ENABLED).',
    inputSchema: {
      type: 'object',
      properties: {
        includeInactive: {
          type: 'boolean',
          description: 'Include inactive applications (default: false)',
        },
      },
    },
  },
  handler,
};

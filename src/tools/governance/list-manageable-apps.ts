/**
 * Tool: list_manageable_apps
 *
 * Lists applications manageable by the current user.
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

    // Format response
    const response = {
      total: manageableApps.length,
      apps: manageableApps.map((app) => ({
        id: app.id,
        name: app.name,
        label: app.label,
        status: app.status,
      })),
    };

    console.log(`[ListManageableApps] Returning ${response.total} apps`);

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
    description: 'List applications manageable in your current authorization scope (all apps for organization-wide access, owned apps for scoped access)',
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

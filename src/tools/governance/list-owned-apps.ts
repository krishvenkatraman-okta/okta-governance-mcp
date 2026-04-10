/**
 * Tool: list_owned_apps
 *
 * Lists applications owned by the current user.
 * For App Admins, this returns only apps in their role targets.
 * For Super Admins, this returns all apps.
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
  console.log('[ListOwnedApps] Executing tool:', {
    subject: context.subject,
    roles: context.roles,
    ownedAppsCount: context.targets.apps.length,
  });

  try {
    // Get all apps from Okta
    const allApps = await appsClient.list({
      filter: 'status eq "ACTIVE"',
      limit: 200,
    });

    console.log(`[ListOwnedApps] Retrieved ${allApps.length} total apps`);

    // Filter by owned apps
    let ownedApps: OktaApp[];

    if (context.roles.superAdmin) {
      // Super Admin can see all apps
      ownedApps = allApps;
      console.log('[ListOwnedApps] User is Super Admin - returning all apps');
    } else if (context.roles.appAdmin && context.targets.apps.length > 0) {
      // App Admin can only see their target apps
      ownedApps = appsClient.filterByIds(allApps, context.targets.apps);
      console.log(
        `[ListOwnedApps] User is App Admin - filtered to ${ownedApps.length} owned apps`
      );
    } else {
      // No apps owned
      ownedApps = [];
      console.log('[ListOwnedApps] User has no owned apps');
    }

    // Format response
    const response = {
      total: ownedApps.length,
      apps: ownedApps.map((app) => ({
        id: app.id,
        name: app.name,
        label: app.label,
        status: app.status,
      })),
    };

    console.log(`[ListOwnedApps] Returning ${response.total} apps`);

    return createJsonResponse(response);
  } catch (error) {
    console.error('[ListOwnedApps] Error:', error);
    return createErrorResponse(
      `Failed to list owned apps: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Tool definition
 */
export const listOwnedAppsTool: ToolDefinition = {
  definition: {
    name: 'list_owned_apps',
    description: 'List applications owned by the current user (App Admin)',
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

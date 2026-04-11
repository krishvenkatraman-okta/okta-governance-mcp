/**
 * Tool: generate_app_activity_report
 *
 * Generates an activity and audit report from system logs for applications
 * within authorization scope. Returns event counts and recent activity for the specified app.
 */

import { systemLogClient } from '../../okta/systemlog-client.js';
import { appsClient } from '../../okta/apps-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Tool arguments
 */
interface GenerateAppActivityReportArgs {
  /**
   * Application ID
   */
  appId: string;

  /**
   * Number of days to include in report (default: 60)
   */
  days?: number;

  /**
   * Include full event details (default: false)
   */
  includeDetails?: boolean;
}

/**
 * Tool handler
 */
async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const { appId, days = 60, includeDetails = false } = args as Partial<GenerateAppActivityReportArgs>;

  console.log('[GenerateAppActivityReport] Executing tool:', {
    subject: context.subject,
    appId,
    days,
    includeDetails,
  });

  // Validate required argument
  if (!appId) {
    return createErrorResponse('Missing required argument: appId');
  }

  try {
    // Validate ownership: Check if app is in user's targets
    if (!context.roles.superAdmin && !context.targets.apps.includes(appId)) {
      console.warn('[GenerateAppActivityReport] Access denied - app not in targets:', {
        appId,
        userTargets: context.targets.apps,
      });
      return createErrorResponse(
        `Access denied: You do not have permission to view logs for app ${appId}`
      );
    }

    console.log('[GenerateAppActivityReport] Fetching app details...');

    // Get app details
    const app = await appsClient.getById(appId);

    console.log('[GenerateAppActivityReport] Fetching system logs...');

    // Query system logs for this app
    const events = await systemLogClient.queryRecentLogsForApp(appId, days);

    console.log(`[GenerateAppActivityReport] Retrieved ${events.length} log events`);

    // Count events by type
    const eventCounts = await systemLogClient.countEventsByType(appId, days);

    // Get unique actors
    const actors = new Set(
      events.filter((e) => e.actor).map((e) => e.actor!.alternateId || e.actor!.id)
    );

    // Build report
    const report = {
      app: {
        id: app.id,
        name: app.name,
        label: app.label,
        status: app.status,
      },
      reportPeriod: {
        days,
        since: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
        until: new Date().toISOString(),
      },
      summary: {
        totalEvents: events.length,
        uniqueActors: actors.size,
        eventTypes: Object.fromEntries(
          Array.from(eventCounts.entries()).sort((a, b) => b[1] - a[1])
        ),
      },
      recentEvents: includeDetails
        ? events.slice(0, 50).map((event) => ({
            uuid: event.uuid,
            published: event.published,
            eventType: event.eventType,
            displayMessage: event.displayMessage,
            actor: event.actor?.displayName || event.actor?.alternateId,
            severity: event.severity,
          }))
        : undefined,
    };

    console.log('[GenerateAppActivityReport] Report generated successfully');

    return createJsonResponse(report);
  } catch (error) {
    console.error('[GenerateAppActivityReport] Error:', error);
    return createErrorResponse(
      `Failed to generate syslog report: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Tool definition
 */
export const generateAppActivityReportTool: ToolDefinition = {
  definition: {
    name: 'generate_app_activity_report',
    description:
      'Generate activity and audit reports from system logs for applications within your authorization scope (last 60 days by default)',
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Application ID (e.g., 0oa123456)',
        },
        days: {
          type: 'number',
          description: 'Number of days to include in report (default: 60, max: 90)',
          default: 60,
        },
        includeDetails: {
          type: 'boolean',
          description: 'Include recent event details in the report (default: false)',
          default: false,
        },
      },
      required: ['appId'],
    },
  },
  handler,
};

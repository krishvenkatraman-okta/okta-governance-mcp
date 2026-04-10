/**
 * Okta System Log API client
 *
 * Provides methods for querying system logs
 */

import { getServiceAccessToken } from './service-client.js';
import { config } from '../config/index.js';
import type { SystemLogEvent } from '../types/index.js';

/**
 * System log query filters
 */
export interface SystemLogQuery {
  /**
   * Filter expression (SCIM filter syntax)
   * Example: 'eventType eq "application.lifecycle.create"'
   */
  filter?: string;

  /**
   * Search query
   * Example: 'target.id eq "0oa123456"'
   */
  q?: string;

  /**
   * Start date (ISO 8601)
   */
  since?: string;

  /**
   * End date (ISO 8601)
   */
  until?: string;

  /**
   * Sort order (ASCENDING or DESCENDING)
   */
  sortOrder?: 'ASCENDING' | 'DESCENDING';

  /**
   * Number of results per page
   */
  limit?: number;
}

/**
 * System log API client
 */
export const systemLogClient = {
  /**
   * Query system logs
   *
   * @param query - Filter and pagination options
   * @returns Array of system log events
   */
  async queryLogs(query: SystemLogQuery = {}): Promise<SystemLogEvent[]> {
    const accessToken = await getServiceAccessToken(['okta.logs.read']);

    // Build query parameters
    const params = new URLSearchParams();

    if (query.filter) {
      params.append('filter', query.filter);
    }

    if (query.q) {
      params.append('q', query.q);
    }

    if (query.since) {
      params.append('since', query.since);
    }

    if (query.until) {
      params.append('until', query.until);
    }

    if (query.sortOrder) {
      params.append('sortOrder', query.sortOrder);
    }

    if (query.limit) {
      params.append('limit', query.limit.toString());
    }

    const url = `${config.okta.apiV1}/logs?${params.toString()}`;

    console.debug('[SystemLogClient] Querying logs:', {
      url,
      filter: query.filter,
      since: query.since,
      until: query.until,
    });

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[SystemLogClient] Failed to query logs:', {
        status: response.status,
        error,
      });
      throw new Error(`Failed to query system logs: ${response.status} ${response.statusText}`);
    }

    const events = (await response.json()) as SystemLogEvent[];

    console.debug(`[SystemLogClient] Retrieved ${events.length} log events`);

    return events;
  },

  /**
   * Query logs for a specific application
   *
   * @param appId - Application ID
   * @param options - Additional query options
   * @returns Array of system log events
   */
  async queryLogsForApp(
    appId: string,
    options: Omit<SystemLogQuery, 'filter'> = {}
  ): Promise<SystemLogEvent[]> {
    // Query logs where the app is the target
    return this.queryLogs({
      ...options,
      filter: `target.id eq "${appId}"`,
    });
  },

  /**
   * Query recent logs for an application (last N days)
   *
   * @param appId - Application ID
   * @param days - Number of days to look back (default: 60)
   * @returns Array of system log events
   */
  async queryRecentLogsForApp(appId: string, days: number = 60): Promise<SystemLogEvent[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.queryLogsForApp(appId, {
      since: since.toISOString(),
      sortOrder: 'DESCENDING',
      limit: 1000, // Okta's max per request
    });
  },

  /**
   * Count events by type for an application
   *
   * @param appId - Application ID
   * @param days - Number of days to look back
   * @returns Map of event type to count
   */
  async countEventsByType(
    appId: string,
    days: number = 60
  ): Promise<Map<string, number>> {
    const events = await this.queryRecentLogsForApp(appId, days);

    const counts = new Map<string, number>();

    for (const event of events) {
      const count = counts.get(event.eventType) || 0;
      counts.set(event.eventType, count + 1);
    }

    return counts;
  },
};

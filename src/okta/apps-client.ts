/**
 * Okta Apps API client
 *
 * Provides methods for interacting with Okta Applications API
 */

import { getServiceAccessToken } from './service-client.js';
import { config } from '../config/index.js';
import type { OktaApp, OktaUser } from '../types/index.js';

/**
 * Extract the `next` page URL from an Okta Link header.
 *
 * Okta uses RFC 5988 Link headers for cursor-based pagination, e.g.
 *   Link: <https://.../api/v1/...>; rel="self", <https://.../api/v1/...?after=...>; rel="next"
 *
 * Returns the URL inside `rel="next"` if present, otherwise null.
 */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Apps query options
 */
export interface AppsQueryOptions {
  /**
   * Filter expression (SCIM filter syntax)
   * Example: 'status eq "ACTIVE"'
   */
  filter?: string;

  /**
   * Search query
   */
  q?: string;

  /**
   * Number of results per page
   */
  limit?: number;

  /**
   * Expand nested resources
   */
  expand?: string;
}

/**
 * Apps API client
 */
export const appsClient = {
  /**
   * List applications
   *
   * @param options - Query options
   * @returns Array of applications
   */
  async list(options: AppsQueryOptions = {}): Promise<OktaApp[]> {
    const accessToken = await getServiceAccessToken(['okta.apps.read']);

    // Build query parameters
    const params = new URLSearchParams();

    if (options.filter) {
      params.append('filter', options.filter);
    }

    if (options.q) {
      params.append('q', options.q);
    }

    if (options.limit) {
      params.append('limit', options.limit.toString());
    }

    if (options.expand) {
      params.append('expand', options.expand);
    }

    const queryString = params.toString();
    const url = `${config.okta.apiV1}/apps${queryString ? `?${queryString}` : ''}`;

    console.debug('[AppsClient] Listing apps:', { url, options });

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[AppsClient] Failed to list apps:', {
        status: response.status,
        error,
      });
      throw new Error(`Failed to list apps: ${response.status} ${response.statusText}`);
    }

    const apps = (await response.json()) as OktaApp[];

    console.debug(`[AppsClient] Retrieved ${apps.length} apps`);

    return apps;
  },

  /**
   * Get application by ID
   *
   * @param appId - Application ID
   * @returns Application object
   */
  async getById(appId: string): Promise<OktaApp> {
    const accessToken = await getServiceAccessToken(['okta.apps.read']);
    const url = `${config.okta.apiV1}/apps/${appId}`;

    console.debug('[AppsClient] Getting app:', { appId });

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[AppsClient] Failed to get app:', {
        appId,
        status: response.status,
        error,
      });
      throw new Error(`Failed to get app ${appId}: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as OktaApp;
  },

  /**
   * List apps owned by a specific admin
   *
   * This requires calling the admin roles API to determine owned apps.
   * For now, we return all apps and let the caller filter by targets.
   *
   * @param options - Query options
   * @returns Array of applications
   */
  async listOwnedApps(options: AppsQueryOptions = {}): Promise<OktaApp[]> {
    // In a full implementation, we would:
    // 1. Get the admin's role assignments
    // 2. Get the app targets for those roles
    // 3. Filter the apps list to only those in the targets
    //
    // For now, we just return all apps and rely on the caller
    // to filter based on context.targets.apps

    return this.list(options);
  },

  /**
   * Filter apps by IDs
   *
   * @param apps - Array of applications
   * @param appIds - Array of app IDs to filter by
   * @returns Filtered applications
   */
  filterByIds(apps: OktaApp[], appIds: string[]): OktaApp[] {
    const idSet = new Set(appIds);
    return apps.filter((app) => idSet.has(app.id));
  },

  /**
   * List users assigned to a specific application.
   *
   * Calls `GET /api/v1/apps/{appId}/users` and follows `Link: rel="next"`
   * cursors until exhausted (capped at `maxPages` to avoid runaway loops
   * on enormous apps).
   *
   * @param appId - Application ID
   * @param pageSize - Page size (default 200, Okta max)
   * @param maxPages - Hard cap on pages walked (default 25)
   * @returns Users assigned to the app
   */
  async listAppUsers(
    appId: string,
    pageSize: number = 200,
    maxPages: number = 25
  ): Promise<OktaUser[]> {
    const accessToken = await getServiceAccessToken(['okta.apps.read', 'okta.users.read']);

    let url: string | null = `${config.okta.apiV1}/apps/${appId}/users?limit=${pageSize}`;
    const collected: OktaUser[] = [];
    let pages = 0;

    console.debug('[AppsClient] Listing app users:', { appId, pageSize });

    while (url && pages < maxPages) {
      const response: Response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[AppsClient] Failed to list app users:', {
          appId,
          status: response.status,
          error,
        });
        throw new Error(`Failed to list app users: ${response.status} ${response.statusText}`);
      }

      const page = (await response.json()) as OktaUser[];
      collected.push(...page);
      pages++;

      url = parseNextLink(response.headers.get('link'));
    }

    if (url && pages >= maxPages) {
      console.warn('[AppsClient] listAppUsers hit maxPages cap:', {
        appId,
        maxPages,
        collected: collected.length,
      });
    }

    console.debug(`[AppsClient] Retrieved ${collected.length} users for app ${appId} across ${pages} page(s)`);

    return collected;
  },

  /**
   * List apps assigned to a specific user
   *
   * @param userId - User ID
   * @returns Array of applications assigned to the user
   */
  async listUserApps(userId: string): Promise<OktaApp[]> {
    const accessToken = await getServiceAccessToken(['okta.apps.read', 'okta.users.read']);
    const url = `${config.okta.apiV1}/apps?filter=user.id eq "${userId}"&limit=200`;

    console.debug('[AppsClient] Listing apps for user:', { userId });

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[AppsClient] Failed to list user apps:', {
        userId,
        status: response.status,
        error,
      });
      throw new Error(`Failed to list user apps: ${response.status} ${response.statusText}`);
    }

    const apps = (await response.json()) as OktaApp[];

    console.debug(`[AppsClient] Retrieved ${apps.length} apps for user ${userId}`);

    return apps;
  },
};

/**
 * Okta Apps API client
 *
 * Provides methods for interacting with Okta Applications API
 */

import { getServiceAccessToken } from './service-client.js';
import { config } from '../config/index.js';
import type { OktaApp } from '../types/index.js';

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
};

/**
 * Okta Governance API client
 *
 * Provides methods for interacting with Okta Governance APIs
 */

import { getServiceAccessToken } from './service-client.js';
import { config } from '../config/index.js';

/**
 * Base governance API request
 */
async function governanceRequest<T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    scopes: string;
  }
): Promise<T> {
  const accessToken = await getServiceAccessToken(options.scopes);
  const url = `${config.okta.governanceApi}${endpoint}`;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Governance API request failed: ${response.status} ${error}`);
  }

  return await response.json() as T;
}

/**
 * Governance API client placeholder
 *
 * This module will be expanded with concrete methods as governance tools are implemented.
 */
export const governanceClient = {
  /**
   * Generic governance API call
   */
  request: governanceRequest,

  /**
   * Campaigns API
   */
  campaigns: {
    /**
     * List all campaigns
     */
    list: async (scopes: string): Promise<any[]> => {
      return await governanceRequest('/governance/api/v1/campaigns', {
        method: 'GET',
        scopes,
      });
    },

    /**
     * Create a campaign
     */
    create: async (data: any, scopes: string): Promise<any> => {
      return await governanceRequest('/governance/api/v1/campaigns', {
        method: 'POST',
        body: data,
        scopes,
      });
    },

    /**
     * Get campaign by ID
     */
    getById: async (campaignId: string, scopes: string): Promise<any> => {
      return await governanceRequest(`/governance/api/v1/campaigns/${campaignId}`, {
        method: 'GET',
        scopes,
      });
    },

    /**
     * Launch a campaign
     */
    launch: async (campaignId: string, scopes: string): Promise<any> => {
      return await governanceRequest(`/governance/api/v1/campaigns/${campaignId}/launch`, {
        method: 'POST',
        scopes,
      });
    },

    /**
     * End a campaign
     */
    end: async (campaignId: string, scopes: string): Promise<any> => {
      return await governanceRequest(`/governance/api/v1/campaigns/${campaignId}/end`, {
        method: 'POST',
        scopes,
      });
    },

    /**
     * Delete a campaign
     */
    delete: async (campaignId: string, scopes: string): Promise<void> => {
      await governanceRequest(`/governance/api/v1/campaigns/${campaignId}`, {
        method: 'DELETE',
        scopes,
      });
    },
  },

  /**
   * Collections (placeholder)
   */
  collections: {
    list: async () => {
      // TODO: Implement when collections tools are created
      throw new Error('Not implemented');
    },
  },

  /**
   * Labels API
   */
  labels: {
    /**
     * List all labels
     */
    list: async (scopes: string): Promise<any> => {
      return await governanceRequest('/governance/api/v1/labels', {
        method: 'GET',
        scopes,
      });
    },

    /**
     * Create a label
     */
    create: async (data: { name: string; description?: string }, scopes: string): Promise<any> => {
      return await governanceRequest('/governance/api/v1/labels', {
        method: 'POST',
        body: data,
        scopes,
      });
    },

    /**
     * Get label by ID
     */
    getById: async (labelId: string, scopes: string): Promise<any> => {
      return await governanceRequest(`/governance/api/v1/labels/${labelId}`, {
        method: 'GET',
        scopes,
      });
    },

    /**
     * Assign label to resource
     */
    assign: async (labelId: string, data: { resourceId: string; resourceType: string }, scopes: string): Promise<any> => {
      return await governanceRequest(`/governance/api/v1/labels/${labelId}/assignments`, {
        method: 'POST',
        body: data,
        scopes,
      });
    },

    /**
     * Remove label from resource
     */
    unassign: async (labelId: string, resourceId: string, scopes: string): Promise<any> => {
      return await governanceRequest(`/governance/api/v1/labels/${labelId}/assignments/${resourceId}`, {
        method: 'DELETE',
        scopes,
      });
    },

    /**
     * Get labels assigned to a resource
     */
    getResourceLabels: async (resourceId: string, resourceType: string, scopes: string): Promise<any> => {
      return await governanceRequest(`/governance/api/v1/resources/${resourceId}/labels?resourceType=${resourceType}`, {
        method: 'GET',
        scopes,
      });
    },
  },

  /**
   * Entitlements
   */
  entitlements: {
    list: async () => {
      // TODO: Implement when entitlements tools are created
      throw new Error('Not implemented');
    },

    /**
     * List entitlement grants held by a specific user for a specific app.
     *
     * Calls the Okta Governance Grants API
     * (`GET /governance/api/v1/grants?filter=...&include=full_entitlements`)
     * with a filter pinning both the target app and the target principal.
     * Each `data[*]` entry can describe either an `ENTITLEMENT-BUNDLE`
     * grant or an inline entitlement grant; the caller is responsible for
     * unpacking the bundle/entitlement shape it cares about.
     *
     * The Grants endpoint is described in the Postman collection ("List
     * all grants" under the "Grants" category); if the runtime registry
     * has not loaded it for any reason, this method still issues the
     * request — the registry is advisory, not a hard gate.
     *
     * @param userId - Okta user ID (the `targetPrincipal.externalId`)
     * @param appId - Okta application ID (the `target.externalId`)
     * @param scopes - OAuth scopes to mint a service token under (typically
     *   `'okta.governance.entitlements.read'`)
     * @returns Array of grant objects, or an empty array if the API call
     *   fails in a non-fatal way (e.g. the org has not enabled the
     *   Governance Grants endpoint yet — we log a warning and degrade
     *   gracefully so analytics callers can still produce partial results).
     */
    listForUser: async (
      userId: string,
      appId: string,
      scopes: string,
    ): Promise<any[]> => {
      const filter =
        `target.externalId eq "${appId}" AND target.type eq "APPLICATION" ` +
        `AND targetPrincipal.externalId eq "${userId}" AND targetPrincipal.type eq "OKTA_USER"`;
      const params = new URLSearchParams();
      params.append('filter', filter);
      params.append('include', 'full_entitlements');
      params.append('limit', '200');

      try {
        const response = await governanceRequest<{ data?: any[] }>(
          `/governance/api/v1/grants?${params.toString()}`,
          {
            method: 'GET',
            scopes,
          },
        );
        return response.data ?? [];
      } catch (error) {
        console.warn(
          '[GovernanceClient] entitlements API endpoint not yet wired (or call failed) — returning empty grant list:',
          {
            userId,
            appId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return [];
      }
    },
  },
};

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
    /** Pass a user token to call the API as the authenticated user instead of the service app */
    token?: string;
  }
): Promise<T> {
  const accessToken = options.token || await getServiceAccessToken(options.scopes);
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
      return await governanceRequest('/campaigns', {
        method: 'GET',
        scopes,
      });
    },

    /**
     * Create a campaign
     */
    create: async (data: any, scopes: string): Promise<any> => {
      return await governanceRequest('/campaigns', {
        method: 'POST',
        body: data,
        scopes,
      });
    },

    /**
     * Get campaign by ID
     */
    getById: async (campaignId: string, scopes: string): Promise<any> => {
      return await governanceRequest(`/campaigns/${campaignId}`, {
        method: 'GET',
        scopes,
      });
    },

    /**
     * Launch a campaign
     */
    launch: async (campaignId: string, scopes: string): Promise<any> => {
      return await governanceRequest(`/campaigns/${campaignId}/launch`, {
        method: 'POST',
        scopes,
      });
    },

    /**
     * End a campaign
     */
    end: async (campaignId: string, scopes: string): Promise<any> => {
      return await governanceRequest(`/campaigns/${campaignId}/end`, {
        method: 'POST',
        scopes,
      });
    },

    /**
     * Delete a campaign
     */
    delete: async (campaignId: string, scopes: string): Promise<void> => {
      await governanceRequest(`/campaigns/${campaignId}`, {
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
      return await governanceRequest('/labels', {
        method: 'GET',
        scopes,
      });
    },

    /**
     * Create a label
     */
    create: async (data: { name: string; description?: string }, scopes: string): Promise<any> => {
      return await governanceRequest('/labels', {
        method: 'POST',
        body: data,
        scopes,
      });
    },

    /**
     * Get label by ID
     */
    getById: async (labelId: string, scopes: string): Promise<any> => {
      return await governanceRequest(`/labels/${labelId}`, {
        method: 'GET',
        scopes,
      });
    },

    /**
     * Assign label to resource
     */
    assign: async (labelId: string, data: { resourceId: string; resourceType: string }, scopes: string): Promise<any> => {
      return await governanceRequest(`/labels/${labelId}/assignments`, {
        method: 'POST',
        body: data,
        scopes,
      });
    },

    /**
     * Remove label from resource
     */
    unassign: async (labelId: string, resourceId: string, scopes: string): Promise<any> => {
      return await governanceRequest(`/labels/${labelId}/assignments/${resourceId}`, {
        method: 'DELETE',
        scopes,
      });
    },

    /**
     * Get labels assigned to a resource
     */
    getResourceLabels: async (resourceId: string, resourceType: string, scopes: string): Promise<any> => {
      return await governanceRequest(`/resources/${resourceId}/labels?resourceType=${resourceType}`, {
        method: 'GET',
        scopes,
      });
    },
  },

  /**
   * Certification Reviews API
   */
  reviews: {
    /**
     * List reviews with optional filter (requires user token)
     * @param filter - OData filter (e.g., 'decision eq "UNREVIEWED"')
     * @param limit - Max results (default 200)
     * @param userToken - The authenticated user's access token
     */
    list: async (filter: string | undefined, limit: number, scopes: string, userToken?: string): Promise<any[]> => {
      const params = new URLSearchParams();
      if (filter) params.append('filter', filter);
      if (limit) params.append('limit', String(limit));
      const query = params.toString() ? `?${params.toString()}` : '';
      return await governanceRequest(`/reviews${query}`, {
        method: 'GET',
        scopes,
        token: userToken,
      });
    },

    /**
     * List review items assigned to the current user for a specific campaign
     * Endpoint: GET /governance/api/v1/campaigns/{campaignId}/reviewItems/me
     * @param userToken - The authenticated user's access token
     */
    listMyReviewItems: async (campaignId: string, limit: number, scopes: string, userToken?: string): Promise<any> => {
      const params = new URLSearchParams();
      if (limit) params.append('limit', String(limit));
      const query = params.toString() ? `?${params.toString()}` : '';
      return await governanceRequest(`/campaigns/${campaignId}/reviewItems/me${query}`, {
        method: 'GET',
        scopes,
        token: userToken,
      });
    },

    /**
     * Get a specific review by ID (requires user token)
     * @param userToken - The authenticated user's access token
     */
    getById: async (reviewId: string, scopes: string, userToken?: string): Promise<any> => {
      return await governanceRequest(`/reviews/${reviewId}`, {
        method: 'GET',
        scopes,
        token: userToken,
      });
    },

    /**
     * Submit a certification decision using the user's token
     * This uses the reviewer's own token, not the service app token.
     */
    submitDecision: async (
      campaignId: string,
      reviewItemId: string,
      decision: 'APPROVE' | 'REVOKE',
      note: string | undefined,
      userToken: string
    ): Promise<any> => {
      const url = `${config.okta.governanceApi}/campaigns/${campaignId}/reviewItems/${reviewItemId}/me`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          decisions: [{ reviewItemId, decision }],
          note: note || '',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Decision submission failed: ${response.status} ${error}`);
      }

      return await response.json();
    },
  },

  /**
   * Entitlements (placeholder)
   */
  entitlements: {
    list: async () => {
      // TODO: Implement when entitlements tools are created
      throw new Error('Not implemented');
    },
  },
};

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
   * Entitlements (placeholder)
   */
  entitlements: {
    list: async () => {
      // TODO: Implement when entitlements tools are created
      throw new Error('Not implemented');
    },
  },
};

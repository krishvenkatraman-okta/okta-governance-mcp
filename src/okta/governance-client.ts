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
   * Campaigns (placeholder)
   */
  campaigns: {
    list: async () => {
      // TODO: Implement when campaigns tools are created
      throw new Error('Not implemented');
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

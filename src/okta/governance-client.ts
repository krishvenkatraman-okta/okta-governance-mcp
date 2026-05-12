/**
 * Okta Governance API client
 *
 * Two API surfaces:
 * - Admin API (/governance/api/v1/) — service app token, bulk operations
 * - End-user API (/api/v1/governance/) — user's Org AS token, reviewer-scoped
 */

import { getServiceAccessToken } from './service-client.js';
import { config } from '../config/index.js';

/**
 * Admin governance API request (/governance/api/v1/)
 * Uses service app token by default; can override with user token.
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
 * End-user governance API request (/api/v1/governance/)
 * Requires the user's Org Authorization Server token.
 * This is the same API surface the Access Certification Reviews UI uses.
 */
async function endUserGovernanceRequest<T>(
  endpoint: string,
  userToken: string,
  options: {
    method?: string;
    body?: unknown;
  } = {}
): Promise<T> {
  const url = `${config.okta.orgUrl}/api/v1/governance${endpoint}`;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`End-user Governance API failed: ${response.status} ${error}`);
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
   * Certification Reviews — End-User API (/api/v1/governance/)
   *
   * All methods require the user's Org Authorization Server token.
   * Returns reviewer-scoped data with rich contextual information.
   */
  reviews: {
    /**
     * List campaigns assigned to the current reviewer.
     * GET /api/v1/governance/campaigns/me
     */
    listMyCampaigns: async (
      userToken: string,
      options?: { status?: string; sortBy?: string; sortOrder?: string; limit?: number }
    ): Promise<any[]> => {
      const params = new URLSearchParams();
      if (options?.status) params.append('campaignStatus', options.status);
      if (options?.sortBy) params.append('sortBy', options.sortBy);
      if (options?.sortOrder) params.append('sortOrder', options.sortOrder);
      if (options?.limit) params.append('limit', String(options.limit));
      params.append('reviewItemsCount', 'true');
      const query = params.toString() ? `?${params.toString()}` : '';
      return await endUserGovernanceRequest(`/campaigns/me${query}`, userToken);
    },

    /**
     * List review items assigned to the current reviewer for a campaign.
     * GET /api/v1/governance/campaigns/{campaignId}/reviewItems/me
     *
     * Pre-filtered to the authenticated user. Returns rich contextual data
     * including risk items, AI recommendations, entitlements, and group memberships.
     */
    listMyReviewItems: async (
      campaignId: string,
      userToken: string,
      options?: {
        filter?: string;
        search?: string;
        sortBy?: string;
        sortOrder?: string;
        limit?: number;
        after?: number;
        reviewerLevelId?: string;
        decision?: string;
      }
    ): Promise<any[]> => {
      const params = new URLSearchParams();
      // The UI uses decision= as a query param (not OData filter) alongside reviewerLevelId
      if (options?.decision) params.append('decision', options.decision);
      if (options?.reviewerLevelId) params.append('reviewerLevelId', options.reviewerLevelId);
      if (options?.filter) params.append('filter', options.filter);
      if (options?.search) params.append('search', options.search);
      if (options?.sortBy) params.append('sortBy', options.sortBy);
      if (options?.sortOrder) params.append('sortOrder', options.sortOrder);
      if (options?.limit) params.append('limit', String(options.limit));
      if (options?.after) params.append('after', String(options.after));
      const query = params.toString() ? `?${params.toString()}` : '';
      return await endUserGovernanceRequest(`/campaigns/${campaignId}/reviewItems/me${query}`, userToken);
    },

    /**
     * Submit approve/revoke decisions.
     * PUT /api/v1/governance/campaigns/{campaignId}/reviewItems/me
     */
    submitDecision: async (
      campaignId: string,
      reviewItemId: string,
      decision: 'APPROVE' | 'REVOKE',
      reviewerLevelId: string,
      note: string | undefined,
      userToken: string
    ): Promise<any> => {
      return await endUserGovernanceRequest(
        `/campaigns/${campaignId}/reviewItems/me`,
        userToken,
        {
          method: 'PUT',
          body: {
            decisions: [{ reviewItemId, decision }],
            reviewerLevelId,
            note: note || '',
          },
        }
      );
    },

    /**
     * Admin: List reviews with optional filter (service app token).
     * GET /governance/api/v1/reviews
     * @deprecated Use listMyReviewItems for reviewer-scoped access
     */
    adminList: async (filter: string | undefined, limit: number, scopes: string): Promise<any[]> => {
      const params = new URLSearchParams();
      if (filter) params.append('filter', filter);
      if (limit) params.append('limit', String(limit));
      const query = params.toString() ? `?${params.toString()}` : '';
      return await governanceRequest(`/reviews${query}`, {
        method: 'GET',
        scopes,
      });
    },

    /**
     * Admin: Get a specific review by ID (service app token).
     * GET /governance/api/v1/reviews/{reviewId}
     * @deprecated Use listMyReviewItems for reviewer-scoped access
     */
    adminGetById: async (reviewId: string, scopes: string): Promise<any> => {
      return await governanceRequest(`/reviews/${reviewId}`, {
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

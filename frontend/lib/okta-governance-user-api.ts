/**
 * Okta End-User Governance API Client
 *
 * Frontend client for calling Okta governance endpoints using the
 * authenticated user's access token (not service credentials).
 *
 * All methods return GovernanceResponse<T> with:
 * - data: Array of results
 * - next: Pagination cursor (if available)
 * - summary: Optional count/total metadata
 * - error: Error details if request fails
 *
 * Usage:
 * ```typescript
 * const client = new OktaGovernanceUserAPI(accessToken, oktaDomain)
 * const response = await client.getMySettings()
 * ```
 */

/**
 * Standard response shape for all Okta governance endpoints
 */
export interface GovernanceResponse<T> {
  data: T[];
  next?: string | null;
  summary?: {
    total: number;
    count: number;
  };
  error?: {
    code: string;
    message: string;
    scope?: string;
  };
}

/**
 * Parameters for getMyRequests()
 */
export interface GetMyRequestsParams {
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Parameters for getMyCatalogEntries()
 */
export interface GetMyCatalogEntriesParams {
  limit?: number;
}

/**
 * Parameters for getMySecurityAccessReviews()
 */
export interface GetMySecurityAccessReviewsParams {
  limit?: number;
  sortBy?: string;
}

/**
 * Parameters for getMyAccessCertificationReviews()
 */
export interface GetMyAccessCertificationReviewsParams {
  campaignStatus?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  reviewItemsCount?: boolean;
  limit?: number;
}

/**
 * Okta Governance User API Client
 *
 * Calls Okta governance endpoints using the authenticated user's access token.
 */
export class OktaGovernanceUserAPI {
  private baseUrl: string;
  private accessToken: string;

  /**
   * Create a new governance API client
   *
   * @param accessToken - User's MCP access token from session
   * @param baseUrl - Okta domain (e.g., "https://your-tenant.okta.com")
   */
  constructor(accessToken: string, baseUrl: string) {
    this.accessToken = accessToken;
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Internal request helper
   *
   * Handles URL construction, query parameters, authorization header,
   * and error response formatting.
   */
  private async request<T>(
    path: string,
    params?: Record<string, any>
  ): Promise<GovernanceResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);

    // Add query parameters
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        cache: 'no-store', // Disable caching for fresh data
      });

      if (!response.ok) {
        // Parse error response if available
        const errorData = await response.json().catch(() => ({}));

        return {
          data: [],
          error: {
            code: String(response.status),
            message: errorData.errorSummary || errorData.message || response.statusText,
            scope: errorData.errorCode,
          },
        };
      }

      const data = await response.json();

      // Okta governance endpoints return data in various shapes
      // Normalize to GovernanceResponse<T> format
      if (Array.isArray(data)) {
        // Direct array response
        return {
          data,
          summary: {
            total: data.length,
            count: data.length,
          },
        };
      } else if (data.data && Array.isArray(data.data)) {
        // Standard paginated response
        return {
          data: data.data,
          next: data.next || null,
          summary: data.summary || {
            total: data.data.length,
            count: data.data.length,
          },
        };
      } else {
        // Unknown format - wrap in data array
        return {
          data: [data],
          summary: {
            total: 1,
            count: 1,
          },
        };
      }
    } catch (error) {
      // Network or parsing error
      return {
        data: [],
        error: {
          code: 'CLIENT_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Get current user's governance settings
   *
   * Endpoint: GET /governance/api/v1/me/settings
   * Scope: okta.governance.settings.read
   *
   * @returns User's governance settings
   */
  async getMySettings(): Promise<GovernanceResponse<any>> {
    return this.request('/governance/api/v1/me/settings');
  }

  /**
   * Get current user's access requests
   *
   * Endpoint: GET /governance/api/v1/me/requests
   * Scope: okta.governance.requests.read
   *
   * @param params - Optional query parameters (limit, sortBy, sortOrder)
   * @returns User's access requests
   */
  async getMyRequests(params?: GetMyRequestsParams): Promise<GovernanceResponse<any>> {
    return this.request('/governance/api/v1/me/requests', params);
  }

  /**
   * Get current user's available catalog entries
   *
   * Endpoint: GET /governance/api/v2/my/catalogs/default/entries
   * Scope: okta.accessRequests.catalog.read
   *
   * @param params - Optional query parameters (limit)
   * @returns User's available catalog entries (apps, groups, entitlements they can request)
   */
  async getMyCatalogEntries(params?: GetMyCatalogEntriesParams): Promise<GovernanceResponse<any>> {
    // Use V2 API with default catalog and filter for top-level entries only
    const filter = 'not(parent pr)';
    const requestParams = {
      ...params,
      filter,
    };
    return this.request('/governance/api/v2/my/catalogs/default/entries', requestParams);
  }

  /**
   * Get current user's security access reviews
   *
   * Endpoint: GET /governance/api/v1/me/access-reviews
   * Scope: okta.governance.access-reviews.read
   *
   * @param params - Optional query parameters (limit, sortBy)
   * @returns User's security access reviews
   */
  async getMySecurityAccessReviews(
    params?: GetMySecurityAccessReviewsParams
  ): Promise<GovernanceResponse<any>> {
    return this.request('/governance/api/v1/me/access-reviews', params);
  }

  /**
   * Get current user's access certification campaigns
   *
   * Endpoint: GET /governance/api/v1/campaigns/me
   * Scope: okta.governance.campaigns.read
   *
   * @param params - Optional query parameters (campaignStatus, sortBy, sortOrder, reviewItemsCount, limit)
   * @returns User's access certification reviews
   */
  async getMyAccessCertificationReviews(
    params?: GetMyAccessCertificationReviewsParams
  ): Promise<GovernanceResponse<any>> {
    return this.request('/governance/api/v1/campaigns/me', params);
  }
}

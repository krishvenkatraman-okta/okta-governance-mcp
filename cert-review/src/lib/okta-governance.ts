/**
 * Okta Governance end-user API client.
 * All calls use the user's Org Auth Server token.
 */

const OKTA_DOMAIN = process.env.OKTA_DOMAIN || 'taskvantage.okta.com';
const BASE_URL = `https://${OKTA_DOMAIN}/api/v1/governance`;

class GovernanceAPIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'GovernanceAPIError';
  }
}

async function govFetch<T>(endpoint: string, token: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new GovernanceAPIError(res.status, `${res.status}: ${body}`);
  }

  return res.json();
}

/**
 * List campaigns assigned to the current reviewer.
 */
export async function listMyCampaigns(token: string, status = 'READY') {
  const params = new URLSearchParams({
    campaignStatus: status,
    sortBy: 'endTime',
    sortOrder: 'ASC',
    reviewItemsCount: 'true',
    limit: '20',
  });
  return govFetch<any[]>(`/campaigns/me?${params}`, token);
}

/**
 * List review items for a campaign assigned to the current reviewer.
 */
export async function listMyReviewItems(
  campaignId: string,
  token: string,
  options?: {
    filter?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
    limit?: number;
    after?: number;
  }
) {
  const params = new URLSearchParams();
  if (options?.filter) params.set('filter', options.filter);
  if (options?.search) params.set('search', options.search);
  if (options?.sortBy) params.set('sortBy', options.sortBy);
  if (options?.sortOrder) params.set('sortOrder', options.sortOrder);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.after) params.set('after', String(options.after));
  const query = params.toString() ? `?${params}` : '';
  return govFetch<any[]>(`/campaigns/${campaignId}/reviewItems/me${query}`, token);
}

/**
 * Submit a certification decision.
 */
export async function submitDecision(
  campaignId: string,
  reviewItemId: string,
  decision: 'APPROVE' | 'REVOKE',
  reviewerLevelId: string,
  note: string,
  token: string
) {
  return govFetch<any[]>(
    `/campaigns/${campaignId}/reviewItems/me`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({
        decisions: [{ reviewItemId, decision }],
        reviewerLevelId,
        note,
      }),
    }
  );
}

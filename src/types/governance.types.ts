/**
 * Governance domain types
 */

/**
 * Campaign types
 */
export type CampaignType = 'RESOURCE' | 'ROLE';

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  campaignType: CampaignType;
  status: string;
  created: string;
  lastUpdated: string;
  [key: string]: unknown;
}

/**
 * Collection (bundle) types
 */
export interface Collection {
  id: string;
  name: string;
  description?: string;
  created: string;
  lastUpdated: string;
  [key: string]: unknown;
}

/**
 * Label types
 */
export interface Label {
  id: string;
  name: string;
  description?: string;
  type: string;
  created: string;
  lastUpdated: string;
  [key: string]: unknown;
}

/**
 * Entitlement types
 */
export interface Entitlement {
  id: string;
  name: string;
  description?: string;
  appId: string;
  created: string;
  lastUpdated: string;
  [key: string]: unknown;
}

/**
 * Access request types
 */
export type AccessRequestStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED';

export interface AccessRequest {
  id: string;
  requesterId: string;
  status: AccessRequestStatus;
  created: string;
  lastUpdated: string;
  [key: string]: unknown;
}

/**
 * Review item types
 */
export interface ReviewItem {
  id: string;
  campaignId: string;
  reviewerId: string;
  status: string;
  created: string;
  lastUpdated: string;
  [key: string]: unknown;
}

/**
 * Okta API types
 */

/**
 * Okta OAuth token response
 */
export interface OktaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

/**
 * Okta admin role types
 */
export type OktaRoleType =
  | 'SUPER_ADMIN'
  | 'ORG_ADMIN'
  | 'APP_ADMIN'
  | 'USER_ADMIN'
  | 'GROUP_ADMIN'
  | 'GROUP_MEMBERSHIP_ADMIN'
  | 'HELP_DESK_ADMIN'
  | 'READ_ONLY_ADMIN'
  | 'API_ACCESS_MANAGEMENT_ADMIN'
  | 'MOBILE_ADMIN'
  | 'REPORT_ADMIN';

/**
 * Okta role assignment
 */
export interface OktaRole {
  id: string;
  type: OktaRoleType;
  label: string;
  status: string;
  created: string;
  lastUpdated: string;
}

/**
 * Okta role target (app or group)
 */
export interface OktaRoleTarget {
  id: string;
  type: 'APP' | 'GROUP';
  resourceId: string;
  resourceType: string;
}

/**
 * Okta app resource
 */
export interface OktaApp {
  id: string;
  name: string;
  label: string;
  status: string;
  [key: string]: unknown;
}

/**
 * Okta group resource
 */
export interface OktaGroup {
  id: string;
  profile: {
    name: string;
    description?: string;
  };
  type: string;
  [key: string]: unknown;
}

/**
 * Okta user resource
 */
export interface OktaUser {
  id: string;
  status: string;
  profile: {
    firstName?: string;
    lastName?: string;
    email?: string;
    login: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * System log event
 */
export interface SystemLogEvent {
  uuid: string;
  published: string;
  eventType: string;
  version: string;
  severity: string;
  displayMessage: string;
  actor?: {
    id: string;
    type: string;
    alternateId?: string;
    displayName?: string;
  };
  target?: Array<{
    id: string;
    type: string;
    alternateId?: string;
    displayName?: string;
  }>;
  [key: string]: unknown;
}

/**
 * Governance API base response
 */
export interface GovernanceApiResponse<T> {
  data?: T;
  _links?: {
    self: { href: string };
    next?: { href: string };
  };
}

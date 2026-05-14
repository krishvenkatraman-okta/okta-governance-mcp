/**
 * TypeScript types for the certification review app.
 * Matches the Okta Governance end-user API response shapes.
 */

// ─── View Config (agent → UI) ───────────────────────────────────────────────

export type LayoutType = 'campaign-overview' | 'flat-table' | 'grouped-cards' | 'risk-dashboard' | 'split-detail';

export interface ViewConfig {
  layout: LayoutType;
  title?: string;
  groupBy?: string | string[];
  filter?: Record<string, string | string[]>;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
  columns?: string[];
  expandedByDefault?: boolean;
  campaignId?: string;
}

export interface AgentResponse {
  message: string;
  view?: ViewConfig;
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  view?: ViewConfig;
  timestamp: Date;
}

// ─── Okta Governance API Types ───────────────────────────────────────────────

export interface Campaign {
  id: string;
  status: string;
  startTime: string;
  endTime: string;
  campaignSummary: {
    approved: number;
    delegated: number;
    revoked: number;
    outstanding: number;
    pending: number;
    total: number;
  };
  template: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
  };
  assignedReviewerLevels: string[];
  reviewerLevelOfReviewer: string;
  endDateForReviewerLevel: string;
}

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  type: string;
}

export interface RiskItem {
  riskAttribute: string;
  riskLabel: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: {
    message: string;
    args: Array<{ value: string; type: string }>;
  };
}

export interface EntitlementSet {
  id: string;
  name: string;
  values: Array<{ id: string; name: string }>;
}

export interface ReviewItem {
  id: string;
  campaignId: string;
  resourceId: string;
  resourceUnderReview: { id: string; type: string };
  principalProfile: UserProfile;
  reviewerProfile: UserProfile;
  decision: 'UNREVIEWED' | 'APPROVE' | 'REVOKE';
  remediationStatus: string;
  currReviewerLevel: string;
  delegated: boolean;
  assignmentType: string;
  assignments: Array<{ sourceType: string }>;
  note: { id: string; note: string } | null;
  riskItems: RiskItem[];
  sodConflicts: any[];
  reviewItemContextualInfo: {
    userInfo: {
      firstName: string;
      lastName: string;
      userName: string;
      email: string;
      userStatus: string;
      customAttributes: Record<string, string>;
    };
    appInfo?: {
      id: string;
      name: string;
      label: string;
      assignedDate: string;
      assignmentType: string;
      assignments: any[];
      applicationUsage: number;
      groupMembershipAssignedTo: Array<{ id: string; name: string }>;
      activeEntitlements: EntitlementSet[];
    };
    groupInfo?: any;
    collectionInfo?: any;
  };
  govAnalyzerRecommendationContext?: {
    recommendedReviewDecision: 'APPROVE' | 'REVOKE';
  };
}

// ─── Decision ────────────────────────────────────────────────────────────────

export interface DecisionRequest {
  campaignId: string;
  reviewItemId: string;
  decision: 'APPROVE' | 'REVOKE';
  reviewerLevelId: string;
  note: string;
}

/**
 * Certification Review API client — placeholder endpoints.
 *
 * TODO: Replace placeholder URLs with real Okta governance API endpoints
 * once the myreviews and approve/reject APIs are confirmed.
 */

export interface CertReviewItem {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  department: string;
  appName: string;
  entitlement: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  lastAccess: string;       // ISO date
  accessGrantedDate: string; // ISO date
  recommendation: "APPROVE" | "REVOKE" | "REVIEW";
  status: "PENDING" | "APPROVED" | "REVOKED";
}

export interface CertReview {
  id: string;
  campaignName: string;
  campaignId: string;
  reviewerName: string;
  reviewerEmail: string;
  totalItems: number;
  completedItems: number;
  dueDate: string;
  items: CertReviewItem[];
}

// Placeholder base URL — will be replaced with real Okta governance API
const CERT_API_BASE = process.env.CERT_API_BASE || "https://placeholder.okta.com/governance/api/v2";

/**
 * Fetch the current user's pending certification reviews.
 * TODO: Replace with real myreviews API call
 */
export async function getMyReviews(accessToken: string): Promise<CertReview[]> {
  // --- PLACEHOLDER: return mock data for hackathon demo ---
  // When the real API is ready, replace this with:
  //   const resp = await fetch(`${CERT_API_BASE}/myreviews`, {
  //     headers: { Authorization: `Bearer ${accessToken}` }
  //   });
  //   return await resp.json();

  return [
    {
      id: "rev-001",
      campaignName: "Q2 2026 Salesforce Access Review",
      campaignId: "camp-sf-q2",
      reviewerName: "Current User",
      reviewerEmail: "reviewer@example.com",
      totalItems: 12,
      completedItems: 3,
      dueDate: "2026-05-15",
      items: [
        { id: "item-001", userId: "u001", userName: "Sarah Chen", userEmail: "sarah.chen@example.com", department: "Engineering", appName: "Salesforce", entitlement: "CRM Full Access", riskLevel: "LOW", lastAccess: "2026-04-28", accessGrantedDate: "2025-06-15", recommendation: "APPROVE", status: "PENDING" },
        { id: "item-002", userId: "u002", userName: "Marcus Johnson", userEmail: "marcus.j@example.com", department: "Engineering", appName: "Salesforce", entitlement: "CRM Full Access", riskLevel: "HIGH", lastAccess: "2025-12-01", accessGrantedDate: "2024-03-10", recommendation: "REVOKE", status: "PENDING" },
        { id: "item-003", userId: "u003", userName: "Priya Patel", userEmail: "priya.p@example.com", department: "Sales", appName: "Salesforce", entitlement: "CRM Read Only", riskLevel: "LOW", lastAccess: "2026-04-29", accessGrantedDate: "2025-01-20", recommendation: "APPROVE", status: "PENDING" },
        { id: "item-004", userId: "u004", userName: "David Kim", userEmail: "david.k@example.com", department: "Marketing", appName: "Salesforce", entitlement: "Reports Viewer", riskLevel: "MEDIUM", lastAccess: "2026-03-15", accessGrantedDate: "2025-08-01", recommendation: "REVIEW", status: "PENDING" },
        { id: "item-005", userId: "u005", userName: "Emma Wilson", userEmail: "emma.w@example.com", department: "Finance", appName: "Salesforce", entitlement: "CRM Full Access", riskLevel: "CRITICAL", lastAccess: "2025-09-20", accessGrantedDate: "2023-11-05", recommendation: "REVOKE", status: "PENDING" },
        { id: "item-006", userId: "u006", userName: "James Rodriguez", userEmail: "james.r@example.com", department: "Sales", appName: "Salesforce", entitlement: "CRM Full Access", riskLevel: "LOW", lastAccess: "2026-04-30", accessGrantedDate: "2024-07-12", recommendation: "APPROVE", status: "PENDING" },
        { id: "item-007", userId: "u007", userName: "Lisa Zhang", userEmail: "lisa.z@example.com", department: "Engineering", appName: "Salesforce", entitlement: "API Access", riskLevel: "MEDIUM", lastAccess: "2026-04-10", accessGrantedDate: "2025-02-28", recommendation: "REVIEW", status: "PENDING" },
        { id: "item-008", userId: "u008", userName: "Tom Anderson", userEmail: "tom.a@example.com", department: "HR", appName: "Salesforce", entitlement: "Reports Viewer", riskLevel: "HIGH", lastAccess: "2025-11-15", accessGrantedDate: "2024-01-08", recommendation: "REVOKE", status: "PENDING" },
        { id: "item-009", userId: "u009", userName: "Nina Kowalski", userEmail: "nina.k@example.com", department: "Sales", appName: "Salesforce", entitlement: "CRM Read Only", riskLevel: "LOW", lastAccess: "2026-04-29", accessGrantedDate: "2025-09-01", recommendation: "APPROVE", status: "APPROVED" },
        { id: "item-010", userId: "u010", userName: "Carlos Rivera", userEmail: "carlos.r@example.com", department: "Engineering", appName: "Salesforce", entitlement: "CRM Full Access", riskLevel: "MEDIUM", lastAccess: "2026-02-20", accessGrantedDate: "2024-05-15", recommendation: "REVIEW", status: "PENDING" },
        { id: "item-011", userId: "u011", userName: "Aisha Mohammed", userEmail: "aisha.m@example.com", department: "Legal", appName: "Salesforce", entitlement: "Reports Viewer", riskLevel: "LOW", lastAccess: "2026-04-25", accessGrantedDate: "2025-11-10", recommendation: "APPROVE", status: "APPROVED" },
        { id: "item-012", userId: "u012", userName: "Ryan O'Brien", userEmail: "ryan.o@example.com", department: "Marketing", appName: "Salesforce", entitlement: "CRM Full Access", riskLevel: "HIGH", lastAccess: "2025-10-05", accessGrantedDate: "2023-08-20", recommendation: "REVOKE", status: "REVOKED" },
      ],
    },
    {
      id: "rev-002",
      campaignName: "Q2 2026 ServiceNow Access Review",
      campaignId: "camp-snow-q2",
      reviewerName: "Current User",
      reviewerEmail: "reviewer@example.com",
      totalItems: 6,
      completedItems: 0,
      dueDate: "2026-05-20",
      items: [
        { id: "item-101", userId: "u002", userName: "Marcus Johnson", userEmail: "marcus.j@example.com", department: "Engineering", appName: "ServiceNow", entitlement: "Incident Manager", riskLevel: "LOW", lastAccess: "2026-04-28", accessGrantedDate: "2025-03-15", recommendation: "APPROVE", status: "PENDING" },
        { id: "item-102", userId: "u005", userName: "Emma Wilson", userEmail: "emma.w@example.com", department: "Finance", appName: "ServiceNow", entitlement: "Change Manager", riskLevel: "MEDIUM", lastAccess: "2026-01-10", accessGrantedDate: "2024-06-20", recommendation: "REVIEW", status: "PENDING" },
        { id: "item-103", userId: "u007", userName: "Lisa Zhang", userEmail: "lisa.z@example.com", department: "Engineering", appName: "ServiceNow", entitlement: "Admin", riskLevel: "HIGH", lastAccess: "2026-04-15", accessGrantedDate: "2024-02-01", recommendation: "REVIEW", status: "PENDING" },
        { id: "item-104", userId: "u008", userName: "Tom Anderson", userEmail: "tom.a@example.com", department: "HR", appName: "ServiceNow", entitlement: "HR Service Desk", riskLevel: "LOW", lastAccess: "2026-04-29", accessGrantedDate: "2025-07-01", recommendation: "APPROVE", status: "PENDING" },
        { id: "item-105", userId: "u010", userName: "Carlos Rivera", userEmail: "carlos.r@example.com", department: "Engineering", appName: "ServiceNow", entitlement: "Incident Manager", riskLevel: "LOW", lastAccess: "2026-04-20", accessGrantedDate: "2025-04-10", recommendation: "APPROVE", status: "PENDING" },
        { id: "item-106", userId: "u012", userName: "Ryan O'Brien", userEmail: "ryan.o@example.com", department: "Marketing", appName: "ServiceNow", entitlement: "Service Portal User", riskLevel: "CRITICAL", lastAccess: "2025-06-01", accessGrantedDate: "2023-12-15", recommendation: "REVOKE", status: "PENDING" },
      ],
    },
  ];
}

/**
 * Approve a certification review item.
 * TODO: Replace with real approve API call
 */
export async function approveItem(reviewId: string, itemId: string, accessToken: string): Promise<void> {
  // const resp = await fetch(`${CERT_API_BASE}/reviews/${reviewId}/items/${itemId}/approve`, {
  //   method: "POST",
  //   headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  // });
  console.log(`[PLACEHOLDER] Approved: review=${reviewId} item=${itemId}`);
}

/**
 * Revoke/reject a certification review item.
 * TODO: Replace with real reject API call
 */
export async function revokeItem(reviewId: string, itemId: string, accessToken: string, justification?: string): Promise<void> {
  // const resp = await fetch(`${CERT_API_BASE}/reviews/${reviewId}/items/${itemId}/revoke`, {
  //   method: "POST",
  //   headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  //   body: JSON.stringify({ justification }),
  // });
  console.log(`[PLACEHOLDER] Revoked: review=${reviewId} item=${itemId} reason=${justification}`);
}

/**
 * View configuration schema for the AI agent.
 * Defines the contract between the agent's structured output and the UI renderer.
 */

import type { ViewConfig, LayoutType } from './types';

/**
 * Available fields the agent can reference in filter/sort/group/columns.
 */
export const AVAILABLE_FIELDS = {
  // Principal fields
  'principal.firstName': 'User first name',
  'principal.lastName': 'User last name',
  'principal.email': 'User email',
  'principal.status': 'User status (ACTIVE, etc)',

  // Resource fields
  'resource.name': 'App/resource name',
  'resource.type': 'Resource type (APP, GROUP)',

  // Decision fields
  'decision': 'Current decision (UNREVIEWED, APPROVE, REVOKE)',
  'recommendation': 'AI recommendation (APPROVE, REVOKE)',
  'assignmentType': 'How assigned (INDIVIDUAL, GROUP)',

  // Risk fields
  'riskLevel': 'Overall risk level (LOW, MEDIUM, HIGH)',
  'riskItems': 'Risk analysis details',

  // Entitlement fields
  'entitlements': 'Active entitlements',

  // App context
  'applicationUsage': 'App usage count',
  'assignedDate': 'When access was assigned',
  'assignedVia': 'Groups that grant access',
} as const;

/**
 * Layout descriptions for the agent's system prompt.
 */
export const LAYOUT_DESCRIPTIONS: Record<LayoutType, string> = {
  'campaign-overview': 'Summary cards for each campaign showing progress (approved/revoked/pending counts) with drill-down. Use when the user wants to see all campaigns or pick one.',
  'flat-table': 'Standard data table with sortable columns and checkboxes for bulk actions. Best for detailed comparison of many items.',
  'grouped-cards': 'Cards grouped by a field (e.g., by user, by app, by risk level). Expandable/collapsible groups. Good for organizing large review sets.',
  'risk-dashboard': 'Risk-focused view showing risk level distribution and items sorted by risk. Use when the user wants to prioritize high-risk items.',
  'split-detail': 'List on the left, detail panel on the right. Click an item to see full details. Good for investigating individual items.',
};

/**
 * Default view config when no agent instruction is given.
 */
export const DEFAULT_VIEW: ViewConfig = {
  layout: 'campaign-overview',
  title: 'My Access Certifications',
};

/**
 * JSON schema description for the agent's structured output.
 * Included in the system prompt.
 */
export const VIEW_CONFIG_SCHEMA = `
You control a certification review UI. Respond with JSON containing:
{
  "message": "Natural language explanation of what you're showing",
  "view": {
    "layout": "campaign-overview" | "flat-table" | "grouped-cards" | "risk-dashboard" | "split-detail",
    "title": "Display title for the view",
    "campaignId": "Campaign ID to load items for (required for all layouts except campaign-overview)",
    "groupBy": "Field or array of fields for nested grouping (for grouped-cards layout). Example: ['resource.name', 'entitlements', 'principal.name'] for Resource > Entitlement > User hierarchy",
    "filter": { "field": "value" },  // Filter review items
    "sortBy": "Field to sort by",
    "sortOrder": "ASC" | "DESC",
    "columns": ["field1", "field2"],  // Which columns/fields to show
    "expandedByDefault": true | false  // For grouped-cards
  }
}

Available layouts:
${Object.entries(LAYOUT_DESCRIPTIONS).map(([k, v]) => `- "${k}": ${v}`).join('\n')}

Available filter/sort/group fields:
${Object.entries(AVAILABLE_FIELDS).map(([k, v]) => `- "${k}": ${v}`).join('\n')}

Filter examples:
- {"decision": "UNREVIEWED"} — only pending items
- {"resource.name": "Salesforce"} — specific app
- {"riskLevel": "HIGH"} — high risk only
- {"principal.email": "user@example.com"} — specific user
`;

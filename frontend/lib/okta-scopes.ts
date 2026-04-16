/**
 * Okta Scopes - Source of Truth
 *
 * SCOPE SEPARATION MODEL:
 * ========================
 *
 * 1. User Login (OIDC + PKCE):
 *    - Scopes: login scopes (openid, profile, email)
 *    - Purpose: User authentication and identity
 *    - Token: ID token (identity ONLY - NO resource scopes)
 *    - ORG access token: Contains endUserApi scopes (for direct Okta API calls)
 *
 * 2. ID Token → ID-JAG Exchange:
 *    - Scopes: mcpResource (governance:mcp) - EXPLICITLY requested
 *    - Purpose: Grant AI agent access to MCP server
 *    - Token: ID-JAG (identity + resource scope)
 *    - CRITICAL: Scope comes from exchange request, NOT from ID token
 *
 * 3. ID-JAG → MCP Access Token Exchange:
 *    - Scopes: INHERITED from ID-JAG (no new scopes requested)
 *    - Purpose: Final access token for MCP server
 *    - Token: MCP access token (governance:mcp scope from ID-JAG)
 *
 * IMPORTANT:
 * - ID tokens carry identity ONLY (no resource scopes)
 * - ID-JAG scope is explicitly requested during token exchange
 * - MCP access token inherits scope from ID-JAG assertion
 * - ORG access token (from login) is used separately for end-user Okta API calls
 */

export const oktaScopes = {
  // OIDC identity scopes - Used in user login flow
  login: [
    'openid',
    'profile',
    'email',
  ],

  // End-user API scopes - Granted to ORG access token during login
  // Used for direct Okta Governance API calls by the authenticated user
  endUserApi: [
    'okta.accessRequests.catalog.read',
    'okta.accessRequests.request.read',
    'okta.accessRequests.request.manage',  // Required for creating/managing access requests
    'okta.governance.accessCertifications.read',
    'okta.governance.accessCertifications.manage',
    'okta.governance.delegates.manage',
    'okta.governance.delegates.read',
    'okta.governance.principalSettings.manage',
    'okta.governance.principalSettings.read',
    'okta.governance.securityAccessReviews.endUser.read',
    'okta.governance.securityAccessReviews.endUser.manage',
    'okta.users.read.self',
  ],

  // MCP resource scope - Used ONLY in ID-JAG exchange
  // Grants AI agent access to MCP server on behalf of authenticated user
  mcpResource: [
    'governance:mcp',
  ],
};

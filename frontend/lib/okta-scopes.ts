export const oktaScopes = {
  login: [
    'openid',
    'profile',
    'email',
  ],
  endUserApi: [
    'okta.accessRequests.catalog.read',
    'okta.accessRequests.request.read',
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
  mcpResource: [
    'governance:mcp',
  ],
};

/**
 * Okta-specific configuration
 *
 * Configures:
 * - Service app OAuth client (client credentials + private_key_jwt)
 * - Okta API endpoints
 * - ID-JAG validation for inbound user tokens
 */

/**
 * Default OAuth scopes for service app
 *
 * These are used when no specific scopes are requested.
 * Should be kept to minimum required for basic operations.
 */
const DEFAULT_SCOPES = [
  'okta.apps.read',
  'okta.users.read',
  'okta.groups.read',
].join(' ');

export function oktaConfig() {
  // Required configuration
  const domain = process.env.OKTA_DOMAIN;
  const clientId = process.env.OKTA_CLIENT_ID;
  const privateKeyPath = process.env.OKTA_PRIVATE_KEY_PATH;

  // Validation
  if (!domain) {
    throw new Error('OKTA_DOMAIN environment variable is required');
  }

  if (!clientId) {
    throw new Error('OKTA_CLIENT_ID environment variable is required');
  }

  if (!privateKeyPath) {
    throw new Error('OKTA_PRIVATE_KEY_PATH environment variable is required');
  }

  // Parse domain to extract org URL
  // Supports: dev-123456.okta.com, company.oktapreview.com, company.okta.com
  const orgUrl = domain.startsWith('https://') ? domain : `https://${domain}`;

  // Service app OAuth configuration
  // IMPORTANT: Must use org authorization server (/oauth2/v1/token)
  // NOT custom authorization server (/oauth2/aus.../v1/token)
  const tokenUrl = process.env.OKTA_TOKEN_URL || `${orgUrl}/oauth2/v1/token`;

  // Default scopes (can be overridden per request)
  const defaultScopes = process.env.OKTA_SCOPES_DEFAULT || DEFAULT_SCOPES;

  // Private key kid (optional, but recommended for key rotation)
  const privateKeyKid = process.env.OKTA_PRIVATE_KEY_KID;

  return {
    // Core OAuth configuration
    domain,
    orgUrl,
    clientId,
    privateKeyPath,
    privateKeyKid,
    tokenUrl,
    defaultScopes,

    // Okta API endpoints
    baseUrl: orgUrl,
    apiV1: `${orgUrl}/api/v1`,
    governanceApi: `${orgUrl}/governance/api/v1`,

    // ID-JAG validation (for inbound user tokens from MAS)
    // NOTE: Used by MAS for token exchange, not used by MRS anymore
    idJag: {
      // ID-JAG can use custom authorization server
      issuer: process.env.ID_JAG_ISSUER || `${orgUrl}/oauth2/default`,
      audience: process.env.ID_JAG_AUDIENCE || 'api://mcp-governance',
      jwksUri: process.env.ID_JAG_JWKS_URI || `${orgUrl}/oauth2/default/v1/keys`,
    },

    // Access Token validation (for MRS authentication)
    // Access tokens are issued by Okta custom authorization server after ID-JAG exchange
    accessToken: {
      // Custom authorization server issuer
      issuer: process.env.ACCESS_TOKEN_ISSUER || process.env.ID_JAG_ISSUER || `${orgUrl}/oauth2/default`,
      // Expected audience for MCP access
      audience: process.env.ACCESS_TOKEN_AUDIENCE || process.env.ID_JAG_AUDIENCE || 'api://mcp-governance',
      // JWKS URI for custom authorization server
      jwksUri: process.env.ACCESS_TOKEN_JWKS_URI || process.env.ID_JAG_JWKS_URI || `${orgUrl}/oauth2/default/v1/keys`,
    },
  };
}

/**
 * Okta-specific configuration
 */

export function oktaConfig() {
  const domain = process.env.OKTA_DOMAIN;
  const issuer = process.env.OKTA_ISSUER;
  const clientId = process.env.OKTA_CLIENT_ID;
  const privateKeyPath = process.env.OKTA_PRIVATE_KEY_PATH;
  const tokenUrl = process.env.OKTA_TOKEN_URL;

  if (!domain) {
    throw new Error('OKTA_DOMAIN environment variable is required');
  }

  if (!clientId) {
    throw new Error('OKTA_CLIENT_ID environment variable is required');
  }

  return {
    domain,
    issuer: issuer || `https://${domain}/oauth2/default`,
    clientId,
    privateKeyPath: privateKeyPath || './keys/okta-private-key.pem',
    tokenUrl: tokenUrl || `https://${domain}/oauth2/v1/token`,
    baseUrl: `https://${domain}`,
    // Okta API endpoints
    apiV1: `https://${domain}/api/v1`,
    governanceApi: `https://${domain}/governance/api/v1`,
    // ID-JAG validation
    idJag: {
      issuer: process.env.ID_JAG_ISSUER || `https://${domain}/oauth2/default`,
      audience: process.env.ID_JAG_AUDIENCE || 'api://mcp-governance',
      jwksUri: process.env.ID_JAG_JWKS_URI || `https://${domain}/oauth2/default/v1/keys`,
    },
  };
}

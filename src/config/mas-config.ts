/**
 * MAS (MCP Authorization Server) configuration
 */

export function masConfig() {
  const port = parseInt(process.env.MAS_PORT || '3000', 10);
  const baseUrl = process.env.MAS_BASE_URL || `http://localhost:${port}`;
  const privateKeyPath = process.env.MAS_JWT_PRIVATE_KEY_PATH || './keys/mas-private-key.pem';
  const publicKeyPath = process.env.MAS_JWT_PUBLIC_KEY_PATH || './keys/mas-public-key.pem';
  const algorithm = process.env.MAS_JWT_ALGORITHM || 'RS256';
  const tokenExpiry = parseInt(process.env.MAS_TOKEN_EXPIRY || '3600', 10);
  const issuer = process.env.MCP_TOKEN_ISSUER || 'mcp://okta-governance-mas';
  const audience = process.env.MCP_TOKEN_AUDIENCE || 'mcp://okta-governance-mrs';

  return {
    port,
    baseUrl,
    jwt: {
      privateKeyPath,
      publicKeyPath,
      algorithm,
      tokenExpiry,
      issuer,
      audience,
    },
  };
}

/**
 * MRS (MCP Resource Server) configuration
 */

export function mrsConfig() {
  const port = parseInt(process.env.MRS_PORT || '3001', 10);
  const baseUrl = process.env.MRS_BASE_URL || `http://localhost:${port}`;
  const serverName = process.env.MRS_SERVER_NAME || 'okta-governance-mcp';
  const serverVersion = process.env.MRS_SERVER_VERSION || '1.0.0';
  const tokenAudience = process.env.MCP_TOKEN_AUDIENCE || 'mcp://okta-governance-mrs';
  const tokenIssuer = process.env.MCP_TOKEN_ISSUER || 'mcp://okta-governance-mas';
  const enablePostmanCatalog = process.env.ENABLE_POSTMAN_CATALOG === 'true';

  return {
    port,
    baseUrl,
    serverName,
    serverVersion,
    token: {
      audience: tokenAudience,
      issuer: tokenIssuer,
    },
    features: {
      enablePostmanCatalog,
    },
  };
}

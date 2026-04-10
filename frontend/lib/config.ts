/**
 * Frontend configuration for Okta and MCP
 *
 * Centralized configuration for:
 * - Okta domain and authorization servers
 * - MCP backend URL
 * - OAuth/OIDC settings
 */

export interface FrontendConfig {
  okta: {
    domain: string;
    clientId: string;
    orgAuthServer: {
      issuer: string;
      tokenEndpoint: string;
      jwksUri: string;
    };
    customAuthServer: {
      issuer: string;
      tokenEndpoint: string;
      authorizeEndpoint: string;
      jwksUri: string;
    };
  };
  mcp: {
    baseUrl: string;
    endpoints: {
      tools: string;
      toolsCall: string;
      discovery: string;
    };
  };
  oauth: {
    redirectUri: string;
    scopes: string[];
  };
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): FrontendConfig {
  const oktaDomain = process.env.NEXT_PUBLIC_OKTA_DOMAIN || '';
  const clientId = process.env.NEXT_PUBLIC_OKTA_CLIENT_ID || '';
  const customAuthServer = process.env.NEXT_PUBLIC_OKTA_CUSTOM_AUTH_SERVER || 'default';
  const mcpBaseUrl = process.env.NEXT_PUBLIC_MCP_BASE_URL || 'http://localhost:3002';
  const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI || 'http://localhost:3000/api/auth/callback';

  const orgUrl = oktaDomain.startsWith('https://') ? oktaDomain : `https://${oktaDomain}`;

  return {
    okta: {
      domain: oktaDomain,
      clientId,
      orgAuthServer: {
        issuer: `${orgUrl}`,
        tokenEndpoint: `${orgUrl}/oauth2/v1/token`,
        jwksUri: `${orgUrl}/oauth2/v1/keys`,
      },
      customAuthServer: {
        issuer: `${orgUrl}/oauth2/${customAuthServer}`,
        tokenEndpoint: `${orgUrl}/oauth2/${customAuthServer}/v1/token`,
        authorizeEndpoint: `${orgUrl}/oauth2/${customAuthServer}/v1/authorize`,
        jwksUri: `${orgUrl}/oauth2/${customAuthServer}/v1/keys`,
      },
    },
    mcp: {
      baseUrl: mcpBaseUrl,
      endpoints: {
        tools: `${mcpBaseUrl}/mcp/v1/tools/list`,
        toolsCall: `${mcpBaseUrl}/mcp/v1/tools/call`,
        discovery: `${mcpBaseUrl}/.well-known/mcp.json`,
      },
    },
    oauth: {
      redirectUri,
      scopes: ['openid', 'profile', 'email', 'mcp.governance'],
    },
  };
}

/**
 * Singleton config instance
 */
export const config = loadConfig();

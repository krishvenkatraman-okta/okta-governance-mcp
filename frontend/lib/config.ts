/**
 * Frontend configuration for Okta and MCP
 *
 * IMPORTANT: Two OAuth Clients
 * =============================
 *
 * This application uses TWO separate OAuth clients for different purposes:
 *
 * 1. USER OAuth Client (okta.userOAuthClient):
 *    - Used for: User authentication (OIDC + PKCE)
 *    - Used for: Access token exchange (step 3)
 *    - Type: Public client (PKCE) or Confidential client (with secret)
 *
 * 2. AGENT OAuth Client (okta.agent):
 *    - Used for: ID-JAG exchange (step 2)
 *    - Type: Confidential client with private_key_jwt authentication
 *    - Requires: Private key for signing client assertions
 *
 * Authentication Flow:
 * ====================
 *
 * 1. User authentication (OIDC + PKCE) → ORG authorization server
 *    Client: USER OAuth client
 *
 * 2. ID token → ID-JAG exchange → ORG authorization server
 *    Client: AGENT OAuth client (signed client assertion)
 *
 * 3. ID-JAG → access token exchange → CUSTOM authorization server
 *    Client: USER OAuth client
 *
 * 4. Access token → call MCP server
 *
 * Authorization Servers:
 * - ORG Auth Server: /oauth2/v1/... (steps 1-2)
 * - CUSTOM Auth Server: /oauth2/{serverId}/v1/... (step 3)
 */

export interface FrontendConfig {
  okta: {
    domain: string;

    // USER OAuth Client
    // Used for: User authentication (OIDC + PKCE)
    // This is the OAuth 2.0 web application that the user logs into
    // Client Authentication: Public key / Private key (private_key_jwt)
    // Additional Verification: PKCE required
    userOAuthClient: {
      clientId: string;               // User OAuth client ID
      keyId: string;                  // Key ID (kid) for signing client assertions
      privateKeyJwk?: string;         // User OAuth client private key as JWK (JSON string, server-side only)
      privateKeyPath?: string;        // Alternative: path to private key file (server-side only)
    };

    // ORG Authorization Server
    // Used for: OIDC authentication and ID-JAG exchange
    orgAuthServer: {
      issuer: string;
      authorizeEndpoint: string;  // For OIDC flow
      tokenEndpoint: string;       // For code exchange and ID-JAG exchange
      jwksUri: string;
    };

    // CUSTOM Authorization Server
    // Used for: ID-JAG → access token exchange
    customAuthServer: {
      serverId: string;
      issuer: string;
      audience: string;        // Audience for ID-JAG exchange (base URL without /v1/token)
      tokenEndpoint: string;   // For ID-JAG → access token exchange
      jwksUri: string;
    };

    // AGENT Principal (for token exchange only, NOT login)
    // Used ONLY for: Token exchange (ID-JAG exchange, MCP access token exchange)
    // Uses private_key_jwt authentication (signed client assertion)
    // NOTE: This is the AGENT PRINCIPAL ID, not a user OAuth client
    agent: {
      principalId: string;        // Agent principal ID (iss/sub in client assertion)
      keyId: string;              // Key ID (kid) for signing client assertions
      privateKeyJwk?: string;     // Agent private key as JWK (JSON string, server-side only)
      privateKeyPath?: string;    // Alternative: path to private key file (server-side only)
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
    scopes: string[];  // OIDC scopes ONLY (openid, profile, email) - NOT governance scopes
                       // Governance scopes are requested during ID-JAG exchange, not login
  };

  debug: {
    exposeTokens: boolean;  // If true, debug API will return raw tokens (LOCAL USE ONLY)
  };
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): FrontendConfig {
  // Okta domain
  const oktaDomain = process.env.NEXT_PUBLIC_OKTA_DOMAIN || '';
  const orgUrl = oktaDomain.startsWith('https://') ? oktaDomain : `https://${oktaDomain}`;

  // USER OAuth Client (for user authentication with PKCE + private_key_jwt)
  const userOAuthClientId = process.env.NEXT_PUBLIC_OKTA_USER_OAUTH_CLIENT_ID || '';
  const userOAuthKeyId = process.env.NEXT_PUBLIC_OKTA_USER_OAUTH_KEY_ID || '';
  const userOAuthPrivateKeyJwk = process.env.USER_OAUTH_PRIVATE_KEY_JWK;  // Server-side only
  const userOAuthPrivateKeyPath = process.env.USER_OAUTH_PRIVATE_KEY_PATH;  // Server-side only

  // Custom authorization server ID
  const customAuthServerId = process.env.NEXT_PUBLIC_OKTA_CUSTOM_AUTH_SERVER_ID || 'default';

  // AGENT Principal (for token exchange only, NOT login)
  // Uses private_key_jwt authentication for ID-JAG and MCP access token exchanges
  const agentPrincipalId = process.env.NEXT_PUBLIC_OKTA_AGENT_PRINCIPAL_ID || '';
  const agentKeyId = process.env.NEXT_PUBLIC_OKTA_AGENT_KEY_ID || '';
  const agentPrivateKeyJwk = process.env.AGENT_PRIVATE_KEY_JWK;  // Server-side only
  const agentPrivateKeyPath = process.env.AGENT_PRIVATE_KEY_PATH;  // Server-side only

  // MCP server
  const mcpBaseUrl = process.env.NEXT_PUBLIC_MCP_BASE_URL || 'http://localhost:3002';

  // OAuth redirect
  const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI || 'http://localhost:3000/api/auth/callback';

  // Debug (LOCAL USE ONLY - never enable in production)
  const debugExposeTokens = process.env.DEBUG_EXPOSE_TOKENS === 'true';

  return {
    okta: {
      domain: oktaDomain,

      // USER OAuth Client
      // Used for: User authentication (OIDC + PKCE + private_key_jwt)
      userOAuthClient: {
        clientId: userOAuthClientId,
        keyId: userOAuthKeyId,
        privateKeyJwk: userOAuthPrivateKeyJwk,
        privateKeyPath: userOAuthPrivateKeyPath,
      },

      // ORG Authorization Server
      // Used for: OIDC + PKCE authentication (step 1) and ID-JAG exchange (step 2)
      orgAuthServer: {
        issuer: orgUrl,
        authorizeEndpoint: `${orgUrl}/oauth2/v1/authorize`,
        tokenEndpoint: `${orgUrl}/oauth2/v1/token`,
        jwksUri: `${orgUrl}/oauth2/v1/keys`,
      },

      // CUSTOM Authorization Server
      // Used for: ID-JAG → access token exchange (step 3)
      customAuthServer: {
        serverId: customAuthServerId,
        issuer: `${orgUrl}/oauth2/${customAuthServerId}`,
        audience: `${orgUrl}/oauth2/${customAuthServerId}`,  // Base URL for audience claim
        tokenEndpoint: `${orgUrl}/oauth2/${customAuthServerId}/v1/token`,
        jwksUri: `${orgUrl}/oauth2/${customAuthServerId}/v1/keys`,
      },

      // AGENT Principal (for token exchange only, NOT login)
      // Used ONLY for: Token exchange (ID-JAG exchange, MCP access token exchange)
      agent: {
        principalId: agentPrincipalId,
        keyId: agentKeyId,
        privateKeyJwk: agentPrivateKeyJwk,
        privateKeyPath: agentPrivateKeyPath,
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
      scopes: ['openid', 'profile', 'email'],  // OIDC scopes ONLY (for user login)
                                                // Governance scopes are requested during ID-JAG exchange
    },

    debug: {
      exposeTokens: debugExposeTokens,  // LOCAL USE ONLY - never enable in production
    },
  };
}

/**
 * Singleton config instance
 */
export const config = loadConfig();

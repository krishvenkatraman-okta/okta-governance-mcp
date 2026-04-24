/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 *
 * Provides discovery endpoint for OAuth clients to learn how to authenticate.
 * Includes protected resource metadata (RFC 8705) to describe MCP server capabilities.
 */

import { config } from '../config/index.js';
import { getProtectedResourceMetadata, getMcpServerInfo } from './resource-metadata.js';
import { getAllToolScopes } from './scope-registry.js';

/**
 * OAuth 2.0 Discovery Metadata structure (RFC 8414)
 */
export interface OAuthDiscoveryMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  resource_server: any;
  mcp_server_info: any;
  revocation_endpoint?: string;
  introspection_endpoint?: string;
}

/**
 * Generate OAuth 2.0 Authorization Server Metadata
 *
 * Returns discovery metadata compliant with RFC 8414, plus:
 * - Protected resource metadata (RFC 8705)
 * - MCP-specific server information
 *
 * This endpoint tells OAuth clients (VS Code, Claude Desktop) how to:
 * - Start authorization flow
 * - Exchange authorization code for token
 * - Validate tokens
 * - What scopes are needed for the MCP server
 */
export function getOAuthDiscoveryMetadata(): OAuthDiscoveryMetadata {
  // Validate config exists
  if (!config.okta?.oauth) {
    throw new Error('OAuth configuration not found. Please set OKTA_OAUTH_ISSUER environment variable.');
  }

  const issuer = config.okta.oauth.issuer;

  if (!issuer) {
    throw new Error('OAuth issuer not configured. Please set OKTA_OAUTH_ISSUER environment variable.');
  }

  return {
    // Standard OAuth 2.0 Authorization Server Metadata (RFC 8414)
    issuer,
    authorization_endpoint: config.okta.oauth.authorizationEndpoint || `${issuer}/oauth2/v1/authorize`,
    token_endpoint: config.okta.oauth.tokenEndpoint || `${issuer}/oauth2/v1/token`,
    jwks_uri: config.okta.oauth.jwksUri || `${issuer}/oauth2/v1/keys`,
    scopes_supported: getAllToolScopes(),
    response_types_supported: ['code', 'token'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'none', // For PKCE public clients
    ],

    // Protected Resource Metadata (RFC 8705)
    // Describes what scopes are required for this resource server
    resource_server: getProtectedResourceMetadata(),

    // MCP-specific extensions
    // Provides additional information about MCP server capabilities
    mcp_server_info: getMcpServerInfo(),

    // Optional endpoints (for token management)
    revocation_endpoint: `${issuer}/oauth2/v1/revoke`,
    introspection_endpoint: `${issuer}/oauth2/v1/introspect`,
  };
}

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 *
 * This module provides metadata for the MCP server as a Protected Resource.
 * The MCP server VALIDATES tokens from Okta; it doesn't ISSUE tokens.
 * This is the correct pattern for our use case.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9728.html
 */

import { config } from '../config/index.js';
import { getAllToolScopes } from './scope-registry.js';

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 *
 * This tells OAuth clients:
 * - We're a protected resource (not an auth server)
 * - Get tokens from Okta (the auth server)
 * - Here are the scopes we require
 */
export interface ProtectedResourceMetadata {
  /** REQUIRED: The resource identifier */
  resource: string;

  /** REQUIRED: Where to get access tokens */
  authorization_servers: string[];

  /** OPTIONAL: Human-readable name */
  resource_name?: string;

  /** OPTIONAL: Documentation URL */
  resource_documentation?: string;

  /** OPTIONAL: Scopes this resource requires */
  scopes_supported?: string[];

  /** OPTIONAL: How to send the bearer token */
  bearer_methods_supported?: string[];
}

/**
 * Generate OAuth 2.0 Protected Resource Metadata
 *
 * This is the CORRECT pattern for your MCP server.
 * You're a protected resource that accepts tokens from Okta.
 * You do NOT issue tokens yourself.
 *
 * @returns Protected Resource Metadata compliant with RFC 9728
 * @throws Error if OAuth configuration is missing
 */
export function getProtectedResourceMetadata(): ProtectedResourceMetadata {
  if (!config.okta?.oauth) {
    throw new Error('OAuth configuration not found');
  }

  // Your MCP server's actual URL (the protected resource)
  // This should be the real endpoint where clients send authenticated requests
  const baseUrl = config.http?.baseUrl || 'https://okta-governance-mcp.onrender.com';
  const resourceIdentifier = `${baseUrl}/mcp`;

  // Where OAuth clients should get access tokens (Okta ORG auth server)
  const authorizationServers = [config.okta.oauth.issuer];

  // Documentation URL
  const resourceDocumentation = config.resource?.documentation || `${baseUrl}/docs`;

  // Get tool-specific scopes and add OIDC scopes
  const toolScopes = getAllToolScopes();
  const allScopes = ['openid', 'profile', 'email', ...toolScopes];

  return {
    // Your MCP server's actual URL
    resource: resourceIdentifier,

    // Where to get access tokens (Okta ORG auth server)
    authorization_servers: authorizationServers,

    // Human-readable name
    resource_name: 'Okta Governance MCP Server',

    // Documentation
    resource_documentation: resourceDocumentation,

    // Scopes required for this resource (OIDC + Okta admin scopes)
    scopes_supported: allScopes,

    // How to send the bearer token
    bearer_methods_supported: ['header'],
  };
}

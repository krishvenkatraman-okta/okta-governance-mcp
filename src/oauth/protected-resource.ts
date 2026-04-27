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

  /** OPTIONAL: Token types accepted */
  token_types_supported?: string[];
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

  // Your MCP server's URL (the protected resource)
  const resourceIdentifier = config.resource?.identifier || config.http?.baseUrl || 'https://governance.okta.com/mcp';

  // Where OAuth clients should get access tokens (Okta ORG auth server)
  const authorizationServers = [config.okta.oauth.issuer];

  // Documentation URL
  const resourceDocumentation = config.resource?.documentation || `${config.http?.baseUrl || ''}/docs`;

  return {
    // Your MCP server's URL
    resource: resourceIdentifier,

    // Where to get access tokens (Okta ORG auth server)
    authorization_servers: authorizationServers,

    // Human-readable name
    resource_name: 'Okta Governance MCP Server',

    // Documentation
    resource_documentation: resourceDocumentation,

    // Scopes required for this resource
    scopes_supported: getAllToolScopes(),

    // How to send the bearer token
    bearer_methods_supported: ['header'],

    // Token types accepted
    token_types_supported: ['Bearer'],
  };
}

/**
 * Protected resource metadata (RFC 8705)
 *
 * Generates metadata describing the MCP server as an OAuth 2.0 resource server.
 * This tells OAuth clients what scopes are required and what capabilities are available.
 */

import { config } from '../config/index.js';
import { getAllToolScopes, getToolCapabilities } from './scope-registry.js';

/**
 * Protected resource metadata structure (RFC 8705)
 */
export interface ProtectedResourceMetadata {
  resource: string;
  resource_documentation?: string;
  scopes_supported: string[];
  token_types_supported: string[];
  authorization_details_supported: boolean;
}

/**
 * Generate protected resource metadata (RFC 8705)
 *
 * Returns metadata describing this resource server's requirements and capabilities.
 * Used by OAuth clients to understand what scopes to request.
 */
export function getProtectedResourceMetadata(): ProtectedResourceMetadata {
  return {
    resource: config.resource.identifier,
    resource_documentation: config.resource.documentation,
    scopes_supported: getAllToolScopes(),
    token_types_supported: ['Bearer'],
    authorization_details_supported: false,
  };
}

/**
 * Get MCP-specific server information
 *
 * Returns extended metadata about the MCP server, including:
 * - Server name and version
 * - Available capabilities
 * - Tool details per capability
 */
export function getMcpServerInfo() {
  return {
    name: 'Okta Governance MCP Server',
    version: config.mrs.serverVersion,
    capabilities: Object.keys(getToolCapabilities()),
    capability_details: getToolCapabilities(),
  };
}

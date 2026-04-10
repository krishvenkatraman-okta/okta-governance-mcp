/**
 * MCP Server Metadata Builder
 *
 * Generates MCP server discovery metadata for the /.well-known/mcp.json endpoint
 * according to the Model Context Protocol specification.
 */

import { config } from '../config/index.js';

/**
 * MCP Server Metadata
 *
 * Discovery metadata that describes the server's capabilities, endpoints,
 * and authentication requirements.
 */
export interface McpServerMetadata {
  /** Protocol version */
  protocolVersion: string;

  /** Server information */
  server: {
    name: string;
    version: string;
    vendor?: string;
  };

  /** Transport configuration */
  transport: {
    type: 'stdio' | 'http' | 'sse';
    url?: string;
    /** For HTTP transport */
    endpoint?: string;
  };

  /** Authentication requirements */
  authentication: {
    required: boolean;
    schemes: string[];
    description?: string;
  };

  /** Server capabilities */
  capabilities: {
    tools?: {
      dynamic: boolean;
      count?: number;
    };
    resources?: {
      dynamic: boolean;
      count?: number;
    };
    prompts?: {
      dynamic: boolean;
      count?: number;
    };
    sampling?: boolean;
    logging?: boolean;
  };

  /** Additional metadata */
  metadata?: {
    description?: string;
    homepage?: string;
    documentation?: string;
    support?: string;
  };
}

/**
 * Build MCP server metadata from configuration
 *
 * Generates discovery metadata that reflects the actual server configuration,
 * including URLs, transport type, authentication requirements, and capabilities.
 */
export function buildServerMetadata(): McpServerMetadata {
  const { baseUrl, serverName, serverVersion } = config.mrs;

  return {
    protocolVersion: '2024-11-05',

    server: {
      name: serverName,
      version: serverVersion,
      vendor: 'Okta Identity Governance',
    },

    transport: {
      type: 'http',
      url: baseUrl,
      endpoint: '/mcp/v1',
    },

    authentication: {
      required: true,
      schemes: ['bearer'],
      description:
        'Requires MCP access token issued by MAS. Obtain token via OAuth 2.0 token exchange with Okta ID-JAG.',
    },

    capabilities: {
      tools: {
        dynamic: true,
        // Tools are filtered based on user authorization context
        // Count varies by user role and targets
      },
      resources: {
        dynamic: false,
        count: 0,
      },
      prompts: {
        dynamic: false,
        count: 0,
      },
      sampling: false,
      logging: false,
    },

    metadata: {
      description:
        'MCP server for Okta Identity Governance operations. ' +
        'Provides governance tools for entitlements, campaigns, bundles, labels, and access requests. ' +
        'Authorization is role-based (SUPER_ADMIN, APP_ADMIN, GROUP_ADMIN) with fine-grained capability checks.',
      documentation: `${baseUrl}/docs`,
      support: 'https://github.com/okta/okta-governance-mcp',
    },
  };
}

/**
 * Get server metadata as JSON response
 *
 * Returns formatted metadata suitable for HTTP response.
 * Ensures stable output for testing and demos.
 */
export function getServerMetadataResponse(): McpServerMetadata {
  return buildServerMetadata();
}

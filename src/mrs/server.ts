/**
 * MRS MCP server implementation
 *
 * Implements the Model Context Protocol for governance tools
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config/index.js';
import { getAvailableTools } from './tool-registry.js';
import { executeTool } from './tool-executor.js';
import { loadEndpointRegistry } from '../catalog/endpoint-registry.js';
import type { AuthorizationContext } from '../types/index.js';

/**
 * MCP server instance
 */
let authContext: AuthorizationContext | null = null;

/**
 * Create and start MRS server
 */
export async function startMrsServer() {
  const server = new Server(
    {
      name: config.mrs.serverName,
      version: config.mrs.serverVersion,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Initialize endpoint registry if enabled
  if (config.mrs.features.enablePostmanCatalog) {
    try {
      const postmanPath = './postman/Okta Governance API.postman_collection.json';
      loadEndpointRegistry(postmanPath);
      console.log('[MRS] Loaded Postman endpoint catalog');
    } catch (error) {
      console.warn('[MRS] Failed to load Postman catalog:', error);
    }
  }

  /**
   * List tools handler
   *
   * Returns tools filtered by user authorization context
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // In a real implementation, we would extract the MCP token from the request
    // For now, we use a placeholder context
    const context = authContext || {
      subject: 'unknown',
      roles: {
        superAdmin: false,
        orgAdmin: false,
        appAdmin: false,
        groupAdmin: false,
        readOnlyAdmin: false,
        regularUser: true,
      },
      targets: { apps: [], groups: [] },
      reviewer: { hasAssignedReviews: false, hasSecurityAccessReviews: false },
      capabilities: [],
    };

    const tools = getAvailableTools(context);

    return { tools };
  });

  /**
   * Call tool handler
   *
   * Executes tool with re-authorization
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // In a real implementation, we would extract and validate the MCP token
    // For now, we use a placeholder context
    const context = authContext || {
      subject: 'unknown',
      roles: {
        superAdmin: false,
        orgAdmin: false,
        appAdmin: false,
        groupAdmin: false,
        readOnlyAdmin: false,
        regularUser: true,
      },
      targets: { apps: [], groups: [] },
      reviewer: { hasAssignedReviews: false, hasSecurityAccessReviews: false },
      capabilities: [],
    };

    const result = await executeTool(
      {
        name: request.params.name,
        arguments: request.params.arguments,
      },
      context
    );

    // Return in the expected format for CallToolResult
    return {
      content: result.content,
      isError: result.isError,
    };
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.log('\n🔧 MCP Resource Server (MRS) running');
  console.log(`📍 Server: ${config.mrs.serverName} v${config.mrs.serverVersion}`);
  console.log('✅ Ready to accept tool calls via MCP protocol\n');

  return server;
}

/**
 * Set authorization context (for testing)
 */
export function setAuthorizationContext(context: AuthorizationContext) {
  authContext = context;
}

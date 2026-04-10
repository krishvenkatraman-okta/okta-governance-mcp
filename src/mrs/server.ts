/**
 * MRS MCP server implementation
 *
 * Implements the Model Context Protocol for governance tools with
 * request authentication and authorization context resolution.
 *
 * Authentication Flow:
 * 1. Extract MCP access token from request metadata
 * 2. Validate token (signature, issuer, audience, expiry)
 * 3. Extract subject from validated token
 * 4. Resolve authorization context (roles, targets, capabilities)
 * 5. Filter/execute tools based on authorization context
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
import { validateAccessToken } from '../auth/access-token-validator.js';
import { resolveAuthorizationContextForSubject } from '../policy/authorization-context.js';
import type { AuthorizationContext } from '../types/index.js';

/**
 * Extract Okta access token from request metadata
 *
 * The MCP SDK may pass authentication via:
 * - Request metadata (meta.auth or meta.token)
 * - Environment variables (for stdio transport)
 * - Custom headers (for HTTP transport)
 *
 * For now, we support environment variable for testing.
 */
function extractAccessToken(request: any): string | null {
  // Try to extract from request metadata
  if (request.meta?.auth?.token) {
    return request.meta.auth.token;
  }

  if (request.meta?.token) {
    return request.meta.token;
  }

  // Try environment variable (for testing)
  // Note: This is now an Okta access token, not MCP token
  if (process.env.MCP_ACCESS_TOKEN) {
    return process.env.MCP_ACCESS_TOKEN;
  }

  return null;
}

/**
 * Authenticate and resolve authorization context
 *
 * Validates the Okta access token and resolves the user's authorization context.
 * Fails closed - returns null if authentication fails.
 *
 * @param request - MCP request object
 * @returns Authorization context or null if auth fails
 */
async function authenticateRequest(request: any): Promise<AuthorizationContext | null> {
  // Step 1: Extract Okta access token
  const token = extractAccessToken(request);

  if (!token) {
    console.warn('[MRS] No Okta access token provided in request');
    return null;
  }

  // Step 2: Validate Okta access token
  const validation = await validateAccessToken(token);

  if (!validation.valid) {
    console.error('[MRS] Okta access token validation failed:', {
      error: validation.error,
      errors: validation.errors,
    });
    return null;
  }

  if (!validation.payload) {
    console.error('[MRS] Okta access token validation succeeded but no payload');
    return null;
  }

  const { sub: subject } = validation.payload;

  console.log('[MRS] Okta access token validated:', {
    subject,
    issuer: validation.claims?.issuer,
    expiresAt: validation.claims?.expiresAt,
    scope: validation.claims?.scope,
  });

  // Step 3: Resolve authorization context
  try {
    const context = await resolveAuthorizationContextForSubject(subject, validation.payload);

    console.log('[MRS] Authorization context resolved:', {
      subject,
      roles: Object.entries(context.roles)
        .filter(([_, value]) => value)
        .map(([key]) => key),
      capabilities: context.capabilities.length,
      targetApps: context.targets.apps.length,
    });

    return context;
  } catch (error) {
    console.error('[MRS] Failed to resolve authorization context:', error);
    return null;
  }
}

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
   * Authenticates the request and returns tools filtered by authorization context.
   * Fails closed - returns empty list if authentication fails.
   */
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    console.log('[MRS] Received ListTools request');

    // Authenticate and resolve authorization context
    const context = await authenticateRequest(request);

    if (!context) {
      console.warn('[MRS] ListTools: Authentication failed, returning empty tool list');
      return { tools: [] };
    }

    // Get tools filtered by authorization context
    const tools = getAvailableTools(context);

    console.log('[MRS] ListTools: Returning', tools.length, 'tools for subject', context.subject);

    return { tools };
  });

  /**
   * Call tool handler
   *
   * Authenticates the request and executes the tool with authorization context.
   * Fails closed - returns error if authentication fails.
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    console.log('[MRS] Received CallTool request:', request.params.name);

    // Authenticate and resolve authorization context
    const context = await authenticateRequest(request);

    if (!context) {
      console.error('[MRS] CallTool: Authentication failed');
      return {
        content: [
          {
            type: 'text',
            text: 'Authentication failed. Please provide a valid MCP access token.',
          },
        ],
        isError: true,
      };
    }

    // Execute tool with authorization context
    const result = await executeTool(
      {
        name: request.params.name,
        arguments: request.params.arguments,
      },
      context
    );

    console.log('[MRS] CallTool:', request.params.name, 'completed:', {
      subject: context.subject,
      isError: result.isError,
    });

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
  console.log('🔐 Authentication: MCP access token (from MAS)');
  console.log('✅ Ready to accept authenticated tool calls via MCP protocol\n');

  return server;
}

/**
 * Set authorization context (for testing)
 *
 * @deprecated For testing only. Real authentication uses MCP tokens.
 */
export function setAuthorizationContext(_context: AuthorizationContext) {
  console.warn('[MRS] setAuthorizationContext is deprecated and only for testing');
  // No-op in production - authentication must use MCP tokens
}

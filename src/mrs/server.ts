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
import {
  loadEndpointRegistry,
  getRegistryStats,
  getEndpointsByCategory,
  findEndpointByName,
} from '../catalog/endpoint-registry.js';
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

  // Initialize endpoint registry (always enabled for production)
  // This loads ALL 153+ Okta Governance API endpoints from the Postman collection
  try {
    const postmanPath = './postman/Okta Governance API.postman_collection.json';
    const registryInfo = loadEndpointRegistry(postmanPath);

    console.log('[MRS] ✅ Endpoint Registry Loaded:');
    console.log(`[MRS]    - ${registryInfo.totalCount} endpoints`);
    console.log(`[MRS]    - ${registryInfo.categories.size} categories`);
    console.log('[MRS]    - All endpoints available for intelligent tool execution');

    // Log verification
    const stats = getRegistryStats();
    if (stats) {
      console.log('[MRS] Registry Stats:', {
        total: stats.totalEndpoints,
        withBody: stats.endpointsWithRequestBody,
        withExamples: stats.endpointsWithExamples,
      });
    }

    // Verify label endpoints are loaded (critical for manage_app_labels tool)
    console.log('[MRS] Verifying label endpoints...');
    const labelEndpoints = getEndpointsByCategory('Labels');
    console.log(`[MRS]    - Found ${labelEndpoints.length} label endpoints`);

    // Check for critical label endpoints
    const criticalLabelEndpoints = [
      'List all labels',
      'Create a label',
      'Assign the labels to resources',
      'Remove the labels from resources',
    ];

    for (const name of criticalLabelEndpoints) {
      const endpoint = findEndpointByName(name);
      if (endpoint) {
        console.log(`[MRS]    ✅ "${name}"`);
      } else {
        console.error(`[MRS]    ❌ Missing: "${name}"`);
      }
    }
  } catch (error) {
    console.error('[MRS] ❌ Failed to load Postman endpoint registry:', error);
    console.error('[MRS]    Tools requiring endpoint metadata will fail');
    throw error; // Critical failure - MCP server cannot function without registry
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

    // Determine resolved role (highest privilege wins)
    let resolvedRole = 'REGULAR_USER';
    if (context.roles.superAdmin) {
      resolvedRole = 'SUPER_ADMIN';
    } else if (context.roles.orgAdmin) {
      resolvedRole = 'ORG_ADMIN';
    } else if (context.roles.appAdmin) {
      resolvedRole = 'APP_ADMIN';
    } else if (context.roles.groupAdmin) {
      resolvedRole = 'GROUP_ADMIN';
    } else if (context.roles.readOnlyAdmin) {
      resolvedRole = 'READ_ONLY_ADMIN';
    }

    // Determine scope summary
    let scopeSummary = 'No access';
    if (context.roles.superAdmin || context.roles.orgAdmin) {
      scopeSummary = 'Organization-wide';
    } else if (context.roles.appAdmin || context.roles.groupAdmin) {
      const targetCount = context.targets.apps.length + context.targets.groups.length;
      if (targetCount > 0) {
        scopeSummary = `${targetCount} owned resource(s)`;
      } else {
        scopeSummary = 'Limited access';
      }
    } else if (context.roles.regularUser) {
      scopeSummary = 'Self-service only';
    }

    const response = {
      tools,
      authorization: {
        resolvedRole,
        capabilitiesCount: context.capabilities.length,
        targetAppsCount: context.targets.apps.length,
        targetGroupsCount: context.targets.groups.length,
        scopeSummary,
      },
    };

    console.log('[MRS] ListTools: Returning', tools.length, 'tools for subject', context.subject, 'with role', resolvedRole);

    return response;
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

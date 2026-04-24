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
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config/index.js';
import { getAvailableTools } from './tool-registry.js';
import { executeTool } from './tool-executor.js';
import {
  loadEndpointRegistry,
  getRegistryStats,
  getEndpointsByCategory,
  findEndpointByName,
  isRegistryLoaded,
  getRegistryStatus,
} from '../catalog/endpoint-registry.js';
import { authenticateRequestWithRouter } from '../auth/token-router.js';
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
 * Uses token router to support both authentication paths:
 * - Path A: Frontend flow (CUSTOM auth server tokens)
 * - Path B: OAuth flow (ORG/DEFAULT auth server tokens)
 *
 * Fails closed - returns null if authentication fails.
 *
 * @param request - MCP request object
 * @returns Authorization context or null if auth fails
 */
async function authenticateRequest(request: any): Promise<AuthorizationContext | null> {
  // Step 1: Extract access token
  const token = extractAccessToken(request);

  if (!token) {
    console.warn('[MRS] No access token provided in request');
    return null;
  }

  // Step 2: Route to appropriate validator and resolve context
  // The router automatically detects token type (CUSTOM vs OAuth) and:
  // - Validates the token using the correct validator
  // - Extracts the subject (user ID)
  // - Resolves authorization context from Okta
  try {
    const context = await authenticateRequestWithRouter(token);

    if (!context) {
      console.error('[MRS] Authentication failed: Token validation or context resolution failed');
      return null;
    }

    console.log('[MRS] Authentication successful:', {
      subject: context.subject,
      roles: Object.entries(context.roles)
        .filter(([_, value]) => value)
        .map(([key]) => key),
      capabilities: context.capabilities.length,
      targetApps: context.targets.apps.length,
      targetGroups: context.targets.groups.length,
    });

    return context;
  } catch (error) {
    console.error('[MRS] Authentication error:', error);
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

  // Initialize endpoint registry (CRITICAL - MCP server cannot function without it)
  // This loads ALL 153+ Okta Governance API endpoints from the Postman collection
  console.log('[MRS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[MRS] Initializing Endpoint Registry...');
  console.log('[MRS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Step 1: Check current working directory
    const cwd = process.cwd();
    console.log('[MRS] Current working directory:', cwd);

    // Step 2: Resolve Postman collection path
    const postmanRelativePath = './postman/Okta Governance API.postman_collection.json';
    const postmanAbsolutePath = resolve(cwd, postmanRelativePath);

    console.log('[MRS] Looking for Postman collection:');
    console.log('[MRS]    Relative path:', postmanRelativePath);
    console.log('[MRS]    Absolute path:', postmanAbsolutePath);

    // Step 3: Check if file exists
    const fileExists = existsSync(postmanAbsolutePath);
    console.log('[MRS]    File exists:', fileExists);

    if (!fileExists) {
      console.error('[MRS] ❌ CRITICAL ERROR: Postman collection file not found!');
      console.error('[MRS]    Expected location:', postmanAbsolutePath);
      console.error('[MRS]    Working directory:', cwd);
      console.error('[MRS]    Directory contents:');

      try {
        const { readdirSync } = await import('fs');
        const files = readdirSync(cwd);
        console.error('[MRS]    Files in cwd:', files.slice(0, 20).join(', '));

        // Check if postman directory exists
        const postmanDirPath = resolve(cwd, 'postman');
        const postmanDirExists = existsSync(postmanDirPath);
        console.error('[MRS]    postman/ directory exists:', postmanDirExists);

        if (postmanDirExists) {
          const postmanFiles = readdirSync(postmanDirPath);
          console.error('[MRS]    Files in postman/:', postmanFiles.join(', '));
        }
      } catch (dirError) {
        console.error('[MRS]    Could not list directory contents:', dirError);
      }

      throw new Error(`Postman collection not found at: ${postmanAbsolutePath}`);
    }

    // Step 4: Load the registry
    console.log('[MRS] ✅ File found, loading registry...');
    const registryInfo = loadEndpointRegistry(postmanAbsolutePath);

    console.log('[MRS] ✅ Endpoint Registry Loaded Successfully:');
    console.log(`[MRS]    - ${registryInfo.totalCount} endpoints`);
    console.log(`[MRS]    - ${registryInfo.categories.size} categories`);
    console.log('[MRS]    - All endpoints available for intelligent tool execution');

    // Step 5: Verify registry stats
    const stats = getRegistryStats();
    if (stats) {
      console.log('[MRS] Registry Stats:', {
        total: stats.totalEndpoints,
        withBody: stats.endpointsWithRequestBody,
        withExamples: stats.endpointsWithExamples,
        categories: Object.keys(stats.categories).length,
      });
    }

    // Step 6: Verify label endpoints (critical for manage_app_labels tool)
    console.log('[MRS] Verifying critical label endpoints...');
    const labelEndpoints = getEndpointsByCategory('Labels');
    console.log(`[MRS]    - Found ${labelEndpoints.length} label endpoints in "Labels" category`);

    if (labelEndpoints.length === 0) {
      console.error('[MRS] ❌ CRITICAL ERROR: No label endpoints found in registry!');
      console.error('[MRS]    Available categories:', Object.keys(stats?.categories || {}));
      throw new Error('No label endpoints found in registry');
    }

    // Check for critical label endpoints
    const criticalLabelEndpoints = [
      'List all labels',
      'Create a label',
      'Assign the labels to resources',
      'Remove the labels from resources',
    ];

    let missingEndpoints = 0;
    for (const name of criticalLabelEndpoints) {
      const endpoint = findEndpointByName(name);
      if (endpoint) {
        console.log(`[MRS]    ✅ "${name}"`);
      } else {
        console.error(`[MRS]    ❌ Missing: "${name}"`);
        missingEndpoints++;
      }
    }

    if (missingEndpoints > 0) {
      console.error(`[MRS] ❌ WARNING: ${missingEndpoints} critical endpoints missing!`);
      console.error('[MRS]    Available label endpoints:');
      labelEndpoints.forEach((ep, idx) => {
        console.error(`[MRS]       ${idx + 1}. "${ep.name}" → ${ep.method} ${ep.normalizedPath}`);
      });
    }

    // Step 7: Final health check
    console.log('[MRS] Performing final registry health check...');
    const registryStatus = getRegistryStatus();
    const registryLoaded = isRegistryLoaded();

    console.log('[MRS] Registry health check:', {
      loaded: registryLoaded,
      endpointCount: registryStatus.endpointCount,
      categoryCount: registryStatus.categoryCount,
    });

    if (!registryLoaded) {
      throw new Error('Registry health check failed: isRegistryLoaded() returned false');
    }

    if (registryStatus.endpointCount === 0) {
      throw new Error('Registry health check failed: No endpoints loaded');
    }

    console.log('[MRS] ✅ Registry health check passed');
    console.log('[MRS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (error) {
    console.error('[MRS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('[MRS] ❌ CRITICAL FAILURE: Endpoint Registry Loading Failed');
    console.error('[MRS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('[MRS] Error details:');
    console.error('[MRS]    Type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('[MRS]    Message:', error instanceof Error ? error.message : String(error));

    if (error instanceof Error && error.stack) {
      console.error('[MRS]    Stack trace:');
      const stackLines = error.stack.split('\n').slice(0, 5);
      stackLines.forEach((line) => console.error('[MRS]      ' + line));
    }

    console.error('[MRS]');
    console.error('[MRS] Full error object:', JSON.stringify(error, null, 2));
    console.error('[MRS]');
    console.error('[MRS] MCP server CANNOT continue without endpoint registry.');
    console.error('[MRS] Tools will fail with "endpoint not found" errors.');
    console.error('[MRS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // CRITICAL: Fail startup - do not continue
    throw new Error(
      `CRITICAL: Endpoint registry loading failed: ${error instanceof Error ? error.message : String(error)}`
    );
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

  // Final registry verification before starting server
  console.log('═══════════════════════════════════════════════════════');
  console.log('[MRS] REGISTRY STATUS AT STARTUP:');
  const status = getRegistryStatus();
  console.log('[MRS] Loaded:', status.loaded);
  console.log('[MRS] Endpoint Count:', status.endpointCount);
  console.log('[MRS] Category Count:', status.categoryCount);
  if (!status.loaded || status.endpointCount === 0) {
    console.error('[MRS] ❌ CRITICAL: Registry not initialized!');
    console.error('[MRS] Server cannot start without a working registry.');
    process.exit(1);
  } else {
    console.log('[MRS] ✅ Registry initialized successfully');
  }
  console.log('═══════════════════════════════════════════════════════');

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

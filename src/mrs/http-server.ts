/**
 * Production HTTP server for MRS
 *
 * Long-running HTTP server that exposes MCP endpoints via REST API.
 * Designed for cloud hosting platforms like Render.
 *
 * Key Features:
 * - Binds to 0.0.0.0 (required for Docker/cloud hosting)
 * - Uses process.env.PORT (required by Render)
 * - Exposes /health, /.well-known/mcp.json, and MCP tool endpoints
 * - Long-running process (never exits unless error)
 */

import express from 'express';
import { config } from '../config/index.js';
import { getAvailableTools } from './tool-registry.js';
import { executeTool } from './tool-executor.js';
import { authenticateRequestWithRouter } from '../auth/token-router.js';
import { getServerMetadataResponse } from './server-metadata.js';
import { getProtectedResourceMetadata } from '../oauth/protected-resource.js';
import { handleMcpJsonRpc } from './mcp-jsonrpc-handler.js';
import type { AuthorizationContext } from '../types/index.js';

const app = express();
app.use(express.json());

// CORS for browser clients
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

/**
 * Extract and validate access token from Authorization header
 * Uses token router to support both frontend and OAuth tokens
 */
async function authenticateRequest(req: express.Request): Promise<AuthorizationContext | null> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[MRS-HTTP] No Authorization header or invalid format');
    return null;
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix

  // Use token router for automatic token type detection and validation
  try {
    const context = await authenticateRequestWithRouter(token);

    if (!context) {
      console.error('[MRS-HTTP] Token validation or context resolution failed');
      return null;
    }

    console.log('[MRS-HTTP] Authentication successful for subject:', context.subject);
    return context;
  } catch (error) {
    console.error('[MRS-HTTP] Authentication error:', error);
    return null;
  }
}

/**
 * GET /.well-known/mcp.json
 * MCP server discovery metadata endpoint
 */
app.get('/.well-known/mcp.json', (_req, res) => {
  try {
    const metadata = getServerMetadataResponse();
    res.json(metadata);
  } catch (error) {
    console.error('[MRS-HTTP] Error generating server metadata:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate server metadata',
    });
  }
});

/**
 * GET /health
 * Health check endpoint for Render and monitoring
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: config.mrs.serverName,
    version: config.mrs.serverVersion,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /.well-known/oauth-protected-resource
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 *
 * This endpoint tells OAuth clients:
 * - We're a protected resource (not an authorization server)
 * - Get tokens from Okta (https://fcxdemo.okta.com)
 * - We validate those tokens to authorize access
 * - We require specific Okta admin scopes
 */
app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  try {
    console.log('[MRS-HTTP] ✅ Serving OAuth Protected Resource metadata (RFC 9728)');
    const metadata = getProtectedResourceMetadata();
    console.log('[MRS-HTTP] Protected Resource metadata generated successfully');
    console.log('[MRS-HTTP] Authorization servers:', metadata.authorization_servers);

    // Ensure CORS headers for browser-based clients
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');

    res.json(metadata);
  } catch (error) {
    console.error('[MRS-HTTP] Error generating Protected Resource metadata:');
    console.error('[MRS-HTTP] Error message:', error instanceof Error ? error.message : String(error));
    res.status(500).json({
      error: 'internal_server_error',
      error_description: error instanceof Error ? error.message : 'Failed to generate metadata',
    });
  }
});

/**
 * GET /.well-known/oauth-authorization-server
 *
 * NOT SUPPORTED - We are a Protected Resource, not an Authorization Server.
 * Clients should use /.well-known/oauth-protected-resource instead.
 */
app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  console.warn('[MRS-HTTP] ❌ Rejected request to oauth-authorization-server endpoint');
  console.warn('[MRS-HTTP] We are a Protected Resource, not an Authorization Server');
  console.warn('[MRS-HTTP] Clients should use: /.well-known/oauth-protected-resource');

  res.status(404).json({
    error: 'not_found',
    error_description: 'This server is an OAuth 2.0 Protected Resource, not an Authorization Server. Use /.well-known/oauth-protected-resource for discovery.',
    correct_endpoint: `${config.http?.baseUrl || 'https://okta-governance-mcp.onrender.com'}/.well-known/oauth-protected-resource`,
  });
});

/**
 * POST /mcp
 * MCP Streamable HTTP Transport - JSON-RPC endpoint for VS Code
 *
 * This implements the MCP protocol over HTTP using JSON-RPC 2.0.
 * When called without authentication, returns 401 with WWW-Authenticate
 * header pointing to OAuth Protected Resource metadata, triggering
 * VS Code's OAuth Authorization Code + PKCE flow.
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#http
 * @see https://github.com/microsoft/vscode/issues/247759
 */
app.post('/mcp', async (req, res) => {
  try {
    console.log('[MCP-HTTP] POST /mcp request received');
    console.log('[MCP-HTTP] Request body:', JSON.stringify(req.body, null, 2));

    // Check for Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token provided - return 401 with WWW-Authenticate header
      // This triggers VS Code to start OAuth flow
      console.log('[MCP-HTTP] No authorization header, sending 401 with WWW-Authenticate');

      const protectedResourceUrl = `${config.http?.baseUrl || 'https://okta-governance-mcp.onrender.com'}/.well-known/oauth-protected-resource`;

      // Return 401 with correct WWW-Authenticate format per RFC 9728
      res.status(401)
        .header('WWW-Authenticate', `Bearer resource_metadata="${protectedResourceUrl}"`)
        .header('Access-Control-Expose-Headers', 'WWW-Authenticate')
        .header('Access-Control-Allow-Origin', '*')
        .header('Content-Type', 'application/json')
        .json({
          error: 'unauthorized',
          message: 'Authentication required',
        });
      return;
    }

    console.log('[MCP-HTTP] Authorization header found, authenticating...');
    console.log('[MCP-HTTP] Token (first 20 chars):', authHeader.substring(7, 27) + '...');

    // Authenticate request
    const context = await authenticateRequest(req);

    console.log('[MCP-HTTP] Authentication result:', context ? 'SUCCESS' : 'FAILED');

    if (!context) {
      // Invalid token - return 401 with WWW-Authenticate header
      console.log('[MCP-HTTP] Invalid token, sending 401 with WWW-Authenticate');

      const protectedResourceUrl = `${config.http?.baseUrl || 'https://okta-governance-mcp.onrender.com'}/.well-known/oauth-protected-resource`;

      res.status(401)
        .header('WWW-Authenticate', `Bearer resource_metadata="${protectedResourceUrl}"`)
        .header('Access-Control-Expose-Headers', 'WWW-Authenticate')
        .header('Access-Control-Allow-Origin', '*')
        .header('Content-Type', 'application/json')
        .json({
          error: 'unauthorized',
          message: 'Authentication required',
        });
      return;
    }

    // Valid token - handle JSON-RPC request
    await handleMcpJsonRpc(req, res, context);
  } catch (error) {
    console.error('[MCP-HTTP] Error handling /mcp request:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /mcp
 * Optional: For streaming server messages (not yet implemented)
 * Currently returns information about the MCP endpoint
 */
app.get('/mcp', (_req, res) => {
  res.json({
    message: 'MCP Streamable HTTP Transport endpoint',
    methods: ['POST'],
    description: 'Use POST with JSON-RPC 2.0 requests. Authentication required via OAuth 2.0.',
    discoveryUrl: `${config.http?.baseUrl || 'https://okta-governance-mcp.onrender.com'}/.well-known/oauth-protected-resource`,
  });
});

/**
 * GET /authorize
 * OAuth Authorization Endpoint Proxy
 *
 * VS Code expects the authorization endpoint on the MCP server URL.
 * This endpoint proxies to the actual Okta authorization server.
 */
app.get('/authorize', (req, res) => {
  try {
    const oktaIssuer = config.okta?.oauth?.issuer || 'https://fcxdemo.okta.com';
    const authEndpoint = config.okta?.oauth?.authorizationEndpoint || `${oktaIssuer}/oauth2/v1/authorize`;

    // Forward all query parameters to Okta
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    const redirectUrl = `${authEndpoint}?${queryString}`;

    console.log('[MRS-HTTP] Proxying authorization request to Okta:', redirectUrl);

    // Redirect to Okta authorization endpoint
    res.redirect(302, redirectUrl);
  } catch (error) {
    console.error('[MRS-HTTP] Error proxying authorization request:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to proxy authorization request',
    });
  }
});

/**
 * POST /token
 * OAuth Token Endpoint Proxy
 *
 * VS Code expects the token endpoint on the MCP server URL.
 * This endpoint proxies to the actual Okta token server.
 */
app.post('/token', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const oktaIssuer = config.okta?.oauth?.issuer || 'https://fcxdemo.okta.com';
    const tokenEndpoint = config.okta?.oauth?.tokenEndpoint || `${oktaIssuer}/oauth2/v1/token`;

    console.log('[MRS-HTTP] Proxying token request to Okta:', tokenEndpoint);
    console.log('[MRS-HTTP] Token request body:', req.body);

    // Build form data from request body
    const formData = new URLSearchParams();
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'string') {
        formData.append(key, value);
      }
    }

    // Forward the token request to Okta
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: formData.toString(),
    });

    const data = await response.json();

    console.log('[MRS-HTTP] Token response from Okta:', response.status);

    // Forward Okta's response back to VS Code
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[MRS-HTTP] Error proxying token request:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to proxy token request',
    });
  }
});

/**
 * POST /mcp/v1/tools/list
 * List available tools for authenticated user
 */
app.post('/mcp/v1/tools/list', async (req, res) => {
  try {
    // Authenticate
    const context = await authenticateRequest(req);

    if (!context) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing MCP access token',
      });
      return;
    }

    // Get available tools
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
      tools: tools,
      authorization: {
        resolvedRole,
        capabilitiesCount: context.capabilities.length,
        targetAppsCount: context.targets.apps.length,
        targetGroupsCount: context.targets.groups.length,
        scopeSummary,
      },
    };

    // Debug: Log the full response structure (safe - no tokens)
    console.log('[MRS-HTTP] Sending tools response:', JSON.stringify({
      toolsCount: response.tools.length,
      authorization: response.authorization,
    }, null, 2));

    res.json(response);
  } catch (error) {
    console.error('[MRS-HTTP] Error listing tools:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /mcp/v1/tools/call
 * Execute a tool
 */
app.post('/mcp/v1/tools/call', async (req, res) => {
  try {
    // Authenticate
    const context = await authenticateRequest(req);

    if (!context) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing MCP access token',
      });
      return;
    }

    const { name, arguments: args } = req.body;

    if (!name) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required field: name',
      });
      return;
    }

    console.log('[MRS-HTTP] Executing tool:', { name, subject: context.subject });

    // Execute tool
    const result = await executeTool(
      {
        name,
        arguments: args || {},
      },
      context
    );

    res.json(result);
  } catch (error) {
    console.error('[MRS-HTTP] Error executing tool:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Start HTTP server
 */
export function startMrsHttpServer() {
  // Render provides PORT via environment variable
  // Bind to 0.0.0.0 (required for Docker/cloud hosting)
  const port = process.env.PORT || 3002;
  const host = '0.0.0.0';

  app.listen(Number(port), host, () => {
    console.log('\n🚀 MCP Resource Server (MRS) - Production HTTP Server');
    console.log('─'.repeat(70));
    console.log(`📍 Port: ${port}`);
    console.log(`🌍 Host: ${host}`);
    console.log(`📦 Service: ${config.mrs.serverName} v${config.mrs.serverVersion}`);
    console.log('─'.repeat(70));
    console.log('\n✅ Server is running\n');
    console.log('Endpoints:');
    console.log('  MCP Streamable HTTP Transport (VS Code):');
    console.log(`    POST http://${host}:${port}/mcp`);
    console.log(`    GET  http://${host}:${port}/mcp`);
    console.log('');
    console.log('  OAuth Proxy (VS Code → Okta):');
    console.log(`    GET  http://${host}:${port}/authorize → Okta`);
    console.log(`    POST http://${host}:${port}/token → Okta`);
    console.log('');
    console.log('  OAuth Discovery:');
    console.log(`    GET  http://${host}:${port}/.well-known/oauth-protected-resource`);
    console.log(`    GET  http://${host}:${port}/.well-known/mcp.json`);
    console.log('');
    console.log('  REST API (Frontend):');
    console.log(`    POST http://${host}:${port}/mcp/v1/tools/list`);
    console.log(`    POST http://${host}:${port}/mcp/v1/tools/call`);
    console.log('');
    console.log('  Health:');
    console.log(`    GET  http://${host}:${port}/health`);
    console.log('\n🔐 Authentication: Bearer token (Okta OAuth token)');
    console.log('🎫 Token validation: Okta ORG/CUSTOM authorization servers');
    console.log('📱 VS Code: Proxies OAuth requests to Okta authorization server\n');
  });

  // Keep process alive on signals (graceful shutdown)
  process.on('SIGTERM', () => {
    console.log('\n👋 SIGTERM received, shutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('\n👋 SIGINT received, shutting down gracefully...');
    process.exit(0);
  });
}

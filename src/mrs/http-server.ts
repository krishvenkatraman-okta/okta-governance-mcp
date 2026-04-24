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
import { getOAuthDiscoveryMetadata } from '../oauth/discovery.js';
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
 * GET /.well-known/oauth-authorization-server
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * For VS Code, Claude Desktop, and other OAuth clients
 */
app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  try {
    console.log('[MRS-HTTP] Generating OAuth discovery metadata...');
    const metadata = getOAuthDiscoveryMetadata();
    console.log('[MRS-HTTP] OAuth discovery metadata generated successfully');
    res.json(metadata);
  } catch (error) {
    console.error('[MRS-HTTP] Error generating OAuth discovery metadata:');
    console.error('[MRS-HTTP] Error name:', error instanceof Error ? error.name : typeof error);
    console.error('[MRS-HTTP] Error message:', error instanceof Error ? error.message : String(error));
    console.error('[MRS-HTTP] Error stack:', error instanceof Error ? error.stack : 'N/A');
    res.status(500).json({
      error: 'internal_server_error',
      error_description: error instanceof Error ? error.message : 'Failed to generate OAuth discovery metadata',
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
    console.log(`  GET  http://${host}:${port}/.well-known/mcp.json`);
    console.log(`  GET  http://${host}:${port}/.well-known/oauth-authorization-server`);
    console.log(`  GET  http://${host}:${port}/health`);
    console.log(`  POST http://${host}:${port}/mcp/v1/tools/list`);
    console.log(`  POST http://${host}:${port}/mcp/v1/tools/call`);
    console.log('\n🔐 Authentication: Bearer token (MCP access token or OAuth token)\n');
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

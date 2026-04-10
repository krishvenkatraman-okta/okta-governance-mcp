#!/usr/bin/env tsx
/**
 * HTTP test server wrapper for MRS smoke testing
 *
 * Provides HTTP REST endpoints that wrap the MCP stdio server for testing.
 * NOT for production use - only for smoke testing.
 */

import express from 'express';
import { config } from '../src/config/index.js';
import { getAvailableTools } from '../src/mrs/tool-registry.js';
import { executeTool } from '../src/mrs/tool-executor.js';
import { validateMcpToken } from '../src/auth/mcp-token-validator.js';
import { resolveAuthorizationContextForSubject } from '../src/policy/authorization-context.js';
import { getServerMetadataResponse } from '../src/mrs/server-metadata.js';
import type { AuthorizationContext } from '../src/types/index.js';

const app = express();
app.use(express.json());

// CORS for testing
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

/**
 * Extract and validate MCP token from Authorization header
 */
async function authenticateRequest(req: express.Request): Promise<AuthorizationContext | null> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[HTTP-Test] No Authorization header or invalid format');
    return null;
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix

  // Validate token
  const validation = validateMcpToken(token);

  if (!validation.valid) {
    console.error('[HTTP-Test] Token validation failed:', validation.error);
    return null;
  }

  if (!validation.payload?.sub) {
    console.error('[HTTP-Test] No subject in token');
    return null;
  }

  const { sub: subject } = validation.payload;

  console.log('[HTTP-Test] Token validated for subject:', subject);

  // Resolve authorization context
  try {
    const context = await resolveAuthorizationContextForSubject(subject, validation.payload);
    return context;
  } catch (error) {
    console.error('[HTTP-Test] Failed to resolve authorization context:', error);
    return null;
  }
}

/**
 * GET /.well-known/mcp.json
 * MCP server discovery metadata endpoint
 */
app.get('/.well-known/mcp.json', (req, res) => {
  try {
    const metadata = getServerMetadataResponse();
    res.json(metadata);
  } catch (error) {
    console.error('[HTTP-Test] Error generating server metadata:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate server metadata',
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: config.mrs.serverName,
    version: config.mrs.serverVersion,
    timestamp: new Date().toISOString(),
  });
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
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing MCP access token',
      });
    }

    // Get available tools
    const tools = getAvailableTools(context);

    res.json({
      tools: tools.map(tool => tool.definition),
    });
  } catch (error) {
    console.error('[HTTP-Test] Error listing tools:', error);
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
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing MCP access token',
      });
    }

    const { name, arguments: args } = req.body;

    if (!name) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required field: name',
      });
    }

    console.log('[HTTP-Test] Executing tool:', { name, subject: context.subject });

    // Execute tool
    const result = await executeTool(name, args || {}, context);

    res.json(result);
  } catch (error) {
    console.error('[HTTP-Test] Error executing tool:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Start server
 */
const port = process.env.MRS_PORT || 3002;

app.listen(port, () => {
  console.log('\n🚀 HTTP Test Server for MRS Smoke Testing');
  console.log('─'.repeat(60));
  console.log(`📍 Port: ${port}`);
  console.log(`🌍 Base URL: http://localhost:${port}`);
  console.log('─'.repeat(60));
  console.log('\n✅ Ready for testing\n');
  console.log('Endpoints:');
  console.log(`  GET  http://localhost:${port}/.well-known/mcp.json`);
  console.log(`  GET  http://localhost:${port}/health`);
  console.log(`  POST http://localhost:${port}/mcp/v1/tools/list`);
  console.log(`  POST http://localhost:${port}/mcp/v1/tools/call`);
  console.log('\n⚠️  This is a test server only - NOT for production use\n');
});

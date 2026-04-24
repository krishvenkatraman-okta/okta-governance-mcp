/**
 * HTTP server for OAuth discovery and health checks
 *
 * Runs alongside stdio MCP transport to provide:
 * - OAuth 2.0 discovery endpoint
 * - Health check endpoint
 * - Future: HTTP-based MCP transport
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { config } from '../config/index.js';
import { getOAuthDiscoveryMetadata } from '../oauth/discovery.js';

/**
 * Create HTTP server with routes
 */
export function createHttpServer() {
  const app = express();

  // CORS for browser-based MCP clients
  app.use(
    cors({
      origin: '*', // Allow all origins for discovery endpoint
      methods: ['GET', 'OPTIONS'],
    })
  );

  // JSON parsing
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      name: 'Okta Governance MCP Server',
      version: config.mrs.serverVersion,
      timestamp: new Date().toISOString(),
    });
  });

  // Root endpoint
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'Okta Governance MCP Server',
      version: config.mrs.serverVersion,
      documentation: 'https://github.com/your-org/okta-governance-mcp',
      endpoints: {
        health: '/health',
        discovery: '/.well-known/oauth-authorization-server',
      },
    });
  });

  // OAuth 2.0 Authorization Server Metadata (RFC 8414)
  app.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
    try {
      const metadata = getOAuthDiscoveryMetadata();
      res.json(metadata);
    } catch (error) {
      console.error('[HTTP] Failed to generate OAuth discovery metadata:', error);
      res.status(500).json({
        error: 'internal_server_error',
        error_description: 'Failed to generate OAuth discovery metadata',
      });
    }
  });

  return app;
}

/**
 * Start HTTP server
 *
 * Returns server instance or null if disabled
 */
export async function startHttpServer() {
  // Check if HTTP server is enabled
  if (!config.http?.enabled) {
    console.log('[HTTP] HTTP server disabled (MCP_HTTP_ENABLED=false)');
    return null;
  }

  try {
    const app = createHttpServer();
    const port = config.http.port;

    return new Promise<any>((resolve, reject) => {
      const server = app.listen(port, () => {
        console.log('[HTTP] ════════════════════════════════════════════');
        console.log('[HTTP] HTTP Server Started');
        console.log('[HTTP] ════════════════════════════════════════════');
        console.log(`[HTTP] Port: ${port}`);
        console.log(`[HTTP] Health: http://localhost:${port}/health`);
        console.log(`[HTTP] Root: http://localhost:${port}/`);
        console.log(`[HTTP] Discovery: http://localhost:${port}/.well-known/oauth-authorization-server`);
        console.log('[HTTP] ════════════════════════════════════════════');
        resolve(server);
      });

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[HTTP] Port ${port} is already in use`);
          console.error('[HTTP] Set MCP_HTTP_PORT to use a different port');
        } else {
          console.error('[HTTP] Failed to start HTTP server:', err.message);
        }
        reject(err);
      });
    });
  } catch (error) {
    console.error('[HTTP] Error starting HTTP server:', error);
    throw error;
  }
}

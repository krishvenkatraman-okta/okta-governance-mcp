/**
 * Production HTTP server entrypoint for MRS
 *
 * This is the entrypoint for cloud hosting platforms (Render, Heroku, etc.)
 * that require a long-running HTTP server.
 *
 * For local development with stdio, use src/index.ts with SERVER_MODE=mrs
 */

import { config } from './config/index.js';
import { startMrsHttpServer } from './mrs/http-server.js';
import { loadEndpointRegistry } from './catalog/endpoint-registry.js';

async function main() {
  console.log('🚀 Okta Governance MCP Server');
  console.log(`📋 Mode: MRS (HTTP)`);
  console.log(`🌍 Environment: ${config.nodeEnv}`);
  console.log('');

  try {
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

    // Start HTTP server
    startMrsHttpServer();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
main();

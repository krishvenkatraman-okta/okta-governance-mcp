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
import {
  loadEndpointRegistry,
  getRegistryStats,
  getEndpointsByCategory,
  findEndpointByName,
  isRegistryLoaded,
  getRegistryStatus,
} from './catalog/endpoint-registry.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

async function main() {
  console.log('🚀 Okta Governance MCP Server');
  console.log(`📋 Mode: MRS (HTTP)`);
  console.log(`🌍 Environment: ${config.nodeEnv}`);
  console.log('');

  try {
    // CRITICAL: Initialize endpoint registry (REQUIRED - not optional!)
    // This loads ALL 153+ Okta Governance API endpoints from the Postman collection
    console.log('[MRS] ════════════════════════════════════════════════════════');
    console.log('[MRS] Initializing Endpoint Registry...');
    console.log('[MRS] ════════════════════════════════════════════════════════');

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

      console.error('[MRS] ════════════════════════════════════════════════════════');
      process.exit(1);
    }

    // Step 4: Load the registry
    console.log('[MRS] ✅ File found, loading registry...');
    const registryInfo = loadEndpointRegistry(postmanAbsolutePath);

    console.log('[MRS] ✅ Endpoint Registry Loaded Successfully:');
    console.log(`[MRS]    - ${registryInfo.totalCount} endpoints`);
    console.log(`[MRS]    - ${registryInfo.categories.size} categories`);

    // Step 5: Verify registry stats
    const stats = getRegistryStats();
    if (stats) {
      console.log('[MRS] Registry Stats:', {
        total: stats.totalEndpoints,
        withBody: stats.endpointsWithRequestBody,
        categories: Object.keys(stats.categories).length,
      });
    }

    // Step 6: Verify label endpoints (critical for manage_app_labels tool)
    console.log('[MRS] Verifying critical label endpoints...');
    const labelEndpoints = getEndpointsByCategory('Labels');
    console.log(`[MRS]    - Found ${labelEndpoints.length} label endpoints`);

    if (labelEndpoints.length === 0) {
      console.error('[MRS] ❌ CRITICAL ERROR: No label endpoints found in registry!');
      console.error('[MRS]    Available categories:', Object.keys(stats?.categories || {}));
      process.exit(1);
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
      console.error('[MRS] ❌ Registry health check failed: isRegistryLoaded() returned false');
      process.exit(1);
    }

    if (registryStatus.endpointCount === 0) {
      console.error('[MRS] ❌ Registry health check failed: No endpoints loaded');
      process.exit(1);
    }

    console.log('[MRS] ✅ Registry health check passed');
    console.log('[MRS] ════════════════════════════════════════════════════════');

    // Start HTTP server
    startMrsHttpServer();
  } catch (error) {
    console.error('[MRS] ════════════════════════════════════════════════════════');
    console.error('[MRS] ❌ CRITICAL FAILURE during startup');
    console.error('[MRS] ════════════════════════════════════════════════════════');
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
    console.error('[MRS] ════════════════════════════════════════════════════════');
    process.exit(1);
  }
}

// Start the server
main();

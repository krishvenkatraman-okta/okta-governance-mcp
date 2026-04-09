/**
 * Main entry point
 *
 * Starts either MAS or MRS based on SERVER_MODE environment variable
 */

import { config } from './config/index.js';
import { startMas } from './mas/index.js';
import { startMrs } from './mrs/index.js';

async function main() {
  console.log('🚀 Okta Governance MCP Server');
  console.log(`📋 Mode: ${config.serverMode.toUpperCase()}`);
  console.log(`🌍 Environment: ${config.nodeEnv}`);
  console.log('');

  try {
    if (config.serverMode === 'mas') {
      startMas();
    } else if (config.serverMode === 'mrs') {
      await startMrs();
    } else {
      throw new Error(`Invalid SERVER_MODE: ${config.serverMode}. Must be 'mas' or 'mrs'.`);
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle process signals
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  process.exit(0);
});

// Start the server
main();

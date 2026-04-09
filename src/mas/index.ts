/**
 * MCP Authorization Server entry point
 */

import { startMasServer } from './server.js';

export function startMas() {
  console.log('Starting MCP Authorization Server (MAS)...');
  return startMasServer();
}

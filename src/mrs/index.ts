/**
 * MCP Resource Server entry point
 */

import { startMrsServer } from './server.js';

export async function startMrs() {
  console.log('Starting MCP Resource Server (MRS)...');
  return await startMrsServer();
}

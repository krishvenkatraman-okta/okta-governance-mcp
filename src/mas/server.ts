/**
 * MAS HTTP server
 */

import express from 'express';
import { config } from '../config/index.js';
import { router } from './routes.js';

/**
 * Create and start MAS server
 */
export function startMasServer() {
  const app = express();

  // Middleware
  app.use(express.json());

  // Logging middleware
  app.use((req, _res, next) => {
    console.log(`[MAS] ${req.method} ${req.path}`);
    next();
  });

  // Routes
  app.use(router);

  // Start server
  const port = config.mas.port;
  app.listen(port, () => {
    console.log(`\n🔐 MCP Authorization Server (MAS) running on port ${port}`);
    console.log(`📍 Base URL: ${config.mas.baseUrl}`);
    console.log(`✅ Ready to validate ID-JAG tokens and issue MCP access tokens\n`);
  });

  return app;
}

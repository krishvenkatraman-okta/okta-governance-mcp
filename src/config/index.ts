/**
 * Configuration loader
 */

import { config as loadEnv } from 'dotenv';
import { oktaConfig } from './okta-config.js';
import { masConfig } from './mas-config.js';
import { mrsConfig } from './mrs-config.js';

// Load environment variables
loadEnv();

export interface AppConfig {
  nodeEnv: string;
  serverMode: 'mas' | 'mrs';
  logLevel: string;
  enableAuditLogging: boolean;
  okta: ReturnType<typeof oktaConfig>;
  mas: ReturnType<typeof masConfig>;
  mrs: ReturnType<typeof mrsConfig>;
  http: {
    enabled: boolean;
    port: number;
    baseUrl: string;
  };
  resource: {
    identifier: string;
    documentation?: string;
  };
}

/**
 * Load and validate configuration
 */
export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const serverMode = (process.env.SERVER_MODE as 'mas' | 'mrs') || 'mrs';
  const logLevel = process.env.LOG_LEVEL || 'info';
  const enableAuditLogging = process.env.ENABLE_AUDIT_LOGGING === 'true';

  return {
    nodeEnv,
    serverMode,
    logLevel,
    enableAuditLogging,
    okta: oktaConfig(),
    mas: masConfig(),
    mrs: mrsConfig(),
    http: {
      enabled: process.env.MCP_HTTP_ENABLED !== 'false', // Enabled by default
      port: parseInt(process.env.MCP_HTTP_PORT || '3000', 10),
      baseUrl: process.env.MCP_HTTP_BASE_URL || 'http://localhost:3000',
    },
    resource: {
      identifier: process.env.MCP_RESOURCE_IDENTIFIER || 'https://governance.okta.com/mcp',
      documentation: process.env.MCP_RESOURCE_DOCUMENTATION,
    },
  };
}

export const config = loadConfig();

/**
 * MCP access token validation
 */

import { verifyJwt, decodeJwt } from './jwt-utils.js';
import { config } from '../config/index.js';
import type { McpAccessToken, McpTokenValidationResult } from '../types/index.js';

/**
 * Validate MCP access token
 *
 * Uses the MAS public key to verify tokens issued by MAS
 */
export function validateMcpToken(token: string): McpTokenValidationResult {
  try {
    const payload = verifyJwt(token, config.mas.jwt.publicKeyPath, {
      issuer: config.mrs.token.issuer,
      audience: config.mrs.token.audience,
    });

    return {
      valid: true,
      payload: payload as McpAccessToken,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid MCP token',
    };
  }
}

/**
 * Extract subject from MCP token without validation
 */
export function extractSubjectFromMcpToken(token: string): string | null {
  try {
    const decoded = decodeJwt(token);
    return decoded?.sub || null;
  } catch {
    return null;
  }
}

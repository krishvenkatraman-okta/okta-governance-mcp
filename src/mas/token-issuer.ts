/**
 * MCP token issuer
 *
 * Issues MCP access tokens for validated ID-JAG tokens
 */

import { randomUUID } from 'crypto';
import { signJwt } from '../auth/jwt-utils.js';
import { config } from '../config/index.js';
import type { McpAccessToken, IdJagToken } from '../types/index.js';

/**
 * Issue MCP access token
 *
 * @param idJagPayload - Validated ID-JAG payload
 * @returns MCP access token (JWT string)
 */
export function issueMcpAccessToken(idJagPayload: IdJagToken): string {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = randomUUID();

  const payload: Partial<McpAccessToken> = {
    iss: config.mas.jwt.issuer,
    sub: idJagPayload.sub,
    aud: config.mas.jwt.audience,
    exp: now + config.mas.jwt.tokenExpiry,
    iat: now,
    jti: randomUUID(),
    sessionId,
    // Carry over any additional claims if needed
  };

  return signJwt(payload, config.mas.jwt.privateKeyPath, {
    algorithm: config.mas.jwt.algorithm as 'RS256',
  });
}

/**
 * Generate token metadata for response
 */
export function generateTokenMetadata(token: string) {
  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: config.mas.jwt.tokenExpiry,
    scope: 'mcp:governance',
  };
}

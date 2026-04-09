/**
 * Okta OAuth service app client
 *
 * Handles OAuth client credentials flow with private_key_jwt
 */

import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import type { OktaTokenResponse } from '../types/index.js';

/**
 * Cached access token
 */
let cachedToken: {
  accessToken: string;
  expiresAt: number;
} | null = null;

/**
 * Generate client assertion for private_key_jwt
 */
function generateClientAssertion(): string {
  const privateKey = readFileSync(config.okta.privateKeyPath, 'utf8');

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: config.okta.clientId,
    sub: config.okta.clientId,
    aud: config.okta.tokenUrl,
    exp: now + 300, // 5 minutes
    iat: now,
    jti: `${config.okta.clientId}-${now}-${Math.random()}`,
  };

  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

/**
 * Get access token for Okta service app
 *
 * Uses client credentials flow with private_key_jwt authentication.
 * Tokens are cached and reused until expiration.
 *
 * @param scopes - Required OAuth scopes (space-separated)
 */
export async function getServiceAccessToken(scopes: string): Promise<string> {
  // Check if cached token is still valid
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.accessToken;
  }

  const clientAssertion = generateClientAssertion();

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: scopes,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion,
  });

  const response = await fetch(config.okta.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get service access token: ${response.status} ${error}`);
  }

  const tokenResponse = await response.json() as OktaTokenResponse;

  // Cache the token
  cachedToken = {
    accessToken: tokenResponse.access_token,
    expiresAt: Date.now() + (tokenResponse.expires_in * 1000),
  };

  return tokenResponse.access_token;
}

/**
 * Clear cached token (useful for testing or forced refresh)
 */
export function clearTokenCache(): void {
  cachedToken = null;
}

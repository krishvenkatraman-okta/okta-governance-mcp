/**
 * JWKS client cache
 *
 * Provides cached JWKS clients for multiple issuers.
 * Reduces external calls to JWKS endpoints and supports key rotation.
 */

import jwksClient from 'jwks-rsa';

/**
 * Cache of JWKS clients keyed by JWKS URI
 */
const clients = new Map<string, jwksClient.JwksClient>();

/**
 * Get or create JWKS client for a given URI
 *
 * Creates a cached JWKS client that:
 * - Caches keys for 1 hour
 * - Rate limits to 10 requests/minute
 * - Supports automatic key rotation
 * - Times out after 30 seconds
 *
 * @param jwksUri - JWKS endpoint URL
 * @returns JWKS client instance
 */
export function getJwksClient(jwksUri: string): jwksClient.JwksClient {
  if (!clients.has(jwksUri)) {
    const client = jwksClient({
      jwksUri,
      cache: true,
      cacheMaxAge: 3600000, // 1 hour
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      timeout: 30000, // 30 seconds
    });

    clients.set(jwksUri, client);

    console.log('[JwksCache] Created new JWKS client:', {
      jwksUri,
      cacheEnabled: true,
      cacheMaxAge: '1 hour',
    });
  }

  return clients.get(jwksUri)!;
}

/**
 * Clear JWKS cache
 *
 * Useful for testing or forcing key refresh.
 */
export function clearJwksCache(): void {
  clients.clear();
  console.log('[JwksCache] Cleared all JWKS clients');
}

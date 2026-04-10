/**
 * Okta OAuth service app client
 *
 * Handles OAuth client credentials flow with private_key_jwt
 * for calling Okta admin and governance APIs from the MRS.
 *
 * Key features:
 * - Client credentials grant with private_key_jwt client authentication
 * - Targets org authorization server (/oauth2/v1/token)
 * - Token caching by scope set for efficient reuse
 * - Automatic refresh before expiry
 * - Safe logging with secret redaction
 */

import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/index.js';
import type { OktaTokenResponse } from '../types/index.js';

/**
 * Cached access token entry
 */
interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number;
  scopes: string;
}

/**
 * In-memory token cache keyed by normalized scope set
 *
 * Format: Map<scopeSetKey, TokenCacheEntry>
 * where scopeSetKey = sorted, space-separated scopes
 */
const tokenCache = new Map<string, TokenCacheEntry>();

/**
 * Normalize scope set to create consistent cache key
 *
 * Sorts scopes alphabetically and joins with space.
 * This ensures "okta.apps.read okta.users.read" and
 * "okta.users.read okta.apps.read" use the same cache entry.
 *
 * @param scopes - Array or space-separated string of scopes
 * @returns Normalized scope string for cache key
 */
function normalizeScopeSet(scopes: string[] | string): string {
  const scopeArray = Array.isArray(scopes) ? scopes : scopes.split(/\s+/).filter(Boolean);
  return scopeArray.sort().join(' ');
}

/**
 * Redact sensitive values for safe logging
 *
 * Replaces all but first 6 and last 4 characters with asterisks
 */
function redactSecret(value: string): string {
  if (value.length <= 10) {
    return '***';
  }
  return `${value.slice(0, 6)}***${value.slice(-4)}`;
}

/**
 * Build JWT client assertion for private_key_jwt authentication
 *
 * Creates a signed JWT with:
 * - iss: OAuth client ID
 * - sub: OAuth client ID
 * - aud: Token endpoint URL
 * - exp: Current time + 5 minutes
 * - iat: Current time
 * - jti: Unique nonce
 *
 * Signed with RS256 using the service app's private key.
 *
 * @returns Signed JWT assertion
 */
export function buildPrivateKeyJwtAssertion(): string {
  const privateKey = readFileSync(config.okta.privateKeyPath, 'utf8');

  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');

  const payload = {
    iss: config.okta.clientId,
    sub: config.okta.clientId,
    aud: config.okta.tokenUrl,
    exp: now + 300, // 5 minutes (max allowed by Okta)
    iat: now,
    jti: `${config.okta.clientId}.${now}.${nonce}`,
  };

  const signOptions: jwt.SignOptions = {
    algorithm: 'RS256',
  };

  // Add kid to header if configured
  if (config.okta.privateKeyKid) {
    signOptions.keyid = config.okta.privateKeyKid;
  }

  return jwt.sign(payload, privateKey, signOptions);
}

/**
 * Request access token from Okta using client credentials flow
 *
 * Internal function that makes the actual token request.
 * Does not use cache - callers should check cache first.
 *
 * @param scopes - Normalized scope string
 * @returns Token response from Okta
 */
async function requestAccessToken(scopes: string): Promise<OktaTokenResponse> {
  const clientAssertion = buildPrivateKeyJwtAssertion();

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: scopes,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion,
  });

  // Safe logging: redact the JWT assertion
  console.debug('[OktaServiceClient] Token request:', {
    grant_type: 'client_credentials',
    scope: scopes,
    client_id: config.okta.clientId,
    client_assertion: redactSecret(clientAssertion),
    token_url: config.okta.tokenUrl,
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
    const errorText = await response.text();
    console.error('[OktaServiceClient] Token request failed:', {
      status: response.status,
      statusText: response.statusText,
      error: errorText,
    });
    throw new Error(
      `Failed to get service access token: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  const tokenResponse = (await response.json()) as OktaTokenResponse;

  console.debug('[OktaServiceClient] Token acquired:', {
    token_type: tokenResponse.token_type,
    expires_in: tokenResponse.expires_in,
    scope: tokenResponse.scope,
    access_token: redactSecret(tokenResponse.access_token),
  });

  return tokenResponse;
}

/**
 * Get access token for specific OAuth scopes
 *
 * Implements token caching by scope set:
 * - Checks cache for unexpired token matching scope set
 * - Requests new token if cache miss or near expiry
 * - Refreshes token 60 seconds before expiration
 *
 * This is the primary function for getting tokens with dynamic scopes.
 *
 * @param scopes - Required OAuth scopes (array or space-separated string)
 * @returns Valid access token
 *
 * @example
 * ```typescript
 * // Request token with specific scopes
 * const token = await getServiceAccessToken([
 *   'okta.apps.read',
 *   'okta.governance.entitlements.read'
 * ]);
 *
 * // Or with space-separated string
 * const token = await getServiceAccessToken('okta.apps.read okta.users.read');
 * ```
 */
export async function getServiceAccessToken(scopes: string[] | string): Promise<string> {
  const normalizedScopes = normalizeScopeSet(scopes);

  // Check cache for valid token
  const cached = tokenCache.get(normalizedScopes);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    console.debug('[OktaServiceClient] Using cached token for scopes:', normalizedScopes);
    return cached.accessToken;
  }

  // Request new token
  console.debug('[OktaServiceClient] Requesting new token for scopes:', normalizedScopes);
  const tokenResponse = await requestAccessToken(normalizedScopes);

  // Cache the token with 60-second buffer before expiry
  const entry: TokenCacheEntry = {
    accessToken: tokenResponse.access_token,
    expiresAt: Date.now() + tokenResponse.expires_in * 1000,
    scopes: normalizedScopes,
  };

  tokenCache.set(normalizedScopes, entry);

  return tokenResponse.access_token;
}

/**
 * Get access token with default scopes
 *
 * Uses the configured default scope set from OKTA_SCOPES_DEFAULT.
 * Useful for general-purpose operations that don't require specific scopes.
 *
 * @returns Valid access token with default scopes
 *
 * @example
 * ```typescript
 * const token = await getDefaultServiceAccessToken();
 * ```
 */
export async function getDefaultServiceAccessToken(): Promise<string> {
  return getServiceAccessToken(config.okta.defaultScopes);
}

/**
 * Get cached token info for debugging
 *
 * Returns information about all cached tokens without exposing the actual tokens.
 *
 * @returns Array of cache entries with redacted tokens
 */
export function getCachedTokenInfo(): Array<{
  scopes: string;
  expiresAt: string;
  expiresIn: number;
  isExpired: boolean;
  accessToken: string;
}> {
  const now = Date.now();
  return Array.from(tokenCache.values()).map((entry) => ({
    scopes: entry.scopes,
    expiresAt: new Date(entry.expiresAt).toISOString(),
    expiresIn: Math.floor((entry.expiresAt - now) / 1000),
    isExpired: entry.expiresAt <= now,
    accessToken: redactSecret(entry.accessToken),
  }));
}

/**
 * Clear all cached tokens
 *
 * Useful for:
 * - Testing token refresh logic
 * - Forcing re-authentication after config changes
 * - Cleanup during shutdown
 */
export function clearTokenCache(): void {
  const count = tokenCache.size;
  tokenCache.clear();
  console.debug(`[OktaServiceClient] Cleared ${count} cached token(s)`);
}

/**
 * Clear cached token for specific scope set
 *
 * @param scopes - Scope set to clear
 */
export function clearTokenCacheForScopes(scopes: string[] | string): void {
  const normalizedScopes = normalizeScopeSet(scopes);
  const deleted = tokenCache.delete(normalizedScopes);
  if (deleted) {
    console.debug(`[OktaServiceClient] Cleared cached token for scopes: ${normalizedScopes}`);
  }
}

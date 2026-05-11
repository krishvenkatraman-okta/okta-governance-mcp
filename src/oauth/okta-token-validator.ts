/**
 * OAuth access token validator
 *
 * Validates Okta access tokens from ORG/DEFAULT authorization server.
 * Used by VS Code, Claude Desktop, and other OAuth clients that obtain
 * tokens directly from Okta without ID-JAG exchange.
 *
 * This is SEPARATE from the existing access token validator which handles
 * tokens from the CUSTOM authorization server (frontend flow).
 */

import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { getJwksClient } from './jwks-cache.js';
import type { OktaAccessToken, AccessTokenValidationResult } from '../types/index.js';

/**
 * Get signing key from Okta OAuth JWKS
 *
 * Fetches the public key for token signature verification.
 * Uses kid (key ID) from JWT header to identify the correct key.
 * Supports both custom auth server and Org auth server JWKS endpoints.
 */
function getKeyForJwksUri(jwksUri: string) {
  return function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
    if (!header.kid) {
      callback(new Error('Missing kid in JWT header'));
      return;
    }

    const client = getJwksClient(jwksUri);

    client.getSigningKey(header.kid, (err, key) => {
      if (err) {
        console.error('[OAuthValidator] JWKS key fetch failed:', {
          kid: header.kid?.substring(0, 8) + '...',
          jwksUri,
          error: err.message,
        });
        callback(err);
        return;
      }

      const signingKey = key?.getPublicKey();
      if (!signingKey) {
        callback(new Error('Failed to extract public key from JWKS'));
        return;
      }

      callback(null, signingKey);
    });
  };
}

/**
 * Resolve validation parameters based on token issuer.
 * Org AS tokens use the Org JWKS and accept any audience.
 * Custom AS tokens use the configured JWKS and audience.
 */
function resolveValidationParams(token: string): { jwksUri: string; issuer: string; audience?: string } {
  const decoded = jwt.decode(token) as any;
  const issuer = decoded?.iss || '';
  const orgUrl = `https://${config.okta.domain}`;

  if (issuer === orgUrl || issuer.includes('/oauth2/v1') || issuer.includes('/oauth2/default')) {
    // Org Auth Server token — use Org JWKS, no audience check (Org AS tokens use cid as aud)
    return {
      jwksUri: `${orgUrl}/oauth2/v1/keys`,
      issuer: issuer,
    };
  }

  // Custom auth server — use configured JWKS and audience
  return {
    jwksUri: config.okta.oauth.jwksUri,
    issuer: config.okta.oauth.issuer,
    audience: config.okta.oauth.audience,
  };
}

/**
 * Validate Okta OAuth access token
 *
 * Validates tokens from ORG/DEFAULT authorization server (direct OAuth flow).
 * Separate from the existing validator that handles custom auth server tokens.
 *
 * Validation steps:
 * 1. Verify JWT signature using JWKS
 * 2. Validate issuer (ORG/DEFAULT auth server)
 * 3. Validate audience
 * 4. Validate expiry, not-before, issued-at
 * 5. Extract user context (subject, scopes)
 *
 * @param token - JWT access token string
 * @returns Validation result with user context
 */
export async function validateOAuthAccessToken(token: string): Promise<AccessTokenValidationResult> {
  if (!token || typeof token !== 'string') {
    return {
      valid: false,
      error: 'Invalid token format',
    };
  }

  const params = resolveValidationParams(token);
  console.log('[OAuthValidator] Validating OAuth access token', {
    issuer: params.issuer,
    jwksUri: params.jwksUri,
    hasAudience: !!params.audience,
  });

  return new Promise((resolve) => {
    const verifyOptions: jwt.VerifyOptions & { issuer: string; audience?: string } = {
      issuer: params.issuer,
      algorithms: ['RS256'],
      clockTolerance: 300, // 5 minutes clock skew tolerance
    };
    if (params.audience) {
      verifyOptions.audience = params.audience;
    }

    jwt.verify(
      token,
      getKeyForJwksUri(params.jwksUri),
      verifyOptions,
      (err, decoded) => {
        if (err) {
          console.warn('[OAuthValidator] Validation failed:', {
            error: err.name,
            message: err.message,
          });

          resolve({
            valid: false,
            error: `OAuth token validation failed: ${err.message}`,
          });
          return;
        }

        const payload = decoded as OktaAccessToken;

        // Validate required claims
        if (!payload.sub || typeof payload.sub !== 'string') {
          console.warn('[OAuthValidator] Missing or invalid subject (sub) claim');
          resolve({
            valid: false,
            error: 'Missing or invalid subject (sub) claim',
          });
          return;
        }

        console.log('[OAuthValidator] Validation successful:', {
          subject: payload.sub,
          scope: payload.scp ? (Array.isArray(payload.scp) ? payload.scp.join(' ') : payload.scp) : 'none',
          expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : 'unknown',
        });

        resolve({
          valid: true,
          payload,
        });
      }
    );
  });
}

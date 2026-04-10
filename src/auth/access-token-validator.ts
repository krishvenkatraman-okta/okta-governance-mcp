/**
 * Okta Access Token Validation for MRS
 *
 * Validates Okta access tokens issued by the custom authorization server
 * after ID-JAG exchange. This replaces MCP token validation.
 *
 * Validation checks:
 * - Signature verification using Okta JWKS
 * - Issuer validation (custom authorization server)
 * - Audience validation
 * - Expiry validation
 * - Not-before validation
 * - Required claims validation (sub, iat)
 *
 * Security:
 * - Never logs raw tokens
 * - Returns structured validation errors
 * - Uses cached JWKS with rate limiting
 */

import jwksClient from 'jwks-rsa';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import type { OktaAccessToken, AccessTokenValidationResult } from '../types/index.js';

/**
 * JWKS client for fetching Okta public keys from custom authorization server
 *
 * Configuration:
 * - Cache enabled (24 hours)
 * - Rate limiting enabled (10 requests/minute)
 * - Automatic key rotation support
 * - 30-second timeout
 */
const client = jwksClient({
  jwksUri: config.okta.accessToken.jwksUri,
  cache: true,
  cacheMaxAge: 86400000, // 24 hours
  rateLimit: true,
  jwksRequestsPerMinute: 10,
  timeout: 30000, // 30 seconds
});

/**
 * Validation error details
 */
export interface AccessTokenValidationError {
  code: string;
  message: string;
  details?: string;
}

/**
 * Enhanced validation result with structured errors
 */
export interface DetailedAccessTokenValidationResult extends AccessTokenValidationResult {
  errors?: AccessTokenValidationError[];
  claims?: {
    issuer?: string;
    audience?: string;
    subject?: string;
    expiresAt?: string;
    notBefore?: string;
    issuedAt?: string;
    scope?: string;
  };
}

/**
 * Get signing key from JWKS
 *
 * Fetches the public key for token signature verification.
 * Uses kid (key ID) from JWT header to identify the correct key.
 */
function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
  if (!header.kid) {
    callback(new Error('Missing kid in JWT header'));
    return;
  }

  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      console.error('[AccessToken] JWKS key fetch failed:', {
        kid: header.kid?.substring(0, 8) + '...',
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
}

/**
 * Validate required claims in access token
 *
 * Ensures all required claims are present and valid.
 */
function validateRequiredClaims(payload: any): AccessTokenValidationError[] {
  const errors: AccessTokenValidationError[] = [];

  // Subject (user ID) is required
  if (!payload.sub || typeof payload.sub !== 'string') {
    errors.push({
      code: 'MISSING_SUBJECT',
      message: 'Missing or invalid subject (sub) claim',
      details: 'Access token must contain valid Okta user ID',
    });
  }

  // Issued at (iat) is required
  if (!payload.iat || typeof payload.iat !== 'number') {
    errors.push({
      code: 'MISSING_IAT',
      message: 'Missing or invalid issued-at (iat) claim',
    });
  }

  // Check if token was issued in the future (clock skew tolerance: 5 minutes)
  if (payload.iat && typeof payload.iat === 'number') {
    const now = Math.floor(Date.now() / 1000);
    const clockSkewTolerance = 300; // 5 minutes
    if (payload.iat > now + clockSkewTolerance) {
      errors.push({
        code: 'TOKEN_ISSUED_IN_FUTURE',
        message: 'Token issued-at time is in the future',
        details: `iat: ${new Date(payload.iat * 1000).toISOString()}, now: ${new Date().toISOString()}`,
      });
    }
  }

  return errors;
}

/**
 * Validate Okta access token with comprehensive checks
 *
 * Performs signature verification using Okta JWKS and validates all claims.
 * Returns structured validation result with detailed error information.
 *
 * @param token - Okta access token string (from custom authorization server)
 * @returns Detailed validation result with errors if validation fails
 *
 * @example
 * ```typescript
 * const result = await validateAccessToken(token);
 * if (!result.valid) {
 *   console.log('Validation errors:', result.errors);
 * } else {
 *   console.log('Subject:', result.payload.sub);
 * }
 * ```
 */
export async function validateAccessToken(token: string): Promise<DetailedAccessTokenValidationResult> {
  // Step 1: Verify token format (without logging the token)
  if (!token || typeof token !== 'string') {
    return {
      valid: false,
      error: 'Invalid token format',
      errors: [
        {
          code: 'INVALID_FORMAT',
          message: 'Token must be a non-empty string',
        },
      ],
    };
  }

  // Log validation attempt (without token content)
  console.log('[AccessToken] Validating Okta access token', {
    tokenLength: token.length,
    hasBearer: token.startsWith('Bearer '),
  });

  return new Promise((resolve) => {
    // Step 2: Verify signature and standard claims using JWKS
    jwt.verify(
      token,
      getKey,
      {
        issuer: config.okta.accessToken.issuer,
        audience: config.okta.accessToken.audience,
        algorithms: ['RS256'],
        clockTolerance: 300, // 5 minutes clock skew tolerance
      },
      (err, decoded) => {
        if (err) {
          // Map JWT errors to structured errors
          let errorCode = 'VALIDATION_FAILED';
          if (err.name === 'TokenExpiredError') {
            errorCode = 'TOKEN_EXPIRED';
          } else if (err.name === 'JsonWebTokenError') {
            errorCode = 'INVALID_SIGNATURE';
          } else if (err.name === 'NotBeforeError') {
            errorCode = 'TOKEN_NOT_YET_VALID';
          }

          console.warn('[AccessToken] Validation failed:', {
            errorCode,
            message: err.message,
          });

          resolve({
            valid: false,
            error: `Access token validation failed: ${err.message}`,
            errors: [
              {
                code: errorCode,
                message: err.message,
              },
            ],
          });
          return;
        }

        // Step 3: Validate required claims
        const claimErrors = validateRequiredClaims(decoded);
        if (claimErrors.length > 0) {
          console.warn('[AccessToken] Required claims validation failed:', {
            errorCount: claimErrors.length,
          });

          resolve({
            valid: false,
            error: 'Access token validation failed: Required claims missing or invalid',
            errors: claimErrors,
          });
          return;
        }

        // Step 4: Extract claims for logging (no sensitive data)
        const payload = decoded as OktaAccessToken;
        const claims = {
          issuer: payload.iss,
          audience: Array.isArray(payload.aud) ? payload.aud.join(', ') : String(payload.aud),
          subject: payload.sub,
          expiresAt: payload.exp ? new Date(Number(payload.exp) * 1000).toISOString() : undefined,
          notBefore: payload.nbf ? new Date(Number(payload.nbf) * 1000).toISOString() : undefined,
          issuedAt: payload.iat ? new Date(Number(payload.iat) * 1000).toISOString() : undefined,
          scope: payload.scp ? (Array.isArray(payload.scp) ? payload.scp.join(' ') : String(payload.scp)) : undefined,
        };

        console.log('[AccessToken] Validation successful:', {
          subject: payload.sub,
          expiresAt: claims.expiresAt,
          scope: claims.scope,
        });

        resolve({
          valid: true,
          payload: payload,
          claims,
        });
      }
    );
  });
}

/**
 * Extract subject (user ID) from access token without validation
 *
 * WARNING: This does not validate the token. Only use for non-security-critical
 * operations like logging or debugging.
 *
 * @param token - Okta access token string
 * @returns Subject (user ID) or null if extraction fails
 */
export function extractSubjectFromAccessToken(token: string): string | null {
  try {
    const decoded = jwt.decode(token) as OktaAccessToken | null;
    return decoded?.sub || null;
  } catch (error) {
    console.error('[AccessToken] Failed to decode token for subject extraction');
    return null;
  }
}

/**
 * Validate and extract subject from access token
 *
 * Convenience function that validates the token and returns the subject.
 * Returns null if validation fails.
 *
 * @param token - Okta access token
 * @returns Subject (user ID) or null if invalid
 */
export async function validateAndExtractSubject(token: string): Promise<string | null> {
  const result = await validateAccessToken(token);

  if (!result.valid || !result.payload) {
    return null;
  }

  return result.payload.sub;
}

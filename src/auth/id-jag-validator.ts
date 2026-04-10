/**
 * ID-JAG validation logic (tightened)
 *
 * Validates Okta ID-JAG tokens with comprehensive checks:
 * - Signature verification using Okta JWKS
 * - Issuer validation
 * - Audience validation
 * - Expiry validation
 * - Not-before validation
 * - Required claims validation
 *
 * Security:
 * - Never logs raw tokens
 * - Returns structured validation errors
 * - Uses cached JWKS with rate limiting
 */

import jwksClient from 'jwks-rsa';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import type { IdJagToken, IdJagValidationResult } from '../types/index.js';

/**
 * JWKS client for fetching Okta public keys
 *
 * Configuration:
 * - Cache enabled (24 hours)
 * - Rate limiting enabled
 * - Automatic key rotation support
 */
const client = jwksClient({
  jwksUri: config.okta.idJag.jwksUri,
  cache: true,
  cacheMaxAge: 86400000, // 24 hours
  rateLimit: true,
  jwksRequestsPerMinute: 10,
  timeout: 30000, // 30 seconds
});

/**
 * Validation error details
 */
export interface IdJagValidationError {
  code: string;
  message: string;
  details?: string;
}

/**
 * Enhanced validation result with structured errors
 */
export interface DetailedIdJagValidationResult extends IdJagValidationResult {
  errors?: IdJagValidationError[];
  claims?: {
    issuer?: string;
    audience?: string;
    subject?: string;
    expiresAt?: string;
    notBefore?: string;
    issuedAt?: string;
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
      console.error('[ID-JAG] JWKS key fetch failed:', {
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
 * Validate required claims in ID-JAG token
 *
 * Ensures all required claims are present and valid.
 */
function validateRequiredClaims(payload: any): IdJagValidationError[] {
  const errors: IdJagValidationError[] = [];

  // Subject (user ID) is required
  if (!payload.sub || typeof payload.sub !== 'string') {
    errors.push({
      code: 'MISSING_SUBJECT',
      message: 'Missing or invalid subject (sub) claim',
      details: 'ID-JAG must contain valid Okta user ID',
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
 * Validate ID-JAG token with comprehensive checks
 *
 * Performs signature verification using Okta JWKS and validates all claims.
 * Returns structured validation result with detailed error information.
 *
 * @param token - ID-JAG token string
 * @returns Detailed validation result with errors if validation fails
 *
 * @example
 * ```typescript
 * const result = await validateIdJag(token);
 * if (!result.valid) {
 *   console.log('Validation errors:', result.errors);
 * }
 * ```
 */
export async function validateIdJag(token: string): Promise<DetailedIdJagValidationResult> {
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
  console.log('[ID-JAG] Validating token', {
    tokenLength: token.length,
    hasBearer: token.startsWith('Bearer '),
  });

  return new Promise((resolve) => {
    // Step 2: Verify signature and standard claims using JWKS
    jwt.verify(
      token,
      getKey,
      {
        issuer: config.okta.idJag.issuer,
        audience: config.okta.idJag.audience,
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

          console.warn('[ID-JAG] Validation failed:', {
            errorCode,
            message: err.message,
          });

          resolve({
            valid: false,
            error: `ID-JAG validation failed: ${err.message}`,
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
          console.warn('[ID-JAG] Required claims validation failed:', {
            errorCount: claimErrors.length,
          });

          resolve({
            valid: false,
            error: 'ID-JAG validation failed: Required claims missing or invalid',
            errors: claimErrors,
          });
          return;
        }

        // Step 4: Extract claims for logging (no sensitive data)
        const payload = decoded as IdJagToken;
        const claims = {
          issuer: payload.iss,
          audience: Array.isArray(payload.aud) ? payload.aud.join(', ') : String(payload.aud),
          subject: payload.sub,
          expiresAt: payload.exp ? new Date(Number(payload.exp) * 1000).toISOString() : undefined,
          notBefore: payload.nbf ? new Date(Number(payload.nbf) * 1000).toISOString() : undefined,
          issuedAt: payload.iat ? new Date(Number(payload.iat) * 1000).toISOString() : undefined,
        };

        console.log('[ID-JAG] Validation successful:', {
          subject: payload.sub,
          expiresAt: claims.expiresAt,
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
 * Extract subject (user ID) from ID-JAG without validation
 *
 * WARNING: This does not validate the token. Only use for non-security-critical
 * operations like logging or debugging.
 *
 * @param token - ID-JAG token string
 * @returns Subject (user ID) or null if extraction fails
 */
export function extractSubjectFromIdJag(token: string): string | null {
  try {
    const decoded = jwt.decode(token) as IdJagToken | null;
    return decoded?.sub || null;
  } catch (error) {
    console.error('[ID-JAG] Failed to decode token for subject extraction');
    return null;
  }
}

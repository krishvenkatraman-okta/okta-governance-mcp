/**
 * MCP access token validation
 *
 * Validates MCP tokens issued by MAS with comprehensive checks:
 * - Signature verification using MAS public key
 * - Issuer validation
 * - Audience validation
 * - Expiry validation
 * - Subject presence validation
 */

import { verifyJwt, decodeJwt } from './jwt-utils.js';
import { config } from '../config/index.js';
import type { McpAccessToken, McpTokenValidationResult } from '../types/index.js';

/**
 * Detailed validation result
 */
export interface DetailedMcpTokenValidationResult extends McpTokenValidationResult {
  validationErrors?: string[];
  claims?: {
    issuer?: string;
    audience?: string;
    subject?: string;
    expiresAt?: string;
    issuedAt?: string;
    sessionId?: string;
  };
}

/**
 * Validate MCP access token with comprehensive checks
 *
 * Validation steps:
 * 1. JWT signature verification (using MAS public key)
 * 2. Issuer check (must match expected MAS issuer)
 * 3. Audience check (must match MRS audience)
 * 4. Expiry check (token must not be expired)
 * 5. Subject check (sub claim must be present)
 * 6. Issued-at check (iat must be present and not in future)
 *
 * @param token - MCP access token (JWT string)
 * @returns Validation result with detailed error messages
 */
export function validateMcpToken(token: string): DetailedMcpTokenValidationResult {
  const errors: string[] = [];

  try {
    // Step 1: Verify JWT signature and basic structure
    const payload = verifyJwt(token, config.mas.jwt.publicKeyPath, {
      issuer: config.mrs.token.issuer,
      audience: config.mrs.token.audience,
    }) as McpAccessToken;

    // Step 2-4: Issuer, audience, expiry already validated by verifyJwt

    // Step 5: Validate subject presence
    if (!payload.sub || typeof payload.sub !== 'string') {
      errors.push('Missing or invalid subject (sub) claim');
    }

    // Step 6: Validate issued-at time
    if (!payload.iat || typeof payload.iat !== 'number') {
      errors.push('Missing or invalid issued-at (iat) claim');
    } else {
      const now = Math.floor(Date.now() / 1000);
      if (payload.iat > now + 60) {
        // Allow 60 second clock skew
        errors.push('Token issued in the future');
      }
    }

    // Additional validations
    if (!payload.jti || typeof payload.jti !== 'string') {
      errors.push('Missing or invalid JWT ID (jti) claim');
    }

    // If any validation errors, return invalid
    if (errors.length > 0) {
      return {
        valid: false,
        error: `Token validation failed: ${errors.join(', ')}`,
        validationErrors: errors,
      };
    }

    // All validations passed
    return {
      valid: true,
      payload,
      claims: {
        issuer: payload.iss,
        audience: payload.aud,
        subject: payload.sub,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
        issuedAt: new Date(payload.iat * 1000).toISOString(),
        sessionId: payload.sessionId,
      },
    };
  } catch (error) {
    // Signature verification or other critical error
    const errorMessage = error instanceof Error ? error.message : 'Invalid MCP token';

    return {
      valid: false,
      error: errorMessage,
      validationErrors: [errorMessage],
    };
  }
}

/**
 * Validate and extract subject from MCP token
 *
 * Convenience function that validates the token and returns the subject.
 * Returns null if validation fails.
 *
 * @param token - MCP access token
 * @returns Subject (user ID) or null if invalid
 */
export function validateAndExtractSubject(token: string): string | null {
  const result = validateMcpToken(token);

  if (!result.valid || !result.payload) {
    return null;
  }

  return result.payload.sub;
}

/**
 * Extract subject from MCP token without validation
 *
 * WARNING: This does not validate the token signature or claims.
 * Use only for non-security-critical operations like logging.
 *
 * @param token - MCP access token
 * @returns Subject (user ID) or null if decode fails
 */
export function extractSubjectFromMcpToken(token: string): string | null {
  try {
    const decoded = decodeJwt(token);
    return decoded?.sub || null;
  } catch {
    return null;
  }
}

/**
 * Extract claims from MCP token without validation
 *
 * WARNING: This does not validate the token signature or claims.
 * Use only for debugging or non-security-critical operations.
 *
 * @param token - MCP access token
 * @returns Decoded payload or null if decode fails
 */
export function extractClaimsFromMcpToken(token: string): McpAccessToken | null {
  try {
    return decodeJwt(token) as McpAccessToken;
  } catch {
    return null;
  }
}

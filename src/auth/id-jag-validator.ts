/**
 * ID-JAG validation logic
 */

import jwksClient from 'jwks-rsa';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import type { IdJagToken, IdJagValidationResult } from '../types/index.js';

/**
 * JWKS client for fetching Okta public keys
 */
const client = jwksClient({
  jwksUri: config.okta.idJag.jwksUri,
  cache: true,
  cacheMaxAge: 86400000, // 24 hours
  rateLimit: true,
});

/**
 * Get signing key from JWKS
 */
function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

/**
 * Validate ID-JAG token
 *
 * Checks:
 * - Signature (using JWKS from Okta)
 * - Issuer
 * - Audience
 * - Expiration
 * - Not before
 */
export async function validateIdJag(token: string): Promise<IdJagValidationResult> {
  return new Promise((resolve) => {
    jwt.verify(
      token,
      getKey,
      {
        issuer: config.okta.idJag.issuer,
        audience: config.okta.idJag.audience,
        algorithms: ['RS256'],
      },
      (err, decoded) => {
        if (err) {
          resolve({
            valid: false,
            error: `ID-JAG validation failed: ${err.message}`,
          });
          return;
        }

        resolve({
          valid: true,
          payload: decoded as IdJagToken,
        });
      }
    );
  });
}

/**
 * Extract subject (user ID) from ID-JAG
 */
export function extractSubjectFromIdJag(token: string): string | null {
  try {
    const decoded = jwt.decode(token) as IdJagToken | null;
    return decoded?.sub || null;
  } catch {
    return null;
  }
}

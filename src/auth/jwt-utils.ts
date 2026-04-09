/**
 * JWT utilities for signing and verification
 */

import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';

/**
 * Sign a JWT with RS256
 */
export function signJwt(
  payload: Record<string, unknown>,
  privateKeyPath: string,
  options: jwt.SignOptions
): string {
  const privateKey = readFileSync(privateKeyPath, 'utf8');
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    ...options,
  });
}

/**
 * Verify a JWT with RS256
 */
export function verifyJwt(
  token: string,
  publicKeyPath: string,
  options?: jwt.VerifyOptions
): jwt.JwtPayload {
  const publicKey = readFileSync(publicKeyPath, 'utf8');
  return jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    ...options,
  }) as jwt.JwtPayload;
}

/**
 * Decode JWT without verification (for inspection)
 */
export function decodeJwt(token: string): jwt.JwtPayload | null {
  return jwt.decode(token) as jwt.JwtPayload | null;
}

/**
 * Extract bearer token from Authorization header
 */
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

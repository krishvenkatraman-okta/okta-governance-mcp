/**
 * USER OAuth Client Assertion Builder
 *
 * Builds signed JWTs for OAuth client authentication using private_key_jwt.
 *
 * USAGE:
 * - Used ONLY for USER OAuth client callback token exchange (authorization code → tokens)
 * - Used together with PKCE (code_verifier) for additional verification
 * - NOT used for AGENT principal token exchanges
 *
 * SECURITY:
 * - Server-side only (never expose to browser)
 * - Private key must be securely stored
 * - Short-lived tokens (60 seconds)
 *
 * JWT Structure:
 * - Header: { alg: "RS256", kid: "{user_key_id}" }
 * - Payload: { iss: clientId, sub: clientId, aud, iat, exp, jti }
 * - Signature: RS256 with USER OAuth client private key
 */

import { SignJWT, importJWK, importPKCS8 } from 'jose';
import { readFileSync } from 'fs';
import { config } from './config';

export interface UserClientAssertionOptions {
  /**
   * Audience for the JWT (ORG token endpoint)
   * Example: https://{domain}/oauth2/v1/token
   */
  audience: string;
}

export interface UserClientAssertionMetadata {
  header: {
    alg: string;
    kid: string;
  };
  payload: {
    iss: string;
    sub: string;
    aud: string;
    iat: number;
    exp: number;
    jti: string;
  };
}

/**
 * Build and sign a client assertion JWT for the USER OAuth client
 *
 * @param options - Assertion options (audience)
 * @returns Signed JWT string
 */
export async function buildUserClientAssertion(
  options: UserClientAssertionOptions
): Promise<string> {
  const { userOAuthClient } = config.okta;

  // Validate configuration
  if (!userOAuthClient.clientId || !userOAuthClient.keyId) {
    throw new Error('USER OAuth client ID and key ID must be configured');
  }

  if (!userOAuthClient.privateKeyJwk && !userOAuthClient.privateKeyPath) {
    throw new Error('USER OAuth client private key (JWK or path) must be configured');
  }

  // Load private key from JWK string or PEM file
  let privateKey: any;
  if (userOAuthClient.privateKeyJwk) {
    // Load from JWK string (preferred)
    try {
      const jwk = JSON.parse(userOAuthClient.privateKeyJwk);
      privateKey = await importJWK(jwk, 'RS256');
    } catch (error) {
      throw new Error(`Failed to parse USER OAuth client private key JWK: ${error}`);
    }
  } else if (userOAuthClient.privateKeyPath) {
    // Load from PEM file (alternative)
    try {
      const pem = readFileSync(userOAuthClient.privateKeyPath, 'utf-8');
      privateKey = await importPKCS8(pem, 'RS256');
    } catch (error) {
      throw new Error(`Failed to load USER OAuth client private key from path: ${error}`);
    }
  }

  // Build JWT claims
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60; // 60 seconds (short-lived)
  const jti = crypto.randomUUID(); // Unique token ID

  // Sign JWT
  const jwt = await new SignJWT({
    iss: userOAuthClient.clientId, // Issuer = USER OAuth client ID
    sub: userOAuthClient.clientId, // Subject = USER OAuth client ID (same as issuer)
    aud: options.audience, // Audience = Okta token endpoint
    iat: now, // Issued at
    exp: exp, // Expires in 60 seconds
    jti: jti, // JWT ID (prevents replay)
  })
    .setProtectedHeader({
      alg: 'RS256', // Algorithm
      kid: userOAuthClient.keyId, // Key ID
    })
    .sign(privateKey);

  return jwt;
}

/**
 * Decode USER client assertion metadata without verification
 *
 * SECURITY: This only decodes the JWT structure, it does NOT verify the signature.
 * Use this for inspection/debugging only.
 *
 * @param jwt - Signed JWT string
 * @returns Decoded header and payload
 */
export function decodeUserClientAssertionMetadata(jwt: string): UserClientAssertionMetadata {
  const [headerB64, payloadB64] = jwt.split('.');

  if (!headerB64 || !payloadB64) {
    throw new Error('Invalid JWT format');
  }

  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

  return {
    header,
    payload,
  };
}

/**
 * Validate USER client assertion claims (without signature verification)
 *
 * Checks that required claims are present and not expired.
 * Does NOT verify the signature.
 *
 * @param jwt - Signed JWT string
 * @returns Validation result
 */
export function validateUserClientAssertionClaims(jwt: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  try {
    const { header, payload } = decodeUserClientAssertionMetadata(jwt);

    // Check header
    if (header.alg !== 'RS256') {
      errors.push('Invalid algorithm (must be RS256)');
    }
    if (!header.kid) {
      errors.push('Missing kid in header');
    }

    // Check required claims
    if (!payload.iss) {
      errors.push('Missing iss claim');
    }
    if (!payload.sub) {
      errors.push('Missing sub claim');
    }
    if (!payload.aud) {
      errors.push('Missing aud claim');
    }
    if (!payload.iat) {
      errors.push('Missing iat claim');
    }
    if (!payload.exp) {
      errors.push('Missing exp claim');
    }
    if (!payload.jti) {
      errors.push('Missing jti claim');
    }

    // Check iss === sub
    if (payload.iss !== payload.sub) {
      errors.push('iss and sub must be equal (USER OAuth client ID)');
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      errors.push('JWT has expired');
    }

    // Check not used before iat
    if (payload.iat > now + 60) {
      errors.push('JWT issued in the future (check clock skew)');
    }

    // Check lifetime (should be short, max 60 seconds)
    const lifetime = payload.exp - payload.iat;
    if (lifetime > 60) {
      errors.push('JWT lifetime too long (max 60 seconds)');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  } catch (error) {
    errors.push(`Failed to decode JWT: ${error}`);
    return {
      valid: false,
      errors,
    };
  }
}

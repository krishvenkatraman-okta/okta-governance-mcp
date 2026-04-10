/**
 * Agent Client Assertion Builder
 *
 * Builds signed JWTs for OAuth client authentication using private_key_jwt.
 * Used in ID-JAG exchange to authenticate the AI agent client with Okta.
 *
 * SECURITY:
 * - Server-side only (never expose to browser)
 * - Private key must be securely stored
 * - Short-lived tokens (5 minutes max)
 *
 * JWT Structure:
 * - Header: { alg: "RS256", kid: "{agent_key_id}" }
 * - Payload: { iss, sub, aud, iat, exp, jti }
 * - Signature: RS256 with agent private key
 */

import { SignJWT, importJWK, importPKCS8 } from 'jose';
import { readFileSync } from 'fs';
import { config } from './config';

export interface ClientAssertionOptions {
  /**
   * Audience for the JWT (ORG token endpoint)
   * Example: https://{domain}/oauth2/v1/token
   */
  audience: string;
}

export interface ClientAssertionMetadata {
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
 * Build and sign a client assertion JWT for the AI agent
 *
 * @param options - Assertion options (audience)
 * @returns Signed JWT string
 */
export async function buildAgentClientAssertion(
  options: ClientAssertionOptions
): Promise<string> {
  const { agent } = config.okta;

  // Validate configuration
  if (!agent.clientId || !agent.keyId) {
    throw new Error('Agent client ID and key ID must be configured');
  }

  if (!agent.privateKeyJwk && !agent.privateKeyPath) {
    throw new Error('Agent private key (JWK or path) must be configured');
  }

  // Load private key from JWK string or PEM file
  let privateKey: any;
  if (agent.privateKeyJwk) {
    // Load from JWK string (preferred)
    try {
      const jwk = JSON.parse(agent.privateKeyJwk);
      privateKey = await importJWK(jwk, 'RS256');
    } catch (error) {
      throw new Error(`Failed to parse agent private key JWK: ${error}`);
    }
  } else if (agent.privateKeyPath) {
    // Load from PEM file (alternative)
    try {
      const pem = readFileSync(agent.privateKeyPath, 'utf-8');
      privateKey = await importPKCS8(pem, 'RS256');
    } catch (error) {
      throw new Error(`Failed to load agent private key from path: ${error}`);
    }
  }

  // Build JWT claims
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 300; // 5 minutes (short-lived)
  const jti = crypto.randomUUID(); // Unique token ID

  // Sign JWT
  const jwt = await new SignJWT({
    iss: agent.clientId, // Issuer = agent client ID
    sub: agent.clientId, // Subject = agent client ID (same as issuer)
    aud: options.audience, // Audience = Okta token endpoint
    iat: now, // Issued at
    exp: exp, // Expires in 5 minutes
    jti: jti, // JWT ID (prevents replay)
  })
    .setProtectedHeader({
      alg: 'RS256', // Algorithm
      kid: agent.keyId, // Key ID
    })
    .sign(privateKey);

  return jwt;
}

/**
 * Decode client assertion metadata without verification
 *
 * SECURITY: This only decodes the JWT structure, it does NOT verify the signature.
 * Use this for inspection/debugging only.
 *
 * @param jwt - Signed JWT string
 * @returns Decoded header and payload
 */
export function decodeClientAssertionMetadata(jwt: string): ClientAssertionMetadata {
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
 * Validate client assertion claims (without signature verification)
 *
 * Checks that required claims are present and not expired.
 * Does NOT verify the signature.
 *
 * @param jwt - Signed JWT string
 * @returns Validation result
 */
export function validateClientAssertionClaims(jwt: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  try {
    const { header, payload } = decodeClientAssertionMetadata(jwt);

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
      errors.push('iss and sub must be equal (agent client ID)');
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

    // Check lifetime (should be short, max 5 minutes)
    const lifetime = payload.exp - payload.iat;
    if (lifetime > 300) {
      errors.push('JWT lifetime too long (max 5 minutes)');
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

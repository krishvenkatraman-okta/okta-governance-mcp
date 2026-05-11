/**
 * Token router for dual authentication
 *
 * Routes tokens to the correct validator based on issuer:
 * - CUSTOM auth server tokens → existing validator (frontend flow)
 * - ORG/DEFAULT auth server tokens → new OAuth validator (VS Code/Claude Desktop)
 *
 * This enables both authentication paths to coexist without breaking changes.
 */

import jwt from 'jsonwebtoken';
import { validateAccessToken } from './access-token-validator.js';
import { validateOAuthAccessToken } from '../oauth/okta-token-validator.js';
import { resolveAuthorizationContextForSubject } from '../policy/authorization-context.js';
import { config } from '../config/index.js';
import type { AuthorizationContext } from '../types/index.js';

/**
 * Token type classification
 */
type TokenType = 'CUSTOM_AUTH_SERVER' | 'ORG_OR_DEFAULT_AUTH_SERVER' | 'UNKNOWN';

/**
 * Detect token type by peeking at issuer claim
 *
 * Does NOT validate the token, just identifies which validator to use.
 * Decodes the token without verification to read the issuer (iss) claim.
 *
 * @param token - JWT token string
 * @returns Token type classification
 */
function detectTokenType(token: string): TokenType {
  try {
    const decoded = jwt.decode(token) as any;
    const issuer = decoded?.iss;

    if (!issuer) {
      console.warn('[TokenRouter] Token has no issuer claim');
      return 'UNKNOWN';
    }

    // Check if token is from custom auth server (existing frontend flow)
    if (issuer === config.okta.accessToken.issuer) {
      console.log('[TokenRouter] Detected CUSTOM_AUTH_SERVER token (frontend flow)');
      return 'CUSTOM_AUTH_SERVER';
    }

    // Check if token is from org/default auth server (new OAuth flow)
    if (issuer === config.okta.oauth.issuer) {
      console.log('[TokenRouter] Detected ORG_OR_DEFAULT_AUTH_SERVER token (OAuth flow)');
      return 'ORG_OR_DEFAULT_AUTH_SERVER';
    }

    // Also check for org auth server variant (/oauth2/v1)
    if (issuer.includes('/oauth2/v1') || issuer.includes('/oauth2/default')) {
      console.log('[TokenRouter] Detected ORG_OR_DEFAULT_AUTH_SERVER token (by pattern)');
      return 'ORG_OR_DEFAULT_AUTH_SERVER';
    }

    // Check for bare Org Auth Server issuer (https://{domain} with no /oauth2/ path)
    // This is the issuer for tokens from the Org Authorization Server
    const orgUrl = `https://${config.okta.domain}`;
    if (issuer === orgUrl) {
      console.log('[TokenRouter] Detected ORG_OR_DEFAULT_AUTH_SERVER token (bare domain issuer)');
      return 'ORG_OR_DEFAULT_AUTH_SERVER';
    }

    console.warn('[TokenRouter] Unknown issuer:', issuer);
    console.warn('[TokenRouter] Expected issuers:', {
      customAuthServer: config.okta.accessToken.issuer,
      oauthAuthServer: config.okta.oauth.issuer,
    });
    return 'UNKNOWN';
  } catch (error) {
    console.error('[TokenRouter] Failed to decode token:', error);
    return 'UNKNOWN';
  }
}

/**
 * Authenticate request with automatic token type detection
 *
 * Routes to correct validator based on token issuer:
 * - CUSTOM_AUTH_SERVER: Use existing validator (frontend flow with ID-JAG exchange)
 * - ORG_OR_DEFAULT_AUTH_SERVER: Use new OAuth validator (VS Code/Claude Desktop)
 *
 * After validation, both paths converge at resolveAuthorizationContextForSubject(),
 * which fetches user roles from Okta and builds the authorization context.
 *
 * @param token - JWT access token
 * @returns Authorization context or null if authentication fails
 */
export async function authenticateRequestWithRouter(token: string): Promise<AuthorizationContext | null> {
  const tokenType = detectTokenType(token);

  if (tokenType === 'CUSTOM_AUTH_SERVER') {
    // Path A: Existing flow (frontend after ID-JAG exchange)
    console.log('[TokenRouter] Using CUSTOM_AUTH_SERVER validator (existing flow)');

    const validation = await validateAccessToken(token);

    if (!validation.valid || !validation.payload) {
      console.error('[TokenRouter] Custom auth server validation failed:', validation.error);
      return null;
    }

    const subject = validation.payload.sub;
    console.log('[TokenRouter] Resolved subject from CUSTOM token:', subject);

    // CONVERGENCE POINT: Both paths use same authorization resolver
    const context = await resolveAuthorizationContextForSubject(subject, validation.payload);
    if (context) context.userToken = token; // Passthrough for user-scoped API calls
    return context;
  }

  if (tokenType === 'ORG_OR_DEFAULT_AUTH_SERVER') {
    // Path B: New OAuth flow (VS Code/Claude Desktop direct)
    console.log('[TokenRouter] Using ORG_OR_DEFAULT_AUTH_SERVER validator (OAuth flow)');

    const validation = await validateOAuthAccessToken(token);

    if (!validation.valid || !validation.payload) {
      console.error('[TokenRouter] OAuth validation failed:', validation.error);
      return null;
    }

    const subject = validation.payload.sub;
    console.log('[TokenRouter] Resolved subject from OAuth token:', subject);

    // CONVERGENCE POINT: Both paths use same authorization resolver
    const context = await resolveAuthorizationContextForSubject(subject, validation.payload);
    if (context) context.userToken = token; // Passthrough for user-scoped API calls
    return context;
  }

  // Unknown token type
  console.error('[TokenRouter] Unknown token type, cannot validate');
  console.error('[TokenRouter] Token must be from either:');
  console.error('[TokenRouter]   - Custom authorization server (frontend flow)');
  console.error('[TokenRouter]   - Org/default authorization server (OAuth flow)');
  return null;
}

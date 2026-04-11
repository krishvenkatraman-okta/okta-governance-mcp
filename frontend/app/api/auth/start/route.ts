/**
 * API Route: /api/auth/start
 *
 * Initiates Okta OIDC + PKCE authentication flow
 *
 * OAUTH CLIENT: USER OAuth Client
 * AUTHORIZATION SERVER: ORG auth server (/oauth2/v1/authorize)
 *
 * SCOPES REQUESTED (from lib/okta-scopes.ts):
 * - oktaScopes.login + oktaScopes.endUserApi
 */

import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { oktaScopes } from '@/lib/okta-scopes';
import { getSession } from '@/lib/session';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '@/lib/pkce';

export async function GET() {
  try {
    console.log('[Auth Start] Initiating OIDC + PKCE flow');

    // 1. Get session and clear all old auth/token data
    // This ensures a clean slate for new login attempts
    const session = await getSession();

    // Clear all tokens
    session.idToken = undefined;
    session.idJag = undefined;
    session.mcpAccessToken = undefined;

    // Clear all token expiry timestamps
    session.idTokenExpiresAt = undefined;
    session.idJagExpiresAt = undefined;
    session.mcpAccessTokenExpiresAt = undefined;

    // Clear user info
    session.userId = undefined;
    session.userEmail = undefined;

    // Clear any old PKCE state
    session.codeVerifier = undefined;
    session.state = undefined;

    console.log('[Auth Start] Old session data cleared');

    // 2. Generate fresh PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    // 3. Store fresh PKCE parameters in clean session
    session.codeVerifier = codeVerifier;
    session.state = state;
    await session.save();

    console.log('[Auth Start] Fresh PKCE parameters stored in clean session');

    // 4. Build authorization URL
    const authParams = new URLSearchParams({
      client_id: config.okta.userOAuthClient.clientId,
      redirect_uri: config.oauth.redirectUri,
      response_type: 'code',
      // User login scopes: identity (openid, profile, email) + end-user API access
      // Note: MCP resource scope (governance:mcp) is NOT requested here
      // It will be requested later during ID-JAG exchange
      scope: [...oktaScopes.login, ...oktaScopes.endUserApi].join(' '),
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authorizeUrl = `${config.okta.orgAuthServer.authorizeEndpoint}?${authParams.toString()}`;

    console.log('[Auth Start] Redirecting to Okta');

    // 5. Redirect to Okta
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    console.error('[Auth Start] Error:', error);
    return NextResponse.json(
      { error: 'Failed to start authentication' },
      { status: 500 }
    );
  }
}

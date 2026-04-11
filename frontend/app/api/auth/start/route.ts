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

    // 1. Generate PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    // 2. Store PKCE parameters in session
    const session = await getSession();
    session.codeVerifier = codeVerifier;
    session.state = state;
    await session.save();

    console.log('[Auth Start] PKCE parameters stored in session');

    // 3. Build authorization URL
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

    // 4. Redirect to Okta
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    console.error('[Auth Start] Error:', error);
    return NextResponse.json(
      { error: 'Failed to start authentication' },
      { status: 500 }
    );
  }
}

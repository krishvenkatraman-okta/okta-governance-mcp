/**
 * API Route: /api/auth/callback
 *
 * OAuth callback handler after Okta authentication
 *
 * OAUTH CLIENT: USER OAuth Client
 * AUTHORIZATION SERVER: ORG auth server (/oauth2/v1/token)
 *
 * Flow:
 * 1. Receive authorization code from Okta
 * 2. Verify state parameter (CSRF protection)
 * 3. Retrieve code_verifier from session
 * 4. Exchange authorization code for tokens:
 *    POST to ORG token endpoint: https://{domain}/oauth2/v1/token
 *    - grant_type=authorization_code
 *    - code
 *    - redirect_uri
 *    - client_id (USER OAuth client ID)
 *    - code_verifier (PKCE)
 * 5. Receive id_token and access_token
 * 6. Store id_token and access_token in secure session
 * 7. Extract and store user info from id_token
 * 8. Redirect to /agent
 *
 * Note: The id_token will later be exchanged for ID-JAG using the AGENT client
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { getSession } from '@/lib/session';
import { decodeJwt } from 'jose';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token: string;
  scope?: string;
}

interface OktaErrorResponse {
  error: string;
  error_description?: string;
}

export async function GET(request: NextRequest) {
  try {
    console.log('[Auth Callback] Processing OAuth callback');

    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Check for OAuth errors
    if (error) {
      console.error('[Auth Callback] OAuth error:', error);
      return NextResponse.json(
        {
          error: 'OAuth error',
          error_description: searchParams.get('error_description') || 'Unknown error',
        },
        { status: 400 }
      );
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('[Auth Callback] Missing required parameters');
      return NextResponse.json(
        { error: 'Missing code or state parameter' },
        { status: 400 }
      );
    }

    // 1. Retrieve session and verify state (CSRF protection)
    const session = await getSession();

    if (!session.state) {
      console.error('[Auth Callback] No state found in session');
      return NextResponse.json(
        { error: 'Invalid session state' },
        { status: 400 }
      );
    }

    if (session.state !== state) {
      console.error('[Auth Callback] State mismatch - possible CSRF attack');
      return NextResponse.json(
        { error: 'State mismatch - invalid request' },
        { status: 400 }
      );
    }

    console.log('[Auth Callback] State verified successfully');

    // 2. Retrieve code_verifier from session
    const codeVerifier = session.codeVerifier;

    if (!codeVerifier) {
      console.error('[Auth Callback] No code verifier found in session');
      return NextResponse.json(
        { error: 'Missing code verifier' },
        { status: 400 }
      );
    }

    console.log('[Auth Callback] Code verifier retrieved from session');

    // 3. Exchange authorization code for tokens
    const tokenEndpoint = config.okta.orgAuthServer.tokenEndpoint;
    const requestBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: config.oauth.redirectUri,
      client_id: config.okta.userOAuthClient.clientId,
      code_verifier: codeVerifier,
    });

    console.log('[Auth Callback] Exchanging code for tokens at ORG auth server');

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: requestBody.toString(),
    });

    // Handle error response
    if (!response.ok) {
      const errorData: OktaErrorResponse = await response.json();
      console.error('[Auth Callback] Token exchange failed:', {
        status: response.status,
        error: errorData.error,
        description: errorData.error_description,
      });

      return NextResponse.json(
        {
          error: 'Token exchange failed',
          okta_error: errorData.error,
          okta_error_description: errorData.error_description,
        },
        { status: response.status }
      );
    }

    // Parse token response
    const tokenResponse: TokenResponse = await response.json();

    console.log('[Auth Callback] Token exchange successful');

    // 4. Decode ID token to extract user info (no verification needed here, just extraction)
    const idToken = tokenResponse.id_token;
    const decoded = decodeJwt(idToken);

    const userId = decoded.sub as string;
    const userEmail = decoded.email as string | undefined;

    console.log('[Auth Callback] User info extracted:', { userId, userEmail });

    // 5. Store tokens and user info in session
    session.idToken = idToken;
    session.orgAccessToken = tokenResponse.access_token;
    session.userId = userId;

    if (userEmail) {
      session.userEmail = userEmail;
    }

    // Calculate and store ID token expiration
    if (decoded.exp) {
      session.idTokenExpiresAt = decoded.exp as number;
    }

    // Clear PKCE parameters (no longer needed)
    session.codeVerifier = undefined;
    session.state = undefined;

    await session.save();

    console.log('[Auth Callback] Session updated with tokens and user info');

    // 6. Redirect to /agent page
    const agentUrl = new URL('/agent', request.url);
    return NextResponse.redirect(agentUrl);
  } catch (error) {
    console.error('[Auth Callback] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        error: 'Failed to handle OAuth callback',
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}

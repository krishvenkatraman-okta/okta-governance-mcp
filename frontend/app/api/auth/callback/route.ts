/**
 * API Route: /api/auth/callback
 *
 * OAuth callback handler after Okta authentication
 *
 * OAUTH CLIENT: USER OAuth Client
 * AUTHORIZATION SERVER: ORG auth server (/oauth2/v1/token)
 *
 * Flow (to be implemented):
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
 * 6. Store id_token in secure session
 * 7. Redirect to /agent
 *
 * Note: The id_token will later be exchanged for ID-JAG using the AGENT client
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Check for OAuth errors
    if (error) {
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
      return NextResponse.json(
        { error: 'Missing code or state parameter' },
        { status: 400 }
      );
    }

    // TODO: Implement callback handler
    // 1. Verify state matches stored value
    // 2. Retrieve code_verifier from session
    // 3. Exchange code for tokens (ORG auth server)
    // 4. Store id_token securely
    // 5. Redirect to /agent

    // Placeholder response
    return NextResponse.json({
      message: 'OAuth callback endpoint - not yet implemented',
      received: {
        code: code.substring(0, 10) + '...',
        state: state.substring(0, 10) + '...',
      },
      next_step: 'Will exchange code for id_token',
      authorization_server: 'ORG (/oauth2/v1/...)',
      token_endpoint: config.okta.orgAuthServer.tokenEndpoint,
    });
  } catch (error) {
    console.error('Callback error:', error);
    return NextResponse.json(
      { error: 'Failed to handle callback' },
      { status: 500 }
    );
  }
}

/**
 * API Route: /api/auth/callback
 *
 * OAuth callback handler after Okta authentication
 *
 * Flow (to be implemented):
 * 1. Receive authorization code from Okta
 * 2. Verify state parameter (CSRF protection)
 * 3. Retrieve code_verifier from session
 * 4. Exchange authorization code for tokens:
 *    POST to token endpoint with:
 *    - grant_type=authorization_code
 *    - code
 *    - redirect_uri
 *    - client_id
 *    - code_verifier
 * 5. Receive id_token and access_token
 * 6. Store tokens in secure session
 * 7. Redirect to /agent
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
    // 3. Exchange code for tokens
    // 4. Store tokens securely
    // 5. Redirect to /agent

    // Placeholder response
    return NextResponse.json({
      message: 'OAuth callback endpoint - not yet implemented',
      received: {
        code: code.substring(0, 10) + '...',
        state: state.substring(0, 10) + '...',
      },
      next_step: 'Will exchange code for tokens',
      token_endpoint: config.okta.customAuthServer.tokenEndpoint,
    });
  } catch (error) {
    console.error('Callback error:', error);
    return NextResponse.json(
      { error: 'Failed to handle callback' },
      { status: 500 }
    );
  }
}

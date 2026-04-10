/**
 * API Route: /api/token/access-token
 *
 * Exchange ID-JAG for MCP access token using Okta custom authorization server
 *
 * OAUTH CLIENT: AGENT OAuth Client (for consistency with ID-JAG exchange)
 * AUTHORIZATION SERVER: CUSTOM auth server (/oauth2/{serverId}/v1/token)
 *
 * CLIENT AUTHENTICATION: private_key_jwt (signed client assertion)
 * - NO client secret required
 * - Uses same AGENT client as ID-JAG exchange
 * - client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
 * - client_assertion=<signed_jwt>
 *
 * GRANT TYPE: JWT Bearer (urn:ietf:params:oauth:grant-type:jwt-bearer)
 * - The ID-JAG serves as the bearer assertion
 * - Scopes are inherited from the ID-JAG
 * - No new scopes requested in this step
 *
 * SCOPES:
 * - The MCP access token inherits scopes from ID-JAG ONLY:
 *   - oktaScopes.mcpResource (governance:mcp)
 *
 * This is the final token exchange step. The resulting MCP access token is used
 * to authenticate with the MCP server.
 *
 * Note: The ORG access token (from login) contains oktaScopes.endUserApi and is
 * used separately for end-user Okta Governance API calls.
 *
 * Flow:
 * 1. Retrieve ID-JAG from session (server-side only)
 * 2. Build signed client assertion JWT using AGENT private key
 * 3. POST to CUSTOM auth server token endpoint: https://{domain}/oauth2/{serverId}/v1/token
 *    - grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
 *    - assertion=<id_jag>
 *    - client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
 *    - client_assertion=<signed_jwt>
 * 4. Receive MCP access token in response (inherits mcpResource scope from ID-JAG)
 * 5. Store MCP access token in session
 * 6. Return success response with metadata
 *
 * Note: Uses AGENT client authentication for consistency and security (private_key_jwt).
 * The MCP access token contains the mcpResource scope inherited from the ID-JAG.
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { buildAgentClientAssertion } from '@/lib/agent-client-assertion';
import { getSession } from '@/lib/session';
import { decodeJwt } from 'jose';

interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

interface OktaErrorResponse {
  error: string;
  error_description?: string;
}

export async function POST(request: NextRequest) {
  try {
    console.log('[Access Token Exchange] Starting JWT bearer exchange with AGENT client authentication');

    // 1. Get ID-JAG from session (server-side only)
    const session = await getSession();

    if (!session.idJag) {
      console.error('[Access Token Exchange] No ID-JAG found in session');
      return NextResponse.json(
        {
          error: 'ID-JAG not available',
          message: 'No ID-JAG found in session. Please exchange ID token for ID-JAG first.',
        },
        { status: 401 }
      );
    }

    if (!session.userId) {
      console.error('[Access Token Exchange] No user ID found in session');
      return NextResponse.json(
        {
          error: 'Invalid session',
          message: 'User ID not found in session.',
        },
        { status: 401 }
      );
    }

    const idJag = session.idJag;
    const userId = session.userId;

    console.log('[Access Token Exchange] Retrieved ID-JAG from session for user:', userId);

    // 2. Build signed client assertion for AGENT client
    const clientAssertion = await buildAgentClientAssertion({
      audience: config.okta.customAuthServer.tokenEndpoint,
    });

    console.log('[Access Token Exchange] Client assertion generated successfully');

    // 3. Prepare JWT bearer grant request with client assertion
    const tokenEndpoint = config.okta.customAuthServer.tokenEndpoint;
    const requestBody = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: idJag,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion,
    });

    console.log('[Access Token Exchange] Calling CUSTOM auth server:', tokenEndpoint);

    // 4. Make JWT bearer grant request
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
      console.error('[Access Token Exchange] Okta error:', {
        status: response.status,
        error: errorData.error,
        description: errorData.error_description,
      });

      return NextResponse.json(
        {
          error: 'Access token exchange failed',
          okta_error: errorData.error,
          okta_error_description: errorData.error_description,
          status: response.status,
        },
        { status: response.status }
      );
    }

    // Parse success response
    const tokenResponse: AccessTokenResponse = await response.json();

    console.log('[Access Token Exchange] Token exchange successful', {
      token_type: tokenResponse.token_type,
      expires_in: tokenResponse.expires_in,
      scope: tokenResponse.scope,
    });

    // 5. Decode MCP access token metadata (without verification, for response only)
    const mcpAccessToken = tokenResponse.access_token;
    const decoded = decodeJwt(mcpAccessToken);

    // 6. Validate scope includes governance:mcp
    const scope = tokenResponse.scope || '';
    if (!scope.includes('governance:mcp')) {
      console.error('[Access Token Exchange] MCP scope not found in access token');
      return NextResponse.json(
        {
          error: 'Invalid token scope',
          message: 'MCP access token does not contain required governance:mcp scope',
        },
        { status: 500 }
      );
    }

    // 7. Store MCP access token in session
    session.mcpAccessToken = mcpAccessToken;

    // Store expiration time if available
    if (decoded.exp) {
      session.mcpAccessTokenExpiresAt = decoded.exp as number;
    }

    await session.save();

    console.log('[Access Token Exchange] MCP access token stored in session');

    // 8. Return success with metadata (NOT full token)
    const claims: Record<string, unknown> = {
      iss: decoded.iss,
      sub: decoded.sub,
      aud: decoded.aud,
      exp: decoded.exp,
      iat: decoded.iat,
    };

    // Include scope claim if present
    if (decoded.scp) {
      claims.scp = decoded.scp;
    }

    return NextResponse.json({
      success: true,
      message: 'MCP access token exchange successful',
      metadata: {
        token_type: tokenResponse.token_type,
        expires_in: tokenResponse.expires_in,
        scope: tokenResponse.scope,
        claims,
      },
      next_step: 'Use MCP access token to call MCP server',
    });
  } catch (error) {
    console.error('[Access Token Exchange] Error:', error);

    // Log error without exposing sensitive data
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        error: 'Failed to exchange ID-JAG for MCP access token',
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}

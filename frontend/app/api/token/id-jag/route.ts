/**
 * API Route: /api/token/id-jag
 *
 * Exchange ID token for ID-JAG using Okta token exchange
 *
 * AUTHENTICATION: AGENT Principal (NOT the USER OAuth client)
 * AUTHORIZATION SERVER: ORG auth server (/oauth2/v1/token)
 *
 * NOTE: User login uses USER OAuth client + PKCE
 *       Token exchange uses AGENT Principal + private_key_jwt
 *
 * SCOPES REQUESTED (from lib/okta-scopes.ts):
 * - oktaScopes.mcpResource (MCP resource scope):
 *   - governance:mcp
 *
 * CRITICAL: Scopes in ID-JAG come ONLY from the scope parameter
 * - ID tokens carry identity, NOT scopes
 * - The ID-JAG receives ONLY the scopes explicitly requested here
 * - NO scope inheritance from ID token occurs
 *
 * This scope grants the AI agent access to the MCP server on behalf of the user.
 *
 * CLIENT AUTHENTICATION: private_key_jwt (signed client assertion)
 * - NO client secret required
 * - Must build signed JWT using AGENT private key
 * - client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
 * - client_assertion=<signed_jwt>
 *
 * Client Assertion JWT Claims:
 * - iss: AGENT principal ID (config.okta.agent.principalId)
 * - sub: AGENT principal ID (same as iss)
 * - aud: Okta token endpoint (config.okta.orgAuthServer.tokenEndpoint)
 * - iat: Current timestamp
 * - exp: iat + 60 (60 seconds)
 * - jti: Unique JWT ID (random UUID)
 *
 * Client Assertion JWT Header:
 * - alg: RS256
 * - kid: Agent key ID (config.okta.agent.keyId)
 *
 * Flow:
 * 1. Retrieve ID token from session (server-side only)
 * 2. Build signed client assertion JWT using lib/agent-client-assertion.ts:
 *    - buildAgentClientAssertion({ audience: orgAuthServer.tokenEndpoint })
 *    - Returns signed JWT with:
 *      - Header: { alg: "RS256", kid: "{agent_key_id}" }
 *      - Claims: { iss, sub, aud, iat, exp, jti }
 * 3. POST to ORG token endpoint (config.okta.orgAuthServer.tokenEndpoint)
 *    Request body parameters (matching working Postman contract):
 *    - grant_type=urn:ietf:params:oauth:grant-type:token-exchange
 *    - requested_token_type=urn:ietf:params:oauth:token-type:id-jag
 *    - subject_token=<id_token> (from session)
 *    - subject_token_type=urn:ietf:params:oauth:token-type:id_token
 *    - client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
 *    - client_assertion=<signed_jwt> (iss/sub=agent principal, aud=ORG token endpoint)
 *    - audience=<custom_auth_server_audience> (config.okta.customAuthServer.audience)
 *    - scope=governance:mcp (oktaScopes.mcpResource from lib/okta-scopes.ts)
 * 4. Receive ID-JAG in response (contains ONLY mcpResource scope)
 * 5. Store ID-JAG in session
 * 6. Return success response with metadata
 *
 * Note: This uses the AGENT principal to exchange the user's ID token for an ID-JAG.
 * The ID-JAG scope comes ONLY from the scope parameter, not from the ID token.
 * User login is handled separately using USER OAuth client + PKCE.
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { oktaScopes } from '@/lib/okta-scopes';
import { buildAgentClientAssertion } from '@/lib/agent-client-assertion';
import { getSession } from '@/lib/session';
import { decodeJwt } from 'jose';

interface TokenExchangeResponse {
  access_token: string;
  issued_token_type: string;
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
    console.log('[ID-JAG Exchange] Starting token exchange with AGENT client authentication');

    // 1. Get ID token from session (server-side only)
    const session = await getSession();

    if (!session.idToken) {
      console.error('[ID-JAG Exchange] No ID token found in session');
      return NextResponse.json(
        {
          error: 'Not authenticated',
          message: 'No ID token found in session. Please log in first.',
        },
        { status: 401 }
      );
    }

    if (!session.userId) {
      console.error('[ID-JAG Exchange] No user ID found in session');
      return NextResponse.json(
        {
          error: 'Invalid session',
          message: 'User ID not found in session.',
        },
        { status: 401 }
      );
    }

    const idToken = session.idToken;
    const userId = session.userId;

    console.log('[ID-JAG Exchange] Retrieved ID token from session for user:', userId);

    // 2. Build signed client assertion
    const clientAssertion = await buildAgentClientAssertion({
      audience: config.okta.orgAuthServer.tokenEndpoint,
    });

    console.log('[ID-JAG Exchange] Client assertion generated successfully');

    // 3. Prepare token exchange request
    const tokenEndpoint = config.okta.orgAuthServer.tokenEndpoint;
    const requestBody = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
      subject_token: idToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion,
      audience: config.okta.customAuthServer.audience, // Custom auth server base URL
      // MCP resource scope - ONLY scope requested for ID-JAG
      // ID token carries identity only, this scope is explicitly added here
      scope: oktaScopes.mcpResource.join(' '), // governance:mcp
    });

    console.log('[ID-JAG Exchange] Calling Okta token endpoint:', tokenEndpoint);

    // 4. Make token exchange request
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
      // Read response as text first to capture raw error
      const responseText = await response.text();

      console.error('[ID-JAG Exchange] Okta error response:', {
        status: response.status,
        statusText: response.statusText,
        rawResponse: responseText.substring(0, 500), // Log first 500 chars for safety
      });

      // Try to parse as JSON
      let errorData: OktaErrorResponse | null = null;
      let parseError: string | null = null;

      try {
        errorData = JSON.parse(responseText);
      } catch (e) {
        parseError = 'Failed to parse error response as JSON';
        console.error('[ID-JAG Exchange] JSON parse error:', e);
      }

      // Return detailed error information
      return NextResponse.json(
        {
          error: 'Token exchange failed',
          status: response.status,
          statusText: response.statusText,
          okta_error: errorData?.error || 'unknown',
          okta_error_description: errorData?.error_description || responseText.substring(0, 200),
          debug: {
            parseError,
            responsePreview: responseText.substring(0, 200),
            endpoint: tokenEndpoint,
          },
        },
        { status: response.status }
      );
    }

    // Parse success response
    const tokenResponse: TokenExchangeResponse = await response.json();

    console.log('[ID-JAG Exchange] Token exchange successful', {
      issued_token_type: tokenResponse.issued_token_type,
      token_type: tokenResponse.token_type,
      expires_in: tokenResponse.expires_in,
      scope: tokenResponse.scope,
    });

    // 5. Decode ID-JAG metadata (without verification, for response only)
    const idJagToken = tokenResponse.access_token;
    const decoded = decodeJwt(idJagToken);

    // 6. Store ID-JAG in session and remove ID token (no longer needed)
    // COOKIE SIZE OPTIMIZATION: ID token is only needed for this exchange
    session.idJag = idJagToken;

    // Store expiration time if available
    if (decoded.exp) {
      session.idJagExpiresAt = decoded.exp as number;
    }

    // Remove ID token from session - no longer needed after ID-JAG exchange
    session.idToken = undefined;
    session.idTokenExpiresAt = undefined;

    await session.save();

    console.log('[ID-JAG Exchange] ID-JAG stored, ID token removed from session');

    // 7. Return success with metadata (NOT full token)
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
      message: 'ID-JAG exchange successful',
      metadata: {
        issued_token_type: tokenResponse.issued_token_type,
        token_type: tokenResponse.token_type,
        expires_in: tokenResponse.expires_in,
        scope: tokenResponse.scope,
        claims,
      },
      next_step: 'Use ID-JAG for MCP access token exchange',
    });
  } catch (error) {
    console.error('[ID-JAG Exchange] Error:', error);

    // Log error without exposing sensitive data
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        error: 'Failed to exchange ID token for ID-JAG',
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}

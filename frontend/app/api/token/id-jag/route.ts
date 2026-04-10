/**
 * API Route: /api/token/id-jag
 *
 * Exchange ID token for ID-JAG using Okta token exchange
 *
 * OAUTH CLIENT: AGENT OAuth Client (NOT the USER client)
 * AUTHORIZATION SERVER: ORG auth server (/oauth2/v1/token)
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
 * - iss: AGENT client ID (config.okta.agent.clientId)
 * - sub: AGENT client ID (same as iss)
 * - aud: Okta token endpoint (config.okta.orgAuthServer.tokenEndpoint)
 * - iat: Current timestamp
 * - exp: iat + 300 (5 minutes)
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
 * 3. POST to ORG token endpoint: https://{domain}/oauth2/v1/token
 *    - grant_type=urn:ietf:params:oauth:grant-type:token-exchange
 *    - subject_token=<id_token> (identity from USER client)
 *    - subject_token_type=urn:ietf:params:oauth:token-type:id_token
 *    - requested_token_type=urn:ietf:params:oauth:token-type:id-jag
 *    - audience=<custom_auth_server_issuer>
 *    - scope=oktaScopes.mcpResource.join(' ') (governance:mcp - EXPLICITLY requested)
 *    - client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
 *    - client_assertion=<signed_jwt> (signed with AGENT key)
 * 4. Receive ID-JAG in response (contains ONLY mcpResource scope)
 * 5. Store ID-JAG in session
 * 6. Return success response with metadata
 *
 * Note: This uses the AGENT client to exchange the user's ID token for an ID-JAG.
 * The ID-JAG scope comes ONLY from the scope parameter, not from the ID token.
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
      audience: config.okta.customAuthServer.issuer, // Custom auth server issuer
      scope: oktaScopes.mcpResource.join(' '), // governance:mcp
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion,
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
      const errorData: OktaErrorResponse = await response.json();
      console.error('[ID-JAG Exchange] Okta error:', {
        status: response.status,
        error: errorData.error,
        description: errorData.error_description,
      });

      return NextResponse.json(
        {
          error: 'Token exchange failed',
          okta_error: errorData.error,
          okta_error_description: errorData.error_description,
          status: response.status,
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

    // 6. Store ID-JAG in session
    session.idJag = idJagToken;

    // Store expiration time if available
    if (decoded.exp) {
      session.idJagExpiresAt = decoded.exp as number;
    }

    await session.save();

    console.log('[ID-JAG Exchange] ID-JAG stored in session');

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

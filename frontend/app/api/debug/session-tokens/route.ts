/**
 * API Route: /api/debug/session-tokens
 *
 * Debug endpoint to inspect session tokens
 *
 * SECURITY WARNING:
 * - This endpoint is for LOCAL TESTING ONLY
 * - Never enable DEBUG_EXPOSE_TOKENS in production
 * - Raw tokens are only returned if DEBUG_EXPOSE_TOKENS=true
 * - Decoded payloads are always returned for debugging
 *
 * Response:
 * {
 *   debugMode: boolean,
 *   hasIdToken: boolean,
 *   hasIdJag: boolean,
 *   hasMcpAccessToken: boolean,
 *   tokens: {
 *     idToken?: { raw?: string, decoded: object },
 *     idJag?: { raw?: string, decoded: object },
 *     mcpAccessToken?: { raw?: string, decoded: object }
 *   }
 * }
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { config } from '@/lib/config';
import { decodeJwt } from 'jose';

export async function GET() {
  try {
    const session = await getSession();
    const debugMode = config.debug.exposeTokens;

    // Helper to safely decode JWT
    const decodeToken = (token: string | undefined) => {
      if (!token) return null;
      try {
        return decodeJwt(token);
      } catch (error) {
        return { error: 'Failed to decode token' };
      }
    };

    // Build response with decoded payloads (always)
    // and raw tokens (only if debug mode enabled)
    const response: any = {
      debugMode,
      warning: debugMode
        ? 'DEBUG MODE ENABLED - Raw tokens exposed (LOCAL USE ONLY)'
        : 'Debug mode disabled - raw tokens hidden',
      hasIdToken: !!session.idToken,
      hasIdJag: !!session.idJag,
      hasMcpAccessToken: !!session.mcpAccessToken,
      tokens: {},
    };

    // ID Token
    if (session.idToken) {
      response.tokens.idToken = {
        decoded: decodeToken(session.idToken),
      };
      if (debugMode) {
        response.tokens.idToken.raw = session.idToken;
      }
    }

    // ID-JAG
    if (session.idJag) {
      response.tokens.idJag = {
        decoded: decodeToken(session.idJag),
      };
      if (debugMode) {
        response.tokens.idJag.raw = session.idJag;
      }
    }

    // MCP Access Token
    if (session.mcpAccessToken) {
      response.tokens.mcpAccessToken = {
        decoded: decodeToken(session.mcpAccessToken),
      };
      if (debugMode) {
        response.tokens.mcpAccessToken.raw = session.mcpAccessToken;
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Debug Session Tokens] Error:', error);

    return NextResponse.json(
      {
        error: 'Failed to fetch session tokens',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

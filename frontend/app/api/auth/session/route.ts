/**
 * API Route: /api/auth/session
 *
 * Returns current session status and token availability
 *
 * SECURITY:
 * - Only returns metadata (no raw tokens)
 * - Returns boolean flags for token existence
 * - Safe for client consumption
 *
 * Response:
 * {
 *   authenticated: boolean,
 *   userId?: string,
 *   userEmail?: string,
 *   hasIdToken: boolean,
 *   hasIdJag: boolean,
 *   hasMcpAccessToken: boolean
 * }
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getUserAccessToken, getMcpAccessToken } from '@/lib/token-cookies';

export async function GET() {
  try {
    const session = await getSession();
    const userAccessToken = await getUserAccessToken();
    const mcpAccessToken = await getMcpAccessToken();

    // Check if user is authenticated
    // User is authenticated if they have a userId (persisted identity field)
    // Note: Individual tokens (idToken, idJag) may be removed after progressive cleanup
    // to reduce cookie size, but userId persists throughout the session
    const authenticated = !!session.userId;

    // Build safe response with metadata only
    // Note: Access tokens are now stored in separate cookies, not in session
    const response = {
      authenticated,
      userId: session.userId || undefined,
      userEmail: session.userEmail || undefined,
      hasIdToken: !!session.idToken,
      hasIdJag: !!session.idJag,
      hasUserAccessToken: !!userAccessToken,
      hasMcpAccessToken: !!mcpAccessToken,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Session Status] Error:', error);

    // Return unauthenticated state on error
    return NextResponse.json({
      authenticated: false,
      hasIdToken: false,
      hasIdJag: false,
      hasUserAccessToken: false,
      hasMcpAccessToken: false,
    });
  }
}

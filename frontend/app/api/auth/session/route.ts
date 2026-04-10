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

export async function GET() {
  try {
    const session = await getSession();

    // Check if user is authenticated (has ID token and user ID)
    const authenticated = !!(session.idToken && session.userId);

    // Build safe response with metadata only
    const response = {
      authenticated,
      userId: session.userId || undefined,
      userEmail: session.userEmail || undefined,
      hasIdToken: !!session.idToken,
      hasIdJag: !!session.idJag,
      hasMcpAccessToken: !!session.mcpAccessToken,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Session Status] Error:', error);

    // Return unauthenticated state on error
    return NextResponse.json({
      authenticated: false,
      hasIdToken: false,
      hasIdJag: false,
      hasMcpAccessToken: false,
    });
  }
}

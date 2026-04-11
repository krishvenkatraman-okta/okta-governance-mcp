/**
 * API Route: /api/auth/logout
 *
 * Handles user logout by destroying the iron-session session completely
 *
 * Flow:
 * 1. Retrieve current session
 * 2. Destroy session (clears all data and removes cookie)
 * 3. Redirect to /agent page
 *
 * This ensures a completely clean slate for next login attempt.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function GET() {
  try {
    console.log('[Logout] Starting logout process');

    // 1. Get session and destroy it completely
    const session = await getSession();
    session.destroy();

    console.log('[Logout] Session destroyed successfully');

    // 2. Redirect to /agent page
    return NextResponse.redirect(new URL('/agent', process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'));
  } catch (error) {
    console.error('[Logout] Error:', error);

    // Even on error, try to redirect to agent page
    return NextResponse.redirect(new URL('/agent', process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'));
  }
}

/**
 * Session management utilities using iron-session
 *
 * Provides secure, encrypted session storage for tokens and PKCE state.
 * Server-side only - never exposes sensitive data to browser.
 */

import { getIronSession, IronSession } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  // PKCE state
  codeVerifier?: string;
  state?: string;

  // Tokens
  idToken?: string;
  orgAccessToken?: string;
  idJag?: string;
  mcpAccessToken?: string;

  // Token metadata
  idTokenExpiresAt?: number;
  idJagExpiresAt?: number;
  mcpAccessTokenExpiresAt?: number;

  // User info
  userId?: string;
  userEmail?: string;
}

const sessionOptions = {
  password: process.env.SESSION_SECRET || 'complex_password_at_least_32_characters_long_for_dev',
  cookieName: 'okta_governance_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: 3600, // 1 hour
    path: '/',
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export async function clearSession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}

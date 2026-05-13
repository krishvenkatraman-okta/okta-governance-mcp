/**
 * Get the user's Okta access token from the next-auth JWT cookie.
 * Uses getToken from next-auth/jwt which is more reliable in App Router
 * than getServerSession.
 */

import { getToken } from 'next-auth/jwt';
import { NextRequest } from 'next/server';

export async function getAccessToken(request: NextRequest): Promise<string | null> {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  return (token?.accessToken as string) || null;
}

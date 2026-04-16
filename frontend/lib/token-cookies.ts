/**
 * Token Cookie Management
 *
 * Stores JWT tokens in separate HTTP-only cookies to avoid bloating the iron-session.
 * This frees up ~2,360 bytes in the session cookie for workflow data.
 */

import { cookies } from 'next/headers';

const TOKEN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 3600, // 1 hour (matches session lifetime)
};

const COOKIE_NAMES = {
  USER_ACCESS_TOKEN: 'okta_user_access_token',
  USER_ACCESS_TOKEN_EXPIRES: 'okta_user_access_token_exp',
  MCP_ACCESS_TOKEN: 'okta_mcp_access_token',
  MCP_ACCESS_TOKEN_EXPIRES: 'okta_mcp_access_token_exp',
};

/**
 * Set user access token (for end-user governance APIs)
 */
export async function setUserAccessToken(token: string, expiresAt?: number) {
  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAMES.USER_ACCESS_TOKEN, token, TOKEN_COOKIE_OPTIONS);

  if (expiresAt) {
    cookieStore.set(
      COOKIE_NAMES.USER_ACCESS_TOKEN_EXPIRES,
      expiresAt.toString(),
      TOKEN_COOKIE_OPTIONS
    );
  }
}

/**
 * Get user access token
 */
export async function getUserAccessToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAMES.USER_ACCESS_TOKEN)?.value;
}

/**
 * Get user access token expiration timestamp
 */
export async function getUserAccessTokenExpiresAt(): Promise<number | undefined> {
  const cookieStore = await cookies();
  const expires = cookieStore.get(COOKIE_NAMES.USER_ACCESS_TOKEN_EXPIRES)?.value;
  return expires ? parseInt(expires, 10) : undefined;
}

/**
 * Set MCP access token (for MCP server calls)
 */
export async function setMcpAccessToken(token: string, expiresAt?: number) {
  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAMES.MCP_ACCESS_TOKEN, token, TOKEN_COOKIE_OPTIONS);

  if (expiresAt) {
    cookieStore.set(
      COOKIE_NAMES.MCP_ACCESS_TOKEN_EXPIRES,
      expiresAt.toString(),
      TOKEN_COOKIE_OPTIONS
    );
  }
}

/**
 * Get MCP access token
 */
export async function getMcpAccessToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAMES.MCP_ACCESS_TOKEN)?.value;
}

/**
 * Get MCP access token expiration timestamp
 */
export async function getMcpAccessTokenExpiresAt(): Promise<number | undefined> {
  const cookieStore = await cookies();
  const expires = cookieStore.get(COOKIE_NAMES.MCP_ACCESS_TOKEN_EXPIRES)?.value;
  return expires ? parseInt(expires, 10) : undefined;
}

/**
 * Clear user access token
 */
export async function clearUserAccessToken() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAMES.USER_ACCESS_TOKEN);
  cookieStore.delete(COOKIE_NAMES.USER_ACCESS_TOKEN_EXPIRES);
}

/**
 * Clear MCP access token
 */
export async function clearMcpAccessToken() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAMES.MCP_ACCESS_TOKEN);
  cookieStore.delete(COOKIE_NAMES.MCP_ACCESS_TOKEN_EXPIRES);
}

/**
 * Clear all token cookies
 */
export async function clearAllTokens() {
  await clearUserAccessToken();
  await clearMcpAccessToken();
}

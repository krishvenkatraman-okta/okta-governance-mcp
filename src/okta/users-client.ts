/**
 * Okta Users API client
 *
 * Provides user lookup and search functionality for the MCP server.
 * Used to resolve usernames/emails to Okta user GUIDs.
 */

import { config } from '../config/index.js';
import { getServiceAccessToken } from './service-client.js';
import type { OktaGroup } from '../types/index.js';

/**
 * Extract the `next` page URL from an Okta Link header.
 *
 * Okta uses RFC 5988 Link headers for cursor-based pagination.
 */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

export interface OktaUser {
  id: string;
  status: string;
  created: string;
  activated: string | null;
  statusChanged: string | null;
  lastLogin: string | null;
  lastUpdated: string;
  passwordChanged: string | null;
  profile: {
    firstName: string;
    lastName: string;
    email: string;
    login: string;
    mobilePhone: string | null;
  };
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<OktaUser | null> {
  try {
    const accessToken = await getServiceAccessToken('okta.users.read');
    const url = `https://${config.okta.domain}/api/v1/users/${userId}`;

    console.log(`[UsersClient] Fetching user: ${userId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[UsersClient] User not found: ${userId}`);
        return null;
      }
      const errorText = await response.text();
      console.error(`[UsersClient] Failed to get user:`, {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const user = (await response.json()) as OktaUser;
    console.log(`[UsersClient] Found user: ${user.profile.email}`);
    return user;
  } catch (error: any) {
    console.error(`[UsersClient] Error getting user:`, error.message);
    return null;
  }
}

/**
 * Find user by username or email
 *
 * Uses Okta Users API search/list with filter parameter.
 * Searches by login (username) or email.
 *
 * @param usernameOrEmail - Username or email address to search for
 * @returns Okta user object if found, null otherwise
 */
export async function findUserByUsernameOrEmail(
  usernameOrEmail: string
): Promise<OktaUser | null> {
  try {
    const accessToken = await getServiceAccessToken('okta.users.read');
    const normalizedQuery = usernameOrEmail.trim();

    // Try exact match on login first
    let url = `https://${config.okta.domain}/api/v1/users?filter=profile.login eq "${normalizedQuery}"&limit=1`;

    console.log(`[UsersClient] Searching for user by login: ${normalizedQuery}`);

    let response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[UsersClient] Failed to search users:`, {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    let users = (await response.json()) as OktaUser[];

    if (users.length > 0) {
      console.log(`[UsersClient] Found user by login: ${users[0].profile.email} (${users[0].id})`);
      return users[0];
    }

    // Try exact match on email
    url = `https://${config.okta.domain}/api/v1/users?filter=profile.email eq "${normalizedQuery}"&limit=1`;

    console.log(`[UsersClient] Searching for user by email: ${normalizedQuery}`);

    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[UsersClient] Failed to search users by email:`, {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    users = (await response.json()) as OktaUser[];

    if (users.length > 0) {
      console.log(`[UsersClient] Found user by email: ${users[0].profile.email} (${users[0].id})`);
      return users[0];
    }

    console.log(`[UsersClient] User not found: ${normalizedQuery}`);
    return null;
  } catch (error: any) {
    console.error(`[UsersClient] Error finding user:`, error.message);
    return null;
  }
}

/**
 * Get user by ID or login
 *
 * First tries to get by ID, then falls back to searching by username/email
 *
 * @param userIdOrLogin - User ID or login/email
 * @returns Okta user object if found, throws error otherwise
 */
export async function getByIdOrLogin(userIdOrLogin: string): Promise<OktaUser> {
  // Try by ID first (if it looks like a user ID)
  if (userIdOrLogin.match(/^00u[a-zA-Z0-9]+$/)) {
    const user = await getUserById(userIdOrLogin);
    if (user) {
      return user;
    }
  }

  // Fall back to search by username/email
  const user = await findUserByUsernameOrEmail(userIdOrLogin);
  if (user) {
    return user;
  }

  throw new Error(`User not found: ${userIdOrLogin}`);
}

/**
 * List users matching an Okta SCIM filter.
 *
 * Calls `GET /api/v1/users?filter=...` and walks `Link: rel="next"`
 * pagination until exhausted (capped at `maxPages`).
 *
 * @param filter - Okta filter expression, e.g.
 *   `profile.department eq "Sales"` or `status eq "ACTIVE"`
 * @param pageSize - Per-page limit (default 200, Okta max)
 * @param maxPages - Page-walk cap (default 25)
 * @returns All users matching the filter
 *
 * @example
 * ```typescript
 * const sales = await usersClient.listWithFilter('profile.department eq "Sales"');
 * const active = await usersClient.listWithFilter('status eq "ACTIVE"');
 * ```
 */
export async function listWithFilter(
  filter: string,
  pageSize: number = 200,
  maxPages: number = 25
): Promise<OktaUser[]> {
  const accessToken = await getServiceAccessToken('okta.users.read');
  const encoded = encodeURIComponent(filter);

  let url: string | null = `https://${config.okta.domain}/api/v1/users?filter=${encoded}&limit=${pageSize}`;
  const collected: OktaUser[] = [];
  let pages = 0;

  console.log(`[UsersClient] Listing users with filter: ${filter}`);

  while (url && pages < maxPages) {
    const response: Response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[UsersClient] Failed to list users with filter:', {
        filter,
        status: response.status,
        error: errorText,
      });
      throw new Error(`Failed to list users with filter: ${response.status} ${response.statusText}`);
    }

    const page = (await response.json()) as OktaUser[];
    collected.push(...page);
    pages++;

    url = parseNextLink(response.headers.get('link'));
  }

  if (url && pages >= maxPages) {
    console.warn('[UsersClient] listWithFilter hit maxPages cap:', {
      filter,
      maxPages,
      collected: collected.length,
    });
  }

  console.log(`[UsersClient] Retrieved ${collected.length} user(s) for filter "${filter}" across ${pages} page(s)`);

  return collected;
}

/**
 * List the groups a user belongs to.
 *
 * Calls `GET /api/v1/users/{userId}/groups`. Pagination follows
 * Okta's Link-header convention.
 *
 * @param userId - User ID
 * @param pageSize - Per-page limit (default 200)
 * @param maxPages - Page-walk cap (default 10)
 * @returns Groups the user is a member of
 */
export async function listGroups(
  userId: string,
  pageSize: number = 200,
  maxPages: number = 10
): Promise<OktaGroup[]> {
  const accessToken = await getServiceAccessToken(['okta.users.read', 'okta.groups.read']);

  let url: string | null = `https://${config.okta.domain}/api/v1/users/${userId}/groups?limit=${pageSize}`;
  const collected: OktaGroup[] = [];
  let pages = 0;

  console.debug('[UsersClient] Listing groups for user:', { userId });

  while (url && pages < maxPages) {
    const response: Response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[UsersClient] Failed to list user groups:', {
        userId,
        status: response.status,
        error: errorText,
      });
      throw new Error(`Failed to list user groups: ${response.status} ${response.statusText}`);
    }

    const page = (await response.json()) as OktaGroup[];
    collected.push(...page);
    pages++;

    url = parseNextLink(response.headers.get('link'));
  }

  if (url && pages >= maxPages) {
    console.warn('[UsersClient] listGroups hit maxPages cap:', {
      userId,
      maxPages,
      collected: collected.length,
    });
  }

  console.debug(`[UsersClient] Retrieved ${collected.length} group(s) for user ${userId}`);

  return collected;
}

/**
 * Users API client
 */
export const usersClient = {
  getUserById,
  findUserByUsernameOrEmail,
  getByIdOrLogin,
  listWithFilter,
  listGroups,
};

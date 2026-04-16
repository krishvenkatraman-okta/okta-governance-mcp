/**
 * Okta Users API client
 *
 * Provides user lookup and search functionality for the MCP server.
 * Used to resolve usernames/emails to Okta user GUIDs.
 */

import { config } from '../config/index.js';
import { getServiceAccessToken } from './service-client.js';

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

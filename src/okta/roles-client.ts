/**
 * Okta Roles API client
 *
 * Provides methods for fetching user admin roles and role targets
 * from Okta's Admin Roles API.
 */

import { getServiceAccessToken } from './service-client.js';
import { config } from '../config/index.js';
import type { OktaRole, OktaApp, OktaGroup } from '../types/index.js';

/**
 * List roles assigned to a user
 *
 * Fetches all admin role assignments for a user.
 *
 * @param userId - Okta user ID
 * @returns Array of role assignments
 *
 * @throws Error if API call fails
 */
async function listUserRoles(userId: string): Promise<OktaRole[]> {
  console.debug('[RolesClient] Fetching roles for user:', userId);

  try {
    // Get service access token with required scopes
    const accessToken = await getServiceAccessToken(['okta.users.read', 'okta.roles.read']);

    const url = `${config.okta.apiV1}/users/${userId}/roles`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[RolesClient] Failed to list user roles:', {
        userId,
        status: response.status,
        error: errorText,
      });

      // Handle specific error cases
      if (response.status === 404) {
        // User not found - return empty array
        console.warn('[RolesClient] User not found, returning empty roles');
        return [];
      }

      if (response.status === 403) {
        // Forbidden - service app lacks permissions
        console.error('[RolesClient] Insufficient permissions to list user roles');
        throw new Error('Insufficient permissions to list user roles');
      }

      throw new Error(`Failed to list user roles: ${response.status} ${response.statusText}`);
    }

    const roles = (await response.json()) as OktaRole[];

    console.debug('[RolesClient] Retrieved roles:', {
      userId,
      count: roles.length,
      types: roles.map((r) => r.type),
    });

    return roles;
  } catch (error) {
    console.error('[RolesClient] Error listing user roles:', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * List app targets for an APP_ADMIN role
 *
 * Fetches the list of applications that an APP_ADMIN role can manage.
 *
 * @param userId - Okta user ID
 * @param roleId - Role assignment ID
 * @returns Array of app IDs
 *
 * @throws Error if API call fails
 */
async function listAppTargets(userId: string, roleId: string): Promise<string[]> {
  console.debug('[RolesClient] Fetching app targets:', { userId, roleId });

  try {
    // Get service access token with required scopes
    const accessToken = await getServiceAccessToken(['okta.users.read', 'okta.roles.read']);

    const url = `${config.okta.apiV1}/users/${userId}/roles/${roleId}/targets/catalog/apps`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[RolesClient] Failed to list app targets:', {
        userId,
        roleId,
        status: response.status,
        error: errorText,
      });

      // Handle specific error cases
      if (response.status === 404) {
        // Role or user not found - return empty array
        console.warn('[RolesClient] Role not found, returning empty app targets');
        return [];
      }

      // For other errors, log but return empty to allow graceful degradation
      console.warn('[RolesClient] Failed to fetch app targets, returning empty array');
      return [];
    }

    const apps = (await response.json()) as OktaApp[];
    const appIds = apps.map((app) => app.id);

    console.debug('[RolesClient] Retrieved app targets:', {
      userId,
      roleId,
      count: appIds.length,
      appIds: appIds.slice(0, 5), // Log first 5
    });

    return appIds;
  } catch (error) {
    console.error('[RolesClient] Error listing app targets:', {
      userId,
      roleId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Return empty array to allow graceful degradation
    console.warn('[RolesClient] Returning empty app targets due to error');
    return [];
  }
}

/**
 * List group targets for a GROUP_ADMIN role
 *
 * Fetches the list of groups that a GROUP_ADMIN role can manage.
 *
 * @param userId - Okta user ID
 * @param roleId - Role assignment ID
 * @returns Array of group IDs
 *
 * @throws Error if API call fails
 */
async function listGroupTargets(userId: string, roleId: string): Promise<string[]> {
  console.debug('[RolesClient] Fetching group targets:', { userId, roleId });

  try {
    // Get service access token with required scopes
    const accessToken = await getServiceAccessToken(['okta.users.read', 'okta.roles.read']);

    const url = `${config.okta.apiV1}/users/${userId}/roles/${roleId}/targets/groups`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[RolesClient] Failed to list group targets:', {
        userId,
        roleId,
        status: response.status,
        error: errorText,
      });

      // Handle specific error cases
      if (response.status === 404) {
        // Role or user not found - return empty array
        console.warn('[RolesClient] Role not found, returning empty group targets');
        return [];
      }

      // For other errors, log but return empty to allow graceful degradation
      console.warn('[RolesClient] Failed to fetch group targets, returning empty array');
      return [];
    }

    const groups = (await response.json()) as OktaGroup[];
    const groupIds = groups.map((group) => group.id);

    console.debug('[RolesClient] Retrieved group targets:', {
      userId,
      roleId,
      count: groupIds.length,
      groupIds: groupIds.slice(0, 5), // Log first 5
    });

    return groupIds;
  } catch (error) {
    console.error('[RolesClient] Error listing group targets:', {
      userId,
      roleId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Return empty array to allow graceful degradation
    console.warn('[RolesClient] Returning empty group targets due to error');
    return [];
  }
}

/**
 * List all targets (apps and groups) for a role
 *
 * Convenience method that fetches both app and group targets based on role type.
 *
 * @param userId - Okta user ID
 * @param roleId - Role assignment ID
 * @param roleType - Role type (APP_ADMIN, GROUP_ADMIN, etc.)
 * @returns Object with apps and groups arrays
 */
async function listRoleTargets(
  userId: string,
  roleId: string,
  roleType: string
): Promise<{ apps: string[]; groups: string[] }> {
  const targets = {
    apps: [] as string[],
    groups: [] as string[],
  };

  // Fetch app targets for APP_ADMIN
  if (roleType === 'APP_ADMIN') {
    targets.apps = await listAppTargets(userId, roleId);
  }

  // Fetch group targets for GROUP_ADMIN
  if (roleType === 'GROUP_ADMIN') {
    targets.groups = await listGroupTargets(userId, roleId);
  }

  return targets;
}

/**
 * Roles API client
 */
export const rolesClient = {
  listUserRoles,
  listAppTargets,
  listGroupTargets,
  listRoleTargets,
};

/**
 * Okta Groups API client
 *
 * Provides methods for group management operations
 */

import { getServiceAccessToken } from './service-client.js';
import { config } from '../config/index.js';
import type { OktaGroup, OktaUser } from '../types/index.js';

/**
 * Groups query options
 */
export interface GroupsQueryOptions {
  /**
   * Filter expression (SCIM filter syntax)
   */
  filter?: string;

  /**
   * Search query
   */
  q?: string;

  /**
   * Number of results per page
   */
  limit?: number;
}

/**
 * Groups API client
 */
export const groupsClient = {
  /**
   * List groups with optional filtering
   */
  async list(options: GroupsQueryOptions = {}): Promise<OktaGroup[]> {
    const accessToken = await getServiceAccessToken('okta.groups.read');

    // Build query parameters
    const params = new URLSearchParams();
    if (options.filter) {
      params.append('filter', options.filter);
    }
    if (options.q) {
      params.append('q', options.q);
    }
    if (options.limit) {
      params.append('limit', options.limit.toString());
    }

    const queryString = params.toString();
    const url = `${config.okta.apiV1}/groups${queryString ? `?${queryString}` : ''}`;

    console.debug('[GroupsClient] Listing groups:', { url, options });

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[GroupsClient] Failed to list groups:', {
        status: response.status,
        error,
      });
      throw new Error(`Failed to list groups: ${response.status} ${response.statusText}`);
    }

    const groups = await response.json() as OktaGroup[];
    console.debug(`[GroupsClient] Retrieved ${groups.length} groups`);

    return groups;
  },

  /**
   * Get group by ID
   */
  async getById(groupId: string): Promise<OktaGroup> {
    const accessToken = await getServiceAccessToken('okta.groups.read');
    const url = `${config.okta.apiV1}/groups/${groupId}`;

    console.debug('[GroupsClient] Getting group:', { groupId });

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[GroupsClient] Failed to get group:', {
        groupId,
        status: response.status,
        error,
      });
      throw new Error(`Failed to get group ${groupId}: ${response.status} ${response.statusText}`);
    }

    return await response.json() as OktaGroup;
  },

  /**
   * List members of a group
   */
  async listMembers(groupId: string, limit: number = 200): Promise<OktaUser[]> {
    const accessToken = await getServiceAccessToken(['okta.groups.read', 'okta.users.read']);
    const url = `${config.okta.apiV1}/groups/${groupId}/users?limit=${limit}`;

    console.debug('[GroupsClient] Listing group members:', { groupId, limit });

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[GroupsClient] Failed to list group members:', {
        groupId,
        status: response.status,
        error,
      });
      throw new Error(`Failed to list group members: ${response.status} ${response.statusText}`);
    }

    const members = await response.json() as OktaUser[];
    console.debug(`[GroupsClient] Retrieved ${members.length} members for group ${groupId}`);

    return members;
  },

  /**
   * Check if a user is a member of a group
   */
  async isMember(groupId: string, userId: string): Promise<boolean> {
    try {
      const accessToken = await getServiceAccessToken(['okta.groups.read', 'okta.users.read']);
      const url = `${config.okta.apiV1}/groups/${groupId}/users/${userId}`;

      console.debug('[GroupsClient] Checking group membership:', { groupId, userId });

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      if (response.status === 404) {
        // User is not a member
        return false;
      }

      if (!response.ok) {
        const error = await response.text();
        console.error('[GroupsClient] Failed to check group membership:', {
          groupId,
          userId,
          status: response.status,
          error,
        });
        throw new Error(`Failed to check membership: ${response.status} ${response.statusText}`);
      }

      // User is a member
      return true;
    } catch (error) {
      console.error('[GroupsClient] Error checking membership:', error);
      throw error;
    }
  },

  /**
   * Add a user to a group
   */
  async addMember(groupId: string, userId: string): Promise<void> {
    const accessToken = await getServiceAccessToken(['okta.groups.manage', 'okta.users.read']);
    const url = `${config.okta.apiV1}/groups/${groupId}/users/${userId}`;

    console.debug('[GroupsClient] Adding user to group:', { groupId, userId });

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[GroupsClient] Failed to add user to group:', {
        groupId,
        userId,
        status: response.status,
        error,
      });
      throw new Error(`Failed to add user to group: ${response.status} ${response.statusText}`);
    }

    console.log('[GroupsClient] Successfully added user to group:', { groupId, userId });
  },

  /**
   * Remove a user from a group
   */
  async removeMember(groupId: string, userId: string): Promise<void> {
    const accessToken = await getServiceAccessToken(['okta.groups.manage', 'okta.users.read']);
    const url = `${config.okta.apiV1}/groups/${groupId}/users/${userId}`;

    console.debug('[GroupsClient] Removing user from group:', { groupId, userId });

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[GroupsClient] Failed to remove user from group:', {
        groupId,
        userId,
        status: response.status,
        error,
      });
      throw new Error(`Failed to remove user from group: ${response.status} ${response.statusText}`);
    }

    console.log('[GroupsClient] Successfully removed user from group:', { groupId, userId });
  },

  /**
   * Filter groups by IDs
   */
  filterByIds(groups: OktaGroup[], groupIds: string[]): OktaGroup[] {
    const idSet = new Set(groupIds);
    return groups.filter((group) => idSet.has(group.id));
  },
};

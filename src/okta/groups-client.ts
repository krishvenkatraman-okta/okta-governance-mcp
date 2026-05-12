/**
 * Okta Groups API client
 *
 * Provides methods for group management operations
 */

import { getServiceAccessToken } from './service-client.js';
import { config } from '../config/index.js';
import type { OktaApp, OktaGroup, OktaUser } from '../types/index.js';

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

/**
 * A group rule (Okta Management API: `GET /api/v1/groups/rules`).
 *
 * The shape is loosely typed because the rule expression is opaque (Okta
 * Expression Language). We surface the fields callers actually use for
 * explainability — `id`, `name`, the `expression.value`, and the
 * `assignUserToGroups` action.
 */
export interface OktaGroupRule {
  id: string;
  name: string;
  status: string;
  conditions?: {
    expression?: {
      value?: string;
      type?: string;
    };
  };
  actions?: {
    assignUserToGroups?: {
      groupIds?: string[];
    };
  };
  [key: string]: unknown;
}

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
   * Note: Okta doesn't have a direct endpoint to check single user membership,
   * so we list all members and check if the user is in the list
   */
  async isMember(groupId: string, userId: string): Promise<boolean> {
    try {
      console.debug('[GroupsClient] Checking group membership:', { groupId, userId });

      // List all members and check if userId is in the list
      const members = await this.listMembers(groupId, 200);
      const isMember = members.some(member => member.id === userId);

      console.debug('[GroupsClient] Membership check result:', {
        groupId,
        userId,
        isMember,
        totalMembers: members.length,
      });

      return isMember;
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

  /**
   * List apps assigned to a group.
   *
   * Calls `GET /api/v1/groups/{groupId}/apps` and walks Link-header
   * pagination until exhausted. Used by the access explainer to detect
   * group-mediated app access.
   *
   * @param groupId - Group ID
   * @param pageSize - Per-page limit (default 200)
   * @param maxPages - Page-walk cap (default 10)
   * @returns Apps assigned to the group
   */
  async listAssignedApps(
    groupId: string,
    pageSize: number = 200,
    maxPages: number = 10
  ): Promise<OktaApp[]> {
    const accessToken = await getServiceAccessToken(['okta.groups.read', 'okta.apps.read']);

    let url: string | null = `${config.okta.apiV1}/groups/${groupId}/apps?limit=${pageSize}`;
    const collected: OktaApp[] = [];
    let pages = 0;

    console.debug('[GroupsClient] Listing apps assigned to group:', { groupId });

    while (url && pages < maxPages) {
      const response: Response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[GroupsClient] Failed to list apps for group:', {
          groupId,
          status: response.status,
          error,
        });
        throw new Error(`Failed to list apps for group: ${response.status} ${response.statusText}`);
      }

      const page = (await response.json()) as OktaApp[];
      collected.push(...page);
      pages++;

      url = parseNextLink(response.headers.get('link'));
    }

    if (url && pages >= maxPages) {
      console.warn('[GroupsClient] listAssignedApps hit maxPages cap:', {
        groupId,
        maxPages,
        collected: collected.length,
      });
    }

    console.debug(`[GroupsClient] Retrieved ${collected.length} app(s) for group ${groupId}`);

    return collected;
  },

  /**
   * List group rules whose action assigns members to the given group.
   *
   * Best-effort: the Management API endpoint
   * `GET /api/v1/groups/rules?expand=groupIdToGroupNameMap` returns ALL
   * rules in the org. We filter client-side for rules whose
   * `actions.assignUserToGroups.groupIds` includes `groupId`.
   *
   * Returns `[]` (with a warning) if the request fails — the access
   * explainer treats rule-mediated paths as best-effort.
   *
   * @param groupId - Target group ID
   * @returns Rules that, when matched, would assign users to this group
   */
  async listRulesForGroup(groupId: string): Promise<OktaGroupRule[]> {
    try {
      const accessToken = await getServiceAccessToken(['okta.groups.read']);
      const url = `${config.okta.apiV1}/groups/rules?expand=groupIdToGroupNameMap&limit=200`;

      console.debug('[GroupsClient] Listing group rules:', { groupId });

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        console.warn('[GroupsClient] Failed to list group rules — returning []:', {
          groupId,
          status: response.status,
          error,
        });
        return [];
      }

      const allRules = (await response.json()) as OktaGroupRule[];
      const matching = allRules.filter((rule) => {
        const groupIds = rule.actions?.assignUserToGroups?.groupIds ?? [];
        return groupIds.includes(groupId);
      });

      console.debug(
        `[GroupsClient] Found ${matching.length} rule(s) targeting group ${groupId} (of ${allRules.length} total)`
      );

      return matching;
    } catch (error) {
      console.warn('[GroupsClient] listRulesForGroup failed — returning []:', {
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  },
};

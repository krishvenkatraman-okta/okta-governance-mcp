/**
 * Resource target ownership resolver
 *
 * Validates that a user has admin rights for a specific resource
 */

import type { AuthorizationContext } from '../types/index.js';

/**
 * Check if user owns/administers an app
 */
export function isAppOwned(context: AuthorizationContext, appId: string): boolean {
  // Super admin owns all apps
  if (context.roles.superAdmin || context.roles.orgAdmin) {
    return true;
  }

  // Check if app is in user's targets
  return context.targets.apps.includes(appId);
}

/**
 * Check if user owns/administers a group
 */
export function isGroupOwned(context: AuthorizationContext, groupId: string): boolean {
  // Super admin owns all groups
  if (context.roles.superAdmin || context.roles.orgAdmin) {
    return true;
  }

  // Check if group is in user's targets
  return context.targets.groups.includes(groupId);
}

/**
 * Get all apps owned by user
 */
export function getOwnedApps(context: AuthorizationContext): string[] {
  return context.targets.apps;
}

/**
 * Get all groups owned by user
 */
export function getOwnedGroups(context: AuthorizationContext): string[] {
  return context.targets.groups;
}

/**
 * Check if user has any owned resources
 */
export function hasAnyOwnedResources(context: AuthorizationContext): boolean {
  return context.targets.apps.length > 0 || context.targets.groups.length > 0;
}

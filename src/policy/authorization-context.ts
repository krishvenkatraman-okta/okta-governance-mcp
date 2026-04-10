/**
 * Authorization context resolver
 *
 * Resolves user authorization context from Okta by:
 * - Fetching admin roles from Okta Roles API
 * - Fetching role targets (apps/groups) from Okta
 * - Mapping roles to capabilities
 * - Checking reviewer assignments (future)
 */

import { rolesClient } from '../okta/roles-client.js';
import { capabilityMapper } from './capability-mapper.js';
import type { AuthorizationContext, McpAccessToken } from '../types/index.js';

/**
 * Minimal context for users with no admin roles
 */
function createMinimalContext(subject: string): AuthorizationContext {
  return {
    subject,
    roles: {
      superAdmin: false,
      orgAdmin: false,
      appAdmin: false,
      groupAdmin: false,
      readOnlyAdmin: false,
      regularUser: true,
    },
    targets: {
      apps: [],
      groups: [],
    },
    reviewer: {
      hasAssignedReviews: false,
      hasSecurityAccessReviews: false,
    },
    capabilities: [],
  };
}

/**
 * Resolve authorization context for a subject using real Okta APIs
 *
 * This is the primary entrypoint for authorization context resolution.
 * It fetches the user's admin roles from Okta, resolves targets,
 * and maps to capabilities.
 *
 * Flow:
 * 1. Fetch user's admin roles from Okta (GET /api/v1/users/{id}/roles)
 * 2. For each role, map to role flags (superAdmin, appAdmin, etc.)
 * 3. For APP_ADMIN roles, fetch app targets
 * 4. For GROUP_ADMIN roles, fetch group targets
 * 5. Map roles + targets to capabilities
 * 6. Return complete authorization context
 *
 * Fail-Safe:
 * - If role fetch fails → Return minimal context (regular user)
 * - If target fetch fails → Empty targets array
 * - Logs errors but doesn't fail the request
 *
 * @param subject - Okta user ID (from MCP token sub claim)
 * @param tokenClaims - Optional MCP token claims for additional context
 * @returns Authorization context with roles, targets, and capabilities
 *
 * @example
 * ```typescript
 * const context = await resolveAuthorizationContextForSubject('00u123456', tokenClaims);
 * ```
 */
export async function resolveAuthorizationContextForSubject(
  subject: string,
  tokenClaims?: McpAccessToken
): Promise<AuthorizationContext> {
  console.log('[AuthorizationContext] Resolving context for subject:', {
    subject,
    sessionId: tokenClaims?.sessionId,
  });

  try {
    // Step 1: Fetch user's admin roles from Okta
    console.debug('[AuthorizationContext] Fetching admin roles from Okta...');
    const oktaRoles = await rolesClient.listUserRoles(subject);

    console.log('[AuthorizationContext] Retrieved roles from Okta:', {
      subject,
      roleCount: oktaRoles.length,
      roleTypes: oktaRoles.map((r) => r.type),
    });

    // Initialize context
    const context: AuthorizationContext = {
      subject,
      roles: {
        superAdmin: false,
        orgAdmin: false,
        appAdmin: false,
        groupAdmin: false,
        readOnlyAdmin: false,
        regularUser: true,
      },
      targets: {
        apps: [],
        groups: [],
      },
      reviewer: {
        hasAssignedReviews: false,
        hasSecurityAccessReviews: false,
      },
      capabilities: [],
    };

    // Step 2-4: Map Okta roles to role flags and fetch targets
    for (const role of oktaRoles) {
      switch (role.type) {
        case 'SUPER_ADMIN':
          context.roles.superAdmin = true;
          context.roles.regularUser = false;
          console.debug('[AuthorizationContext] User is SUPER_ADMIN');
          break;

        case 'ORG_ADMIN':
          context.roles.orgAdmin = true;
          context.roles.regularUser = false;
          console.debug('[AuthorizationContext] User is ORG_ADMIN');
          break;

        case 'APP_ADMIN':
          context.roles.appAdmin = true;
          context.roles.regularUser = false;

          // Fetch app targets for this role
          console.debug('[AuthorizationContext] Fetching APP_ADMIN targets from Okta...');
          try {
            const appTargets = await rolesClient.listAppTargets(subject, role.id);
            context.targets.apps.push(...appTargets);

            console.log('[AuthorizationContext] Retrieved APP_ADMIN targets:', {
              roleId: role.id,
              appCount: appTargets.length,
            });
          } catch (error) {
            console.error('[AuthorizationContext] Failed to fetch app targets:', {
              roleId: role.id,
              error: error instanceof Error ? error.message : String(error),
            });
            // Continue with empty targets - fail gracefully
          }
          break;

        case 'GROUP_ADMIN':
          context.roles.groupAdmin = true;
          context.roles.regularUser = false;

          // Fetch group targets for this role
          console.debug('[AuthorizationContext] Fetching GROUP_ADMIN targets from Okta...');
          try {
            const groupTargets = await rolesClient.listGroupTargets(subject, role.id);
            context.targets.groups.push(...groupTargets);

            console.log('[AuthorizationContext] Retrieved GROUP_ADMIN targets:', {
              roleId: role.id,
              groupCount: groupTargets.length,
            });
          } catch (error) {
            console.error('[AuthorizationContext] Failed to fetch group targets:', {
              roleId: role.id,
              error: error instanceof Error ? error.message : String(error),
            });
            // Continue with empty targets - fail gracefully
          }
          break;

        case 'READ_ONLY_ADMIN':
          context.roles.readOnlyAdmin = true;
          context.roles.regularUser = false;
          console.debug('[AuthorizationContext] User is READ_ONLY_ADMIN');
          break;

        default:
          console.debug('[AuthorizationContext] Ignoring role type:', role.type);
      }
    }

    // Step 5: Map roles + targets to capabilities
    context.capabilities = capabilityMapper.mapRolesToCapabilities(context.roles, context.targets);

    // Step 6: Check for reviewer assignments
    // TODO: Query governance campaigns/reviews APIs for reviewer assignments
    // For now, this remains unimplemented

    console.log('[AuthorizationContext] Context resolved successfully:', {
      subject,
      roles: Object.entries(context.roles)
        .filter(([_, value]) => value)
        .map(([key]) => key),
      targetApps: context.targets.apps.length,
      targetGroups: context.targets.groups.length,
      capabilities: context.capabilities.length,
    });

    return context;
  } catch (error) {
    // Fail-safe: If role resolution completely fails, return minimal context
    console.error('[AuthorizationContext] Failed to resolve context from Okta:', {
      subject,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    console.warn('[AuthorizationContext] Returning minimal context (regular user)');
    return createMinimalContext(subject);
  }
}

/**
 * Legacy function for backward compatibility
 *
 * @deprecated Use resolveAuthorizationContextForSubject instead
 */
export async function resolveAuthorizationContext(userId: string): Promise<AuthorizationContext> {
  return resolveAuthorizationContextForSubject(userId);
}

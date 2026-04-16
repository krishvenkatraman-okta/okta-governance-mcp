/**
 * Tool: resolve_okta_user
 *
 * Resolves a username or email address to an Okta user GUID.
 *
 * Use Case:
 * - Access request workflows where user enters username/email
 * - Frontend doesn't have scope to read Okta users directly
 * - MCP server acts as intermediary to resolve username to GUID
 *
 * Returns:
 * - userId: Okta user GUID (e.g., "00u4epk8shXJoB7zb697")
 * - email: User's email address
 * - name: User's full name
 */

import { findUserByUsernameOrEmail } from '../../okta/users-client.js';
import type { ToolDefinition } from '../types.js';
import type { AuthorizationContext } from '../../types/index.js';

export const resolveUserTool: ToolDefinition = {
  definition: {
    name: 'resolve_okta_user',
    description:
      'Resolve a username or email address to an Okta user GUID. Use this when a user provides a username/email and you need the Okta user ID for API calls (e.g., access requests, assignments).',
    inputSchema: {
      type: 'object',
      properties: {
        usernameOrEmail: {
          type: 'string',
          description: 'Username or email address to resolve to Okta user GUID',
        },
      },
      required: ['usernameOrEmail'],
    },
  },
  handler: async (args: Record<string, unknown>, _context: AuthorizationContext) => {
    const { usernameOrEmail } = args as { usernameOrEmail: string };

    console.log('[ResolveUser] Resolving user:', usernameOrEmail);

    // Find user
    const user = await findUserByUsernameOrEmail(usernameOrEmail);

    if (!user) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'User not found',
                message: `Could not find Okta user with username or email: ${usernameOrEmail}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // Return user info
    const result = {
      success: true,
      userId: user.id,
      email: user.profile.email,
      name: `${user.profile.firstName} ${user.profile.lastName}`,
      login: user.profile.login,
    };

    console.log('[ResolveUser] Resolved user:', {
      userId: result.userId,
      email: result.email,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
};

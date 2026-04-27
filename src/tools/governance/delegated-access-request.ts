/**
 * Delegated Access Request Tool
 *
 * Allows admins to request access on behalf of another user.
 * Uses Okta's Access Requests API (V2).
 */

import { config } from '../../config/index.js';
import { getServiceAccessToken } from '../../okta/service-client.js';
import { createTextResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

interface CreateDelegatedAccessRequestArgs {
  appId: string;
  userId: string;
  entitlementId: string;
  duration?: string;
  justification?: string;
}

/**
 * Create delegated access request handler
 *
 * Creates an access request on behalf of another user using Okta's
 * Access Requests API (V2).
 *
 * API Endpoint: POST /api/v2/accessRequests
 *
 * @see https://developer.okta.com/docs/api/openapi/okta-management/management/tag/AccessRequest/
 */
async function createDelegatedAccessRequestHandler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const { appId, userId, entitlementId, duration, justification } = args as Partial<CreateDelegatedAccessRequestArgs>;

  console.log('[DelegatedAccessRequest] Creating request:', {
    subject: context.subject,
    appId,
    userId,
    entitlementId,
  });

  // Validate required fields
  if (!appId) {
    return createErrorResponse('Missing required field: appId');
  }
  if (!userId) {
    return createErrorResponse('Missing required field: userId. Provide the Okta user ID or email of the user to request access for.');
  }
  if (!entitlementId) {
    return createErrorResponse('Missing required field: entitlementId. Provide the entitlement/bundle ID to request.');
  }

  try {
    // Get service access token with required scopes
    const accessToken = await getServiceAccessToken([
      'okta.accessRequests.request.manage',
      'okta.users.read',
    ]);

    // Resolve userId if it's an email
    let resolvedUserId: string = userId;
    if (userId.includes('@')) {
      console.log('[DelegatedAccessRequest] Resolving email to user ID:', userId);
      const resolved = await resolveUserIdFromEmail(userId, accessToken);
      if (!resolved) {
        return createErrorResponse(`User not found: ${userId}`);
      }
      resolvedUserId = resolved;
      console.log('[DelegatedAccessRequest] Resolved user ID:', resolvedUserId);
    }

    // Build request body
    const requestBody: any = {
      requesterId: context.subject, // Admin making the request
      requestedFor: {
        type: 'USER',
        id: resolvedUserId, // User receiving the access
      },
      requestedObject: {
        resourceType: 'ACCESS_BUNDLE',
        resourceId: entitlementId,
      },
    };

    // Add optional fields
    if (duration) {
      requestBody.requestDetails = {
        ...(requestBody.requestDetails || {}),
        duration,
      };
    }

    if (justification) {
      requestBody.requestDetails = {
        ...(requestBody.requestDetails || {}),
        justification,
      };
    }

    console.log('[DelegatedAccessRequest] Request body:', JSON.stringify(requestBody, null, 2));

    // Call Okta Access Requests API (V2)
    const url = `${config.okta.domain}/api/v2/accessRequests`;
    console.log('[DelegatedAccessRequest] Calling API:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const responseData = (await response.json()) as any;

    if (!response.ok) {
      console.error('[DelegatedAccessRequest] API error:', {
        status: response.status,
        statusText: response.statusText,
        error: responseData,
      });

      // Parse Okta error response
      const errorMessage = responseData?.errorSummary || responseData?.message || `API error: ${response.status}`;
      return createErrorResponse(`Failed to create access request: ${errorMessage}`);
    }

    console.log('[DelegatedAccessRequest] Request created successfully:', {
      requestId: responseData?.id,
      status: responseData?.status,
    });

    // Format success response
    const successMessage = [
      '✅ **Access request created successfully!**',
      '',
      `**Request ID:** ${responseData?.id || 'unknown'}`,
      `**Status:** ${responseData?.status || 'PENDING'}`,
      `**Requested For:** ${userId}`,
      `**Resource:** ${entitlementId}`,
    ];

    if (duration) {
      successMessage.push(`**Duration:** ${duration}`);
    }

    if (justification) {
      successMessage.push(`**Justification:** ${justification}`);
    }

    return createTextResponse(successMessage.join('\n'));
  } catch (error) {
    console.error('[DelegatedAccessRequest] Error creating request:', error);
    return createErrorResponse(
      `Failed to create access request: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Resolve user email to Okta user ID
 */
async function resolveUserIdFromEmail(email: string, accessToken: string): Promise<string | null> {
  try {
    const url = `${config.okta.apiV1}/users/${encodeURIComponent(email)}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[DelegatedAccessRequest] User lookup failed:', response.status);
      return null;
    }

    const user = (await response.json()) as any;
    return user?.id || null;
  } catch (error) {
    console.error('[DelegatedAccessRequest] Error resolving user:', error);
    return null;
  }
}

/**
 * Tool definition for delegated access request
 */
export const createDelegatedAccessRequestTool: ToolDefinition = {
  definition: {
    name: 'create_delegated_access_request',
    description: 'Request access on behalf of another user for applications within your authorization scope. Allows admins to create access requests for other users.',
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Application ID (e.g., 0oasfnwnrnJmf5RPl697)',
        },
        userId: {
          type: 'string',
          description: 'User ID or email address of the user to request access for',
        },
        entitlementId: {
          type: 'string',
          description: 'Entitlement/bundle ID to request access to',
        },
        duration: {
          type: 'string',
          description: 'Optional: Duration in ISO 8601 format (e.g., P30D for 30 days)',
        },
        justification: {
          type: 'string',
          description: 'Optional: Justification for the access request',
        },
      },
      required: ['appId', 'userId', 'entitlementId'],
    },
  },
  handler: createDelegatedAccessRequestHandler,
};

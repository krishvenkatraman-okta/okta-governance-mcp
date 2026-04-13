/**
 * Stubbed governance tools
 *
 * These tools are registered in the tool requirements registry
 * but not yet implemented. They still enforce authorization checks.
 */

import { createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Create a stub handler that returns "not implemented"
 */
function createStubHandler(toolName: string) {
  return async function handler(
    args: Record<string, unknown>,
    context: AuthorizationContext
  ): Promise<McpToolCallResponse> {
    console.log(`[${toolName}] Tool called but not yet implemented:`, {
      subject: context.subject,
      args: Object.keys(args),
    });

    return createErrorResponse(
      `Tool '${toolName}' is not yet implemented. Authorization checks passed, but execution logic is pending.`
    );
  };
}

/**
 * Stub: manage_app_entitlements
 */
export const manageAppEntitlementsTool: ToolDefinition = {
  definition: {
    name: 'manage_app_entitlements',
    description: 'Manage entitlements for applications within your authorization scope (not yet implemented)',
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Application ID',
        },
        action: {
          type: 'string',
          enum: ['list', 'create', 'update', 'delete'],
          description: 'Action to perform',
        },
      },
      required: ['appId', 'action'],
    },
  },
  handler: createStubHandler('manage_app_entitlements'),
};

/**
 * Stub: manage_app_bundles
 */
export const manageAppBundlesTool: ToolDefinition = {
  definition: {
    name: 'manage_app_bundles',
    description: 'Create and manage entitlement bundles (collections) for applications within your authorization scope (not yet implemented)',
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Application ID',
        },
        name: {
          type: 'string',
          description: 'Bundle name',
        },
        entitlementIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Entitlement IDs to include in bundle',
        },
      },
      required: ['appId', 'name', 'entitlementIds'],
    },
  },
  handler: createStubHandler('manage_app_bundles'),
};

/**
 * Stub: manage_app_campaigns
 */
export const manageAppCampaignsTool: ToolDefinition = {
  definition: {
    name: 'manage_app_campaigns',
    description: 'Create and manage access certification campaigns for applications within your authorization scope (not yet implemented)',
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Application ID',
        },
        name: {
          type: 'string',
          description: 'Campaign name',
        },
        action: {
          type: 'string',
          enum: ['list', 'create', 'launch'],
          description: 'Action to perform',
        },
      },
      required: ['appId', 'action'],
    },
  },
  handler: createStubHandler('manage_app_campaigns'),
};

/**
 * Stub: create_delegated_access_request
 */
export const createDelegatedAccessRequestTool: ToolDefinition = {
  definition: {
    name: 'create_delegated_access_request',
    description: 'Request access on behalf of another user for applications within your authorization scope (not yet implemented)',
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Application ID',
        },
        userId: {
          type: 'string',
          description: 'User ID to request access for',
        },
        entitlementId: {
          type: 'string',
          description: 'Entitlement ID',
        },
      },
      required: ['appId', 'userId', 'entitlementId'],
    },
  },
  handler: createStubHandler('create_delegated_access_request'),
};

/**
 * Stub: manage_app_workflows
 */
export const manageAppWorkflowsTool: ToolDefinition = {
  definition: {
    name: 'manage_app_workflows',
    description: 'Manage access request workflows and approval conditions for applications within your authorization scope (not yet implemented)',
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Application ID',
        },
        action: {
          type: 'string',
          enum: ['view', 'create', 'update'],
          description: 'Action to perform',
        },
      },
      required: ['appId', 'action'],
    },
  },
  handler: createStubHandler('manage_app_workflows'),
};

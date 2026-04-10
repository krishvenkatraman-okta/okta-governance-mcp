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
 * Stub: manage_owned_app_entitlements
 */
export const manageOwnedAppEntitlementsTool: ToolDefinition = {
  definition: {
    name: 'manage_owned_app_entitlements',
    description: 'Manage entitlements for an owned application (not yet implemented)',
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
  handler: createStubHandler('manage_owned_app_entitlements'),
};

/**
 * Stub: manage_owned_app_labels
 */
export const manageOwnedAppLabelsTool: ToolDefinition = {
  definition: {
    name: 'manage_owned_app_labels',
    description: 'Manage labels for an owned application (not yet implemented)',
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Application ID',
        },
        action: {
          type: 'string',
          enum: ['list', 'create', 'apply', 'remove'],
          description: 'Action to perform',
        },
      },
      required: ['appId', 'action'],
    },
  },
  handler: createStubHandler('manage_owned_app_labels'),
};

/**
 * Stub: create_bundle_for_owned_app
 */
export const createBundleForOwnedAppTool: ToolDefinition = {
  definition: {
    name: 'create_bundle_for_owned_app',
    description: 'Create an entitlement bundle for an owned application (not yet implemented)',
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
  handler: createStubHandler('create_bundle_for_owned_app'),
};

/**
 * Stub: create_campaign_for_owned_app
 */
export const createCampaignForOwnedAppTool: ToolDefinition = {
  definition: {
    name: 'create_campaign_for_owned_app',
    description: 'Create an access certification campaign for an owned application (not yet implemented)',
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
  handler: createStubHandler('create_campaign_for_owned_app'),
};

/**
 * Stub: request_access_for_other_user_on_owned_app
 */
export const requestAccessForOtherUserTool: ToolDefinition = {
  definition: {
    name: 'request_access_for_other_user_on_owned_app',
    description: 'Request access for another user on an owned application (not yet implemented)',
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
  handler: createStubHandler('request_access_for_other_user_on_owned_app'),
};

/**
 * Stub: create_access_request_workflow_for_owned_app
 */
export const createAccessRequestWorkflowTool: ToolDefinition = {
  definition: {
    name: 'create_access_request_workflow_for_owned_app',
    description: 'Create or modify access request workflow for an owned application (not yet implemented)',
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
  handler: createStubHandler('create_access_request_workflow_for_owned_app'),
};

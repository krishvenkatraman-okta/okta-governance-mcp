/**
 * Tool: manage_app_labels
 *
 * Intelligently manage labels for applications using endpoint registry metadata.
 * Supports: create, apply, remove, list, verify actions.
 */

import { findEndpointByName } from '../../catalog/endpoint-registry.js';
import { governanceClient } from '../../okta/governance-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse, ParsedEndpoint } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Label input schema
 */
interface ManageLabelInput {
  action: 'create' | 'apply' | 'remove' | 'list' | 'verify';
  appId?: string;
  labelName?: string;
  labelDescription?: string;
  labelId?: string;
}

/**
 * Label API response types
 */
interface Label {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface LabelAssignment {
  labelId: string;
  resourceId: string;
  resourceType: string;
  assignedAt?: string;
}

/**
 * Call Okta Governance API using endpoint metadata
 */
async function callGovernanceAPI<T>(
  endpoint: ParsedEndpoint,
  options: {
    pathParams?: Record<string, string>;
    queryParams?: Record<string, string>;
    body?: unknown;
    scopes: string;
  }
): Promise<T> {
  let path = endpoint.normalizedPath;

  // Replace path variables
  if (options.pathParams) {
    for (const [key, value] of Object.entries(options.pathParams)) {
      path = path.replace(`:${key}`, encodeURIComponent(value));
    }
  }

  // Add query parameters
  if (options.queryParams) {
    const params = new URLSearchParams(options.queryParams);
    path = `${path}?${params.toString()}`;
  }

  console.log('[ManageLabels] Calling API:', {
    method: endpoint.method,
    path,
    endpoint: endpoint.name,
  });

  return await governanceClient.request<T>(path, {
    method: endpoint.method,
    body: options.body,
    scopes: options.scopes,
  });
}

/**
 * List all labels
 */
async function listLabels(_context: AuthorizationContext): Promise<Label[]> {
  const endpoint = findEndpointByName('List all labels');

  if (!endpoint) {
    throw new Error('Label listing endpoint not found in registry');
  }

  console.log('[ManageLabels] Using endpoint:', {
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.normalizedPath,
  });

  try {
    const response = await callGovernanceAPI<{ labels: Label[] }>(endpoint, {
      scopes: 'okta.governance.labels.read',
    });

    return response.labels || [];
  } catch (error) {
    console.error('[ManageLabels] Failed to list labels:', error);
    throw new Error(`Failed to list labels: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create a new label
 */
async function createLabel(
  labelName: string,
  labelDescription: string | undefined,
  _context: AuthorizationContext
): Promise<Label> {
  const endpoint = findEndpointByName('Create a label');

  if (!endpoint) {
    throw new Error('Label creation endpoint not found in registry');
  }

  console.log('[ManageLabels] Creating label using endpoint:', {
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.normalizedPath,
  });

  // Use request body schema from endpoint metadata
  let requestBody: any = {
    name: labelName,
  };

  if (labelDescription) {
    requestBody.description = labelDescription;
  }

  // If endpoint has a sample body, use it as a template
  if (endpoint.requestBody?.sample) {
    try {
      const sampleBody = JSON.parse(endpoint.requestBody.sample);
      requestBody = {
        ...sampleBody,
        name: labelName,
        description: labelDescription || sampleBody.description,
      };
    } catch (error) {
      console.warn('[ManageLabels] Could not parse sample body, using basic schema');
    }
  }

  try {
    const response = await callGovernanceAPI<Label>(endpoint, {
      body: requestBody,
      scopes: 'okta.governance.labels.manage',
    });

    return response;
  } catch (error) {
    console.error('[ManageLabels] Failed to create label:', error);
    throw new Error(`Failed to create label: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Assign label to an application
 */
async function assignLabel(
  labelId: string,
  appId: string,
  _context: AuthorizationContext
): Promise<LabelAssignment> {
  const endpoint = findEndpointByName('Assign the labels to resources');

  if (!endpoint) {
    throw new Error('Label assignment endpoint not found in registry');
  }

  console.log('[ManageLabels] Assigning label using endpoint:', {
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.normalizedPath,
    labelId,
    appId,
  });

  // Use request body schema from endpoint metadata
  let requestBody: any = {
    resourceId: appId,
    resourceType: 'app',
  };

  // If endpoint has a sample body, use it as a template
  if (endpoint.requestBody?.sample) {
    try {
      const sampleBody = JSON.parse(endpoint.requestBody.sample);
      requestBody = {
        ...sampleBody,
        resourceId: appId,
        resourceType: 'app',
      };
    } catch (error) {
      console.warn('[ManageLabels] Could not parse sample body, using basic schema');
    }
  }

  try {
    const response = await callGovernanceAPI<LabelAssignment>(endpoint, {
      pathParams: { labelId },
      body: requestBody,
      scopes: 'okta.governance.labels.manage',
    });

    return response;
  } catch (error) {
    console.error('[ManageLabels] Failed to assign label:', error);
    throw new Error(`Failed to assign label: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Remove label from an application
 */
async function removeLabel(
  labelId: string,
  appId: string,
  _context: AuthorizationContext
): Promise<void> {
  const endpoint = findEndpointByName('Unassign a label from a resource');

  if (!endpoint) {
    throw new Error('Label removal endpoint not found in registry');
  }

  console.log('[ManageLabels] Removing label using endpoint:', {
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.normalizedPath,
    labelId,
    appId,
  });

  try {
    await callGovernanceAPI<void>(endpoint, {
      pathParams: { labelId, resourceId: appId },
      scopes: 'okta.governance.labels.manage',
    });
  } catch (error) {
    console.error('[ManageLabels] Failed to remove label:', error);
    throw new Error(`Failed to remove label: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get labels assigned to a resource
 */
async function getResourceLabels(appId: string, _context: AuthorizationContext): Promise<Label[]> {
  const endpoint = findEndpointByName('Get labels assigned to a resource');

  if (!endpoint) {
    throw new Error('Resource labels endpoint not found in registry');
  }

  console.log('[ManageLabels] Getting resource labels using endpoint:', {
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.normalizedPath,
    appId,
  });

  try {
    const response = await callGovernanceAPI<{ labels: Label[] }>(endpoint, {
      pathParams: { resourceId: appId },
      queryParams: { resourceType: 'app' },
      scopes: 'okta.governance.labels.read',
    });

    return response.labels || [];
  } catch (error) {
    console.error('[ManageLabels] Failed to get resource labels:', error);
    throw new Error(`Failed to get resource labels: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Intelligent workflow: Apply label (create if needed)
 */
async function applyLabelWorkflow(
  input: ManageLabelInput,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  if (!input.appId || !input.labelName) {
    return createErrorResponse('appId and labelName are required for apply action');
  }

  console.log('[ManageLabels] Executing apply workflow:', {
    appId: input.appId,
    labelName: input.labelName,
  });

  try {
    // Step 1: List existing labels
    console.log('[ManageLabels] Step 1: Checking if label exists');
    const labels = await listLabels(context);
    let label = labels.find((l) => l.name === input.labelName);

    // Step 2: Create label if it doesn't exist
    if (!label) {
      console.log('[ManageLabels] Step 2: Label not found, creating new label');
      label = await createLabel(input.labelName, input.labelDescription, context);
      console.log('[ManageLabels] Created label:', { id: label.id, name: label.name });
    } else {
      console.log('[ManageLabels] Label already exists:', { id: label.id, name: label.name });
    }

    // Step 3: Assign label to app
    console.log('[ManageLabels] Step 3: Assigning label to app');
    const assignment = await assignLabel(label.id, input.appId, context);

    return createJsonResponse({
      status: 'success',
      action: 'apply',
      label: {
        id: label.id,
        name: label.name,
        description: label.description,
      },
      app: {
        id: input.appId,
      },
      assignment,
      message: `✅ Applied label '${label.name}' to application ${input.appId}`,
    });
  } catch (error) {
    console.error('[ManageLabels] Apply workflow failed:', error);
    return createErrorResponse(
      `Failed to apply label: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Tool handler
 */
async function handler(
  args: Record<string, unknown>,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const input = args as unknown as ManageLabelInput;

  console.log('[ManageLabels] Executing tool:', {
    action: input.action,
    subject: context.subject,
    appId: input.appId,
    labelName: input.labelName,
  });

  try {
    switch (input.action) {
      case 'list': {
        const labels = await listLabels(context);
        return createJsonResponse({
          total: labels.length,
          labels,
          message: `Found ${labels.length} labels`,
        });
      }

      case 'create': {
        if (!input.labelName) {
          return createErrorResponse('labelName is required for create action');
        }
        const label = await createLabel(input.labelName, input.labelDescription, context);
        return createJsonResponse({
          status: 'success',
          action: 'create',
          label,
          message: `✅ Created label '${label.name}'`,
        });
      }

      case 'apply': {
        return await applyLabelWorkflow(input, context);
      }

      case 'remove': {
        if (!input.appId || !input.labelId) {
          return createErrorResponse('appId and labelId are required for remove action');
        }
        await removeLabel(input.labelId, input.appId, context);
        return createJsonResponse({
          status: 'success',
          action: 'remove',
          message: `✅ Removed label ${input.labelId} from application ${input.appId}`,
        });
      }

      case 'verify': {
        if (!input.appId) {
          return createErrorResponse('appId is required for verify action');
        }
        const labels = await getResourceLabels(input.appId, context);
        return createJsonResponse({
          total: labels.length,
          labels,
          app: { id: input.appId },
          message: `Application ${input.appId} has ${labels.length} labels`,
        });
      }

      default:
        return createErrorResponse(`Unknown action: ${input.action}`);
    }
  } catch (error) {
    console.error('[ManageLabels] Error:', error);
    return createErrorResponse(
      `Failed to execute label management: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Tool definition
 */
export const manageAppLabelsTool: ToolDefinition = {
  definition: {
    name: 'manage_app_labels',
    description:
      'Intelligently manage labels for applications (create, apply, remove, list, verify). Uses Postman endpoint registry for accurate API calls.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'apply', 'remove', 'list', 'verify'],
          description: 'Label operation to perform',
        },
        appId: {
          type: 'string',
          description: 'Application ID (required for apply/remove/verify)',
        },
        labelName: {
          type: 'string',
          description: 'Label name (required for create/apply)',
        },
        labelDescription: {
          type: 'string',
          description: 'Label description (optional, used in create/apply)',
        },
        labelId: {
          type: 'string',
          description: 'Label ID (required for remove, optional for apply if labelName not provided)',
        },
      },
      required: ['action'],
    },
  },
  handler,
};

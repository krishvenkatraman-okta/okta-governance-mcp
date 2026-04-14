/**
 * Tool: manage_app_labels
 *
 * Intelligently manage labels for applications using endpoint registry metadata.
 * Supports: create, apply, remove, list, verify actions.
 */

import {
  findEndpointByName,
  getEndpointsByCategory,
  getRegistryStatus,
  isRegistryLoaded,
} from '../../catalog/endpoint-registry.js';
import { governanceClient } from '../../okta/governance-client.js';
import { appsClient } from '../../okta/apps-client.js';
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

  // Strip /governance/api/v1 prefix if present (governance-client adds it)
  // The Postman collection includes full paths like /governance/api/v1/labels
  // But governanceClient.request() expects relative paths from the governance API base
  path = path.replace(/^\/governance\/api\/v1/, '');

  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

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
    fullEndpoint: `${endpoint.method} ${endpoint.normalizedPath}`,
    endpointName: endpoint.name,
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
  // Debug: Check registry status
  console.log('[ManageLabels] DEBUG: Checking endpoint registry status...');
  const registryLoaded = isRegistryLoaded();
  console.log('[ManageLabels] DEBUG: Registry loaded:', registryLoaded);

  if (!registryLoaded) {
    console.error('[ManageLabels] ERROR: Registry not loaded! This is a critical error.');
    throw new Error('Endpoint registry not loaded - MCP server initialization failed');
  }

  const registryStatus = getRegistryStatus();
  console.log('[ManageLabels] DEBUG: Registry status:', {
    loaded: registryStatus.loaded,
    endpointCount: registryStatus.endpointCount,
    categoryCount: registryStatus.categoryCount,
  });

  // Debug: List all label endpoints available
  const labelEndpoints = getEndpointsByCategory('Labels');
  console.log('[ManageLabels] DEBUG: Label endpoints in registry:', labelEndpoints.length);
  labelEndpoints.forEach((ep, idx) => {
    console.log(`[ManageLabels] DEBUG:   ${idx + 1}. "${ep.name}" → ${ep.method} ${ep.normalizedPath}`);
  });

  // Debug: Show what we're searching for
  const searchName = 'List all labels';
  console.log('[ManageLabels] DEBUG: Searching for endpoint:', searchName);

  const endpoint = findEndpointByName(searchName);

  if (!endpoint) {
    console.error('[ManageLabels] ERROR: Endpoint not found!');
    console.error('[ManageLabels] ERROR: Searched for:', searchName);
    console.error('[ManageLabels] ERROR: Available label endpoints:', labelEndpoints.map(e => e.name));
    throw new Error(`Label listing endpoint not found in registry. Searched for: "${searchName}". Available: ${labelEndpoints.map(e => `"${e.name}"`).join(', ')}`);
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
  console.log('[ManageLabels] DEBUG: Looking up "Create a label" endpoint...');
  const endpoint = findEndpointByName('Create a label');

  if (!endpoint) {
    const labelEndpoints = getEndpointsByCategory('Labels');
    console.error('[ManageLabels] ERROR: Create label endpoint not found!');
    console.error('[ManageLabels] ERROR: Available:', labelEndpoints.map(e => `"${e.name}"`).join(', '));
    throw new Error(`Label creation endpoint not found in registry. Available: ${labelEndpoints.map(e => `"${e.name}"`).join(', ')}`);
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
  console.log('[ManageLabels] DEBUG: Looking up "Assign the labels to resources" endpoint...');
  const endpoint = findEndpointByName('Assign the labels to resources');

  if (!endpoint) {
    const labelEndpoints = getEndpointsByCategory('Labels');
    console.error('[ManageLabels] ERROR: Assign label endpoint not found!');
    console.error('[ManageLabels] ERROR: Available:', labelEndpoints.map(e => `"${e.name}"`).join(', '));
    throw new Error(`Label assignment endpoint not found in registry. Available: ${labelEndpoints.map(e => `"${e.name}"`).join(', ')}`);
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
  console.log('[ManageLabels] DEBUG: Looking up "Remove the labels from resources" endpoint...');
  const endpoint = findEndpointByName('Remove the labels from resources');

  if (!endpoint) {
    const labelEndpoints = getEndpointsByCategory('Labels');
    console.error('[ManageLabels] ERROR: Remove label endpoint not found!');
    console.error('[ManageLabels] ERROR: Available:', labelEndpoints.map(e => `"${e.name}"`).join(', '));
    throw new Error(`Label removal endpoint not found in registry. Available: ${labelEndpoints.map(e => `"${e.name}"`).join(', ')}`);
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
  console.log('[ManageLabels] DEBUG: Looking up "List all labeled resources" endpoint...');
  const endpoint = findEndpointByName('List all labeled resources');

  if (!endpoint) {
    const labelEndpoints = getEndpointsByCategory('Labels');
    console.error('[ManageLabels] ERROR: Resource labels endpoint not found!');
    console.error('[ManageLabels] ERROR: Available:', labelEndpoints.map(e => `"${e.name}"`).join(', '));
    throw new Error(`Resource labels endpoint not found in registry. Available: ${labelEndpoints.map(e => `"${e.name}"`).join(', ')}`);
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
 * Validate app exists and is governance-enabled
 */
async function validateApp(appId: string, context: AuthorizationContext): Promise<{
  valid: boolean;
  app?: any;
  error?: string;
}> {
  try {
    console.log('[ManageLabels] Validating app:', { appId, subject: context.subject });

    // Step 1: Check if app exists
    const app = await appsClient.getById(appId);

    if (!app) {
      return {
        valid: false,
        error: `Application ${appId} not found`,
      };
    }

    console.log('[ManageLabels] App found:', {
      id: app.id,
      name: app.name,
      label: app.label,
      status: app.status,
    });

    // Step 2: Check if app is governance-enabled
    // Apps must have Entitlement Management (emOptInStatus) enabled to support labels
    const settings = (app as any).settings;
    const emOptInStatus = settings?.emOptInStatus;

    if (emOptInStatus !== 'ENABLED') {
      return {
        valid: false,
        app,
        error: `Application '${app.label}' does not have Entitlement Management enabled. Current status: ${emOptInStatus || 'DISABLED'}. Labels can only be applied to governance-enabled applications.`,
      };
    }

    console.log('[ManageLabels] App is governance-enabled:', {
      id: app.id,
      label: app.label,
      emOptInStatus,
    });

    // Step 3: Check authorization (if user is App Admin, verify app is in their targets)
    if (!context.roles.superAdmin && !context.roles.orgAdmin) {
      if (context.roles.appAdmin) {
        const hasAccess = context.targets.apps.includes(appId);
        if (!hasAccess) {
          return {
            valid: false,
            app,
            error: `You do not have permission to manage labels for application '${app.label}'. This app is not in your role targets.`,
          };
        }
      } else {
        return {
          valid: false,
          app,
          error: `You do not have permission to manage labels. Required role: APP_ADMIN, SUPER_ADMIN, or ORG_ADMIN.`,
        };
      }
    }

    return {
      valid: true,
      app,
    };
  } catch (error) {
    console.error('[ManageLabels] App validation failed:', error);
    return {
      valid: false,
      error: `Failed to validate app: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
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
    subject: context.subject,
  });

  try {
    // Step 0: Validate app exists and is governance-enabled
    console.log('[ManageLabels] Step 0: Validating application');
    const validation = await validateApp(input.appId, context);

    if (!validation.valid) {
      console.error('[ManageLabels] App validation failed:', validation.error);
      return createErrorResponse(validation.error || 'App validation failed');
    }

    const app = validation.app;
    console.log('[ManageLabels] App validated successfully:', {
      id: app.id,
      label: app.label,
      governanceEnabled: true,
    });

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

    console.log('[ManageLabels] ✅ Apply workflow completed successfully');

    return createJsonResponse({
      success: true,
      action: 'apply',
      appId: input.appId,
      appLabel: app.label,
      appName: app.name,
      label: {
        id: label.id,
        name: label.name,
        description: label.description,
      },
      assignment,
      message: `✅ Successfully applied label '${label.name}' to application '${app.label}'`,
      details: {
        labelCreated: !labels.find((l) => l.name === input.labelName),
        labelId: label.id,
        labelName: label.name,
        appId: input.appId,
        appLabel: app.label,
        timestamp: new Date().toISOString(),
      },
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

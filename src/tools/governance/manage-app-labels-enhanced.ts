/**
 * Enhanced Label Management Tool
 *
 * Provides guided, user-friendly label management with:
 * - Automatic discovery of existing labels and values
 * - Intelligent suggestions based on user input
 * - ORN resolution for resources
 * - Clear, non-technical prompts
 */

import {
  findEndpointByName,
  isRegistryLoaded,
} from '../../catalog/endpoint-registry.js';
import { governanceClient } from '../../okta/governance-client.js';
import { appsClient } from '../../okta/apps-client.js';
import { createJsonResponse, createErrorResponse } from '../types.js';
import type { AuthorizationContext, McpToolCallResponse, ParsedEndpoint } from '../../types/index.js';
import type { ToolDefinition } from '../types.js';

/**
 * Label structure in Okta Governance:
 * - Label (key): The category (e.g., "Risk", "Compliance")
 * - Label Values: The options under that category (e.g., "high-risk", "medium-risk")
 */

interface LabelValue {
  id: string;
  name: string;
  description?: string;
}

interface Label {
  id: string;
  name: string;
  description?: string;
  values: LabelValue[];
  createdAt?: string;
  updatedAt?: string;
}

interface ResourceInfo {
  id: string;
  name: string;
  label: string;
  type: 'app' | 'group' | 'entitlement';
  orn: string;
  governanceEnabled?: boolean;
}

interface DiscoveryResult {
  existingLabels: Label[];
  matchingLabel?: Label;
  matchingValue?: LabelValue;
  suggestions: {
    labelExists: boolean;
    valueExists: boolean;
    recommendedAction: 'assign_existing' | 'create_value' | 'create_label';
    message: string;
    options?: string[];
  };
}

/**
 * Enhanced input schema with value support
 */
interface ManageLabelInput {
  action: 'discover' | 'create' | 'apply' | 'remove' | 'list' | 'verify';

  // Resource identification
  appId?: string;
  appName?: string;
  resourceType?: 'app' | 'group' | 'entitlement';
  resourceId?: string;

  // Label identification
  labelName?: string;
  labelValue?: string;
  labelDescription?: string;

  // Advanced
  labelId?: string;
  valueId?: string;

  // Discovery hint
  searchTerm?: string;
}

/**
 * Call Okta Governance API (from original tool)
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
  path = path.replace(/^\/governance\/api\/v1/, '');
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  if (options.pathParams) {
    for (const [key, value] of Object.entries(options.pathParams)) {
      path = path.replace(`:${key}`, encodeURIComponent(value));
    }
  }

  if (options.queryParams) {
    const params = new URLSearchParams(options.queryParams);
    path = `${path}?${params.toString()}`;
  }

  console.log('[ManageLabels] Calling API:', {
    method: endpoint.method,
    path,
    endpointName: endpoint.name,
  });

  return await governanceClient.request<T>(path, {
    method: endpoint.method,
    body: options.body,
    scopes: options.scopes,
  });
}

/**
 * Resolve resource ORN
 *
 * Automatically resolves the ORN for a resource without asking the user.
 * Supports: apps, groups, entitlements
 */
async function resolveResourceORN(
  resourceType: 'app' | 'group' | 'entitlement',
  resourceId: string,
  context: AuthorizationContext
): Promise<{ orn: string; resource: ResourceInfo } | { error: string }> {
  console.log('[ManageLabels] Resolving ORN:', { resourceType, resourceId });

  try {
    switch (resourceType) {
      case 'app': {
        // Fetch app details
        const app = await appsClient.getById(resourceId);

        if (!app) {
          return { error: `Application ${resourceId} not found` };
        }

        // Check governance enablement
        const settings = (app as any).settings;
        const emOptInStatus = settings?.emOptInStatus;

        if (emOptInStatus !== 'ENABLED') {
          return {
            error: `Application '${app.label}' does not have Entitlement Management enabled. Labels can only be applied to governance-enabled applications.`,
          };
        }

        // Extract ORN
        // Apps use format: orn:okta:app:<instanceId>:<appId>
        const orn = (app as any).orn || `orn:okta:app:${context.subject.split('@')[0]}:${resourceId}`;

        return {
          orn,
          resource: {
            id: app.id,
            name: app.name,
            label: app.label,
            type: 'app',
            orn,
            governanceEnabled: true,
          },
        };
      }

      case 'group': {
        // For groups, construct ORN
        // Groups use format: orn:okta:group:<instanceId>:<groupId>
        const orn = `orn:okta:group:${context.subject.split('@')[0]}:${resourceId}`;

        return {
          orn,
          resource: {
            id: resourceId,
            name: resourceId,
            label: resourceId,
            type: 'group',
            orn,
          },
        };
      }

      case 'entitlement': {
        // For entitlements, construct ORN
        // Entitlements use format: orn:okta:entitlement:<instanceId>:<entitlementId>
        const orn = `orn:okta:entitlement:${context.subject.split('@')[0]}:${resourceId}`;

        return {
          orn,
          resource: {
            id: resourceId,
            name: resourceId,
            label: resourceId,
            type: 'entitlement',
            orn,
          },
        };
      }

      default:
        return { error: `Unsupported resource type: ${resourceType}` };
    }
  } catch (error) {
    console.error('[ManageLabels] ORN resolution failed:', error);
    return {
      error: `Failed to resolve resource ORN: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * List all labels with their values
 */
async function listLabelsWithValues(_context: AuthorizationContext): Promise<Label[]> {
  console.log('[ManageLabels] Listing all labels with values...');

  const registryLoaded = isRegistryLoaded();
  if (!registryLoaded) {
    throw new Error('Endpoint registry not loaded');
  }

  const endpoint = findEndpointByName('List all labels');
  if (!endpoint) {
    throw new Error('Label listing endpoint not found in registry');
  }

  try {
    const response = await callGovernanceAPI<{ data?: Label[]; labels?: Label[] }>(endpoint, {
      scopes: 'okta.governance.labels.read',
    });

    // Debug: Log response structure
    console.log('[ManageLabels] DEBUG: Response keys:', Object.keys(response));
    console.log('[ManageLabels] DEBUG: response.data exists:', !!response.data);
    console.log('[ManageLabels] DEBUG: response.labels exists:', !!response.labels);

    // Okta API returns labels under 'data' key, not 'labels'
    const labels = response.data || response.labels || [];
    console.log(`[ManageLabels] Found ${labels.length} labels`);

    // Log first label for verification
    if (labels.length > 0) {
      console.log('[ManageLabels] DEBUG: First label name:', labels[0].name);
    }

    // Log each label with its values
    labels.forEach((label) => {
      console.log(`[ManageLabels]   - "${label.name}" (${label.values?.length || 0} values)`);
      if (label.values && label.values.length > 0) {
        label.values.forEach((value) => {
          console.log(`[ManageLabels]       • "${value.name}"`);
        });
      }
    });

    return labels;
  } catch (error) {
    console.error('[ManageLabels] Failed to list labels:', error);
    throw new Error(`Failed to list labels: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Discover existing labels and provide guidance
 *
 * This is the key function for the guided experience.
 * It searches existing labels and values, then provides recommendations.
 */
async function discoverLabels(
  searchTerm: string,
  context: AuthorizationContext
): Promise<DiscoveryResult> {
  console.log('[ManageLabels] Discovering labels for search term:', searchTerm);

  const existingLabels = await listLabelsWithValues(context);
  const searchLower = searchTerm.toLowerCase();

  // Strategy 1: Direct label name match
  const directLabelMatch = existingLabels.find(
    (l) => l.name.toLowerCase() === searchLower
  );

  if (directLabelMatch) {
    console.log('[ManageLabels] Found exact label match:', directLabelMatch.name);

    // Format available values in human-readable list
    const valuesList = directLabelMatch.values.length > 0
      ? directLabelMatch.values.map((v) => `- ${v.name}`).join('\n')
      : '(no values defined yet)';

    const message = `I found an existing label: **${directLabelMatch.name}**

Available values:
${valuesList}

What would you like to do?
a. Assign one of the existing values above
b. Create a new value under "${directLabelMatch.name}"
c. Create a completely new label`;

    return {
      existingLabels,
      matchingLabel: directLabelMatch,
      suggestions: {
        labelExists: true,
        valueExists: false,
        recommendedAction: 'assign_existing',
        message,
        options: directLabelMatch.values.map((v) => v.name),
      },
    };
  }

  // Strategy 2: Search for value across all labels
  for (const label of existingLabels) {
    const matchingValue = label.values?.find(
      (v) => v.name.toLowerCase() === searchLower
    );

    if (matchingValue) {
      console.log('[ManageLabels] Found value match:', matchingValue.name, 'under label:', label.name);

      // Format available values
      const valuesList = label.values.map((v) => {
        return v.id === matchingValue.id ? `- **${v.name}** ← matches your request` : `- ${v.name}`;
      }).join('\n');

      const message = `I found the value **"${matchingValue.name}"** under the label **"${label.name}"**

Available values in this label:
${valuesList}

Would you like me to assign "${matchingValue.name}" to the application?`;

      return {
        existingLabels,
        matchingLabel: label,
        matchingValue,
        suggestions: {
          labelExists: true,
          valueExists: true,
          recommendedAction: 'assign_existing',
          message,
          options: label.values.map((v) => v.name),
        },
      };
    }
  }

  // Strategy 3: Partial label name match
  const partialLabelMatches = existingLabels.filter(
    (l) => l.name.toLowerCase().includes(searchLower) || searchLower.includes(l.name.toLowerCase())
  );

  if (partialLabelMatches.length > 0) {
    const bestMatch = partialLabelMatches[0];
    console.log('[ManageLabels] Found partial label match:', bestMatch.name);

    const valuesList = bestMatch.values.length > 0
      ? bestMatch.values.map((v) => `- ${v.name}`).join('\n')
      : '(no values defined yet)';

    const message = `I found a similar label: **${bestMatch.name}**

Available values:
${valuesList}

Did you mean:
a. Use one of the values from "${bestMatch.name}"?
b. Create a new value under "${bestMatch.name}"?
c. Create a completely new label?`;

    return {
      existingLabels,
      matchingLabel: bestMatch,
      suggestions: {
        labelExists: true,
        valueExists: false,
        recommendedAction: 'create_value',
        message,
        options: bestMatch.values.map((v) => v.name),
      },
    };
  }

  // Strategy 4: Partial value match across all labels
  const valueMatches: Array<{ label: Label; value: LabelValue }> = [];
  for (const label of existingLabels) {
    const partialValues = label.values?.filter(
      (v) => v.name.toLowerCase().includes(searchLower) || searchLower.includes(v.name.toLowerCase())
    ) || [];

    for (const value of partialValues) {
      valueMatches.push({ label, value });
    }
  }

  if (valueMatches.length > 0) {
    const bestMatch = valueMatches[0];
    console.log('[ManageLabels] Found partial value match:', bestMatch.value.name, 'under', bestMatch.label.name);

    const valuesList = bestMatch.label.values.map((v) => {
      return v.id === bestMatch.value.id ? `- **${v.name}** ← similar to your request` : `- ${v.name}`;
    }).join('\n');

    const message = `I found a similar value: **"${bestMatch.value.name}"** under the label **"${bestMatch.label.name}"**

Available values:
${valuesList}

Would you like me to assign "${bestMatch.value.name}"?`;

    return {
      existingLabels,
      matchingLabel: bestMatch.label,
      matchingValue: bestMatch.value,
      suggestions: {
        labelExists: true,
        valueExists: true,
        recommendedAction: 'assign_existing',
        message,
        options: bestMatch.label.values.map((v) => v.name),
      },
    };
  }

  // Strategy 5: No matches - new label needed
  console.log('[ManageLabels] No matches found, new label needed');

  // Show existing labels for reference
  const existingLabelsList = existingLabels.length > 0
    ? existingLabels.slice(0, 5).map((l) => {
        const valueCount = l.values.length;
        return `- ${l.name} (${valueCount} value${valueCount !== 1 ? 's' : ''})`;
      }).join('\n')
    : '(no labels exist yet)';

  const message = `I couldn't find any existing labels or values matching **"${searchTerm}"**

Existing labels for reference:
${existingLabelsList}
${existingLabels.length > 5 ? `... and ${existingLabels.length - 5} more` : ''}

To create a new label, I'll need:
1. **Label name** (the category) - for example: "Risk", "Compliance", "Department"
2. **First value** under that label - for example: "high-risk", "PCI-compliant", "Engineering"

Please tell me:
- The label name you want to create
- The first value under that label`;

  return {
    existingLabels,
    suggestions: {
      labelExists: false,
      valueExists: false,
      recommendedAction: 'create_label',
      message,
    },
  };
}

/**
 * Create a new label with values
 */
async function createLabelWithValue(
  labelName: string,
  valueName: string,
  labelDescription: string | undefined,
  _context: AuthorizationContext
): Promise<Label> {
  console.log('[ManageLabels] Creating label with value:', { labelName, valueName });

  const endpoint = findEndpointByName('Create a label');
  if (!endpoint) {
    throw new Error('Label creation endpoint not found in registry');
  }

  const requestBody = {
    name: labelName,
    description: labelDescription || `Label: ${labelName}`,
    values: [
      {
        name: valueName,
        description: `Value: ${valueName}`,
      },
    ],
  };

  try {
    const response = await callGovernanceAPI<Label>(endpoint, {
      body: requestBody,
      scopes: 'okta.governance.labels.manage',
    });

    console.log('[ManageLabels] Created label:', response.name, 'with value:', valueName);
    return response;
  } catch (error) {
    console.error('[ManageLabels] Failed to create label:', error);
    throw new Error(`Failed to create label: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Assign label value to resource (using ORN)
 */
async function assignLabelValue(
  labelId: string,
  valueId: string,
  resourceOrn: string,
  resourceType: string,
  _context: AuthorizationContext
): Promise<any> {
  console.log('[ManageLabels] ========================================');
  console.log('[ManageLabels] Assigning label value');
  console.log('[ManageLabels] ========================================');

  const endpoint = findEndpointByName('Assign the labels to resources');
  if (!endpoint) {
    throw new Error('Label assignment endpoint not found in registry');
  }

  // API expects: POST /governance/api/v1/resource-labels/assign
  // Body format: { resourceOrns: [...], labelValueIds: [...] }
  const requestBody = {
    resourceOrns: [resourceOrn],
    labelValueIds: [valueId],
  };

  // Debug logging BEFORE request
  console.log('[ManageLabels] DEBUG: Assignment request details:');
  console.log('[ManageLabels]   Endpoint:', endpoint.name);
  console.log('[ManageLabels]   Method:', endpoint.method);
  console.log('[ManageLabels]   Path:', endpoint.normalizedPath);
  console.log('[ManageLabels]   Resource ORN:', resourceOrn);
  console.log('[ManageLabels]   Resource Type:', resourceType);
  console.log('[ManageLabels]   Label ID:', labelId);
  console.log('[ManageLabels]   Value ID:', valueId);
  console.log('[ManageLabels]   Request body:', JSON.stringify(requestBody, null, 2));

  try {
    const response = await callGovernanceAPI<any>(endpoint, {
      body: requestBody,
      scopes: 'okta.governance.labels.manage',
    });

    // Debug logging AFTER request
    console.log('[ManageLabels] DEBUG: Assignment response received');
    console.log('[ManageLabels]   Response keys:', Object.keys(response));
    console.log('[ManageLabels]   response.data exists:', !!response.data);

    if (response.data) {
      console.log('[ManageLabels]   response.data is array:', Array.isArray(response.data));
      if (Array.isArray(response.data)) {
        console.log('[ManageLabels]   response.data.length:', response.data.length);
      }
    }

    console.log('[ManageLabels]   Full response:', JSON.stringify(response, null, 2));

    // Validate response - do NOT mark as success if data is empty
    if (response.data && Array.isArray(response.data) && response.data.length === 0) {
      console.error('[ManageLabels] ❌ Assignment returned empty data array');
      throw new Error('Label assignment returned empty result - assignment may not have succeeded');
    }

    if (!response.data) {
      console.error('[ManageLabels] ❌ Assignment response missing data field');
      throw new Error('Label assignment response invalid - no data field returned');
    }

    console.log('[ManageLabels] ✅ Label value assigned successfully');
    console.log('[ManageLabels] ========================================');
    return response;
  } catch (error) {
    console.error('[ManageLabels] ❌ Failed to assign label value:', error);
    console.error('[ManageLabels] ========================================');
    throw new Error(`Failed to assign label: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Enhanced guided apply workflow
 *
 * This implements the user-friendly guided experience:
 * 1. Discover existing labels/values
 * 2. Provide clear guidance
 * 3. Execute the appropriate action
 */
async function guidedApplyWorkflow(
  input: ManageLabelInput,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  console.log('[ManageLabels] Starting guided apply workflow:', input);

  try {
    // Step 1: Resolve resource ORN
    const resourceType = input.resourceType || 'app';
    const resourceId = input.appId || input.resourceId;

    if (!resourceId) {
      return createErrorResponse('Resource ID is required (appId, groupId, or resourceId)');
    }

    console.log('[ManageLabels] Step 1: Resolving resource ORN');
    const ornResult = await resolveResourceORN(resourceType, resourceId, context);

    if ('error' in ornResult) {
      return createErrorResponse(ornResult.error);
    }

    const { orn: resourceOrn, resource } = ornResult;
    console.log('[ManageLabels] Resource resolved:', {
      name: resource.label,
      type: resource.type,
      orn: resourceOrn,
    });

    // Step 2: Determine search term (label name or value)
    const searchTerm = input.labelValue || input.labelName || input.searchTerm;

    if (!searchTerm) {
      return createErrorResponse('Please provide either labelName or labelValue');
    }

    console.log('[ManageLabels] Step 2: Discovering existing labels');
    const discovery = await discoverLabels(searchTerm, context);

    // Step 3: Execute based on discovery
    console.log('[ManageLabels] Step 3: Executing recommended action:', discovery.suggestions.recommendedAction);

    switch (discovery.suggestions.recommendedAction) {
      case 'assign_existing': {
        // Label and value both exist - assign it
        if (!discovery.matchingLabel || !discovery.matchingValue) {
          // Label exists but no specific value - ask user
          if (!discovery.matchingLabel) {
            return createErrorResponse('Label information missing from discovery');
          }

          const formattedMessage = `${discovery.suggestions.message}

**Resource:** ${resource.label} (${resource.type})

Please reply with your choice:
- To assign an existing value: just type the value name (e.g., "SOX")
- To create a new value: specify "create value: <name>"
- To start over with a new label: type "cancel"`;

          return createJsonResponse({
            status: 'guidance_needed',
            message: formattedMessage,
            availableValues: discovery.suggestions.options,
            label: {
              id: discovery.matchingLabel.id,
              name: discovery.matchingLabel.name,
            },
            resource: {
              name: resource.label,
              type: resource.type,
              id: resource.id,
            },
          });
        }

        // Assign the label value
        const assignment = await assignLabelValue(
          discovery.matchingLabel.id,
          discovery.matchingValue.id,
          resourceOrn,
          resourceType,
          context
        );

        // Validate assignment result before marking as success
        if (!assignment || !assignment.data || (Array.isArray(assignment.data) && assignment.data.length === 0)) {
          console.error('[ManageLabels] ❌ Assignment response invalid or empty');
          return createErrorResponse(
            `Label assignment could not be verified. The API returned an empty or invalid response. Please check if the label was actually assigned in Okta.`
          );
        }

        return createJsonResponse({
          success: true,
          action: 'assign_existing',
          message: `✅ Successfully assigned "${discovery.matchingValue.name}" (from label "${discovery.matchingLabel.name}") to ${resource.label}`,
          resource: {
            name: resource.label,
            type: resource.type,
            id: resource.id,
          },
          label: {
            name: discovery.matchingLabel.name,
            value: discovery.matchingValue.name,
          },
          assignment,
        });
      }

      case 'create_value': {
        // Label exists but value doesn't - guide user
        if (!discovery.matchingLabel) {
          return createErrorResponse('Label information missing from discovery');
        }

        const formattedMessage = `${discovery.suggestions.message}

**Resource:** ${resource.label} (${resource.type})

Please reply with your choice:
- To use an existing value: just type the value name
- To create a new value under "${discovery.matchingLabel.name}": specify "create value: <name>"
- To create a completely new label: type "new label"`;

        return createJsonResponse({
          status: 'guidance_needed',
          message: formattedMessage,
          existingValues: discovery.suggestions.options,
          label: {
            id: discovery.matchingLabel.id,
            name: discovery.matchingLabel.name,
          },
          resource: {
            name: resource.label,
            type: resource.type,
            id: resource.id,
          },
        });
      }

      case 'create_label': {
        // No label exists - guide user to provide both label name and value
        const formattedMessage = `${discovery.suggestions.message}

**Resource:** ${resource.label} (${resource.type})

To proceed, please reply with:
**"create label: <label-name> value: <value-name>"**

Example: "create label: Risk value: high-risk"`;

        return createJsonResponse({
          status: 'guidance_needed',
          message: formattedMessage,
          existingLabels: discovery.existingLabels.slice(0, 5).map((l) => ({
            name: l.name,
            valueCount: l.values.length,
          })),
          resource: {
            name: resource.label,
            type: resource.type,
            id: resource.id,
          },
        });
      }

      default:
        return createErrorResponse('Unknown recommended action');
    }
  } catch (error) {
    console.error('[ManageLabels] Guided workflow failed:', error);
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

  console.log('[ManageLabels Enhanced] Executing tool:', {
    action: input.action,
    subject: context.subject,
  });

  try {
    switch (input.action) {
      case 'list': {
        const labels = await listLabelsWithValues(context);
        return createJsonResponse({
          total: labels.length,
          labels: labels.map((l) => ({
            name: l.name,
            description: l.description,
            values: l.values.map((v) => v.name),
            valueCount: l.values.length,
          })),
          message: `Found ${labels.length} labels`,
        });
      }

      case 'discover': {
        const searchTerm = input.searchTerm || input.labelName || input.labelValue;
        if (!searchTerm) {
          return createErrorResponse('searchTerm, labelName, or labelValue is required for discover action');
        }

        const discovery = await discoverLabels(searchTerm, context);
        return createJsonResponse({
          searchTerm,
          ...discovery.suggestions,
          matchingLabel: discovery.matchingLabel
            ? {
                name: discovery.matchingLabel.name,
                values: discovery.matchingLabel.values.map((v) => v.name),
              }
            : undefined,
          matchingValue: discovery.matchingValue?.name,
        });
      }

      case 'apply': {
        return await guidedApplyWorkflow(input, context);
      }

      case 'create': {
        if (!input.labelName || !input.labelValue) {
          return createErrorResponse('Both labelName and labelValue are required for create action');
        }

        const label = await createLabelWithValue(
          input.labelName,
          input.labelValue,
          input.labelDescription,
          context
        );

        return createJsonResponse({
          success: true,
          action: 'create',
          label: {
            name: label.name,
            values: label.values.map((v) => v.name),
          },
          message: `✅ Created label "${label.name}" with value "${input.labelValue}"`,
        });
      }

      default:
        return createErrorResponse(`Unknown action: ${input.action}`);
    }
  } catch (error) {
    console.error('[ManageLabels Enhanced] Error:', error);
    return createErrorResponse(
      `Failed to execute label management: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Enhanced tool definition
 */
export const manageAppLabelsEnhancedTool: ToolDefinition = {
  definition: {
    name: 'manage_app_labels',
    description: `Guided label management assistant for Okta Governance.

Labels have a structure:
- Label (key): The category (e.g., "Risk", "Compliance")
- Label Values: Options under that category (e.g., "high-risk", "medium-risk")

Before applying labels:
1. Searches existing labels and values
2. Provides clear guidance on what exists
3. Suggests the easiest path forward
4. Uses simple, user-friendly language

Automatically resolves resource ORNs (no need to provide ORNs manually).

Actions:
- discover: Search existing labels/values and get guidance
- list: List all labels with their values
- create: Create a new label with a value
- apply: Intelligently apply a label value (with guided discovery)`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['discover', 'list', 'create', 'apply'],
          description: 'Label operation: discover (search), list (all), create (new), apply (assign)',
        },

        // Resource identification
        appId: {
          type: 'string',
          description: 'Application ID',
        },
        resourceType: {
          type: 'string',
          enum: ['app', 'group', 'entitlement'],
          description: 'Type of resource (default: app)',
        },
        resourceId: {
          type: 'string',
          description: 'Generic resource ID (alternative to appId)',
        },

        // Label/value identification
        labelName: {
          type: 'string',
          description: 'Label name (category) - e.g., "Risk", "Compliance"',
        },
        labelValue: {
          type: 'string',
          description: 'Label value - e.g., "high-risk", "PCI-compliant"',
        },
        labelDescription: {
          type: 'string',
          description: 'Description for new label (optional)',
        },

        // Discovery
        searchTerm: {
          type: 'string',
          description: 'Search term for discover action',
        },
      },
      required: ['action'],
    },
  },
  handler,
};

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
    const response = await callGovernanceAPI<{ labels: Label[] }>(endpoint, {
      scopes: 'okta.governance.labels.read',
    });

    const labels = response.labels || [];
    console.log(`[ManageLabels] Found ${labels.length} labels`);

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
    return {
      existingLabels,
      matchingLabel: directLabelMatch,
      suggestions: {
        labelExists: true,
        valueExists: false,
        recommendedAction: 'assign_existing',
        message: `I found the label "${directLabelMatch.name}" with ${directLabelMatch.values.length} available values.`,
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
      return {
        existingLabels,
        matchingLabel: label,
        matchingValue,
        suggestions: {
          labelExists: true,
          valueExists: true,
          recommendedAction: 'assign_existing',
          message: `I found the label "${label.name}" which has the value "${matchingValue.name}".`,
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
    return {
      existingLabels,
      matchingLabel: bestMatch,
      suggestions: {
        labelExists: true,
        valueExists: false,
        recommendedAction: 'create_value',
        message: `I found a similar label: "${bestMatch.name}". Did you mean to use one of its values, or create a new value?`,
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
    return {
      existingLabels,
      matchingLabel: bestMatch.label,
      matchingValue: bestMatch.value,
      suggestions: {
        labelExists: true,
        valueExists: true,
        recommendedAction: 'assign_existing',
        message: `I found a similar value: "${bestMatch.value.name}" under the label "${bestMatch.label.name}".`,
        options: bestMatch.label.values.map((v) => v.name),
      },
    };
  }

  // Strategy 5: No matches - new label needed
  console.log('[ManageLabels] No matches found, new label needed');
  return {
    existingLabels,
    suggestions: {
      labelExists: false,
      valueExists: false,
      recommendedAction: 'create_label',
      message: `I couldn't find any existing labels or values matching "${searchTerm}". To create a new label, I'll need:
1. The label name (category) - for example: "Risk", "Compliance", "Department"
2. The first value under that label - for example: "high-risk", "PCI-compliant", "Engineering"`,
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
  console.log('[ManageLabels] Assigning label value:', {
    labelId,
    valueId,
    resourceOrn,
    resourceType,
  });

  const endpoint = findEndpointByName('Assign the labels to resources');
  if (!endpoint) {
    throw new Error('Label assignment endpoint not found in registry');
  }

  const requestBody = {
    assignments: [
      {
        resourceOrn,
        resourceType,
        labelValues: [
          {
            labelId,
            valueId,
          },
        ],
      },
    ],
  };

  try {
    const response = await callGovernanceAPI<any>(endpoint, {
      body: requestBody,
      scopes: 'okta.governance.labels.manage',
    });

    console.log('[ManageLabels] Successfully assigned label value');
    return response;
  } catch (error) {
    console.error('[ManageLabels] Failed to assign label value:', error);
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
          return createJsonResponse({
            status: 'guidance_needed',
            message: discovery.suggestions.message,
            availableValues: discovery.suggestions.options,
            nextStep: 'Please specify which value you want to assign from the list above.',
            resource: {
              name: resource.label,
              type: resource.type,
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
        return createJsonResponse({
          status: 'guidance_needed',
          message: discovery.suggestions.message,
          existingValues: discovery.suggestions.options,
          recommendedAction: 'Choose one of the existing values above, or tell me the new value you want to create.',
          resource: {
            name: resource.label,
            type: resource.type,
          },
          label: {
            name: discovery.matchingLabel?.name,
          },
        });
      }

      case 'create_label': {
        // No label exists - guide user to provide both label name and value
        return createJsonResponse({
          status: 'guidance_needed',
          message: discovery.suggestions.message,
          existingLabels: discovery.existingLabels.map((l) => ({
            name: l.name,
            values: l.values.map((v) => v.name),
          })),
          recommendedAction: 'Please provide:\n1. The label name (category)\n2. The value under that label',
          resource: {
            name: resource.label,
            type: resource.type,
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

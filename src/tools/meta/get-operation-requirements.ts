/**
 * Get operation requirements
 *
 * Returns requirements for a specific API operation/endpoint
 */

import { findEndpointByName, getAllEndpoints } from '../../catalog/endpoint-registry.js';
import type { ToolDefinition } from '../types.js';
import { createTextResponse, createErrorResponse, createJsonResponse } from '../types.js';

export const getOperationRequirementsTool: ToolDefinition = {
  definition: {
    name: 'get_operation_requirements',
    description:
      'Get the required scopes and details for a specific Okta Governance API operation. Use this to understand what permissions are needed for a particular API endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        operationName: {
          type: 'string',
          description: 'The name of the API operation (e.g., "Create a campaign")',
        },
        searchMode: {
          type: 'boolean',
          description: 'If true, search for operations containing the query string',
        },
      },
      required: ['operationName'],
    },
  },

  async handler(args) {
    const { operationName, searchMode = false } = args as {
      operationName: string;
      searchMode?: boolean;
    };

    if (!operationName) {
      return createErrorResponse('operationName parameter is required');
    }

    // Try exact match first
    let endpoint = findEndpointByName(operationName);

    // If not found and search mode, find similar endpoints
    if (!endpoint && searchMode) {
      const allEndpoints = getAllEndpoints();
      const lowerQuery = operationName.toLowerCase();
      const matches = allEndpoints.filter((ep) =>
        ep.name.toLowerCase().includes(lowerQuery)
      );

      if (matches.length === 0) {
        return createTextResponse(
          `No operations found matching '${operationName}'. Try a different search term or use exact operation name.`
        );
      }

      if (matches.length > 1) {
        return createJsonResponse({
          message: `Found ${matches.length} operations matching '${operationName}'`,
          matches: matches.map((ep) => ({
            name: ep.name,
            method: ep.method,
            path: ep.normalizedPath,
            category: ep.category,
          })),
          hint: 'Use the exact operation name to get detailed requirements',
        });
      }

      endpoint = matches[0];
    }

    if (!endpoint) {
      return createTextResponse(
        `Operation '${operationName}' not found in the endpoint registry. ` +
          `The registry may not be loaded or the operation name may be incorrect. ` +
          `Try setting searchMode to true to find similar operations.`
      );
    }

    // Infer required scopes from endpoint
    const requiredScopes = inferScopesFromEndpoint(endpoint.method, endpoint.category);

    // Build comprehensive response
    const response = {
      operation: endpoint.name,
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.normalizedPath,
      category: endpoint.category,
      subcategory: endpoint.subcategory,
      description: endpoint.description,
      requiredScopes,
      requestDetails: {
        headers: endpoint.headers
          .filter((h) => !h.disabled)
          .map((h) => ({ key: h.key, value: h.value })),
        queryParams: endpoint.queryParams.map((q) => ({
          key: q.key,
          required: !q.disabled,
          description: q.description,
        })),
        bodyRequired: endpoint.requestBody !== undefined,
        bodyFormat: endpoint.requestBody?.language,
      },
      exampleResponses: endpoint.exampleResponses.map((ex) => ({
        name: ex.name,
        status: ex.status,
        code: ex.code,
      })),
      authNote: endpoint.authNote,
    };

    return createJsonResponse(response);
  },
};

/**
 * Infer required scopes from endpoint method and category
 */
function inferScopesFromEndpoint(method: string, category: string): string[] {
  const scopes: string[] = [];

  // Map category to scope prefix
  const categoryToScope: Record<string, string> = {
    Campaigns: 'accessCertifications',
    Reviews: 'accessCertifications',
    Entitlements: 'entitlements',
    'Entitlement Bundles': 'collections',
    Grants: 'entitlements',
    'Principal Entitlements': 'entitlements',
    'Principal Access': 'principalSettings',
    'Principal Access - V2': 'principalSettings',
    Collections: 'collections',
    'Risk Rules': 'riskRule',
    'Resource Owners': 'resourceOwner',
    Labels: 'labels',
    'Principal Settings': 'principalSettings',
    Delegates: 'delegates',
    'Security Access Reviews': 'securityAccessReviews',
    'Org Governance Settings': 'settings',
    'Entitlement Settings': 'settings',
    Operations: 'operations',
    'Access Requests - V1': 'accessRequests',
    'Access Requests - V2': 'accessRequests',
  };

  const scopePrefix = categoryToScope[category] || category.toLowerCase().replace(/\s+/g, '_');

  // Determine action based on method
  if (method === 'GET' || method === 'HEAD') {
    scopes.push(`okta.governance.${scopePrefix}.read`);
  } else if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    scopes.push(`okta.governance.${scopePrefix}.manage`);
    // Some mutations may also need read
    if (method !== 'POST') {
      scopes.push(`okta.governance.${scopePrefix}.read`);
    }
  }

  return scopes;
}

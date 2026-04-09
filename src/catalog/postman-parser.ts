/**
 * Postman collection parser
 *
 * Parses Okta Governance API Postman collection to extract comprehensive endpoint catalog
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import type {
  PostmanCollection,
  PostmanItem,
  PostmanRequest,
  PostmanUrl,
  PostmanQueryParam,
  PostmanHeader,
  PostmanVariable,
  ParsedEndpoint,
  EndpointExampleResponse,
} from '../types/index.js';

/**
 * Parse Postman collection file
 */
export function parsePostmanCollection(filePath: string): ParsedEndpoint[] {
  const content = readFileSync(filePath, 'utf8');
  const collection = JSON.parse(content) as PostmanCollection;

  const endpoints: ParsedEndpoint[] = [];

  function extractEndpoints(items: PostmanItem[], folderPath: string[] = []) {
    for (const item of items) {
      if (item.item) {
        // This is a folder, recurse with updated path
        extractEndpoints(item.item, [...folderPath, item.name]);
      } else if (item.request) {
        // This is an actual request
        const endpoint = parseEndpoint(item, folderPath);
        endpoints.push(endpoint);
      }
    }
  }

  extractEndpoints(collection.item);

  return endpoints;
}

/**
 * Parse a single endpoint from a Postman item
 */
function parseEndpoint(item: PostmanItem, folderPath: string[]): ParsedEndpoint {
  const request = item.request!;

  // Parse URL
  const urlInfo = parseUrl(request.url);

  // Determine category and subcategory
  const category = folderPath[1] || folderPath[0] || 'Uncategorized'; // Skip "Management APIs"
  const subcategory = folderPath.length > 2 ? folderPath[2] : undefined;

  // Generate unique ID
  const id = generateEndpointId(item.name, request.method, urlInfo.normalizedPath);

  // Parse request body
  const requestBody = parseRequestBody(request);

  // Parse auth info
  const authInfo = parseAuthInfo(request);

  // Parse example responses
  const exampleResponses = parseExampleResponses(item.response || []);

  return {
    id,
    name: item.name,
    category,
    subcategory,
    folderPath,
    method: request.method,
    rawUrl: urlInfo.raw,
    normalizedPath: urlInfo.normalizedPath,
    pathSegments: urlInfo.pathSegments,
    queryParams: urlInfo.queryParams,
    pathVariables: urlInfo.pathVariables,
    headers: request.header || [],
    requestBody,
    description: request.description || item.description,
    authType: authInfo.type,
    authNote: authInfo.note,
    exampleResponses,
  };
}

/**
 * Parse URL information
 */
function parseUrl(url: PostmanUrl | string): {
  raw: string;
  normalizedPath: string;
  pathSegments: string[];
  queryParams: PostmanQueryParam[];
  pathVariables: PostmanVariable[];
} {
  if (typeof url === 'string') {
    return {
      raw: url,
      normalizedPath: url,
      pathSegments: url.split('/').filter(Boolean),
      queryParams: [],
      pathVariables: [],
    };
  }

  const raw = url.raw || '';
  const pathSegments = url.path || [];
  const queryParams = url.query || [];
  const pathVariables = url.variable || [];

  // Build normalized path (without {{variables}})
  let normalizedPath = '/' + pathSegments.join('/');

  // Remove variable placeholders
  normalizedPath = normalizedPath.replace(/\{\{[^}]+\}\}/g, '');

  // Clean up double slashes
  normalizedPath = normalizedPath.replace(/\/+/g, '/');

  return {
    raw,
    normalizedPath,
    pathSegments,
    queryParams: queryParams.filter((q) => !q.disabled),
    pathVariables,
  };
}

/**
 * Parse request body information
 */
function parseRequestBody(
  request: PostmanRequest
): ParsedEndpoint['requestBody'] | undefined {
  if (!request.body) {
    return undefined;
  }

  const body = request.body;

  return {
    mode: body.mode || 'raw',
    sample: body.raw,
    language: body.options?.raw?.language || 'json',
  };
}

/**
 * Parse auth information
 */
function parseAuthInfo(request: PostmanRequest): { type?: string; note?: string } {
  if (!request.auth) {
    return {};
  }

  const authType = request.auth.type;

  // Add note about OAuth Bearer replacement
  let note: string | undefined;
  if (authType === 'apikey') {
    note =
      'Original collection uses API key auth. Replace with OAuth Bearer token for service app execution.';
  }

  return {
    type: authType,
    note,
  };
}

/**
 * Parse example responses
 */
function parseExampleResponses(responses: any[]): EndpointExampleResponse[] {
  return responses.map((response) => {
    // Extract content type from headers
    const contentType = response.header?.find(
      (h: PostmanHeader) => h.key.toLowerCase() === 'content-type'
    )?.value;

    return {
      name: response.name,
      status: response.status,
      code: response.code,
      body: response.body,
      contentType,
      headers: response.header || [],
    };
  });
}

/**
 * Generate unique endpoint ID
 */
function generateEndpointId(name: string, method: string, path: string): string {
  const combined = `${method}:${path}:${name}`;
  return createHash('sha256').update(combined).digest('hex').substring(0, 16);
}

/**
 * Get unique endpoint categories from parsed endpoints
 */
export function getEndpointCategories(endpoints: ParsedEndpoint[]): string[] {
  const categories = new Set<string>();
  for (const endpoint of endpoints) {
    categories.add(endpoint.category);
  }
  return Array.from(categories).sort();
}

/**
 * Filter endpoints by category
 */
export function filterEndpointsByCategory(
  endpoints: ParsedEndpoint[],
  category: string
): ParsedEndpoint[] {
  return endpoints.filter((ep) => ep.category === category);
}

/**
 * Filter endpoints by method
 */
export function filterEndpointsByMethod(
  endpoints: ParsedEndpoint[],
  method: string
): ParsedEndpoint[] {
  return endpoints.filter((ep) => ep.method === method.toUpperCase());
}

/**
 * Get endpoint summary statistics
 */
export function getEndpointStats(endpoints: ParsedEndpoint[]) {
  const methods = new Map<string, number>();
  const categories = new Map<string, number>();
  const withBody = endpoints.filter((ep) => ep.requestBody).length;
  const withResponses = endpoints.filter((ep) => ep.exampleResponses.length > 0).length;

  for (const endpoint of endpoints) {
    methods.set(endpoint.method, (methods.get(endpoint.method) || 0) + 1);
    categories.set(endpoint.category, (categories.get(endpoint.category) || 0) + 1);
  }

  return {
    totalEndpoints: endpoints.length,
    methods: Object.fromEntries(methods),
    categories: Object.fromEntries(categories),
    withRequestBody: withBody,
    withExampleResponses: withResponses,
  };
}

/**
 * Group endpoints by category with subcategories
 */
export function groupEndpointsByCategory(endpoints: ParsedEndpoint[]): Map<
  string,
  {
    endpoints: ParsedEndpoint[];
    subcategories: Map<string, ParsedEndpoint[]>;
  }
> {
  const grouped = new Map<
    string,
    {
      endpoints: ParsedEndpoint[];
      subcategories: Map<string, ParsedEndpoint[]>;
    }
  >();

  for (const endpoint of endpoints) {
    if (!grouped.has(endpoint.category)) {
      grouped.set(endpoint.category, {
        endpoints: [],
        subcategories: new Map(),
      });
    }

    const categoryGroup = grouped.get(endpoint.category)!;
    categoryGroup.endpoints.push(endpoint);

    if (endpoint.subcategory) {
      if (!categoryGroup.subcategories.has(endpoint.subcategory)) {
        categoryGroup.subcategories.set(endpoint.subcategory, []);
      }
      categoryGroup.subcategories.get(endpoint.subcategory)!.push(endpoint);
    }
  }

  return grouped;
}

/**
 * Search endpoints by name (fuzzy)
 */
export function searchEndpointsByName(
  endpoints: ParsedEndpoint[],
  query: string
): ParsedEndpoint[] {
  const lowerQuery = query.toLowerCase();
  return endpoints.filter((ep) => ep.name.toLowerCase().includes(lowerQuery));
}

/**
 * Search endpoints by path
 */
export function searchEndpointsByPath(
  endpoints: ParsedEndpoint[],
  pathFragment: string
): ParsedEndpoint[] {
  const lowerFragment = pathFragment.toLowerCase();
  return endpoints.filter((ep) => ep.normalizedPath.toLowerCase().includes(lowerFragment));
}

/**
 * Governance endpoint registry
 *
 * Maintains catalog of available Okta Governance API endpoints
 */

import {
  parsePostmanCollection,
  groupEndpointsByCategory,
} from './postman-parser.js';
import type {
  EndpointRegistry,
  EndpointCategory,
  ParsedEndpoint,
  EndpointSearchFilters,
} from '../types/index.js';

/**
 * In-memory endpoint registry
 */
let registry: EndpointRegistry | null = null;

/**
 * Load endpoint registry from Postman collection
 *
 * Loads ALL endpoints from the Postman collection and makes them available
 * for intelligent tool execution via endpoint metadata.
 */
export function loadEndpointRegistry(postmanCollectionPath: string): EndpointRegistry {
  console.log('[EndpointRegistry] Loading endpoints from:', postmanCollectionPath);

  const endpoints = parsePostmanCollection(postmanCollectionPath);
  const categoriesMap = buildCategoryMap(endpoints);

  registry = {
    endpoints,
    categories: categoriesMap,
    totalCount: endpoints.length,
  };

  console.log('[EndpointRegistry] ✅ Loaded', endpoints.length, 'endpoints across', categoriesMap.size, 'categories');

  // Log category breakdown
  const categoryBreakdown = Array.from(categoriesMap.entries())
    .sort((a, b) => b[1].endpointCount - a[1].endpointCount)
    .slice(0, 10)
    .map(([name, cat]) => `  - ${name}: ${cat.endpointCount} endpoints`)
    .join('\n');

  console.log('[EndpointRegistry] Top categories:\n' + categoryBreakdown);

  return registry;
}

/**
 * Load all endpoints (alias for loadEndpointRegistry)
 *
 * This function emphasizes that ALL endpoints from the Postman collection
 * are loaded, not just a subset.
 */
export function loadAllEndpoints(postmanCollectionPath: string): EndpointRegistry {
  return loadEndpointRegistry(postmanCollectionPath);
}

/**
 * Build category map with metadata
 */
function buildCategoryMap(endpoints: ParsedEndpoint[]): Map<string, EndpointCategory> {
  const categoriesMap = new Map<string, EndpointCategory>();
  const grouped = groupEndpointsByCategory(endpoints);

  for (const [categoryName, categoryData] of grouped.entries()) {
    const subcategories = Array.from(categoryData.subcategories.keys()).sort();

    categoriesMap.set(categoryName, {
      name: categoryName,
      endpointCount: categoryData.endpoints.length,
      subcategories,
    });
  }

  return categoriesMap;
}

/**
 * Get loaded registry
 */
export function getEndpointRegistry(): EndpointRegistry | null {
  return registry;
}

/**
 * Get all endpoints
 */
export function getAllEndpoints(): ParsedEndpoint[] {
  if (!registry) {
    return [];
  }
  return registry.endpoints;
}

/**
 * Get endpoints by category
 */
export function getEndpointsByCategory(category: string): ParsedEndpoint[] {
  if (!registry) {
    return [];
  }

  return registry.endpoints.filter((ep) => ep.category === category);
}

/**
 * Get endpoints by subcategory
 */
export function getEndpointsBySubcategory(
  category: string,
  subcategory: string
): ParsedEndpoint[] {
  if (!registry) {
    return [];
  }

  return registry.endpoints.filter(
    (ep) => ep.category === category && ep.subcategory === subcategory
  );
}

/**
 * Find endpoint by name
 */
export function findEndpointByName(name: string): ParsedEndpoint | undefined {
  if (!registry) {
    return undefined;
  }

  return registry.endpoints.find((ep) => ep.name === name);
}

/**
 * Find endpoint by ID
 */
export function findEndpointById(id: string): ParsedEndpoint | undefined {
  if (!registry) {
    return undefined;
  }

  return registry.endpoints.find((ep) => ep.id === id);
}

/**
 * Find endpoints by method
 */
export function findEndpointsByMethod(method: string): ParsedEndpoint[] {
  if (!registry) {
    return [];
  }

  const upperMethod = method.toUpperCase();
  return registry.endpoints.filter((ep) => ep.method === upperMethod);
}

/**
 * List endpoint categories
 */
export function listEndpointCategories(): EndpointCategory[] {
  if (!registry) {
    return [];
  }

  return Array.from(registry.categories.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

/**
 * Get category by name
 */
export function getCategoryByName(name: string): EndpointCategory | undefined {
  if (!registry) {
    return undefined;
  }

  return registry.categories.get(name);
}

/**
 * Search endpoints with filters
 */
export function searchEndpoints(filters: EndpointSearchFilters): ParsedEndpoint[] {
  if (!registry) {
    return [];
  }

  let results = registry.endpoints;

  // Filter by category
  if (filters.category) {
    results = results.filter((ep) => ep.category === filters.category);
  }

  // Filter by subcategory
  if (filters.subcategory) {
    results = results.filter((ep) => ep.subcategory === filters.subcategory);
  }

  // Filter by method
  if (filters.method) {
    const upperMethod = filters.method.toUpperCase();
    results = results.filter((ep) => ep.method === upperMethod);
  }

  // Filter by path contains
  if (filters.pathContains) {
    const lowerPath = filters.pathContains.toLowerCase();
    results = results.filter((ep) => ep.normalizedPath.toLowerCase().includes(lowerPath));
  }

  // Filter by name contains
  if (filters.nameContains) {
    const lowerName = filters.nameContains.toLowerCase();
    results = results.filter((ep) => ep.name.toLowerCase().includes(lowerName));
  }

  return results;
}

/**
 * Get endpoints for a specific path pattern
 */
export function getEndpointsByPathPattern(pathPattern: string): ParsedEndpoint[] {
  if (!registry) {
    return [];
  }

  const lowerPattern = pathPattern.toLowerCase();
  return registry.endpoints.filter((ep) =>
    ep.normalizedPath.toLowerCase().includes(lowerPattern)
  );
}

/**
 * Get all unique HTTP methods in the registry
 */
export function getAllMethods(): string[] {
  if (!registry) {
    return [];
  }

  const methods = new Set<string>();
  for (const endpoint of registry.endpoints) {
    methods.add(endpoint.method);
  }

  return Array.from(methods).sort();
}

/**
 * Get endpoints with request body
 */
export function getEndpointsWithRequestBody(): ParsedEndpoint[] {
  if (!registry) {
    return [];
  }

  return registry.endpoints.filter((ep) => ep.requestBody !== undefined);
}

/**
 * Get endpoints with example responses
 */
export function getEndpointsWithExamples(): ParsedEndpoint[] {
  if (!registry) {
    return [];
  }

  return registry.endpoints.filter((ep) => ep.exampleResponses.length > 0);
}

/**
 * Get summary statistics for the registry
 */
export function getRegistryStats() {
  if (!registry) {
    return null;
  }

  const methods = new Map<string, number>();
  const categories = new Map<string, number>();
  let withBody = 0;
  let withExamples = 0;
  let withDescription = 0;

  for (const endpoint of registry.endpoints) {
    methods.set(endpoint.method, (methods.get(endpoint.method) || 0) + 1);
    categories.set(endpoint.category, (categories.get(endpoint.category) || 0) + 1);

    if (endpoint.requestBody) withBody++;
    if (endpoint.exampleResponses.length > 0) withExamples++;
    if (endpoint.description) withDescription++;
  }

  return {
    totalEndpoints: registry.totalCount,
    methods: Object.fromEntries(methods),
    categories: Object.fromEntries(categories),
    endpointsWithRequestBody: withBody,
    endpointsWithExamples: withExamples,
    endpointsWithDescription: withDescription,
  };
}

/**
 * Check if registry is loaded
 */
export function isRegistryLoaded(): boolean {
  return registry !== null;
}

/**
 * Get registry load status with details
 */
export function getRegistryStatus(): {
  loaded: boolean;
  endpointCount: number;
  categoryCount: number;
  categories: string[];
} {
  if (!registry) {
    return {
      loaded: false,
      endpointCount: 0,
      categoryCount: 0,
      categories: [],
    };
  }

  return {
    loaded: true,
    endpointCount: registry.totalCount,
    categoryCount: registry.categories.size,
    categories: Array.from(registry.categories.keys()).sort(),
  };
}

/**
 * Verify endpoint availability for a tool
 *
 * Checks if all required endpoints for a tool are available in the registry.
 *
 * @param toolName - Tool name
 * @param requiredEndpointNames - Array of endpoint names the tool needs
 * @returns Object with availability status and missing endpoints
 */
export function verifyToolEndpoints(
  _toolName: string,
  requiredEndpointNames: string[]
): {
  available: boolean;
  missing: string[];
  found: string[];
} {
  const found: string[] = [];
  const missing: string[] = [];

  for (const endpointName of requiredEndpointNames) {
    const endpoint = findEndpointByName(endpointName);
    if (endpoint) {
      found.push(endpointName);
    } else {
      missing.push(endpointName);
    }
  }

  return {
    available: missing.length === 0,
    missing,
    found,
  };
}

/**
 * Get detailed registry information
 *
 * Returns comprehensive information about loaded endpoints for debugging
 * and verification purposes.
 */
export function getRegistryInfo(): {
  loaded: boolean;
  totalEndpoints: number;
  categories: Array<{ name: string; count: number; subcategories: string[] }>;
  methods: Record<string, number>;
  topCategories: Array<{ name: string; count: number }>;
} {
  if (!registry) {
    return {
      loaded: false,
      totalEndpoints: 0,
      categories: [],
      methods: {},
      topCategories: [],
    };
  }

  // Category details
  const categories = Array.from(registry.categories.entries())
    .map(([name, cat]) => ({
      name,
      count: cat.endpointCount,
      subcategories: cat.subcategories,
    }))
    .sort((a, b) => b.count - a.count);

  // Method counts
  const methods: Record<string, number> = {};
  for (const endpoint of registry.endpoints) {
    methods[endpoint.method] = (methods[endpoint.method] || 0) + 1;
  }

  // Top 10 categories
  const topCategories = categories.slice(0, 10).map((cat) => ({
    name: cat.name,
    count: cat.count,
  }));

  return {
    loaded: true,
    totalEndpoints: registry.totalCount,
    categories,
    methods,
    topCategories,
  };
}

/**
 * Clear registry (useful for testing)
 */
export function clearRegistry(): void {
  registry = null;
}

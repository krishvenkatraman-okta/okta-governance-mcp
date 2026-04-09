/**
 * Scope intelligence and inference
 *
 * Maps endpoint categories and HTTP methods to required OAuth scopes
 */

/**
 * Category to scope prefix mapping
 *
 * Maps Postman collection categories to Okta OAuth scope prefixes
 */
const CATEGORY_TO_SCOPE_MAP: Record<string, string> = {
  // Campaigns and Reviews
  Campaigns: 'governance.accessCertifications',
  Reviews: 'governance.accessCertifications',
  'My Access Certification Reviews': 'governance.accessCertifications',

  // Entitlements
  Entitlements: 'governance.entitlements',
  'Entitlement Bundles': 'governance.collections',
  'Entitlement Settings': 'governance.settings',
  Grants: 'governance.entitlements',
  'Principal Entitlements': 'governance.entitlements',

  // Collections (Bundles)
  Collections: 'governance.collections',

  // Labels
  Labels: 'governance.labels',

  // Principal Access and Settings
  'Principal Access': 'governance.principalSettings',
  'Principal Access - V2': 'governance.principalSettings',
  'Principal Settings': 'governance.principalSettings',
  'My Settings': 'governance.principalSettings',

  // Delegates
  Delegates: 'governance.delegates',

  // Resource Owners
  'Resource Owners': 'governance.resourceOwner',

  // Risk Rules
  'Risk Rules': 'governance.riskRule',

  // Security Access Reviews
  'Security Access Reviews': 'governance.securityAccessReviews.admin',
  'My Security Access Reviews': 'governance.securityAccessReviews.endUser',

  // Governance Settings
  'Org Governance Settings': 'governance.settings',

  // Operations
  Operations: 'governance.operations',

  // Access Requests
  'Access Requests - V1': 'accessRequests.request',
  'Access Requests - V2': 'accessRequests.request',
  'My Requests': 'accessRequests.request',
  'My Catalogs': 'accessRequests.catalog',
};

/**
 * Infer OAuth scopes from endpoint category and HTTP method
 *
 * Rules:
 * - GET/HEAD → .read scope
 * - POST/PUT/PATCH/DELETE → .manage scope (+ .read for non-POST)
 *
 * @param category - Endpoint category from Postman collection
 * @param method - HTTP method
 * @returns Array of required OAuth scopes
 */
export function inferScopesFromEndpoint(category: string, method: string): string[] {
  const scopes: string[] = [];

  // Get scope prefix for category
  const scopePrefix = CATEGORY_TO_SCOPE_MAP[category];

  if (!scopePrefix) {
    // Unknown category - return generic governance scope
    console.warn(`Unknown category for scope inference: ${category}`);
    return ['okta.governance.read'];
  }

  const upperMethod = method.toUpperCase();

  // Determine action based on HTTP method
  if (upperMethod === 'GET' || upperMethod === 'HEAD') {
    // Read-only operations
    scopes.push(`okta.${scopePrefix}.read`);
  } else if (
    upperMethod === 'POST' ||
    upperMethod === 'PUT' ||
    upperMethod === 'PATCH' ||
    upperMethod === 'DELETE'
  ) {
    // Write operations require manage scope
    scopes.push(`okta.${scopePrefix}.manage`);

    // PUT/PATCH/DELETE also need read to verify existing resource
    if (upperMethod !== 'POST') {
      scopes.push(`okta.${scopePrefix}.read`);
    }
  }

  return scopes;
}

/**
 * Infer scopes for multiple endpoints
 *
 * Deduplicates and sorts the result
 */
export function inferScopesFromEndpoints(
  endpoints: Array<{ category: string; method: string }>
): string[] {
  const scopeSet = new Set<string>();

  for (const endpoint of endpoints) {
    const scopes = inferScopesFromEndpoint(endpoint.category, endpoint.method);
    scopes.forEach((scope) => scopeSet.add(scope));
  }

  return Array.from(scopeSet).sort();
}

/**
 * Get all scopes for a category (both read and manage)
 *
 * Useful for tools that perform multiple operations
 */
export function getAllScopesForCategory(category: string): string[] {
  const scopePrefix = CATEGORY_TO_SCOPE_MAP[category];

  if (!scopePrefix) {
    console.warn(`Unknown category: ${category}`);
    return [];
  }

  return [`okta.${scopePrefix}.read`, `okta.${scopePrefix}.manage`];
}

/**
 * Get read-only scope for a category
 */
export function getReadScopeForCategory(category: string): string | null {
  const scopePrefix = CATEGORY_TO_SCOPE_MAP[category];

  if (!scopePrefix) {
    return null;
  }

  return `okta.${scopePrefix}.read`;
}

/**
 * Get manage scope for a category
 */
export function getManageScopeForCategory(category: string): string | null {
  const scopePrefix = CATEGORY_TO_SCOPE_MAP[category];

  if (!scopePrefix) {
    return null;
  }

  return `okta.${scopePrefix}.manage`;
}

/**
 * Check if a scope is a read scope
 */
export function isReadScope(scope: string): boolean {
  return scope.endsWith('.read');
}

/**
 * Check if a scope is a manage scope
 */
export function isManageScope(scope: string): boolean {
  return scope.endsWith('.manage');
}

/**
 * Get the base scope (without .read or .manage suffix)
 */
export function getBaseScopePrefix(scope: string): string {
  return scope.replace(/\.(read|manage)$/, '');
}

/**
 * Check if two scopes are related (same base prefix)
 */
export function areScopesRelated(scope1: string, scope2: string): boolean {
  return getBaseScopePrefix(scope1) === getBaseScopePrefix(scope2);
}

/**
 * Get all available categories
 */
export function getAllCategories(): string[] {
  return Object.keys(CATEGORY_TO_SCOPE_MAP).sort();
}

/**
 * Validate that a scope follows Okta convention
 */
export function isValidOktaScope(scope: string): boolean {
  // Okta scopes follow pattern: okta.<service>.<resource>.<action>
  // or okta.<resource>.<action> for core scopes
  return /^okta\.[a-z]+(\.[a-zA-Z]+)*\.(read|manage)$/.test(scope);
}

/**
 * Get recommended scopes for common tool patterns
 */
export function getRecommendedScopes(pattern: 'list' | 'create' | 'update' | 'delete' | 'manage'): {
  description: string;
  scopes: string[];
} {
  switch (pattern) {
    case 'list':
      return {
        description: 'List/read operations only',
        scopes: ['.read'],
      };
    case 'create':
      return {
        description: 'Create new resources',
        scopes: ['.manage'],
      };
    case 'update':
      return {
        description: 'Update existing resources',
        scopes: ['.read', '.manage'],
      };
    case 'delete':
      return {
        description: 'Delete resources',
        scopes: ['.read', '.manage'],
      };
    case 'manage':
      return {
        description: 'Full CRUD operations',
        scopes: ['.read', '.manage'],
      };
    default:
      return {
        description: 'Unknown pattern',
        scopes: [],
      };
  }
}

/**
 * Explain why certain scopes are needed
 */
export function explainScopeRequirement(
  scope: string,
  method: string,
  category: string
): string {
  if (isReadScope(scope)) {
    return `Read access to ${category} is required to ${method === 'GET' ? 'retrieve' : 'verify'} resources`;
  }

  if (isManageScope(scope)) {
    const action = method === 'POST' ? 'create' : method === 'PUT' || method === 'PATCH' ? 'update' : 'delete';
    return `Manage permission for ${category} is required to ${action} resources`;
  }

  return `Scope ${scope} is required for ${method} operations on ${category}`;
}

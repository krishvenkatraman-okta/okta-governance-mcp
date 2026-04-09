/**
 * API catalog and tool registry types
 */

import { Capability, TargetConstraint } from './policy.types.js';

/**
 * Postman collection structure
 */
export interface PostmanCollection {
  info: {
    _postman_id?: string;
    name: string;
    description?: string;
    schema: string;
    _exporter_id?: string;
    _collection_link?: string;
  };
  item: PostmanItem[];
  auth?: PostmanAuth;
  variable?: PostmanVariable[];
}

/**
 * Postman item (can be a folder or a request)
 */
export interface PostmanItem {
  name: string;
  description?: string;
  item?: PostmanItem[]; // Nested items (folder)
  request?: PostmanRequest; // Actual request
  response?: PostmanResponse[];
  event?: PostmanEvent[];
}

/**
 * Postman request definition
 */
export interface PostmanRequest {
  method: string;
  header?: PostmanHeader[];
  body?: PostmanBody;
  url: PostmanUrl | string;
  description?: string;
  auth?: PostmanAuth;
}

/**
 * Postman URL structure
 */
export interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[];
  port?: string;
  path?: string[];
  query?: PostmanQueryParam[];
  variable?: PostmanVariable[];
  hash?: string;
}

/**
 * Query parameter
 */
export interface PostmanQueryParam {
  key: string;
  value?: string;
  disabled?: boolean;
  description?: string;
}

/**
 * Header
 */
export interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
  description?: string;
}

/**
 * Request body
 */
export interface PostmanBody {
  mode?: string; // raw, urlencoded, formdata, file, graphql
  raw?: string;
  options?: {
    raw?: {
      language?: string;
    };
  };
  urlencoded?: Array<{ key: string; value: string }>;
  formdata?: Array<{ key: string; value: string; type?: string }>;
}

/**
 * Auth configuration
 */
export interface PostmanAuth {
  type: string; // apikey, bearer, basic, oauth2, etc.
  apikey?: Array<{ key: string; value: string; type?: string }>;
  bearer?: Array<{ key: string; value: string; type?: string }>;
  [key: string]: unknown;
}

/**
 * Variable
 */
export interface PostmanVariable {
  key: string;
  value?: string;
  type?: string;
  description?: string;
}

/**
 * Response example
 */
export interface PostmanResponse {
  name: string;
  originalRequest?: PostmanRequest;
  status?: string;
  code?: number;
  _postman_previewlanguage?: string;
  header?: PostmanHeader[];
  cookie?: unknown[];
  body?: string;
}

/**
 * Event (pre-request, test scripts)
 */
export interface PostmanEvent {
  listen: string;
  script: {
    type?: string;
    exec?: string[];
  };
}

/**
 * Parsed endpoint from Postman collection
 */
export interface ParsedEndpoint {
  // Identity
  id: string; // Generated unique ID
  name: string;

  // Categorization
  category: string; // Top-level category (e.g., "Campaigns")
  subcategory?: string; // Optional subcategory
  folderPath: string[]; // Full folder hierarchy

  // HTTP Details
  method: string;
  rawUrl: string;
  normalizedPath: string; // Path without variables, e.g., /governance/api/v1/campaigns
  pathSegments: string[]; // ['governance', 'api', 'v1', 'campaigns']

  // Parameters
  queryParams: PostmanQueryParam[];
  pathVariables: PostmanVariable[];

  // Headers
  headers: PostmanHeader[];

  // Request Body
  requestBody?: {
    mode: string;
    sample?: string;
    language?: string;
  };

  // Description
  description?: string;

  // Auth metadata (for reference only)
  authType?: string; // 'apikey', 'bearer', etc.
  authNote?: string; // Note that OAuth Bearer should be used

  // Example responses
  exampleResponses: EndpointExampleResponse[];
}

/**
 * Endpoint example response
 */
export interface EndpointExampleResponse {
  name: string;
  status?: string;
  code?: number;
  body?: string;
  contentType?: string;
  headers?: PostmanHeader[];
}

/**
 * Endpoint category
 */
export interface EndpointCategory {
  name: string;
  description?: string;
  endpointCount: number;
  subcategories: string[];
}

/**
 * Endpoint registry
 */
export interface EndpointRegistry {
  endpoints: ParsedEndpoint[];
  categories: Map<string, EndpointCategory>;
  totalCount: number;
}

/**
 * Endpoint search filters
 */
export interface EndpointSearchFilters {
  category?: string;
  subcategory?: string;
  method?: string;
  pathContains?: string;
  nameContains?: string;
}

/**
 * Conditional scope requirement
 */
export interface ConditionalScope {
  condition: string; // Human-readable condition
  scopes: string[];
  description?: string;
}

/**
 * Tool requirement definition
 */
export interface ToolRequirement {
  // Identity
  toolName: string;
  description: string;

  // Endpoint mapping
  mappedEndpoints: string[]; // Endpoint IDs or names
  endpointCategories: string[]; // Categories this tool operates on

  // OAuth scopes
  requiredScopes: string[]; // Always required
  conditionalScopes?: ConditionalScope[]; // Context-dependent

  // Authorization
  requiredCapabilities: Capability[];
  requiredRoles?: string[]; // Okta role types
  targetConstraints: TargetConstraint[];

  // Documentation
  documentationRefs?: string[];
  notes?: string;

  // Metadata
  isMetadataTool?: boolean; // True for read-only meta tools
  requiresTargetResource?: boolean; // True if needs specific app/group
}

/**
 * Tool requirements registry
 */
export interface ToolRequirementsRegistry {
  requirements: Record<string, ToolRequirement>;
}

/**
 * Validation result for tool requirements
 */
export interface ToolRequirementValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  toolName: string;
}

/**
 * Registry validation summary
 */
export interface RegistryValidationSummary {
  totalTools: number;
  validTools: number;
  invalidTools: number;
  errors: Array<{ toolName: string; errors: string[] }>;
  warnings: Array<{ toolName: string; warnings: string[] }>;
}

/**
 * Operation requirement (for specific operations)
 */
export interface OperationRequirement {
  operation: string;
  endpoint: string;
  method: string;
  requiredScopes: string[];
  description?: string;
}

/**
 * Missing requirements detail
 */
export interface MissingRequirements {
  scopes: string[];
  capabilities: Capability[];
  roles: string[];
  targetConstraints: string[];
  reason: string;
}

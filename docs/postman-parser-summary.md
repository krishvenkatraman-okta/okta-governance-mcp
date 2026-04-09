# Postman Collection Parser - Implementation Summary

## Overview

Implemented a comprehensive parser and registry system for the Okta Governance API Postman collection. The system extracts detailed endpoint metadata to power tool execution and LLM explainability.

## What Was Built

### 1. Enhanced Type System (`src/types/catalog.types.ts`)

**Comprehensive Postman Types:**
- `PostmanCollection` - Full collection structure
- `PostmanItem` - Folders and requests with nesting
- `PostmanRequest` - HTTP request details
- `PostmanUrl` - URL structure with query params and variables
- `PostmanQueryParam`, `PostmanHeader`, `PostmanBody` - Request components
- `PostmanAuth` - Auth configuration (for metadata only)
- `PostmanResponse` - Example responses
- `PostmanVariable` - URL and path variables

**Parsed Endpoint Types:**
- `ParsedEndpoint` - Fully extracted endpoint with:
  - Identity (ID, name)
  - Categorization (category, subcategory, folder path)
  - HTTP details (method, URL, path segments)
  - Parameters (query params, path variables)
  - Headers
  - Request body (mode, sample, language)
  - Description
  - Auth metadata (type + note about OAuth replacement)
  - Example responses

**Registry Types:**
- `EndpointRegistry` - In-memory catalog with categories map
- `EndpointCategory` - Category metadata with subcategories
- `EndpointSearchFilters` - Multi-criteria search
- `EndpointExampleResponse` - Parsed response examples

### 2. Comprehensive Parser (`src/catalog/postman-parser.ts`)

**Core Functions:**
- `parsePostmanCollection()` - Main entry point, recursively parses collection
- `parseEndpoint()` - Extracts all endpoint details
- `parseUrl()` - Normalizes URLs, removes variables, extracts segments
- `parseRequestBody()` - Extracts body sample and format
- `parseAuthInfo()` - Notes auth type with OAuth replacement guidance
- `parseExampleResponses()` - Extracts all example responses with status codes

**Utility Functions:**
- `generateEndpointId()` - SHA-256 based unique IDs
- `getEndpointCategories()` - Extract unique categories
- `getEndpointStats()` - Comprehensive statistics
- `groupEndpointsByCategory()` - Hierarchical grouping
- `filterEndpointsByCategory()` - Category-based filtering
- `filterEndpointsByMethod()` - Method-based filtering
- `searchEndpointsByName()` - Fuzzy name search
- `searchEndpointsByPath()` - Path fragment search

### 3. Enhanced Registry (`src/catalog/endpoint-registry.ts`)

**Core Functions:**
- `loadEndpointRegistry()` - Load and build category map
- `getAllEndpoints()` - Get all endpoints
- `getEndpointsByCategory()` - Filter by category
- `getEndpointsBySubcategory()` - Filter by category + subcategory
- `findEndpointByName()` - Exact name lookup
- `findEndpointById()` - ID-based lookup
- `findEndpointsByMethod()` - Method filtering

**Advanced Queries:**
- `searchEndpoints()` - Multi-criteria search with filters
- `getEndpointsByPathPattern()` - Path pattern matching
- `getAllMethods()` - List all HTTP methods
- `getEndpointsWithRequestBody()` - Body-enabled endpoints
- `getEndpointsWithExamples()` - Endpoints with example responses

**Metadata Functions:**
- `listEndpointCategories()` - All categories with metadata
- `getCategoryByName()` - Category details
- `getRegistryStats()` - Comprehensive statistics

### 4. CLI Tool (`scripts/parse-postman.ts`)

**Features:**
- Beautiful formatted output with Unicode box characters
- Overall statistics (total, with body, with examples, with descriptions)
- HTTP methods breakdown with percentage bars
- Categories sorted by endpoint count with subcategories
- Sample endpoints with full details
- Detailed category breakdown for top 3 categories
- Method distribution per category
- Sample endpoints per category

## Collection Analysis Results

### Overall Statistics
- **Total Endpoints:** 153
- **With Request Body:** 51 (33.3%)
- **With Example Responses:** 153 (100%)
- **With Description:** 153 (100%)

### HTTP Methods Distribution
```
GET       81 (52.9%)  - Majority are read operations
POST      40 (26.1%)  - Create operations
PATCH     14 (9.2%)   - Partial updates
DELETE    12 (7.8%)   - Deletions
PUT        6 (3.9%)   - Full updates
```

### Top Categories by Endpoint Count
1. **Access Requests - V2** - 22 endpoints (14.4%)
   - Subcategories: Catalogs, Request Conditions, Request Sequences, Request Settings, Requests
2. **Collections** - 16 endpoints (10.5%)
3. **Security Access Reviews** - 16 endpoints (10.5%)
4. **My Security Access Reviews** - 14 endpoints (9.2%)
5. **Access Requests - V1** - 11 endpoints (7.2%)
   - Subcategories: Request Types, Requests

### All Categories (25 total)
- Access Requests - V2 (22)
- Collections (16)
- Security Access Reviews (16)
- My Security Access Reviews (14)
- Access Requests - V1 (11)
- Entitlements (9)
- Labels (8)
- Org Governance Settings (7)
- Campaigns (6)
- Risk Rules (6)
- Entitlement Bundles (5)
- Grants (5)
- My Catalogs (5)
- Resource Owners (4)
- My Settings (3)
- Principal Entitlements (3)
- Reviews (3)
- Entitlement Settings (2)
- My Requests (2)
- Delegates (1)
- My Access Certification Reviews (1)
- Operations (1)
- Principal Access (1)
- Principal Access - V2 (1)
- Principal Settings (1)

## Assumptions & Design Decisions

### 1. Category Extraction
**Decision:** Skip "Management APIs" folder level, use next level as category
- **Rationale:** "Management APIs" is a generic wrapper; the actual category is the next level (e.g., "Campaigns", "Labels")
- **Implementation:** `folderPath[1] || folderPath[0]`

### 2. Subcategory Support
**Decision:** Support optional subcategories for nested folders
- **Example:** "Access Requests - V2" → "Catalogs", "Request Conditions", etc.
- **Use Case:** Enables fine-grained filtering and organization

### 3. URL Normalization
**Decision:** Remove `{{variables}}` placeholders and clean paths
- **Rationale:** Enables path-based searching and pattern matching
- **Example:** `{{baseUrl}}/governance/api/v1/campaigns` → `/governance/api/v1/campaigns`

### 4. Auth Handling
**Decision:** Preserve auth type as metadata with OAuth replacement note
- **Rationale:** Collection uses API key auth, but runtime will use OAuth Bearer
- **Implementation:** `authType: 'apikey'` + `authNote: 'Replace with OAuth Bearer token...'`

### 5. Unique Endpoint IDs
**Decision:** Generate SHA-256 hash from `method:path:name`
- **Rationale:** Ensures stable, collision-resistant identifiers
- **Benefits:** Enables caching, lookup optimization, version comparison

### 6. Example Response Preservation
**Decision:** Extract all example responses with status codes
- **Rationale:** Powers LLM explainability about error scenarios
- **Data:** Name, status text, status code, body, headers

### 7. Request Body Metadata
**Decision:** Store body mode, sample, and language
- **Rationale:** Enables request generation and validation
- **Example:** `mode: 'raw'`, `language: 'json'`, `sample: '{...}'`

## Edge Cases & Handling

### 1. Missing Folder Structure
**Case:** Endpoints at root level without folder hierarchy
**Handling:** Use "Uncategorized" as category fallback
**Code:** `const category = folderPath[1] || folderPath[0] || 'Uncategorized'`

### 2. String vs. Object URL
**Case:** Postman URL can be string or object
**Handling:** Check type and parse accordingly
**Code:** `if (typeof url === 'string') { ... }`

### 3. Disabled Query Parameters
**Case:** Query params can be marked as disabled
**Handling:** Filter out disabled params
**Code:** `queryParams.filter((q) => !q.disabled)`

### 4. Disabled Headers
**Case:** Headers can be marked as disabled
**Handling:** Preserved in raw data, filtered in queries
**Code:** `endpoint.headers.filter((h) => !h.disabled)`

### 5. Missing Request Body
**Case:** GET/DELETE endpoints typically have no body
**Handling:** `requestBody` is optional (undefined)
**Code:** `requestBody?: { mode, sample, language }`

### 6. Multiple Example Responses
**Case:** Each endpoint can have multiple response examples (success, error cases)
**Handling:** Store all in array with status codes
**Example:** "Create a campaign" has 6 examples (201, 400, 401, 403, 429, 500)

### 7. Path Variables
**Case:** URLs with `:paramName` placeholders
**Handling:** Preserved in normalized path, listed in `pathVariables`
**Example:** `/campaigns/:campaignId` → preserved as-is

### 8. Nested Subcategories
**Case:** More than 2 levels of folder nesting
**Handling:** Use level 3 as subcategory, ignore deeper levels
**Implementation:** `folderPath.length > 2 ? folderPath[2] : undefined`

## Integration Points

### 1. MRS Tool Execution
The registry will power:
- Endpoint lookup by name for tool implementation
- Scope inference from category + method
- Request body template generation
- Response validation

### 2. LLM Explainability Tools
The `get_operation_requirements` tool now uses:
- Exact name lookup
- Fuzzy search mode
- Comprehensive endpoint details
- Scope inference based on category mapping

### 3. Tool Requirements Registry
Future integration:
- Map tool names to endpoint IDs
- Validate required scopes against endpoint requirements
- Generate tool descriptions from endpoint metadata

## Scope Inference Mapping

The parser includes category-to-scope mapping for the `get_operation_requirements` tool:

```typescript
{
  'Campaigns': 'accessCertifications',
  'Reviews': 'accessCertifications',
  'Entitlements': 'entitlements',
  'Entitlement Bundles': 'collections',
  'Collections': 'collections',
  'Labels': 'labels',
  'Risk Rules': 'riskRule',
  'Resource Owners': 'resourceOwner',
  'Security Access Reviews': 'securityAccessReviews',
  'Principal Settings': 'principalSettings',
  'Access Requests - V1': 'accessRequests',
  'Access Requests - V2': 'accessRequests',
  // ... etc
}
```

**Method-based scope suffix:**
- GET/HEAD → `.read`
- POST/PUT/PATCH/DELETE → `.manage` (+ `.read` for non-POST)

## Example Output

### Sample Endpoint Metadata
```json
{
  "id": "d78c76d578a5979b",
  "name": "Create a campaign",
  "category": "Campaigns",
  "folderPath": ["Management APIs", "Campaigns"],
  "method": "POST",
  "rawUrl": "{{baseUrl}}/governance/api/v1/campaigns",
  "normalizedPath": "/governance/api/v1/campaigns",
  "pathSegments": ["governance", "api", "v1", "campaigns"],
  "queryParams": [],
  "pathVariables": [],
  "headers": [
    {"key": "Content-Type", "value": "application/json"},
    {"key": "Accept", "value": "application/json"}
  ],
  "requestBody": {
    "mode": "raw",
    "language": "json",
    "sample": "{\n  \"campaignType\": \"RESOURCE\",\n  ..."
  },
  "description": "Creates a campaign that governs access to resources...",
  "authType": "apikey",
  "authNote": "Original collection uses API key auth. Replace with OAuth Bearer token for service app execution.",
  "exampleResponses": [
    {
      "name": "A successful campaign create response",
      "status": "Created",
      "code": 201,
      "contentType": "application/json"
    },
    {
      "name": "An invalid request to define a campaign",
      "status": "Bad Request",
      "code": 400
    }
    // ... 4 more examples
  ]
}
```

## Next Steps

### 1. Tool Implementation
- Use endpoint metadata to generate tool handlers
- Map endpoint IDs to tool names
- Use request body samples as templates

### 2. Scope Validation
- Cross-reference inferred scopes with actual API documentation
- Build comprehensive scope requirement rules
- Validate tool requirements against endpoint needs

### 3. Response Handling
- Use example responses for response parsing
- Build error handling based on error response examples
- Generate TypeScript types from response bodies

### 4. Path Parameter Handling
- Extract path parameter names
- Generate parameter validation
- Build parameter documentation

## Usage Examples

### Parse Collection
```typescript
import { parsePostmanCollection } from './src/catalog/postman-parser.js';

const endpoints = parsePostmanCollection('./postman/Okta Governance API.postman_collection.json');
console.log(`Parsed ${endpoints.length} endpoints`);
```

### Load Registry
```typescript
import { loadEndpointRegistry, getEndpointsByCategory } from './src/catalog/endpoint-registry.js';

loadEndpointRegistry('./postman/Okta Governance API.postman_collection.json');
const campaignEndpoints = getEndpointsByCategory('Campaigns');
```

### Search Endpoints
```typescript
import { searchEndpoints } from './src/catalog/endpoint-registry.js';

const results = searchEndpoints({
  category: 'Campaigns',
  method: 'POST',
  pathContains: 'launch'
});
```

### Use in Tools
```typescript
import { findEndpointByName } from './src/catalog/endpoint-registry.js';

const endpoint = findEndpointByName('Create a campaign');
if (endpoint) {
  const scopes = inferScopes(endpoint.method, endpoint.category);
  const bodyTemplate = endpoint.requestBody?.sample;
}
```

## Files Modified/Created

1. **src/types/catalog.types.ts** - Comprehensive type definitions (258 lines)
2. **src/catalog/postman-parser.ts** - Full parser implementation (322 lines)
3. **src/catalog/endpoint-registry.ts** - Enhanced registry with queries (300 lines)
4. **scripts/parse-postman.ts** - CLI tool with rich output (194 lines)
5. **src/tools/meta/get-operation-requirements.ts** - Updated to use registry (164 lines)
6. **docs/postman-parser-summary.md** - This document

## Validation

✅ Successfully parses all 153 endpoints
✅ Extracts all metadata fields
✅ Handles nested folder structures
✅ Preserves example responses (153/153 have examples)
✅ Extracts request bodies (51 endpoints)
✅ Handles all HTTP methods (GET, POST, PUT, PATCH, DELETE)
✅ Builds comprehensive statistics
✅ Supports advanced queries and filtering
✅ Integrates with existing tools

## Conclusion

The Postman parser and endpoint registry provide a comprehensive foundation for:
- Tool execution with proper scope requirements
- LLM explainability about API operations
- Dynamic tool generation from endpoints
- Request/response validation
- Developer tooling and documentation

All endpoints are cataloged with full metadata, organized by category, and queryable through a rich API.

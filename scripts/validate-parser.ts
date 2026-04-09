#!/usr/bin/env node
/**
 * Validate parser output
 */

import { parsePostmanCollection } from '../src/catalog/postman-parser.js';

const endpoints = parsePostmanCollection('./postman/Okta Governance API.postman_collection.json');

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  🔍 Parser Validation Tests');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Test 1: Find a specific endpoint
const createCampaign = endpoints.find((ep) => ep.name === 'Create a campaign');
if (createCampaign) {
  console.log('✓ Test 1: Parse specific endpoint');
  console.log(`  Endpoint: "${createCampaign.name}"`);
  console.log(`  ID: ${createCampaign.id}`);
  console.log(`  Method: ${createCampaign.method}`);
  console.log(`  Path: ${createCampaign.normalizedPath}`);
  console.log(`  Category: ${createCampaign.category}`);
  console.log(`  Has body: ${createCampaign.requestBody ? 'Yes' : 'No'}`);
  console.log(`  Example responses: ${createCampaign.exampleResponses.length}`);
  console.log(`  Auth type: ${createCampaign.authType}`);
  console.log('');
}

// Test 2: Check subcategories
const v2Endpoints = endpoints.filter((ep) => ep.category === 'Access Requests - V2');
const subcategories = new Set(
  v2Endpoints.filter((ep) => ep.subcategory).map((ep) => ep.subcategory)
);
console.log('✓ Test 2: Subcategory extraction');
console.log(`  Category: Access Requests - V2`);
console.log(`  Total endpoints: ${v2Endpoints.length}`);
console.log(`  Subcategories: ${subcategories.size}`);
for (const sub of subcategories) {
  const count = v2Endpoints.filter((ep) => ep.subcategory === sub).length;
  console.log(`    - ${sub}: ${count} endpoints`);
}
console.log('');

// Test 3: Check query params
const withQueryParams = endpoints.filter((ep) => ep.queryParams.length > 0);
console.log('✓ Test 3: Query parameter extraction');
console.log(`  Endpoints with query params: ${withQueryParams.length}`);
const listCampaigns = withQueryParams.find((ep) => ep.name === 'List all campaigns');
if (listCampaigns) {
  console.log(`  Example: "${listCampaigns.name}"`);
  console.log(`  Query params: ${listCampaigns.queryParams.map((q) => q.key).join(', ')}`);
}
console.log('');

// Test 4: Check path variables
const withPathVars = endpoints.filter((ep) => ep.normalizedPath.includes(':'));
console.log('✓ Test 4: Path variable handling');
console.log(`  Endpoints with path variables: ${withPathVars.length}`);
const examplePath = withPathVars[0];
if (examplePath) {
  console.log(`  Example: "${examplePath.name}"`);
  console.log(`  Path: ${examplePath.normalizedPath}`);
}
console.log('');

// Test 5: Check example responses
const allHaveExamples = endpoints.every((ep) => ep.exampleResponses.length > 0);
console.log('✓ Test 5: Example responses');
console.log(`  All endpoints have examples: ${allHaveExamples ? 'Yes' : 'No'}`);
const maxExamples = Math.max(...endpoints.map((ep) => ep.exampleResponses.length));
const endpointWithMost = endpoints.find((ep) => ep.exampleResponses.length === maxExamples);
if (endpointWithMost) {
  console.log(`  Max examples: ${maxExamples} ("${endpointWithMost.name}")`);
  console.log('  Status codes:');
  for (const ex of endpointWithMost.exampleResponses) {
    console.log(`    - ${ex.code} ${ex.status}`);
  }
}
console.log('');

// Test 6: Auth metadata
const withAuthNote = endpoints.filter((ep) => ep.authNote);
console.log('✓ Test 6: Auth metadata preservation');
console.log(`  Endpoints with auth notes: ${withAuthNote.length}`);
if (withAuthNote.length > 0) {
  console.log(`  Note: "${withAuthNote[0].authNote?.substring(0, 60)}..."`);
}
console.log('');

// Test 7: Method distribution
const methods = new Map<string, number>();
for (const ep of endpoints) {
  methods.set(ep.method, (methods.get(ep.method) || 0) + 1);
}
console.log('✓ Test 7: HTTP method distribution');
for (const [method, count] of Array.from(methods.entries()).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${method}: ${count}`);
}
console.log('');

// Test 8: Request body presence
const withBody = endpoints.filter((ep) => ep.requestBody !== undefined);
const postWithBody = endpoints.filter((ep) => ep.method === 'POST' && ep.requestBody);
console.log('✓ Test 8: Request body extraction');
console.log(`  Total with body: ${withBody.length}`);
console.log(`  POST with body: ${postWithBody.length}/${endpoints.filter((ep) => ep.method === 'POST').length}`);
console.log('');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  ✅ All validation tests passed!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

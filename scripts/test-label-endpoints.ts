#!/usr/bin/env tsx
/**
 * Test Label Endpoint Names
 *
 * Verify all label endpoints are correctly named and found in registry
 */

import { loadEndpointRegistry, findEndpointByName } from '../src/catalog/endpoint-registry.js';

const postmanPath = './postman/Okta Governance API.postman_collection.json';
loadEndpointRegistry(postmanPath);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Label Endpoint Verification');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const endpointTests = [
  'List all labels',
  'Create a label',
  'Retrieve a label',
  'Update a label',
  'Delete a label',
  'List all labeled resources',
  'Assign the labels to resources',
  'Remove the labels from resources',
];

console.log('Testing all 8 label endpoints:\n');

let allFound = true;

for (const name of endpointTests) {
  const endpoint = findEndpointByName(name);
  if (endpoint) {
    console.log(`✅ "${name}"`);
    console.log(`   ${endpoint.method} ${endpoint.normalizedPath}`);

    // Show path variables if any
    if (endpoint.pathVariables && endpoint.pathVariables.length > 0) {
      console.log(`   Variables: ${endpoint.pathVariables.map(v => v.key).join(', ')}`);
    }
    console.log();
  } else {
    console.log(`❌ "${name}" - NOT FOUND\n`);
    allFound = false;
  }
}

if (allFound) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅ ALL 8 LABEL ENDPOINTS FOUND');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
} else {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ❌ SOME ENDPOINTS NOT FOUND');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
}

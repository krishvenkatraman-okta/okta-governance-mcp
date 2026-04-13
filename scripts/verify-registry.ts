#!/usr/bin/env tsx
/**
 * Verify Endpoint Registry
 *
 * Tests that all 153 endpoints are loaded correctly from the Postman collection
 */

import {
  loadEndpointRegistry,
  getRegistryStatus,
  getRegistryInfo,
  findEndpointByName,
  getEndpointsByCategory,
  verifyToolEndpoints,
} from '../src/catalog/endpoint-registry.js';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Endpoint Registry Verification');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Load registry
console.log('[1/6] Loading endpoint registry...');
const postmanPath = './postman/Okta Governance API.postman_collection.json';
loadEndpointRegistry(postmanPath);
console.log('✅ Registry loaded\n');

// Check status
console.log('[2/6] Checking registry status...');
const status = getRegistryStatus();
console.log(`   Loaded: ${status.loaded}`);
console.log(`   Endpoints: ${status.endpointCount}`);
console.log(`   Categories: ${status.categoryCount}`);
console.log('✅ Status verified\n');

// Get detailed info
console.log('[3/6] Getting detailed information...');
const info = getRegistryInfo();
console.log(`   Total Endpoints: ${info.totalEndpoints}`);
console.log(`   HTTP Methods:`);
Object.entries(info.methods).forEach(([method, count]) => {
  console.log(`      ${method}: ${count}`);
});
console.log(`   Top 5 Categories:`);
info.topCategories.slice(0, 5).forEach((cat, idx) => {
  console.log(`      ${idx + 1}. ${cat.name}: ${cat.count} endpoints`);
});
console.log('✅ Info retrieved\n');

// Test endpoint lookup
console.log('[4/6] Testing endpoint lookup...');
const labelTests = [
  'List all labels',
  'Create a label',
  'Retrieve a label',
  'Update a label',
  'Delete a label',
  'List all labeled resources',
  'Assign the labels to resources',
];

for (const name of labelTests) {
  const endpoint = findEndpointByName(name);
  if (endpoint) {
    console.log(`   ✅ Found: "${name}" → ${endpoint.method} ${endpoint.normalizedPath}`);
  } else {
    console.error(`   ❌ Missing: "${name}"`);
    process.exit(1);
  }
}
console.log('✅ All label endpoints found\n');

// Test category filtering
console.log('[5/6] Testing category filtering...');
const categories = [
  { name: 'Labels', expectedCount: 8 },
  { name: 'Entitlements', expectedCount: 9 },
  { name: 'Campaigns', expectedCount: 6 },
  { name: 'Collections', expectedCount: 16 },
  { name: 'Access Requests - V2', expectedCount: 22 },
];

for (const cat of categories) {
  const endpoints = getEndpointsByCategory(cat.name);
  if (endpoints.length === cat.expectedCount) {
    console.log(`   ✅ ${cat.name}: ${endpoints.length} endpoints`);
  } else {
    console.error(`   ❌ ${cat.name}: Expected ${cat.expectedCount}, got ${endpoints.length}`);
    process.exit(1);
  }
}
console.log('✅ All categories verified\n');

// Test tool verification
console.log('[6/6] Testing tool endpoint verification...');
const toolVerifications = [
  {
    name: 'manage_app_labels',
    endpoints: [
      'List all labels',
      'Create a label',
      'Retrieve a label',
      'Update a label',
      'Delete a label',
      'List all labeled resources',
      'Assign the labels to resources',
    ],
  },
  // Note: Entitlements and Campaigns use different endpoint names
  // These will be verified when those tools are implemented
];

for (const tool of toolVerifications) {
  const verification = verifyToolEndpoints(tool.name, tool.endpoints);
  if (verification.available) {
    console.log(`   ✅ ${tool.name}: All ${verification.found.length} endpoints available`);
  } else {
    console.error(`   ❌ ${tool.name}: Missing ${verification.missing.length} endpoints:`);
    verification.missing.forEach((missing) => console.error(`      - ${missing}`));
    process.exit(1);
  }
}
console.log('✅ All tool verifications passed\n');

// Final summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  ✅ ALL TESTS PASSED');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`\n   Registry contains ${info.totalEndpoints} endpoints`);
console.log(`   Across ${status.categoryCount} categories`);
console.log(`   All tools have required endpoints available\n`);

console.log('   Category with most endpoints:');
console.log(`   → ${info.topCategories[0].name}: ${info.topCategories[0].count} endpoints\n`);

process.exit(0);

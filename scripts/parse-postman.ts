#!/usr/bin/env node
/**
 * Parse Postman collection CLI tool
 *
 * Parses the Okta Governance API Postman collection and outputs comprehensive statistics
 */

import { parsePostmanCollection, getEndpointStats } from '../src/catalog/postman-parser.js';
import {
  loadEndpointRegistry,
  listEndpointCategories,
  getEndpointsByCategory,
  getRegistryStats,
} from '../src/catalog/endpoint-registry.js';

function main() {
  const args = process.argv.slice(2);
  const filePath = args[0] || './postman/Okta Governance API.postman_collection.json';

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📦 Okta Governance API - Postman Collection Parser');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`📄 File: ${filePath}`);
  console.log('');

  try {
    // Parse the collection
    console.log('⏳ Parsing collection...');
    const endpoints = parsePostmanCollection(filePath);
    const stats = getEndpointStats(endpoints);

    // Load into registry
    loadEndpointRegistry(filePath);
    const registryStats = getRegistryStats();
    const categories = listEndpointCategories();

    console.log('✅ Parsing complete!\n');

    // Display overall statistics
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📊 Overall Statistics');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`Total Endpoints:           ${stats.totalEndpoints}`);
    console.log(`With Request Body:         ${stats.withRequestBody}`);
    console.log(`With Example Responses:    ${stats.withExampleResponses}`);
    if (registryStats) {
      console.log(`With Description:          ${registryStats.endpointsWithDescription}`);
    }
    console.log('');

    // Display HTTP methods breakdown
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🔧 HTTP Methods');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    for (const [method, count] of Object.entries(stats.methods)) {
      const percentage = ((count / stats.totalEndpoints) * 100).toFixed(1);
      const bar = '█'.repeat(Math.floor(count / 5));
      console.log(`${method.padEnd(8)} ${String(count).padStart(4)} (${percentage}%) ${bar}`);
    }
    console.log('');

    // Display categories breakdown
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📁 Categories');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    // Sort categories by endpoint count
    const sortedCategories = categories.sort((a, b) => b.endpointCount - a.endpointCount);

    for (const category of sortedCategories) {
      const percentage = ((category.endpointCount / stats.totalEndpoints) * 100).toFixed(1);
      console.log(
        `${category.name.padEnd(30)} ${String(category.endpointCount).padStart(4)} (${percentage}%)`
      );

      // Show subcategories if they exist
      if (category.subcategories.length > 0) {
        for (const subcategory of category.subcategories) {
          const subEndpoints = getEndpointsByCategory(category.name).filter(
            (ep) => ep.subcategory === subcategory
          );
          console.log(`  └─ ${subcategory.padEnd(26)} ${String(subEndpoints.length).padStart(4)}`);
        }
      }
    }
    console.log('');

    // Display sample endpoints
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📝 Sample Endpoints (First 5)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    for (const endpoint of endpoints.slice(0, 5)) {
      console.log(`┌─ [${endpoint.method}] ${endpoint.name}`);
      console.log(`│  ID:          ${endpoint.id}`);
      console.log(`│  Category:    ${endpoint.category}`);
      if (endpoint.subcategory) {
        console.log(`│  Subcategory: ${endpoint.subcategory}`);
      }
      console.log(`│  Path:        ${endpoint.normalizedPath}`);
      if (endpoint.queryParams.length > 0) {
        console.log(
          `│  Query:       ${endpoint.queryParams.map((q) => q.key).join(', ')}`
        );
      }
      if (endpoint.requestBody) {
        console.log(`│  Body:        ${endpoint.requestBody.mode} (${endpoint.requestBody.language})`);
      }
      if (endpoint.exampleResponses.length > 0) {
        console.log(`│  Examples:    ${endpoint.exampleResponses.length} response(s)`);
        for (const example of endpoint.exampleResponses) {
          console.log(`│    - ${example.name} (${example.code})`);
        }
      }
      if (endpoint.authNote) {
        console.log(`│  Auth Note:   ${endpoint.authNote}`);
      }
      if (endpoint.description) {
        const desc = endpoint.description.split('\n')[0];
        console.log(
          `│  Description: ${desc.substring(0, 60)}${desc.length > 60 ? '...' : ''}`
        );
      }
      console.log('└─');
      console.log('');
    }

    // Display detailed category breakdown
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📋 Detailed Category Breakdown');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    // Show top 3 categories with endpoint details
    for (const category of sortedCategories.slice(0, 3)) {
      console.log(`\n▶ ${category.name} (${category.endpointCount} endpoints):`);
      const categoryEndpoints = getEndpointsByCategory(category.name);

      // Group by method
      const methodGroups = new Map<string, number>();
      for (const ep of categoryEndpoints) {
        methodGroups.set(ep.method, (methodGroups.get(ep.method) || 0) + 1);
      }

      console.log('  Methods:');
      for (const [method, count] of methodGroups.entries()) {
        console.log(`    ${method}: ${count}`);
      }

      // Show first 3 endpoints
      console.log('  Sample Endpoints:');
      for (const ep of categoryEndpoints.slice(0, 3)) {
        console.log(`    [${ep.method}] ${ep.name}`);
        console.log(`         ${ep.normalizedPath}`);
      }
    }

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ✨ Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`✅ Successfully parsed ${stats.totalEndpoints} endpoints`);
    console.log(`📁 Organized into ${categories.length} categories`);
    console.log(`📝 ${stats.withExampleResponses} endpoints have example responses`);
    console.log(`📤 ${stats.withRequestBody} endpoints accept request bodies`);
    console.log('');
    console.log('💡 Use the endpoint registry API to query and filter endpoints programmatically');
    console.log('');
  } catch (error) {
    console.error('');
    console.error('❌ Error parsing Postman collection:');
    console.error('');
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      if (error.stack) {
        console.error('');
        console.error('Stack trace:');
        console.error(error.stack);
      }
    } else {
      console.error(`   ${String(error)}`);
    }
    console.error('');
    process.exit(1);
  }
}

main();

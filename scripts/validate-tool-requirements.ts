#!/usr/bin/env node
/**
 * Validate tool requirements registry
 *
 * Validates all registered tools and prints coverage statistics
 */

import {
  validateAllToolRequirements,
  printValidationSummary,
  printCoverageStatistics,
  findDuplicateScopes,
} from '../src/catalog/validation-helpers.js';

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🔍 Tool Requirements Registry Validation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Validate all tools
  const summary = validateAllToolRequirements();
  printValidationSummary(summary);

  // Print coverage statistics
  printCoverageStatistics();

  // Check for duplicate scopes
  const duplicates = findDuplicateScopes();
  if (Object.keys(duplicates).length > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🔄 Scopes Used by Multiple Tools');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    for (const [scope, tools] of Object.entries(duplicates)) {
      console.log(`${scope}:`);
      for (const tool of tools) {
        console.log(`  - ${tool}`);
      }
      console.log('');
    }
  }

  // Exit with error code if validation failed
  if (summary.invalidTools > 0) {
    console.error('❌ Validation failed with errors\n');
    process.exit(1);
  } else {
    console.log('✅ All validation checks passed!\n');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

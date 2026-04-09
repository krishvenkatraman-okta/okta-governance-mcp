/**
 * Tool requirements validation helpers
 *
 * Validates that tool requirements are complete and properly configured
 */

import {
  getAllToolRequirements,
  getMetadataTools,
  getGovernanceTools,
} from './tool-requirements.js';
import type {
  ToolRequirement,
  ToolRequirementValidation,
  RegistryValidationSummary,
} from '../types/index.js';

/**
 * Validate a single tool requirement
 */
export function validateToolRequirement(requirement: ToolRequirement): ToolRequirementValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check tool name
  if (!requirement.toolName || requirement.toolName.trim() === '') {
    errors.push('Tool name is required');
  }

  // Check description
  if (!requirement.description || requirement.description.trim() === '') {
    errors.push('Description is required');
  }

  // Check scopes for non-metadata tools
  if (!requirement.isMetadataTool) {
    if (
      !requirement.requiredScopes ||
      requirement.requiredScopes.length === 0
    ) {
      if (!requirement.notes || !requirement.notes.includes('not in')) {
        errors.push(
          'Non-metadata tools must have at least one required scope, or document why scopes are not needed'
        );
      } else {
        warnings.push(
          'Tool has no required scopes - documented as using non-Governance API'
        );
      }
    }

    // Validate scope format
    for (const scope of requirement.requiredScopes || []) {
      if (!scope.startsWith('okta.')) {
        errors.push(`Invalid scope format: ${scope} (must start with 'okta.')`);
      }
      if (!scope.endsWith('.read') && !scope.endsWith('.manage')) {
        errors.push(`Invalid scope format: ${scope} (must end with .read or .manage)`);
      }
    }
  }

  // Check capabilities for non-metadata tools
  if (!requirement.isMetadataTool) {
    if (
      !requirement.requiredCapabilities ||
      requirement.requiredCapabilities.length === 0
    ) {
      errors.push('Non-metadata tools must have at least one required capability');
    }
  }

  // Check mapped endpoints
  if (!requirement.isMetadataTool) {
    if (
      !requirement.mappedEndpoints ||
      requirement.mappedEndpoints.length === 0
    ) {
      if (!requirement.notes || !requirement.notes.includes('not in')) {
        warnings.push(
          'Tool has no mapped endpoints - may need endpoint mapping or documentation'
        );
      }
    }
  }

  // Check endpoint categories
  if (!requirement.isMetadataTool) {
    if (
      !requirement.endpointCategories ||
      requirement.endpointCategories.length === 0
    ) {
      warnings.push('Tool has no endpoint categories specified');
    }
  }

  // Check target constraints
  if (!requirement.targetConstraints || requirement.targetConstraints.length === 0) {
    errors.push('Target constraints are required (use "no_constraint" if none)');
  }

  // Check target resource flag consistency
  if (requirement.requiresTargetResource) {
    const hasTargetConstraint =
      requirement.targetConstraints &&
      requirement.targetConstraints.some(
        (c) => c === 'must_be_owned_app' || c === 'must_be_owned_group'
      );

    if (!hasTargetConstraint) {
      errors.push(
        'Tools with requiresTargetResource=true must have appropriate target constraints'
      );
    }
  }

  // Check conditional scopes structure
  if (requirement.conditionalScopes) {
    for (const conditional of requirement.conditionalScopes) {
      if (!conditional.condition || conditional.condition.trim() === '') {
        errors.push('Conditional scope must have a condition description');
      }
      if (!conditional.scopes || conditional.scopes.length === 0) {
        errors.push('Conditional scope must have at least one scope');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    toolName: requirement.toolName,
  };
}

/**
 * Validate all registered tool requirements
 */
export function validateAllToolRequirements(): RegistryValidationSummary {
  const registry = getAllToolRequirements();
  const tools = Object.values(registry.requirements);

  const results = tools.map((tool) => validateToolRequirement(tool));

  const errors = results
    .filter((r) => r.errors.length > 0)
    .map((r) => ({
      toolName: r.toolName,
      errors: r.errors,
    }));

  const warnings = results
    .filter((r) => r.warnings.length > 0)
    .map((r) => ({
      toolName: r.toolName,
      warnings: r.warnings,
    }));

  return {
    totalTools: tools.length,
    validTools: results.filter((r) => r.valid).length,
    invalidTools: results.filter((r) => !r.valid).length,
    errors,
    warnings,
  };
}

/**
 * Print validation summary to console
 */
export function printValidationSummary(summary: RegistryValidationSummary): void {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Tool Requirements Registry Validation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`Total Tools:   ${summary.totalTools}`);
  console.log(`Valid Tools:   ${summary.validTools}`);
  console.log(`Invalid Tools: ${summary.invalidTools}`);
  console.log('');

  if (summary.errors.length > 0) {
    console.log('❌ ERRORS:\n');
    for (const error of summary.errors) {
      console.log(`  ${error.toolName}:`);
      for (const err of error.errors) {
        console.log(`    - ${err}`);
      }
      console.log('');
    }
  }

  if (summary.warnings.length > 0) {
    console.log('⚠️  WARNINGS:\n');
    for (const warning of summary.warnings) {
      console.log(`  ${warning.toolName}:`);
      for (const warn of warning.warnings) {
        console.log(`    - ${warn}`);
      }
      console.log('');
    }
  }

  if (summary.invalidTools === 0 && summary.warnings.length === 0) {
    console.log('✅ All tools passed validation!\n');
  }
}

/**
 * Check for duplicate scopes across tools
 */
export function findDuplicateScopes(): Record<string, string[]> {
  const registry = getAllToolRequirements();
  const scopeToTools = new Map<string, string[]>();

  for (const tool of Object.values(registry.requirements)) {
    for (const scope of tool.requiredScopes || []) {
      if (!scopeToTools.has(scope)) {
        scopeToTools.set(scope, []);
      }
      scopeToTools.get(scope)!.push(tool.toolName);
    }
  }

  const duplicates: Record<string, string[]> = {};
  for (const [scope, tools] of scopeToTools.entries()) {
    if (tools.length > 1) {
      duplicates[scope] = tools;
    }
  }

  return duplicates;
}

/**
 * Get coverage statistics
 */
export function getCoverageStatistics() {
  const allTools = getAllToolRequirements().requirements;
  const metadataTools = getMetadataTools();
  const governanceTools = getGovernanceTools();

  const toolsWithScopes = Object.values(allTools).filter(
    (t) => t.requiredScopes && t.requiredScopes.length > 0
  ).length;

  const toolsWithEndpoints = Object.values(allTools).filter(
    (t) => t.mappedEndpoints && t.mappedEndpoints.length > 0
  ).length;

  const toolsWithCapabilities = Object.values(allTools).filter(
    (t) => t.requiredCapabilities && t.requiredCapabilities.length > 0
  ).length;

  const toolsWithConditionalScopes = Object.values(allTools).filter(
    (t) => t.conditionalScopes && t.conditionalScopes.length > 0
  ).length;

  const toolsRequiringTargets = Object.values(allTools).filter(
    (t) => t.requiresTargetResource === true
  ).length;

  const uniqueScopes = new Set<string>();
  const uniqueCapabilities = new Set<string>();
  const uniqueCategories = new Set<string>();

  for (const tool of Object.values(allTools)) {
    tool.requiredScopes?.forEach((s) => uniqueScopes.add(s));
    tool.requiredCapabilities?.forEach((c) => uniqueCapabilities.add(c));
    tool.endpointCategories?.forEach((cat) => uniqueCategories.add(cat));
  }

  return {
    totalTools: Object.keys(allTools).length,
    metadataTools: metadataTools.length,
    governanceTools: governanceTools.length,
    toolsWithScopes,
    toolsWithEndpoints,
    toolsWithCapabilities,
    toolsWithConditionalScopes,
    toolsRequiringTargets,
    uniqueScopes: uniqueScopes.size,
    uniqueCapabilities: uniqueCapabilities.size,
    uniqueCategories: uniqueCategories.size,
    scopesList: Array.from(uniqueScopes).sort(),
    capabilitiesList: Array.from(uniqueCapabilities).sort(),
    categoriesList: Array.from(uniqueCategories).sort(),
  };
}

/**
 * Print coverage statistics
 */
export function printCoverageStatistics(): void {
  const stats = getCoverageStatistics();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Tool Requirements Coverage Statistics');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Tool Counts:');
  console.log(`  Total Tools:          ${stats.totalTools}`);
  console.log(`  Metadata Tools:       ${stats.metadataTools}`);
  console.log(`  Governance Tools:     ${stats.governanceTools}`);
  console.log('');

  console.log('Coverage:');
  console.log(`  With Scopes:          ${stats.toolsWithScopes}/${stats.totalTools}`);
  console.log(`  With Endpoints:       ${stats.toolsWithEndpoints}/${stats.totalTools}`);
  console.log(`  With Capabilities:    ${stats.toolsWithCapabilities}/${stats.totalTools}`);
  console.log(`  With Conditional:     ${stats.toolsWithConditionalScopes}/${stats.totalTools}`);
  console.log(`  Requiring Targets:    ${stats.toolsRequiringTargets}/${stats.totalTools}`);
  console.log('');

  console.log('Unique Values:');
  console.log(`  Unique Scopes:        ${stats.uniqueScopes}`);
  console.log(`  Unique Capabilities:  ${stats.uniqueCapabilities}`);
  console.log(`  Unique Categories:    ${stats.uniqueCategories}`);
  console.log('');

  console.log('Scopes in Use:');
  for (const scope of stats.scopesList) {
    console.log(`  - ${scope}`);
  }
  console.log('');

  console.log('Capabilities in Use:');
  for (const cap of stats.capabilitiesList) {
    console.log(`  - ${cap}`);
  }
  console.log('');

  console.log('Categories in Use:');
  for (const cat of stats.categoriesList) {
    console.log(`  - ${cat}`);
  }
  console.log('');
}

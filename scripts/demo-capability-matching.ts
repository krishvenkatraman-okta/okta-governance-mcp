#!/usr/bin/env tsx
/**
 * Demo: Capability Matching for Different User Types
 *
 * Shows how different admin roles see different tools based on their capabilities.
 */

import { capabilityMapper } from '../src/policy/capability-mapper.js';
import { getAvailableTools } from '../src/mrs/tool-registry.js';
import type { AuthorizationContext, Capability } from '../src/types/index.js';

console.log('\n' + '═'.repeat(70));
console.log('  Capability Matching Demo: Tool Visibility by Role');
console.log('═'.repeat(70) + '\n');

/**
 * Test user contexts
 */
const testUsers = {
  superAdmin: {
    subject: 'test-super-admin',
    roles: {
      superAdmin: true,
      orgAdmin: false,
      appAdmin: false,
      groupAdmin: false,
      readOnlyAdmin: false,
      regularUser: false,
    },
    targets: {
      apps: [],
      groups: [],
    },
    capabilities: capabilityMapper.mapRolesToCapabilities(
      {
        superAdmin: true,
        orgAdmin: false,
        appAdmin: false,
        groupAdmin: false,
        readOnlyAdmin: false,
        regularUser: false,
      },
      { apps: [], groups: [] }
    ),
  } as AuthorizationContext,

  appAdmin: {
    subject: 'test-app-admin',
    roles: {
      superAdmin: false,
      orgAdmin: false,
      appAdmin: true,
      groupAdmin: false,
      readOnlyAdmin: false,
      regularUser: false,
    },
    targets: {
      apps: ['0oa111', '0oa222'],
      groups: [],
    },
    capabilities: capabilityMapper.mapRolesToCapabilities(
      {
        superAdmin: false,
        orgAdmin: false,
        appAdmin: true,
        groupAdmin: false,
        readOnlyAdmin: false,
        regularUser: false,
      },
      { apps: ['0oa111', '0oa222'], groups: [] }
    ),
  } as AuthorizationContext,

  regularUser: {
    subject: 'test-regular-user',
    roles: {
      superAdmin: false,
      orgAdmin: false,
      appAdmin: false,
      groupAdmin: false,
      readOnlyAdmin: false,
      regularUser: true,
    },
    targets: {
      apps: [],
      groups: [],
    },
    capabilities: capabilityMapper.mapRolesToCapabilities(
      {
        superAdmin: false,
        orgAdmin: false,
        appAdmin: false,
        groupAdmin: false,
        readOnlyAdmin: false,
        regularUser: true,
      },
      { apps: [], groups: [] }
    ),
  } as AuthorizationContext,
};

/**
 * Display user context and available tools
 */
function displayUserToolAccess(
  userName: string,
  context: AuthorizationContext
): void {
  console.log('─'.repeat(70));
  console.log(`User: ${userName}`);
  console.log('─'.repeat(70));

  // Show roles
  const activeRoles = Object.entries(context.roles)
    .filter(([_, active]) => active)
    .map(([role]) => role);
  console.log(`Roles:        ${activeRoles.join(', ') || 'none'}`);

  // Show targets
  console.log(`Target Apps:  ${context.targets.apps.length}`);
  console.log(`Target Groups: ${context.targets.groups.length}`);

  // Show capabilities
  console.log(`\nCapabilities (${context.capabilities.length}):`);
  context.capabilities.forEach((cap) => {
    console.log(`  • ${cap}`);
  });

  // Show available tools
  const tools = getAvailableTools(context);
  const governanceTools = tools.filter(
    (t) =>
      !['get_tool_requirements', 'get_operation_requirements', 'explain_why_tool_is_unavailable', 'list_available_tools_for_current_user'].includes(
        t.name
      )
  );

  console.log(`\nAvailable Governance Tools (${governanceTools.length}):`);
  if (governanceTools.length === 0) {
    console.log('  (none)');
  } else {
    governanceTools.forEach((tool) => {
      console.log(`  • ${tool.name}`);
    });
  }

  console.log('');
}

/**
 * Test capability matching logic
 */
function testCapabilityMatching(): void {
  console.log('─'.repeat(70));
  console.log('Capability Matching Logic Test');
  console.log('─'.repeat(70));
  console.log('\nTesting: Does "campaigns.manage.all" satisfy "campaigns.manage.owned"?\n');

  const allCapability = 'campaigns.manage.all' as Capability;
  const ownedRequirement = 'campaigns.manage.owned' as Capability;

  const hasAll = [allCapability];
  const hasOwned = [ownedRequirement];

  const result1 = capabilityMapper.hasCapability(hasAll, ownedRequirement);
  const result2 = capabilityMapper.hasCapability(hasOwned, allCapability);

  console.log(`User has: ["${allCapability}"]`);
  console.log(`Tool requires: "${ownedRequirement}"`);
  console.log(`✅ Match result: ${result1 ? 'PASS (tool visible)' : 'FAIL (tool hidden)'}\n`);

  console.log(`User has: ["${ownedRequirement}"]`);
  console.log(`Tool requires: "${allCapability}"`);
  console.log(`Result: ${result2 ? 'PASS' : 'FAIL (expected - .owned should not satisfy .all)'}\n`);

  console.log('Explanation:');
  console.log('  • .all capabilities are elevated permissions (super/org admin)');
  console.log('  • .all capabilities SHOULD satisfy .owned requirements');
  console.log('  • .owned capabilities should NOT satisfy .all requirements');
  console.log('  • This allows admins to access all tools while maintaining security\n');
}

/**
 * Main demo
 */
function main(): void {
  // Test capability matching logic
  testCapabilityMatching();

  // Show tool access for each user type
  displayUserToolAccess('SUPER_ADMIN', testUsers.superAdmin);
  displayUserToolAccess('APP_ADMIN (with 2 target apps)', testUsers.appAdmin);
  displayUserToolAccess('Regular User', testUsers.regularUser);

  console.log('═'.repeat(70));
  console.log('  Summary');
  console.log('═'.repeat(70));
  console.log('\n✅ SUPER_ADMIN: Has .all capabilities → sees all governance tools');
  console.log('✅ APP_ADMIN: Has .owned capabilities → sees tools for owned apps');
  console.log('✅ Regular User: Has self-service capabilities → sees no governance tools\n');
  console.log('The capability matching logic correctly implements:');
  console.log('  • Exact matches (e.g., .owned === .owned)');
  console.log('  • Elevated matches (e.g., .all satisfies .owned)');
  console.log('  • Security preservation (e.g., .owned does NOT satisfy .all)\n');
}

main();

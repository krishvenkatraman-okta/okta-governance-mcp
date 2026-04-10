#!/usr/bin/env tsx
/**
 * Demo: Execution Layer
 *
 * Demonstrates the tool execution flow with example invocations.
 * Shows authorization checks, scope resolution, and execution.
 *
 * NOTE: This is a demonstration script. Real execution requires:
 * - Valid Okta service app credentials
 * - MCP token from MAS
 * - Network access to Okta tenant
 */

// Set mock environment variables for demo
process.env.OKTA_DOMAIN = 'dev-12345678.okta.com';
process.env.OKTA_CLIENT_ID = '0oaDemoClientId';
process.env.OKTA_PRIVATE_KEY_PATH = './keys/okta-private-key.pem';
process.env.NODE_ENV = 'development';

import { getAvailableTools } from '../src/mrs/tool-registry.js';
import type { AuthorizationContext } from '../src/types/index.js';

/**
 * Sample authorization contexts
 */
const superAdminContext: AuthorizationContext = {
  subject: '00uSuperAdmin',
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
  reviewer: {
    hasAssignedReviews: false,
    hasSecurityAccessReviews: false,
  },
  capabilities: [
    'entitlements.manage.owned',
    'labels.manage.owned',
    'bundles.manage.owned',
    'campaigns.manage.owned',
    'request_for_others.owned',
    'workflow.manage.owned',
    'reports.syslog.owned',
  ],
};

const appAdminContext: AuthorizationContext = {
  subject: '00uAppAdmin',
  roles: {
    superAdmin: false,
    orgAdmin: false,
    appAdmin: true,
    groupAdmin: false,
    readOnlyAdmin: false,
    regularUser: false,
  },
  targets: {
    apps: ['0oa111', '0oa222', '0oa333'],
    groups: [],
  },
  reviewer: {
    hasAssignedReviews: false,
    hasSecurityAccessReviews: false,
  },
  capabilities: [
    'entitlements.manage.owned',
    'labels.manage.owned',
    'bundles.manage.owned',
    'campaigns.manage.owned',
    'request_for_others.owned',
    'workflow.manage.owned',
    'reports.syslog.owned',
  ],
};

const regularUserContext: AuthorizationContext = {
  subject: '00uRegularUser',
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
  reviewer: {
    hasAssignedReviews: false,
    hasSecurityAccessReviews: false,
  },
  capabilities: [],
};

/**
 * Demo: List available tools
 */
function demoAvailableTools() {
  console.log('━'.repeat(80));
  console.log('  Demo 1: Tool Availability by Authorization Context');
  console.log('━'.repeat(80) + '\n');

  const contexts = [
    { name: 'Super Admin', context: superAdminContext },
    { name: 'App Admin (3 owned apps)', context: appAdminContext },
    { name: 'Regular User', context: regularUserContext },
  ];

  for (const { name, context } of contexts) {
    console.log(`${name}:`);
    const tools = getAvailableTools(context);
    console.log(`  Available tools: ${tools.length}`);
    console.log(
      `  Tool names:\n    - ${tools.map((t) => t.name).join('\n    - ')}\n`
    );
  }
}

/**
 * Demo: Tool execution flow
 */
async function demoToolExecution() {
  console.log('━'.repeat(80));
  console.log('  Demo 2: Tool Execution Flow (Simulated)');
  console.log('━'.repeat(80) + '\n');

  console.log('Example 1: list_owned_apps (App Admin)\n');

  console.log('Step 1: Tool invocation request');
  const request1 = {
    name: 'list_owned_apps',
    arguments: {},
  };
  console.log(JSON.stringify(request1, null, 2));

  console.log('\nStep 2: Authorization context');
  console.log(
    JSON.stringify(
      {
        subject: appAdminContext.subject,
        roles: { appAdmin: true },
        targets: { apps: appAdminContext.targets.apps },
        capabilities: appAdminContext.capabilities.slice(0, 3),
      },
      null,
      2
    )
  );

  console.log('\nStep 3: Execution flow');
  console.log('  → Lookup tool definition');
  console.log('  → Validate authorization (capabilities + roles)');
  console.log('  → Validate target constraints');
  console.log('  → Resolve required scopes: ["okta.apps.read"]');
  console.log('  → Get service access token');
  console.log('  → Call Okta API: GET /api/v1/apps?filter=status eq "ACTIVE"');
  console.log('  → Filter by owned apps: [0oa111, 0oa222, 0oa333]');
  console.log('  → Return formatted response\n');

  console.log('Step 4: Expected response (success)');
  const response1 = {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            total: 3,
            apps: [
              { id: '0oa111', name: 'app1', label: 'App 1', status: 'ACTIVE' },
              { id: '0oa222', name: 'app2', label: 'App 2', status: 'ACTIVE' },
              { id: '0oa333', name: 'app3', label: 'App 3', status: 'ACTIVE' },
            ],
          },
          null,
          2
        ),
      },
    ],
    isError: false,
  };
  console.log(JSON.stringify(response1, null, 2));

  console.log('\n' + '─'.repeat(80) + '\n');

  console.log('Example 2: generate_owned_app_syslog_report (App Admin)\n');

  console.log('Step 1: Tool invocation request');
  const request2 = {
    name: 'generate_owned_app_syslog_report',
    arguments: {
      appId: '0oa111',
      days: 30,
      includeDetails: true,
    },
  };
  console.log(JSON.stringify(request2, null, 2));

  console.log('\nStep 2: Authorization context');
  console.log(
    JSON.stringify(
      {
        subject: appAdminContext.subject,
        roles: { appAdmin: true },
        targets: { apps: ['0oa111', '0oa222', '0oa333'] },
        capabilities: ['reports.syslog.owned'],
      },
      null,
      2
    )
  );

  console.log('\nStep 3: Execution flow');
  console.log('  → Lookup tool definition');
  console.log('  → Validate authorization (capabilities + roles)');
  console.log('  → Validate target constraints: 0oa111 in owned apps ✓');
  console.log('  → Resolve required scopes: ["okta.logs.read", "okta.apps.read"]');
  console.log('  → Get service access token');
  console.log('  → Call Okta API: GET /api/v1/apps/0oa111');
  console.log('  → Call Okta API: GET /api/v1/logs?filter=target.id eq "0oa111"&since=...');
  console.log('  → Aggregate log events by type');
  console.log('  → Return formatted report\n');

  console.log('Step 4: Expected response (success)');
  const response2 = {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            app: {
              id: '0oa111',
              name: 'app1',
              label: 'App 1',
              status: 'ACTIVE',
            },
            reportPeriod: {
              days: 30,
              since: '2026-03-10T00:00:00.000Z',
              until: '2026-04-09T00:00:00.000Z',
            },
            summary: {
              totalEvents: 1247,
              uniqueActors: 23,
              eventTypes: {
                'application.user_membership.add': 450,
                'application.user_membership.remove': 320,
                'user.authentication.sso': 477,
              },
            },
            recentEvents: [
              {
                uuid: '...',
                published: '2026-04-09T12:00:00.000Z',
                eventType: 'application.user_membership.add',
                displayMessage: 'Add user to application membership',
                actor: 'admin@example.com',
                severity: 'INFO',
              },
            ],
          },
          null,
          2
        ),
      },
    ],
    isError: false,
  };
  console.log(JSON.stringify(response2, null, 2));

  console.log('\n' + '─'.repeat(80) + '\n');

  console.log('Example 3: Access denied (Regular User)\n');

  console.log('Step 1: Tool invocation request');
  const request3 = {
    name: 'list_owned_apps',
    arguments: {},
  };
  console.log(JSON.stringify(request3, null, 2));

  console.log('\nStep 2: Authorization context');
  console.log(
    JSON.stringify(
      {
        subject: regularUserContext.subject,
        roles: { regularUser: true },
        capabilities: [],
      },
      null,
      2
    )
  );

  console.log('\nStep 3: Execution flow');
  console.log('  → Lookup tool definition');
  console.log('  → Validate authorization (capabilities + roles)');
  console.log('  → ✗ FAILED: Missing capabilities: entitlements.manage.owned');
  console.log('  → Execution aborted\n');

  console.log('Step 4: Expected response (error)');
  const response3 = {
    content: [
      {
        type: 'text',
        text: "Access denied to tool 'list_owned_apps': Missing capabilities: entitlements.manage.owned, labels.manage.owned",
      },
    ],
    isError: true,
  };
  console.log(JSON.stringify(response3, null, 2));

  console.log('\n' + '─'.repeat(80) + '\n');

  console.log('Example 4: Target constraint violation\n');

  console.log('Step 1: Tool invocation request');
  const request4 = {
    name: 'generate_owned_app_syslog_report',
    arguments: {
      appId: '0oaXXXXXX', // Not in owned apps
      days: 30,
    },
  };
  console.log(JSON.stringify(request4, null, 2));

  console.log('\nStep 2: Authorization context');
  console.log(
    JSON.stringify(
      {
        subject: appAdminContext.subject,
        roles: { appAdmin: true },
        targets: { apps: ['0oa111', '0oa222', '0oa333'] },
      },
      null,
      2
    )
  );

  console.log('\nStep 3: Execution flow');
  console.log('  → Lookup tool definition');
  console.log('  → Validate authorization (capabilities + roles) ✓');
  console.log('  → Validate target constraints: 0oaXXXXXX in owned apps');
  console.log('  → ✗ FAILED: App not in owned apps');
  console.log('  → Execution aborted\n');

  console.log('Step 4: Expected response (error)');
  const response4 = {
    content: [
      {
        type: 'text',
        text: 'Access denied: Application 0oaXXXXXX is not in your owned apps',
      },
    ],
    isError: true,
  };
  console.log(JSON.stringify(response4, null, 2));
}

/**
 * Demo: Stubbed tool execution
 */
function demoStubbedTools() {
  console.log('\n' + '━'.repeat(80));
  console.log('  Demo 3: Stubbed Tools (Authorization Only)');
  console.log('━'.repeat(80) + '\n');

  console.log('Stubbed tools enforce authorization but have no execution logic yet.\n');

  console.log('Example: manage_owned_app_entitlements\n');

  console.log('Step 1: Tool invocation request');
  const request = {
    name: 'manage_owned_app_entitlements',
    arguments: {
      appId: '0oa111',
      action: 'list',
    },
  };
  console.log(JSON.stringify(request, null, 2));

  console.log('\nStep 2: Execution flow');
  console.log('  → Lookup tool definition ✓');
  console.log('  → Validate authorization ✓');
  console.log('  → Validate target constraints ✓');
  console.log('  → Execute stub handler\n');

  console.log('Step 3: Expected response (not implemented)');
  const response = {
    content: [
      {
        type: 'text',
        text: "Tool 'manage_owned_app_entitlements' is not yet implemented. Authorization checks passed, but execution logic is pending.",
      },
    ],
    isError: true,
  };
  console.log(JSON.stringify(response, null, 2));
}

/**
 * Demo: Error handling
 */
function demoErrorHandling() {
  console.log('\n' + '━'.repeat(80));
  console.log('  Demo 4: Error Handling');
  console.log('━'.repeat(80) + '\n');

  const scenarios = [
    {
      name: '401/403 Unauthorized',
      error: 'Failed to list apps: 403 Forbidden',
      response:
        'Authorization error: Failed to list apps: 403 Forbidden\n\nThe service app may lack required OAuth scopes: okta.apps.read',
    },
    {
      name: '404 Not Found',
      error: 'Failed to get app 0oaXXXXXX: 404 Not Found',
      response: 'Resource not found. Please verify the IDs provided are correct.',
    },
    {
      name: '429 Rate Limited',
      error: 'Too Many Requests: 429',
      response: 'Rate limit exceeded. Please try again in a few moments.',
    },
    {
      name: 'Network Error',
      error: 'fetch failed',
      response: 'Tool execution failed: fetch failed',
    },
  ];

  for (const scenario of scenarios) {
    console.log(`Scenario: ${scenario.name}`);
    console.log(`  Error: ${scenario.error}`);
    console.log(`  Response: ${scenario.response}\n`);
  }
}

/**
 * Main demo
 */
async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('  MCP Execution Layer Demonstration');
  console.log('═'.repeat(80) + '\n');

  demoAvailableTools();
  await demoToolExecution();
  demoStubbedTools();
  demoErrorHandling();

  console.log('═'.repeat(80));
  console.log('  Summary');
  console.log('═'.repeat(80) + '\n');

  console.log('✅ Tool registry filters tools by authorization context');
  console.log('✅ Tool executor validates authorization on every invocation');
  console.log('✅ Target constraints enforced (e.g., must_be_owned_app)');
  console.log('✅ Required scopes resolved from tool requirements');
  console.log('✅ Service OAuth client acquires tokens with proper scopes');
  console.log('✅ Structured error handling with user-friendly messages');
  console.log('✅ Comprehensive logging for debugging and auditing');
  console.log('✅ 2 real tools implemented (list_owned_apps, generate_syslog_report)');
  console.log('✅ 6 stubbed tools with authorization enforcement\n');

  console.log('Next steps:');
  console.log('  1. Configure real Okta service app credentials');
  console.log('  2. Test with actual MCP client');
  console.log('  3. Implement remaining governance tools');
  console.log('  4. Add API response validation');
  console.log('  5. Add retry logic for transient failures\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

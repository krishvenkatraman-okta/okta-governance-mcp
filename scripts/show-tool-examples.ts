#!/usr/bin/env node
/**
 * Show example outputs for meta tools
 */

import { getToolRequirementsTool } from '../src/tools/meta/get-tool-requirements.js';
import { getOperationRequirementsTool } from '../src/tools/meta/get-operation-requirements.js';
import { explainUnavailableTool } from '../src/tools/meta/explain-unavailable.js';
import { listAvailableToolsTool } from '../src/tools/meta/list-available-tools.js';
import { loadEndpointRegistry } from '../src/catalog/endpoint-registry.js';
import type { AuthorizationContext } from '../src/types/index.js';

// Sample authorization contexts
const appAdminContext: AuthorizationContext = {
  subject: '00u123456',
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
  reviewer: {
    hasAssignedReviews: false,
    hasSecurityAccessReviews: false,
  },
  capabilities: [
    'entitlements.manage.owned',
    'labels.manage.owned',
    'bundles.manage.owned',
    'campaigns.manage.owned',
  ],
};

const regularUserContext: AuthorizationContext = {
  subject: '00u789',
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

async function main() {
  // Load endpoint registry
  console.log('Loading endpoint registry...');
  loadEndpointRegistry('./postman/Okta Governance API.postman_collection.json');

  console.log('\n' + '='.repeat(80));
  console.log('  EXAMPLE OUTPUTS FOR META TOOLS');
  console.log('='.repeat(80) + '\n');

  // Example 1: get_tool_requirements
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Example 1: get_tool_requirements');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Tool: manage_owned_app_entitlements');
  console.log('With authorization context analysis\n');

  const req1 = await getToolRequirementsTool.handler(
    {
      toolName: 'manage_owned_app_entitlements',
      includeAuthContext: true,
    },
    appAdminContext
  );

  console.log(JSON.stringify(JSON.parse(req1.content[0].text || '{}'), null, 2));
  console.log('\n');

  // Example 2: get_operation_requirements
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Example 2: get_operation_requirements');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Operation: Create a campaign\n');

  const req2 = await getOperationRequirementsTool.handler({
    operationName: 'Create a campaign',
  });

  const opResultText = req2.content[0].text || '{}';
  const opResult = typeof opResultText === 'string' && opResultText.startsWith('{')
    ? JSON.parse(opResultText)
    : { error: opResultText };
  console.log(JSON.stringify({
    operation: opResult.operation,
    method: opResult.method,
    path: opResult.path,
    category: opResult.category,
    requiredScopes: opResult.requiredScopes,
    requestDetails: opResult.requestDetails,
    exampleResponses: opResult.exampleResponses.map((ex: any) => `${ex.code} ${ex.status}`),
  }, null, 2));
  console.log('\n');

  // Example 3: explain_why_tool_is_unavailable (tool available)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Example 3: explain_why_tool_is_unavailable');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Scenario: App Admin checking available tool\n');
  console.log('Tool: manage_owned_app_entitlements');
  console.log('Context: App Admin with 2 owned apps\n');

  const req3 = await explainUnavailableTool.handler(
    { toolName: 'manage_owned_app_entitlements' },
    appAdminContext
  );

  console.log(req3.content[0].text);
  console.log('\n');

  // Example 4: explain_why_tool_is_unavailable (tool unavailable)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Example 4: explain_why_tool_is_unavailable (unavailable)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Scenario: Regular user trying to access admin tool\n');
  console.log('Tool: create_campaign_for_owned_app');
  console.log('Context: Regular user with no admin roles\n');

  const req4 = await explainUnavailableTool.handler(
    { toolName: 'create_campaign_for_owned_app' },
    regularUserContext
  );

  console.log(req4.content[0].text);
  console.log('\n');

  // Example 5: list_available_tools_for_current_user
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Example 5: list_available_tools_for_current_user');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Context: App Admin with 2 owned apps\n');

  const req5 = await listAvailableToolsTool.handler(
    { includeUnavailable: false, includeMetadata: true },
    appAdminContext
  );

  const listResult = JSON.parse(req5.content[0].text || '{}');
  console.log(JSON.stringify({
    summary: {
      totalTools: listResult.totalTools,
      availableTools: listResult.availableTools,
      metadataTools: listResult.metadataTools,
      governanceTools: listResult.governanceTools,
    },
    userContext: listResult.userContext,
    availableToolNames: listResult.allTools.map((t: any) => t.name),
  }, null, 2));
  console.log('\n');

  console.log('='.repeat(80));
  console.log('  END OF EXAMPLES');
  console.log('='.repeat(80) + '\n');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

#!/usr/bin/env tsx
/**
 * Demo: Authentication and Authorization Flow
 *
 * Demonstrates the complete authentication flow from MCP token to tool visibility:
 * 1. Create sample MCP tokens
 * 2. Validate tokens
 * 3. Resolve authorization context
 * 4. Show visible tools for each user type
 */

import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import { validateMcpToken } from '../src/auth/mcp-token-validator.js';
import { resolveAuthorizationContextForSubject } from '../src/policy/authorization-context.js';
import { getAvailableTools } from '../src/mrs/tool-registry.js';
import type { McpAccessToken } from '../src/types/index.js';

// Ensure keys directory exists for demo
import { execSync } from 'child_process';
try {
  execSync('mkdir -p keys');
} catch {}

/**
 * Generate MAS key pair for demo (if not exists)
 */
function ensureKeyPair(): { privateKey: string; publicKey: string } {
  try {
    const privateKey = readFileSync('./keys/mas-private-key.pem', 'utf8');
    const publicKey = readFileSync('./keys/mas-public-key.pem', 'utf8');
    return { privateKey, publicKey };
  } catch {
    console.log('Generating MAS RSA key pair for demo...');
    execSync('npm run generate-keypair');
    const privateKey = readFileSync('./keys/mas-private-key.pem', 'utf8');
    const publicKey = readFileSync('./keys/mas-public-key.pem', 'utf8');
    return { privateKey, publicKey };
  }
}

/**
 * Create sample MCP access token
 */
function createMcpToken(
  subject: string,
  sessionId: string,
  privateKey: string
): string {
  const now = Math.floor(Date.now() / 1000);

  const payload: McpAccessToken = {
    iss: 'mcp://okta-governance-mas', // MAS issuer
    sub: subject,
    aud: 'mcp://okta-governance-mrs', // MRS audience
    exp: now + 3600, // 1 hour
    iat: now,
    jti: `mcp-${now}-${Math.random().toString(36).slice(2)}`,
    sessionId,
  };

  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

/**
 * Demo users
 */
const DEMO_USERS = {
  superAdmin: {
    subject: '00usuperadmin',
    sessionId: 'session-superadmin',
    description: 'Super Admin (all permissions)',
  },
  appAdmin: {
    subject: '00uappadmin',
    sessionId: 'session-appadmin',
    description: 'App Admin (3 owned apps)',
  },
  regularUser: {
    subject: '00uregularuser',
    sessionId: 'session-regularuser',
    description: 'Regular User (no admin roles)',
  },
};

/**
 * Demo: Token creation and validation
 */
async function demoTokenValidation() {
  console.log('━'.repeat(80));
  console.log('  Demo 1: MCP Token Creation and Validation');
  console.log('━'.repeat(80) + '\n');

  const { privateKey } = ensureKeyPair();

  for (const [role, user] of Object.entries(DEMO_USERS)) {
    console.log(`${user.description}:`);
    console.log(`  Subject: ${user.subject}`);
    console.log(`  Session: ${user.sessionId}\n`);

    // Create token
    const token = createMcpToken(user.subject, user.sessionId, privateKey);
    console.log(`  Token created (${token.length} characters)`);
    console.log(`  Token preview: ${token.slice(0, 50)}...${token.slice(-30)}\n`);

    // Validate token
    const validation = validateMcpToken(token);

    if (validation.valid) {
      console.log('  ✅ Token validation: PASSED');
      console.log('  Token claims:');
      console.log(`    Issuer: ${validation.claims?.issuer}`);
      console.log(`    Audience: ${validation.claims?.audience}`);
      console.log(`    Subject: ${validation.claims?.subject}`);
      console.log(`    Expires: ${validation.claims?.expiresAt}`);
      console.log(`    Session: ${validation.claims?.sessionId}\n`);
    } else {
      console.log('  ❌ Token validation: FAILED');
      console.log(`    Error: ${validation.error}`);
      console.log(`    Validation errors: ${validation.validationErrors?.join(', ')}\n`);
    }

    console.log('─'.repeat(80) + '\n');
  }
}

/**
 * Demo: Authorization context resolution
 */
async function demoAuthorizationContext() {
  console.log('━'.repeat(80));
  console.log('  Demo 2: Authorization Context Resolution');
  console.log('━'.repeat(80) + '\n');

  for (const [role, user] of Object.entries(DEMO_USERS)) {
    console.log(`${user.description}:`);
    console.log(`  Subject: ${user.subject}\n`);

    // Resolve authorization context
    const context = await resolveAuthorizationContextForSubject(user.subject);

    console.log('  Roles:');
    Object.entries(context.roles).forEach(([roleName, hasRole]) => {
      if (hasRole) {
        console.log(`    ✓ ${roleName}`);
      }
    });

    console.log(`\n  Targets:`);
    console.log(`    Apps: ${context.targets.apps.length}`);
    if (context.targets.apps.length > 0) {
      console.log(`      ${context.targets.apps.join(', ')}`);
    }
    console.log(`    Groups: ${context.targets.groups.length}`);
    if (context.targets.groups.length > 0) {
      console.log(`      ${context.targets.groups.join(', ')}`);
    }

    console.log(`\n  Capabilities (${context.capabilities.length}):`)
;
    if (context.capabilities.length > 0) {
      context.capabilities.slice(0, 5).forEach((cap) => {
        console.log(`    • ${cap}`);
      });
      if (context.capabilities.length > 5) {
        console.log(`    • ... and ${context.capabilities.length - 5} more`);
      }
    } else {
      console.log(`    (none)`);
    }

    console.log('\n' + '─'.repeat(80) + '\n');
  }
}

/**
 * Demo: Tool visibility by role
 */
async function demoToolVisibility() {
  console.log('━'.repeat(80));
  console.log('  Demo 3: Tool Visibility by Role');
  console.log('━'.repeat(80) + '\n');

  for (const [role, user] of Object.entries(DEMO_USERS)) {
    console.log(`${user.description}:`);

    // Resolve context
    const context = await resolveAuthorizationContextForSubject(user.subject);

    // Get available tools
    const tools = getAvailableTools(context);

    console.log(`  Available tools: ${tools.length}\n`);

    if (tools.length > 0) {
      console.log('  Tool names:');
      tools.forEach((tool) => {
        console.log(`    • ${tool.name}`);
      });
    } else {
      console.log('  (No tools available)');
    }

    console.log('\n' + '─'.repeat(80) + '\n');
  }
}

/**
 * Demo: Complete authentication flow
 */
async function demoCompleteFlow() {
  console.log('━'.repeat(80));
  console.log('  Demo 4: Complete Authentication Flow');
  console.log('━'.repeat(80) + '\n');

  const { privateKey } = ensureKeyPair();
  const user = DEMO_USERS.appAdmin;

  console.log('Scenario: App Admin requests tool list\n');

  console.log('Step 1: Create MCP access token');
  const token = createMcpToken(user.subject, user.sessionId, privateKey);
  console.log(`  Token: ${token.slice(0, 40)}...${token.slice(-20)}\n`);

  console.log('Step 2: Validate MCP token');
  const validation = validateMcpToken(token);
  if (!validation.valid) {
    console.log(`  ❌ Validation failed: ${validation.error}\n`);
    return;
  }
  console.log('  ✅ Token valid');
  console.log(`  Subject: ${validation.payload?.sub}`);
  console.log(`  Expires: ${validation.claims?.expiresAt}\n`);

  console.log('Step 3: Resolve authorization context');
  const context = await resolveAuthorizationContextForSubject(
    validation.payload!.sub,
    validation.payload
  );
  console.log('  ✅ Context resolved');
  console.log(`  Roles: ${Object.entries(context.roles).filter(([_, v]) => v).map(([k]) => k).join(', ')}`);
  console.log(`  Capabilities: ${context.capabilities.length}`);
  console.log(`  Target apps: ${context.targets.apps.length}\n`);

  console.log('Step 4: Filter tools by authorization');
  const tools = getAvailableTools(context);
  console.log(`  ✅ ${tools.length} tools available\n`);

  console.log('Step 5: Return tool list to client');
  console.log('  Tools:');
  tools.forEach((tool) => {
    console.log(`    • ${tool.name} - ${tool.description}`);
  });

  console.log('\n' + '─'.repeat(80) + '\n');
}

/**
 * Demo: Token expiry
 */
function demoTokenExpiry() {
  console.log('━'.repeat(80));
  console.log('  Demo 5: Token Expiry Handling');
  console.log('━'.repeat(80) + '\n');

  const { privateKey } = ensureKeyPair();
  const user = DEMO_USERS.regularUser;

  console.log('Scenario: Expired token\n');

  // Create expired token
  const now = Math.floor(Date.now() / 1000);
  const expiredPayload: McpAccessToken = {
    iss: 'mcp://okta-governance-mas',
    sub: user.subject,
    aud: 'mcp://okta-governance-mrs',
    exp: now - 3600, // Expired 1 hour ago
    iat: now - 7200, // Issued 2 hours ago
    jti: `mcp-expired-${now}`,
    sessionId: user.sessionId,
  };

  const expiredToken = jwt.sign(expiredPayload, privateKey, { algorithm: 'RS256' });

  console.log('Step 1: Validate expired token');
  const validation = validateMcpToken(expiredToken);

  if (!validation.valid) {
    console.log('  ❌ Validation failed (expected)');
    console.log(`  Error: ${validation.error}`);
    console.log(`  \n  → Client must request new token from MAS\n`);
  } else {
    console.log('  ⚠ Validation passed (unexpected - should have failed)\n');
  }
}

/**
 * Main demo
 */
async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('  MRS Authentication and Authorization Flow Demo');
  console.log('═'.repeat(80) + '\n');

  await demoTokenValidation();
  await demoAuthorizationContext();
  await demoToolVisibility();
  await demoCompleteFlow();
  demoTokenExpiry();

  console.log('═'.repeat(80));
  console.log('  Summary');
  console.log('═'.repeat(80) + '\n');

  console.log('✅ MCP token validation with comprehensive checks');
  console.log('✅ Authorization context resolution from subject');
  console.log('✅ Role-based capability mapping');
  console.log('✅ Tool filtering by authorization context');
  console.log('✅ Fail-closed authentication (empty tools on auth failure)');
  console.log('✅ Token expiry handling\n');

  console.log('Authentication Flow:');
  console.log('  1. Client → MAS: Request MCP access token');
  console.log('  2. MAS → Client: Return MCP access token (JWT)');
  console.log('  3. Client → MRS: Call tool with MCP token');
  console.log('  4. MRS: Validate token signature');
  console.log('  5. MRS: Extract subject from token');
  console.log('  6. MRS: Resolve authorization context (roles, targets, capabilities)');
  console.log('  7. MRS: Filter/execute tools based on authorization');
  console.log('  8. MRS → Client: Return filtered tools or execution result\n');

  console.log('Next steps:');
  console.log('  1. Integrate with real MCP client');
  console.log('  2. Connect MAS to issue real tokens');
  console.log('  3. Test end-to-end with different user types');
  console.log('  4. Add token refresh flow');
  console.log('  5. Add session management\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

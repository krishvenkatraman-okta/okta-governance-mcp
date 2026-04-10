#!/usr/bin/env tsx
/**
 * Generate test MCP token for smoke testing
 *
 * Creates a locally signed MCP access token for testing MRS without requiring
 * a running MAS or full ID-JAG authentication flow.
 *
 * Usage:
 *   npm run generate-token -- --sub 00u123456 --scope "okta.apps.read okta.logs.read"
 *   npm run generate-token -- --sub 00u123456 --role APP_ADMIN --apps "0oa111,0oa222"
 */

import * as fs from 'fs';
import * as path from 'path';
import { signJwt } from '../src/auth/jwt-utils.js';

interface TokenOptions {
  sub: string; // Okta user ID
  scope?: string; // Space-separated OAuth scopes
  role?: string; // User role (APP_ADMIN, GROUP_ADMIN, SUPER_ADMIN)
  apps?: string; // Comma-separated app IDs for APP_ADMIN targets
  groups?: string; // Comma-separated group IDs for GROUP_ADMIN targets
  sessionId?: string; // Optional session ID
  expiresIn?: number; // Token expiry in seconds (default: 3600)
}

/**
 * Generate MCP test token
 */
function generateTestToken(options: TokenOptions): string {
  const {
    sub,
    scope = 'okta.apps.read okta.logs.read okta.users.read okta.roles.read',
    sessionId = `test-session-${Date.now()}`,
    expiresIn = 3600,
  } = options;

  if (!sub) {
    throw new Error('Subject (sub) is required. Provide Okta user ID (e.g., 00u123456)');
  }

  // Read MAS private key from environment or default path
  const privateKeyPath =
    process.env.MAS_JWT_PRIVATE_KEY_PATH || './keys/mas-private-key.pem';

  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(
      `MAS private key not found at ${privateKeyPath}. ` +
        `Generate keys with: npm run generate-keys`
    );
  }

  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

  // Build token claims
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    // Standard JWT claims
    iss: process.env.MCP_TOKEN_ISSUER || 'mcp://okta-governance-mas',
    aud: process.env.MCP_TOKEN_AUDIENCE || 'mcp://okta-governance-mrs',
    sub,
    iat: now,
    exp: now + expiresIn,

    // OAuth scopes
    scope,

    // Session metadata
    sid: sessionId,

    // Test token marker
    test: true,
  };

  console.log('\n📝 Generating MCP test token...\n');
  console.log('Token claims:', JSON.stringify(claims, null, 2));

  // Sign token
  const token = signJwt(claims, privateKey, {
    algorithm: 'RS256',
  });

  return token;
}

/**
 * Parse command line arguments
 */
function parseArgs(): TokenOptions {
  const args = process.argv.slice(2);
  const options: TokenOptions = { sub: '' };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case '--sub':
      case '-s':
        options.sub = value;
        i++;
        break;
      case '--scope':
        options.scope = value;
        i++;
        break;
      case '--role':
        options.role = value;
        i++;
        break;
      case '--apps':
        options.apps = value;
        i++;
        break;
      case '--groups':
        options.groups = value;
        i++;
        break;
      case '--session-id':
        options.sessionId = value;
        i++;
        break;
      case '--expires-in':
        options.expiresIn = parseInt(value, 10);
        i++;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Usage: npm run generate-token -- [options]

Options:
  --sub <userId>           Okta user ID (required, e.g., 00u123456)
  --scope <scopes>         OAuth scopes (space-separated)
  --role <role>            User role (APP_ADMIN, GROUP_ADMIN, SUPER_ADMIN)
  --apps <appIds>          App IDs for APP_ADMIN (comma-separated)
  --groups <groupIds>      Group IDs for GROUP_ADMIN (comma-separated)
  --session-id <id>        Session ID (optional)
  --expires-in <seconds>   Token expiry in seconds (default: 3600)
  --help, -h               Show this help message

Examples:

  # Generate token for APP_ADMIN with specific apps
  npm run generate-token -- --sub 00u123456 --role APP_ADMIN --apps "0oa111,0oa222"

  # Generate token with custom scopes
  npm run generate-token -- --sub 00u123456 --scope "okta.apps.read okta.logs.read"

  # Generate token with 2-hour expiry
  npm run generate-token -- --sub 00u123456 --expires-in 7200

Environment Variables:
  MAS_JWT_PRIVATE_KEY_PATH   Path to MAS private key (default: ./keys/mas-private-key.pem)
  MCP_TOKEN_ISSUER           Token issuer (default: mcp://okta-governance-mas)
  MCP_TOKEN_AUDIENCE         Token audience (default: mcp://okta-governance-mrs)

Notes:
  - The generated token is signed by MAS and can be used to call MRS directly
  - Token must be sent in Authorization header: "Bearer <token>"
  - MRS will validate the token signature using MAS public key
  - For smoke testing, use a real Okta user ID (00u...) that exists in your tenant
`);
}

/**
 * Main entry point
 */
async function main() {
  try {
    const options = parseArgs();

    if (!options.sub) {
      console.error('❌ Error: --sub (user ID) is required\n');
      printHelp();
      process.exit(1);
    }

    const token = generateTestToken(options);

    console.log('\n✅ Token generated successfully!\n');
    console.log('Token (copy this):');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(token);
    console.log('─────────────────────────────────────────────────────────────\n');

    console.log('Usage in API calls:\n');
    console.log('curl http://localhost:3001/mcp/v1/tools \\');
    console.log('  -H "Authorization: Bearer <token>" \\');
    console.log('  -H "Content-Type: application/json"\n');

    console.log('💡 Note: This token expires in', options.expiresIn || 3600, 'seconds\n');

    // Also write to file for convenience
    const outputPath = './test-token.txt';
    fs.writeFileSync(outputPath, token);
    console.log(`Token also saved to: ${outputPath}\n`);
  } catch (error) {
    console.error('❌ Error generating token:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();

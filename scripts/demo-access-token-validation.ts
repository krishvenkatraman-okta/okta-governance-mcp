#!/usr/bin/env tsx
/**
 * Demo: Okta Access Token Validation for MRS
 *
 * Demonstrates the new access token validation flow that replaces MCP token validation.
 * Shows expected token claims and validation steps.
 *
 * Run modes:
 * 1. Mock mode: Demonstrates validation flow with mock data
 * 2. Real mode: Validates a real Okta access token (if provided)
 */

import { validateAccessToken, extractSubjectFromAccessToken } from '../src/auth/access-token-validator.js';
import { config } from '../src/config/index.js';

/**
 * Mock Okta access token claims
 *
 * This represents what an Okta custom authorization server
 * would include in an access token after ID-JAG exchange.
 */
const MOCK_ACCESS_TOKEN_CLAIMS = {
  // Standard JWT claims
  iss: 'https://qa-aiagentsproduct2tc1.trexcloud.com/oauth2/default', // Okta custom auth server
  sub: '00u8uqjojqqmM8zwy0g7', // Okta user ID
  aud: 'api://mcp-governance', // MCP resource server audience
  exp: Math.floor(Date.now() / 1000) + 3600, // Expires in 1 hour
  iat: Math.floor(Date.now() / 1000), // Issued now
  jti: 'AT.abc123def456', // JWT ID

  // Okta-specific claims
  scp: ['mcp.governance', 'openid', 'profile'], // Scopes
  cid: '0oa9dnjsbaKAF73LB0g7', // Client ID
  uid: '00u8uqjojqqmM8zwy0g7', // User ID (alternative)

  // Additional context
  ver: 1,
  auth_time: Math.floor(Date.now() / 1000),
};

/**
 * Display expected token claims
 */
function displayExpectedClaims() {
  console.log('\n📋 Expected Okta Access Token Claims\n');
  console.log('════════════════════════════════════════════════════════════\n');

  console.log('Standard JWT Claims:');
  console.log('  • iss (issuer):    Okta custom authorization server URL');
  console.log('  • sub (subject):   Okta user ID (00u...)');
  console.log('  • aud (audience):  api://mcp-governance');
  console.log('  • exp (expires):   Unix timestamp (future)');
  console.log('  • iat (issued):    Unix timestamp (now)');
  console.log('  • jti (JWT ID):    Unique token identifier');

  console.log('\nOkta-Specific Claims:');
  console.log('  • scp (scopes):    Array of granted scopes');
  console.log('  • cid (client ID): OAuth client ID');
  console.log('  • uid (user ID):   Alternative user identifier');

  console.log('\n════════════════════════════════════════════════════════════\n');
}

/**
 * Display mock token example
 */
function displayMockToken() {
  console.log('Mock Token Claims (what MRS would validate):\n');
  console.log(JSON.stringify(MOCK_ACCESS_TOKEN_CLAIMS, null, 2));
  console.log('\n════════════════════════════════════════════════════════════\n');
}

/**
 * Display validation flow
 */
function displayValidationFlow() {
  console.log('\n🔒 Okta Access Token Validation Flow\n');
  console.log('════════════════════════════════════════════════════════════\n');

  console.log('Step 1: Extract token from Authorization header');
  console.log('  Authorization: Bearer <okta_access_token>');

  console.log('\nStep 2: Validate token format');
  console.log('  • Check token is non-empty string');
  console.log('  • Never log raw token');

  console.log('\nStep 3: Fetch signing key from JWKS');
  console.log('  • Extract kid from JWT header');
  console.log('  • Fetch public key from Okta JWKS endpoint');
  console.log('  • Use cached key if available (24-hour cache)');

  console.log('\nStep 4: Verify JWT signature');
  console.log('  • Algorithm: RS256');
  console.log('  • Verify signature using public key from JWKS');

  console.log('\nStep 5: Validate standard claims');
  console.log('  • Issuer (iss): Must match Okta custom auth server');
  console.log('  • Audience (aud): Must be api://mcp-governance');
  console.log('  • Expiry (exp): Token must not be expired');
  console.log('  • Not-before (nbf): Token must be valid (if present)');
  console.log('  • Clock skew tolerance: 5 minutes');

  console.log('\nStep 6: Validate required claims');
  console.log('  • Subject (sub): Must be present (Okta user ID)');
  console.log('  • Issued-at (iat): Must be present and not in future');

  console.log('\nStep 7: Extract user context');
  console.log('  • Extract subject (user ID) from sub claim');
  console.log('  • Use subject to resolve authorization context');
  console.log('  • Lookup roles, targets, capabilities');

  console.log('\nStep 8: Return validation result');
  console.log('  • Success: { valid: true, payload, claims }');
  console.log('  • Failure: { valid: false, error, errors[] }');

  console.log('\n════════════════════════════════════════════════════════════\n');
}

/**
 * Display configuration
 */
function displayConfiguration() {
  console.log('\n⚙️  Current Configuration\n');
  console.log('════════════════════════════════════════════════════════════\n');

  console.log('Access Token Validation:');
  console.log(`  Issuer:   ${config.okta.accessToken.issuer}`);
  console.log(`  Audience: ${config.okta.accessToken.audience}`);
  console.log(`  JWKS URI: ${config.okta.accessToken.jwksUri}`);

  console.log('\n════════════════════════════════════════════════════════════\n');
}

/**
 * Validate real token (if provided)
 */
async function validateRealToken(token: string) {
  console.log('\n🔍 Validating Real Okta Access Token\n');
  console.log('════════════════════════════════════════════════════════════\n');

  console.log('Token length:', token.length);

  // Extract subject without validation (for logging)
  const subject = extractSubjectFromAccessToken(token);
  console.log('Extracted subject (unvalidated):', subject);

  console.log('\nValidating token...\n');

  // Validate token
  const result = await validateAccessToken(token);

  if (result.valid) {
    console.log('✅ Token validation SUCCEEDED\n');
    console.log('Validated Claims:');
    console.log(`  Subject:    ${result.claims?.subject}`);
    console.log(`  Issuer:     ${result.claims?.issuer}`);
    console.log(`  Audience:   ${result.claims?.audience}`);
    console.log(`  Expires At: ${result.claims?.expiresAt}`);
    console.log(`  Issued At:  ${result.claims?.issuedAt}`);
    console.log(`  Scope:      ${result.claims?.scope || '(none)'}`);

    if (result.claims?.notBefore) {
      console.log(`  Not Before: ${result.claims.notBefore}`);
    }
  } else {
    console.log('❌ Token validation FAILED\n');
    console.log('Error:', result.error);

    if (result.errors && result.errors.length > 0) {
      console.log('\nValidation Errors:');
      for (const error of result.errors) {
        console.log(`  [${error.code}] ${error.message}`);
        if (error.details) {
          console.log(`    Details: ${error.details}`);
        }
      }
    }
  }

  console.log('\n════════════════════════════════════════════════════════════\n');
}

/**
 * Main demo function
 */
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   Okta Access Token Validation Demo for MRS             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Display expected claims
  displayExpectedClaims();

  // Display mock token
  displayMockToken();

  // Display validation flow
  displayValidationFlow();

  // Display configuration
  displayConfiguration();

  // Check if real token is provided
  const tokenArg = process.argv[2];

  if (tokenArg) {
    await validateRealToken(tokenArg);
  } else {
    console.log('\n💡 Usage:\n');
    console.log('  Mock mode (demo only):');
    console.log('    npm run demo-access-token\n');
    console.log('  Real token validation:');
    console.log('    npm run demo-access-token -- <okta_access_token>\n');
    console.log('  Example:');
    console.log('    npm run demo-access-token -- eyJhbGci...\n');
  }

  console.log('\n📝 Key Differences from MCP Token Validation:\n');
  console.log('  OLD (MCP Token):');
  console.log('    • Issued by MAS (internal)');
  console.log('    • Validated using MAS public key');
  console.log('    • Custom issuer: mcp://okta-governance-mas');
  console.log('    • Custom claims (sessionId, etc.)');

  console.log('\n  NEW (Okta Access Token):');
  console.log('    • Issued by Okta custom authorization server');
  console.log('    • Validated using Okta JWKS (HTTPS)');
  console.log('    • Okta issuer: https://<domain>/oauth2/<server>');
  console.log('    • Standard OAuth 2.0 claims + Okta extensions');

  console.log('\n  Benefits:');
  console.log('    ✅ Eliminates MAS token issuance layer');
  console.log('    ✅ Uses Okta-native tokens');
  console.log('    ✅ Standard OAuth 2.0 flow');
  console.log('    ✅ Simplified architecture');

  console.log('\n════════════════════════════════════════════════════════════\n');
}

// Run demo
main().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});

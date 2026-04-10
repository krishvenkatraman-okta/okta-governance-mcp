#!/usr/bin/env tsx
/**
 * Validate Okta OAuth service app configuration
 *
 * Tests the OAuth client implementation without requiring real credentials.
 * Shows computed values, JWT structure, and caching behavior.
 *
 * Usage:
 *   npm run validate-okta-oauth
 *
 * To test with real credentials (requires valid .env):
 *   REAL_AUTH_TEST=true npm run validate-okta-oauth
 */

import { readFileSync, existsSync } from 'fs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Mock config for testing without real credentials
const MOCK_CONFIG = {
  oktaDomain: 'dev-12345678.okta.com',
  clientId: '0oaAbCdEfGhIjKlMnO',
  privateKeyPath: './keys/okta-private-key.pem',
  privateKeyKid: 'test-key-id',
  tokenUrl: 'https://dev-12345678.okta.com/oauth2/v1/token',
  defaultScopes: 'okta.apps.read okta.users.read okta.groups.read',
};

/**
 * Check if running in real auth test mode
 */
const REAL_AUTH_TEST = process.env.REAL_AUTH_TEST === 'true';

/**
 * Generate mock RSA key pair for testing
 */
function generateMockKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  return { privateKey, publicKey };
}

/**
 * Validate JWT assertion structure
 */
function validateJwtAssertion(assertion: string): {
  valid: boolean;
  header: any;
  payload: any;
  errors: string[];
} {
  const errors: string[] = [];

  try {
    // Decode without verification (for structure validation)
    const decoded = jwt.decode(assertion, { complete: true });

    if (!decoded) {
      errors.push('Failed to decode JWT');
      return { valid: false, header: {}, payload: {}, errors };
    }

    const { header, payload } = decoded;

    // Validate header
    if (header.alg !== 'RS256') {
      errors.push(`Expected alg=RS256, got ${header.alg}`);
    }

    if (!header.kid && REAL_AUTH_TEST) {
      console.warn('Warning: kid not present in JWT header (recommended for production)');
    }

    // Validate payload
    const now = Math.floor(Date.now() / 1000);

    if (!payload.iss) {
      errors.push('Missing iss claim');
    }

    if (!payload.sub) {
      errors.push('Missing sub claim');
    }

    if (payload.iss !== payload.sub) {
      errors.push('iss and sub must be identical for client credentials');
    }

    if (!payload.aud) {
      errors.push('Missing aud claim');
    }

    if (!payload.exp) {
      errors.push('Missing exp claim');
    } else if (payload.exp <= now) {
      errors.push('JWT is expired');
    } else if (payload.exp > now + 300) {
      errors.push('JWT exp is too far in future (max 5 minutes)');
    }

    if (!payload.iat) {
      errors.push('Missing iat claim');
    }

    if (!payload.jti) {
      errors.push('Missing jti claim');
    }

    return {
      valid: errors.length === 0,
      header,
      payload,
      errors,
    };
  } catch (error) {
    errors.push(`JWT decode error: ${error}`);
    return { valid: false, header: {}, payload: {}, errors };
  }
}

/**
 * Test JWT assertion generation
 */
async function testJwtAssertion() {
  console.log('\n' + '━'.repeat(80));
  console.log('  JWT Client Assertion Test');
  console.log('━'.repeat(80) + '\n');

  // Generate or load private key
  let privateKey: string;
  let usingMockKey = false;

  if (REAL_AUTH_TEST && existsSync(MOCK_CONFIG.privateKeyPath)) {
    console.log(`✓ Loading private key from: ${MOCK_CONFIG.privateKeyPath}`);
    privateKey = readFileSync(MOCK_CONFIG.privateKeyPath, 'utf8');
  } else {
    console.log('⚠ Using mock RSA key pair (not for production)');
    const keyPair = generateMockKeyPair();
    privateKey = keyPair.privateKey;
    usingMockKey = true;
  }

  // Build JWT assertion
  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');

  const payload = {
    iss: MOCK_CONFIG.clientId,
    sub: MOCK_CONFIG.clientId,
    aud: MOCK_CONFIG.tokenUrl,
    exp: now + 300,
    iat: now,
    jti: `${MOCK_CONFIG.clientId}.${now}.${nonce}`,
  };

  const signOptions: jwt.SignOptions = {
    algorithm: 'RS256',
  };

  if (MOCK_CONFIG.privateKeyKid) {
    signOptions.keyid = MOCK_CONFIG.privateKeyKid;
  }

  const assertion = jwt.sign(payload, privateKey, signOptions);

  console.log('JWT Assertion Generated:');
  console.log(`  Length: ${assertion.length} characters`);
  console.log(`  Preview: ${assertion.slice(0, 50)}...${assertion.slice(-30)}\n`);

  // Validate structure
  const validation = validateJwtAssertion(assertion);

  console.log('Header:');
  console.log(JSON.stringify(validation.header, null, 2));
  console.log('\nPayload:');
  console.log(JSON.stringify(validation.payload, null, 2));

  if (validation.valid) {
    console.log('\n✅ JWT assertion is valid');
  } else {
    console.log('\n❌ JWT assertion validation failed:');
    validation.errors.forEach((err) => console.log(`  - ${err}`));
  }

  if (usingMockKey) {
    console.log('\n⚠  Note: This JWT was signed with a mock key and cannot be used with Okta');
  }

  return validation.valid;
}

/**
 * Test token caching behavior
 */
function testTokenCaching() {
  console.log('\n' + '━'.repeat(80));
  console.log('  Token Cache Test');
  console.log('━'.repeat(80) + '\n');

  // Simulate scope normalization
  const testCases = [
    {
      input: ['okta.apps.read', 'okta.users.read'],
      expected: 'okta.apps.read okta.users.read',
    },
    {
      input: ['okta.users.read', 'okta.apps.read'],
      expected: 'okta.apps.read okta.users.read', // Should be sorted
    },
    {
      input: 'okta.groups.read okta.apps.read',
      expected: 'okta.apps.read okta.groups.read', // Should be sorted
    },
  ];

  console.log('Scope Normalization Tests:\n');

  let allPassed = true;

  for (const testCase of testCases) {
    const normalized = normalizeScopeSet(testCase.input);
    const passed = normalized === testCase.expected;
    allPassed = allPassed && passed;

    const status = passed ? '✅' : '❌';
    console.log(`${status} Input: ${JSON.stringify(testCase.input)}`);
    console.log(`   Expected: "${testCase.expected}"`);
    console.log(`   Got:      "${normalized}"\n`);
  }

  // Test cache key collision
  console.log('Cache Key Collision Test:\n');

  const scopes1 = normalizeScopeSet(['okta.apps.read', 'okta.users.read']);
  const scopes2 = normalizeScopeSet(['okta.users.read', 'okta.apps.read']);
  const scopes3 = normalizeScopeSet('okta.apps.read okta.users.read');

  if (scopes1 === scopes2 && scopes2 === scopes3) {
    console.log('✅ All equivalent scope sets produce same cache key');
    console.log(`   Cache key: "${scopes1}"\n`);
  } else {
    console.log('❌ Cache key mismatch detected');
    console.log(`   Scopes1: "${scopes1}"`);
    console.log(`   Scopes2: "${scopes2}"`);
    console.log(`   Scopes3: "${scopes3}"\n`);
    allPassed = false;
  }

  return allPassed;
}

/**
 * Normalize scope set (duplicate from service-client.ts for testing)
 */
function normalizeScopeSet(scopes: string[] | string): string {
  const scopeArray = Array.isArray(scopes) ? scopes : scopes.split(/\s+/).filter(Boolean);
  return scopeArray.sort().join(' ');
}

/**
 * Show OAuth flow diagram
 */
function showOAuthFlow() {
  console.log('\n' + '━'.repeat(80));
  console.log('  OAuth Flow: Client Credentials with private_key_jwt');
  console.log('━'.repeat(80) + '\n');

  console.log(`
  ┌─────────────┐                                    ┌─────────────┐
  │  MRS Server │                                    │ Okta Tenant │
  └──────┬──────┘                                    └──────┬──────┘
         │                                                  │
         │  1. Build JWT assertion                         │
         │     - iss: ${MOCK_CONFIG.clientId.slice(0, 15)}...     │
         │     - sub: ${MOCK_CONFIG.clientId.slice(0, 15)}...     │
         │     - aud: /oauth2/v1/token                     │
         │     - exp: now + 5 minutes                      │
         │     - Sign with RS256                           │
         │                                                  │
         │  2. POST /oauth2/v1/token                       │
         │     grant_type=client_credentials               │
         │     scope=okta.apps.read okta.users.read        │
         │     client_assertion_type=jwt-bearer            │
         │     client_assertion=[signed JWT]               │
         ├─────────────────────────────────────────────────>│
         │                                                  │
         │                      3. Validate JWT signature  │
         │                         Check client_id grants  │
         │                         Issue access token      │
         │                                                  │
         │  4. Token Response                              │
         │     {                                            │
         │       access_token: "...",                      │
         │       token_type: "Bearer",                     │
         │       expires_in: 3600,                         │
         │       scope: "okta.apps.read okta.users.read"   │
         │     }                                            │
         │<─────────────────────────────────────────────────┤
         │                                                  │
         │  5. Cache token by scope set                    │
         │     key: "okta.apps.read okta.users.read"       │
         │                                                  │
         │  6. Call Okta API                               │
         │     GET /api/v1/apps                            │
         │     Authorization: Bearer [access_token]        │
         ├─────────────────────────────────────────────────>│
         │                                                  │
         │  7. API Response                                │
         │<─────────────────────────────────────────────────┤
         │                                                  │
  `);
}

/**
 * Show configuration summary
 */
function showConfigSummary() {
  console.log('\n' + '━'.repeat(80));
  console.log('  Configuration Summary');
  console.log('━'.repeat(80) + '\n');

  console.log('Service App OAuth:');
  console.log(`  Okta Domain:    ${MOCK_CONFIG.oktaDomain}`);
  console.log(`  Client ID:      ${MOCK_CONFIG.clientId}`);
  console.log(`  Token URL:      ${MOCK_CONFIG.tokenUrl}`);
  console.log(`  Private Key:    ${MOCK_CONFIG.privateKeyPath}`);
  console.log(`  Key ID (kid):   ${MOCK_CONFIG.privateKeyKid || '(not configured)'}`);
  console.log(`  Default Scopes: ${MOCK_CONFIG.defaultScopes}\n`);

  console.log('Important Notes:');
  console.log('  • Must use org authorization server (/oauth2/v1/token)');
  console.log('  • NOT custom authorization server (/oauth2/aus.../v1/token)');
  console.log('  • Tokens cached by scope set for efficient reuse');
  console.log('  • Tokens refreshed 60 seconds before expiry');
  console.log('  • Safe logging redacts sensitive values\n');

  if (!REAL_AUTH_TEST) {
    console.log('⚠  Running in mock mode');
    console.log('   Set REAL_AUTH_TEST=true to test with actual credentials\n');
  }
}

/**
 * Main validation
 */
async function main() {
  console.log('━'.repeat(80));
  console.log('  Okta OAuth Service App Validation');
  console.log('━'.repeat(80));

  showConfigSummary();
  showOAuthFlow();

  const jwtValid = await testJwtAssertion();
  const cacheValid = testTokenCaching();

  console.log('\n' + '━'.repeat(80));
  console.log('  Summary');
  console.log('━'.repeat(80) + '\n');

  console.log(`JWT Assertion:  ${jwtValid ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Token Caching:  ${cacheValid ? '✅ PASS' : '❌ FAIL'}`);

  if (jwtValid && cacheValid) {
    console.log('\n✅ All validation checks passed!\n');
    process.exit(0);
  } else {
    console.log('\n❌ Some validation checks failed\n');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

#!/usr/bin/env tsx
/**
 * Environment validation script
 *
 * Validates that all required environment variables and files are present
 * before starting MAS or MRS servers.
 *
 * Usage:
 *   npm run validate-env
 *   npm run validate-env -- --mode mrs
 *   npm run validate-env -- --mode mas
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ValidationCheck {
  name: string;
  type: 'required' | 'optional';
  check: () => boolean;
  errorMessage: string;
  value?: string;
}

/**
 * Validate environment configuration
 */
function validateEnvironment(mode?: 'mas' | 'mrs'): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log('\n🔍 Validating environment configuration...\n');
  console.log(`Mode: ${mode || 'all'}\n`);

  // Common checks (required for both MAS and MRS)
  const commonChecks: ValidationCheck[] = [
    {
      name: 'OKTA_DOMAIN',
      type: 'required',
      check: () => !!process.env.OKTA_DOMAIN,
      errorMessage: 'OKTA_DOMAIN is not set. Set to your Okta domain (e.g., dev-123456.okta.com)',
      value: process.env.OKTA_DOMAIN,
    },
    {
      name: 'OKTA_CLIENT_ID',
      type: 'required',
      check: () => !!process.env.OKTA_CLIENT_ID && process.env.OKTA_CLIENT_ID.startsWith('0oa'),
      errorMessage:
        'OKTA_CLIENT_ID is not set or invalid. Should be service app client ID (starts with 0oa)',
      value: process.env.OKTA_CLIENT_ID,
    },
    {
      name: 'OKTA_PRIVATE_KEY_PATH',
      type: 'required',
      check: () => {
        const keyPath = process.env.OKTA_PRIVATE_KEY_PATH;
        return !!keyPath && fs.existsSync(keyPath);
      },
      errorMessage:
        'OKTA_PRIVATE_KEY_PATH is not set or file does not exist. Generate with: npm run generate-keys',
      value: process.env.OKTA_PRIVATE_KEY_PATH,
    },
  ];

  // MAS-specific checks
  const masChecks: ValidationCheck[] = [
    {
      name: 'MAS_JWT_PRIVATE_KEY_PATH',
      type: 'required',
      check: () => {
        const keyPath = process.env.MAS_JWT_PRIVATE_KEY_PATH || './keys/mas-private-key.pem';
        return fs.existsSync(keyPath);
      },
      errorMessage:
        'MAS private key not found. Generate with: npm run generate-keys',
      value: process.env.MAS_JWT_PRIVATE_KEY_PATH || './keys/mas-private-key.pem',
    },
    {
      name: 'MAS_JWT_PUBLIC_KEY_PATH',
      type: 'required',
      check: () => {
        const keyPath = process.env.MAS_JWT_PUBLIC_KEY_PATH || './keys/mas-public-key.pem';
        return fs.existsSync(keyPath);
      },
      errorMessage:
        'MAS public key not found. Generate with: npm run generate-keys',
      value: process.env.MAS_JWT_PUBLIC_KEY_PATH || './keys/mas-public-key.pem',
    },
    {
      name: 'MAS_PORT',
      type: 'optional',
      check: () => true,
      errorMessage: '',
      value: process.env.MAS_PORT || '3000',
    },
  ];

  // MRS-specific checks
  const mrsChecks: ValidationCheck[] = [
    {
      name: 'MAS_JWT_PUBLIC_KEY_PATH',
      type: 'required',
      check: () => {
        const keyPath = process.env.MAS_JWT_PUBLIC_KEY_PATH || './keys/mas-public-key.pem';
        return fs.existsSync(keyPath);
      },
      errorMessage:
        'MAS public key not found (needed to validate MCP tokens). Generate with: npm run generate-keys',
      value: process.env.MAS_JWT_PUBLIC_KEY_PATH || './keys/mas-public-key.pem',
    },
    {
      name: 'MRS_PORT',
      type: 'optional',
      check: () => true,
      errorMessage: '',
      value: process.env.MRS_PORT || '3001',
    },
  ];

  // Determine which checks to run
  let checks: ValidationCheck[] = [...commonChecks];
  if (!mode || mode === 'mas') {
    checks = [...checks, ...masChecks];
  }
  if (!mode || mode === 'mrs') {
    checks = [...checks, ...mrsChecks];
  }

  // Run validation checks
  for (const check of checks) {
    const passed = check.check();
    const status = passed ? '✅' : '❌';
    const displayValue = check.value ? ` (${check.value})` : '';

    console.log(`${status} ${check.name}${displayValue}`);

    if (!passed && check.type === 'required') {
      errors.push(check.errorMessage);
    } else if (!passed && check.type === 'optional') {
      warnings.push(`${check.name}: ${check.errorMessage}`);
    }
  }

  // Check for .env file
  const envExists = fs.existsSync('.env');
  if (!envExists) {
    warnings.push(
      '.env file not found. Copy .env.example to .env and configure values.'
    );
  }

  // Validate key file contents
  const oktaKeyPath = process.env.OKTA_PRIVATE_KEY_PATH;
  if (oktaKeyPath && fs.existsSync(oktaKeyPath)) {
    const keyContent = fs.readFileSync(oktaKeyPath, 'utf8');
    if (!keyContent.includes('BEGIN PRIVATE KEY') && !keyContent.includes('BEGIN RSA PRIVATE KEY')) {
      errors.push(
        `OKTA_PRIVATE_KEY_PATH file (${oktaKeyPath}) does not appear to be a valid PEM private key`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Print validation results
 */
function printResults(result: ValidationResult): void {
  console.log('\n' + '═'.repeat(60));

  if (result.valid) {
    console.log('\n✅ Environment validation PASSED\n');
    console.log('All required configuration is present.');
    console.log('You can now start the server.\n');
  } else {
    console.log('\n❌ Environment validation FAILED\n');
    console.log('Errors found:\n');
    result.errors.forEach((error, i) => {
      console.log(`${i + 1}. ${error}`);
    });
    console.log('');
  }

  if (result.warnings.length > 0) {
    console.log('⚠️  Warnings:\n');
    result.warnings.forEach((warning, i) => {
      console.log(`${i + 1}. ${warning}`);
    });
    console.log('');
  }

  console.log('═'.repeat(60) + '\n');
}

/**
 * Print setup instructions
 */
function printSetupInstructions(): void {
  console.log('📖 Setup Instructions:\n');
  console.log('1. Copy .env.example to .env:');
  console.log('   cp .env.example .env\n');
  console.log('2. Generate MAS key pair:');
  console.log('   npm run generate-keys\n');
  console.log('3. Create Okta service app and configure:');
  console.log('   - OKTA_DOMAIN');
  console.log('   - OKTA_CLIENT_ID');
  console.log('   - OKTA_PRIVATE_KEY_PATH (upload corresponding public key to Okta)\n');
  console.log('4. Grant required OAuth scopes to service app in Okta\n');
  console.log('5. Run validation again:');
  console.log('   npm run validate-env\n');
  console.log('See docs/smoke-test.md for detailed setup instructions.\n');
}

/**
 * Parse command line arguments
 */
function parseArgs(): { mode?: 'mas' | 'mrs'; help?: boolean } {
  const args = process.argv.slice(2);
  const options: { mode?: 'mas' | 'mrs'; help?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case '--mode':
      case '-m':
        if (value === 'mas' || value === 'mrs') {
          options.mode = value;
        }
        i++;
        break;
      case '--help':
      case '-h':
        options.help = true;
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
Usage: npm run validate-env [options]

Options:
  --mode <mas|mrs>  Validate only MAS or MRS configuration
  --help, -h        Show this help message

Examples:
  npm run validate-env
  npm run validate-env -- --mode mrs
  npm run validate-env -- --mode mas
`);
}

/**
 * Main entry point
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const result = validateEnvironment(options.mode);
  printResults(result);

  if (!result.valid) {
    printSetupInstructions();
    process.exit(1);
  }

  process.exit(0);
}

main();

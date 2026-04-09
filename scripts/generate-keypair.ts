#!/usr/bin/env node
/**
 * Generate RSA keypair for JWT signing
 *
 * Generates RSA-256 key pairs for MAS JWT signing
 */

import { generateKeyPairSync } from 'crypto';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

function main() {
  const keysDir = './keys';
  const privateKeyPath = join(keysDir, 'mas-private-key.pem');
  const publicKeyPath = join(keysDir, 'mas-public-key.pem');

  // Create keys directory if it doesn't exist
  if (!existsSync(keysDir)) {
    mkdirSync(keysDir, { recursive: true });
  }

  // Check if keys already exist
  if (existsSync(privateKeyPath) || existsSync(publicKeyPath)) {
    console.log('⚠️  Keys already exist!');
    console.log('');
    console.log('Existing files:');
    if (existsSync(privateKeyPath)) console.log(`   - ${privateKeyPath}`);
    if (existsSync(publicKeyPath)) console.log(`   - ${publicKeyPath}`);
    console.log('');
    console.log('Delete these files first if you want to generate new keys.');
    process.exit(1);
  }

  console.log('🔐 Generating RSA key pair for JWT signing...\n');

  try {
    // Generate RSA key pair
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
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

    // Write keys to files
    writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
    writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });

    console.log('✅ Keys generated successfully!\n');
    console.log('📄 Files created:');
    console.log(`   Private key: ${privateKeyPath}`);
    console.log(`   Public key:  ${publicKeyPath}`);
    console.log('');
    console.log('🔒 Private key permissions set to 0600 (owner read/write only)');
    console.log('');
    console.log('⚠️  Keep the private key secure and never commit it to version control!');
  } catch (error) {
    console.error('❌ Error generating keys:', error);
    process.exit(1);
  }
}

main();

#!/usr/bin/env tsx
/**
 * Find Okta user ID by email
 *
 * Uses the configured Okta service app to lookup a user by email.
 */

import { config } from '../src/config/index.js';
import { getServiceAccessToken } from '../src/okta/service-client.js';

async function findUserByEmail(email: string): Promise<void> {
  console.log('\n🔍 Searching for user in Okta...\n');
  console.log(`Email: ${email}`);
  console.log(`Domain: ${config.okta.domain}\n`);

  try {
    // Get OAuth token
    console.log('📝 Authenticating with Okta...');
    const token = await getServiceAccessToken(['okta.users.read']);
    console.log('✅ Authentication successful\n');

    // Search for user
    console.log('🔎 Looking up user...');
    const url = `https://${config.okta.domain}/api/v1/users?search=profile.email eq "${email}"&limit=10`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to search users: ${response.status} ${response.statusText}`);
    }

    const users = await response.json();

    if (users.length === 0) {
      console.log('❌ User not found\n');
      console.log('Make sure:');
      console.log('  - The email is correct');
      console.log('  - The user exists in', config.okta.domain);
      console.log('  - Your service app has okta.users.read scope\n');
      return;
    }

    const user = users[0];

    console.log('✅ User found!\n');
    console.log('─'.repeat(60));
    console.log('User Details:');
    console.log('─'.repeat(60));
    console.log(`User ID:       ${user.id}`);
    console.log(`Email:         ${user.profile.email}`);
    console.log(`Name:          ${user.profile.firstName} ${user.profile.lastName}`);
    console.log(`Login:         ${user.profile.login}`);
    console.log(`Status:        ${user.status}`);
    console.log('─'.repeat(60));
    console.log('\n💡 Use this user ID to generate a test token:\n');
    console.log(`   npm run generate-token -- --sub ${user.id}\n`);

    // Check for admin roles
    console.log('🔍 Checking admin roles...\n');
    const rolesUrl = `https://${config.okta.domain}/api/v1/users/${user.id}/roles`;

    const rolesResponse = await fetch(rolesUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (rolesResponse.ok) {
      const roles = await rolesResponse.json();

      if (roles.length === 0) {
        console.log('⚠️  No admin roles assigned');
        console.log('   This user will only see self-service tools\n');
      } else {
        console.log('✅ Admin roles found:');
        for (const role of roles) {
          console.log(`   - ${role.type}: ${role.label}`);
        }
        console.log('');
      }
    } else {
      console.log('⚠️  Could not check roles (requires okta.roles.read scope)\n');
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    console.log('\nTroubleshooting:');
    console.log('  - Verify OKTA_DOMAIN, OKTA_CLIENT_ID in .env');
    console.log('  - Verify private key is correct');
    console.log('  - Verify okta.users.read scope is granted\n');
    process.exit(1);
  }
}

// Main
const email = process.argv[2];

if (!email) {
  console.log('\nUsage: npm run find-user -- <email>\n');
  console.log('Example:');
  console.log('  npm run find-user -- john.doe@example.com\n');
  process.exit(1);
}

findUserByEmail(email);

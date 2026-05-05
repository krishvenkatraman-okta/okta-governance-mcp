#!/usr/bin/env tsx
/**
 * Inspect one seeded user's Okta profile and group memberships to verify
 * department/title/managerId actually landed in the profile (peer-grouper
 * reads these off `profile.*`).
 */
import { getServiceAccessToken } from '../src/okta/service-client.js';
import { config } from '../src/config/index.js';

const userId = process.argv[2];
if (!userId) {
  console.error('usage: tsx scripts/inspect-seeded-user.ts <user_id>');
  process.exit(1);
}

const base = `https://${config.okta.domain}`;

async function get(path: string, scopes: string): Promise<unknown> {
  const token = await getServiceAccessToken(scopes);
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json();
}

const user = (await get(`/api/v1/users/${userId}`, 'okta.users.read')) as {
  id: string;
  profile: Record<string, unknown>;
};
const groups = (await get(`/api/v1/users/${userId}/groups`, 'okta.users.read okta.groups.read')) as Array<{
  profile: { name: string };
}>;
const apps = (await get(
  `/api/v1/apps?filter=${encodeURIComponent(`user.id eq "${userId}"`)}&limit=200`,
  'okta.users.read okta.apps.read',
)) as Array<{ label: string; status: string }>;

console.log('id:', user.id);
console.log('profile fields read by peer-grouper:');
console.log('  firstName :', user.profile.firstName);
console.log('  lastName  :', user.profile.lastName);
console.log('  department:', user.profile.department);
console.log('  title     :', user.profile.title);
console.log('  managerId :', user.profile.managerId);
console.log('  manager   :', user.profile.manager);
console.log('groups:', groups.map((g) => g.profile.name));
console.log('apps (via /apps?filter=user.id eq, the path access-graph uses):');
console.log(apps.map((a) => `  ${a.label} [${a.status}]`).join('\n') || '  <empty>');

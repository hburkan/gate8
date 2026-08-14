#!/usr/bin/env node
/**
 * Phase 15 admin provisioning bootstrapper (invite-only, decision D8).
 *
 * Creates a Supabase Auth user with the admin role claim. The role lives ONLY
 * in app_metadata.role (decision D2) — never user_metadata. Uses the
 * service-role Admin API, so it works with enable_signup = false (invite-only;
 * Admin-API user creation is not blocked by signup being disabled).
 *
 * Usage (from repo root, with admin env vars loaded):
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   ADMIN_EMAIL=admin@gumruk.local \
 *   ADMIN_PASSWORD=<strong password, min 12 chars> \
 *   ADMIN_ROLE=SUPER_ADMIN \
 *   node scripts/provision-admin.mjs
 *
 * No secrets are printed; the user id and email are logged on success.
 */
import assert from 'node:assert';

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY_ALT;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const role = process.env.ADMIN_ROLE ?? 'SUPER_ADMIN';

const VALID_ROLES = ['SUPER_ADMIN', 'CONTENT_ADMIN', 'EDITOR', 'REVIEWER'];

assert.ok(url, 'SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is required');
assert.ok(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY is required');
assert.ok(email, 'ADMIN_EMAIL is required');
assert.ok(password, 'ADMIN_PASSWORD is required');
assert.ok(VALID_ROLES.includes(role), `ADMIN_ROLE must be one of ${VALID_ROLES.join(', ')}`);
assert.ok(password.length >= 12, 'ADMIN_PASSWORD must be at least 12 characters long (design D6)');

const endpoint = `${url}/auth/v1/admin/users`;

const body = {
  email,
  password,
  email_confirm: true,
  app_metadata: { role },
  user_metadata: {},
};

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${serviceRoleKey}`,
    apikey: serviceRoleKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const data = await response.json();

if (!response.ok) {
  console.error(`Provisioning failed (${response.status}):`, data);
  process.exit(1);
}

console.log(
  `Provisioned ${role} admin: id=${data.id} email=${data.email} (role=${data.app_metadata?.role})`,
);
console.log('Role claim is set in app_metadata.role only; user_metadata is empty.');

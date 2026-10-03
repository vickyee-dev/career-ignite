'use strict';

/**
 * Create a user from the command line (handy for the first admin).
 *
 *   npm run user:create -- --email jane@example.com --password 'S3cretPass1' \
 *       --first-name Jane --last-name Doe --role ADMIN
 */

const { parseArgs } = require('node:util');
const { hashPassword } = require('../src/lib/password');
const { ROLES } = require('../src/core/auth');

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    /* no .env */
  }
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
      'first-name': { type: 'string' },
      'last-name': { type: 'string' },
      role: { type: 'string', default: 'INTERN' },
    },
  });

  const missing = ['email', 'password', 'first-name', 'last-name'].filter((k) => !values[k]);
  if (missing.length) throw new Error(`Missing required option(s): ${missing.map((m) => `--${m}`).join(', ')}`);
  if (!ROLES.includes(values.role)) throw new Error(`--role must be one of: ${ROLES.join(', ')}`);
  if (values.password.length < 8) throw new Error('--password must be at least 8 characters');

  const db = require('../src/db');
  try {
    const user = await db.user.create({
      data: {
        first_name: values['first-name'],
        last_name: values['last-name'],
        email_address: values.email.toLowerCase(),
        password: await hashPassword(values.password),
        role: values.role,
        is_active: true,
        created_by: 'cli',
      },
    });
    console.log(`Created ${user.role} #${user.id} <${user.email_address}>`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err.code === 'P2002' ? 'A user with that email already exists.' : err.message);
  process.exit(1);
});

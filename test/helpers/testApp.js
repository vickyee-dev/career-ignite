'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../../src/config');
const { createApp } = require('../../src/core/app');
const routes = require('../../src/routes');
const { hashPassword } = require('../../src/lib/password');
const { createFakeDb } = require('./fakeDb');

const ADMIN = { email: 'admin@example.com', password: 'AdminPass123' };
const INTERN = { email: 'intern@example.com', password: 'InternPass123' };

/**
 * Builds a fully wired app on top of the in-memory db.
 * `clock.set(date)` lets tests move time (token expiry, opportunity expiry).
 */
function createTestApp(envOverrides = {}) {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'careerignite-test-'));
  const config = {
    ...loadConfig({
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      UPLOAD_DIR: uploadDir,
      ...envOverrides,
    }),
    silent: true,
  };
  let current = new Date('2026-01-15T10:00:00Z');
  const clock = { now: () => new Date(current), set: (d) => (current = new Date(d)) };
  const db = createFakeDb({ now: () => clock.now() });
  const app = createApp({ db, config, routes, now: clock.now, logger: { error() {}, info() {} } });

  /** request('POST', '/api/x', { body, token, query, headers, raw, ip }) -> { status, body, headers, file } */
  async function request(method, urlPath, { body, token, query = {}, headers = {}, raw, ip = '10.0.0.1' } = {}) {
    const h = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    let rawBody;
    if (raw) rawBody = raw;
    else if (body !== undefined) rawBody = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    return app.handle({ method, path: urlPath, query, headers: h, rawBody, ip });
  }

  async function createUserDirect(overrides = {}) {
    return db.user.create({
      data: {
        first_name: 'Test',
        middle_name: null,
        last_name: 'User',
        email_address: `user${db.user._rows.length + 1}@example.com`,
        password: await hashPassword('Password123'),
        role: 'INTERN',
        is_active: true,
        created_by: 'test',
        ...overrides,
      },
    });
  }

  async function login(email, password) {
    const res = await request('POST', '/api/auth/login', { body: { email_address: email, password } });
    if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
    return res.body.token;
  }

  /** Seeds reference data, an admin, and an intern; returns ready-to-use tokens. */
  async function bootstrap() {
    const meta = { is_active: true, created_by: 'test' };
    await db.department.create({ data: { name: 'Engineering', department_head: 'Ada', description: null, ...meta } });
    await db.opportunityType.create({ data: { type: 'Internship', description: 'x', ...meta } });
    await db.compensationType.create({ data: { type: 'Stipend', description: 'x', ...meta } });
    await db.cohort.create({
      data: { name: 'Alpha', code_name: 'alpha', president: 'Pres', start_date: new Date('2026-01-01'), end_date: new Date('2027-01-01'), ...meta },
    });
    const admin = await createUserDirect({
      email_address: ADMIN.email,
      password: await hashPassword(ADMIN.password),
      role: 'ADMIN',
    });
    const intern = await createUserDirect({
      email_address: INTERN.email,
      password: await hashPassword(INTERN.password),
      cohort: 'Alpha',
    });
    return {
      admin,
      intern,
      adminToken: await login(ADMIN.email, ADMIN.password),
      internToken: await login(INTERN.email, INTERN.password),
    };
  }

  const cleanup = () => fs.rmSync(uploadDir, { recursive: true, force: true });

  return { app, db, config, clock, request, login, createUserDirect, bootstrap, cleanup, routes };
}

const validOpportunity = (overrides = {}) => ({
  title: 'Backend Intern',
  department: 'Engineering',
  opportunity_type: 'Internship',
  opportunity_description: 'Build APIs.',
  core_competencies: 'Node.js, SQL',
  compensation_type: 'Stipend',
  compensation_currency: 'kes',
  compensation_amount: 30000,
  expiry_date: '2026-06-30',
  ...overrides,
});

module.exports = { createTestApp, validOpportunity, ADMIN, INTERN };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, ADMIN, INTERN } = require('./helpers/testApp');
const { signToken } = require('../src/lib/jwt');

const registration = (o = {}) => ({
  first_name: 'Jane',
  last_name: 'Doe',
  email_address: 'jane@example.com',
  password: 'Sup3rSecret',
  ...o,
});

test('register: creates an INTERN, hashes the password, never returns it', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  await ctx.bootstrap();

  const res = await ctx.request('POST', '/api/auth/register', { body: registration({ cohort: 'alpha', role: 'ADMIN', is_active: false }) });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.password, undefined, 'no password in response');
  assert.equal(res.body.data.role, 'INTERN', 'role escalation via body ignored');
  assert.equal(res.body.data.is_active, true);
  assert.equal(res.body.data.cohort, 'Alpha', 'cohort normalised to canonical spelling');

  const stored = ctx.db.user._rows.find((u) => u.email_address === 'jane@example.com');
  assert.match(stored.password, /^scrypt\$/);
  assert.ok(!stored.password.includes('Sup3rSecret'));
});

test('register: validation, duplicate email and unknown cohort', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  await ctx.bootstrap();

  let res = await ctx.request('POST', '/api/auth/register', { body: { email_address: 'nope', password: 'weak' } });
  assert.equal(res.status, 422);
  assert.deepEqual(Object.keys(res.body.error.details).sort(), ['email_address', 'first_name', 'last_name', 'password']);

  res = await ctx.request('POST', '/api/auth/register', { body: registration({ cohort: 'Zeta' }) });
  assert.equal(res.status, 422);
  assert.ok(res.body.error.details.cohort);

  assert.equal((await ctx.request('POST', '/api/auth/register', { body: registration() })).status, 201);
  res = await ctx.request('POST', '/api/auth/register', { body: registration({ email_address: 'JANE@example.com' }) });
  assert.equal(res.status, 409, 'email uniqueness is case-insensitive');
});

test('login: success returns a bearer token usable on /api/me', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  await ctx.bootstrap();

  const res = await ctx.request('POST', '/api/auth/login', { body: { email_address: INTERN.email, password: INTERN.password } });
  assert.equal(res.status, 200);
  assert.equal(res.body.token_type, 'Bearer');
  assert.equal(res.body.expires_in, 3600);
  assert.equal(res.body.user.password, undefined);

  const me = await ctx.request('GET', '/api/me', { token: res.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.data.email_address, INTERN.email);
  assert.equal(me.body.data.password, undefined);
});

test('login: identical error for wrong password, unknown email and inactive account', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  await ctx.bootstrap();
  await ctx.createUserDirect({ email_address: 'off@example.com', is_active: false });
  await ctx.db.user.update({ where: { email_address: 'off@example.com' }, data: { password: ctx.db.user._rows[0].password } }); // admin's hash (AdminPass123)

  const attempts = [
    { email_address: INTERN.email, password: 'WrongPass123' },
    { email_address: 'ghost@example.com', password: 'Whatever123' },
    { email_address: 'off@example.com', password: ADMIN.password },
  ];
  const results = [];
  for (const body of attempts) results.push(await ctx.request('POST', '/api/auth/login', { body }));
  for (const r of results) {
    assert.equal(r.status, 401);
    assert.equal(r.body.error.message, 'Invalid email or password');
  }
});

test('login: is rate limited per IP', async (t) => {
  const ctx = createTestApp({ AUTH_RATE_LIMIT_MAX: '3' });
  t.after(ctx.cleanup);
  const body = { email_address: 'a@example.com', password: 'x' };
  for (let i = 0; i < 3; i++) assert.equal((await ctx.request('POST', '/api/auth/login', { body })).status, 401);
  const blocked = await ctx.request('POST', '/api/auth/login', { body });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['Retry-After']) >= 1);
  assert.equal((await ctx.request('POST', '/api/auth/login', { body, ip: '10.9.9.9' })).status, 401, 'other IPs unaffected');
});

test('auth: missing, malformed, expired, forged and orphaned tokens are all 401', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  const { admin, internToken } = await ctx.bootstrap();

  assert.equal((await ctx.request('GET', '/api/me')).status, 401);
  assert.equal((await ctx.request('GET', '/api/me', { headers: { authorization: 'Basic abc' } })).status, 401);
  assert.equal((await ctx.request('GET', '/api/me', { token: 'garbage' })).status, 401);
  assert.equal((await ctx.request('GET', '/api/me', { token: internToken + 'x' })).status, 401);

  const secret = ctx.config.jwtSecret;
  const expired = signToken({ sub: admin.id, role: 'ADMIN' }, secret, 60, ctx.clock.now().getTime() - 120_000);
  assert.equal((await ctx.request('GET', '/api/me', { token: expired })).status, 401);

  const orphan = signToken({ sub: 9999, role: 'ADMIN' }, secret, 60, ctx.clock.now().getTime());
  assert.equal((await ctx.request('GET', '/api/me', { token: orphan })).status, 401);

  // token lifetime is enforced against the (injected) clock
  ctx.clock.set(new Date(ctx.clock.now().getTime() + 3601_000));
  assert.equal((await ctx.request('GET', '/api/me', { token: internToken })).status, 401);
});

test('auth: the role claim in a token is not trusted; DB role wins', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  const { intern } = await ctx.bootstrap();
  const lying = signToken({ sub: intern.id, role: 'ADMIN' }, ctx.config.jwtSecret, 600, ctx.clock.now().getTime());
  assert.equal((await ctx.request('GET', '/api/users', { token: lying })).status, 403);
});

test('auth: deactivating a user revokes their existing tokens immediately', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  const { intern, internToken, adminToken } = await ctx.bootstrap();
  assert.equal((await ctx.request('GET', '/api/me', { token: internToken })).status, 200);
  assert.equal((await ctx.request('DELETE', `/api/users/${intern.id}`, { token: adminToken })).status, 204);
  assert.equal((await ctx.request('GET', '/api/me', { token: internToken })).status, 401);
});

test('PATCH /api/me: updates profile; password change requires current password', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  const { internToken } = await ctx.bootstrap();

  let res = await ctx.request('PATCH', '/api/me', { token: internToken, body: { first_name: 'Ivy', role: 'ADMIN', email_address: 'x@y.zz' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.first_name, 'Ivy');
  assert.equal(res.body.data.role, 'INTERN', 'role cannot be self-assigned');
  assert.equal(res.body.data.email_address, INTERN.email, 'email is not self-editable');

  res = await ctx.request('PATCH', '/api/me', { token: internToken, body: { password: 'NewPassw0rd' } });
  assert.equal(res.status, 422);
  res = await ctx.request('PATCH', '/api/me', { token: internToken, body: { password: 'NewPassw0rd', current_password: 'nope' } });
  assert.equal(res.status, 422);
  res = await ctx.request('PATCH', '/api/me', { token: internToken, body: { password: 'NewPassw0rd', current_password: INTERN.password } });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.password, undefined);
  await ctx.login(INTERN.email, 'NewPassw0rd');
  assert.equal((await ctx.request('PATCH', '/api/me', { token: internToken, body: {} })).status, 400);
});

test('admin users: interns are forbidden, admins can list/create/update/deactivate', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  const { admin, intern, adminToken, internToken } = await ctx.bootstrap();

  for (const [m, p] of [['GET', '/api/users'], ['POST', '/api/users'], ['GET', `/api/users/${admin.id}`], ['PATCH', `/api/users/${admin.id}`], ['DELETE', `/api/users/${admin.id}`]]) {
    assert.equal((await ctx.request(m, p, { token: internToken, body: {} })).status, 403, `${m} ${p}`);
  }

  let res = await ctx.request('GET', '/api/users', { token: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.meta.total, 2);
  assert.ok(res.body.data.every((u) => u.password === undefined));

  res = await ctx.request('GET', '/api/users', { token: adminToken, query: { q: 'INTERN@', role: 'INTERN' } });
  assert.deepEqual(res.body.data.map((u) => u.id), [intern.id]);
  assert.equal((await ctx.request('GET', '/api/users', { token: adminToken, query: { role: 'ROOT' } })).status, 422);

  res = await ctx.request('POST', '/api/users', { token: adminToken, body: registration({ role: 'ADMIN' }) });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.role, 'ADMIN');
  assert.equal(res.body.data.created_by, ADMIN.email);

  res = await ctx.request('PATCH', `/api/users/${intern.id}`, { token: adminToken, body: { cohort: null, password: 'Another1Pass' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.cohort, null);
  await ctx.login(INTERN.email, 'Another1Pass');

  assert.equal((await ctx.request('GET', '/api/users/999', { token: adminToken })).status, 404);
  assert.equal((await ctx.request('GET', '/api/users/abc', { token: adminToken })).status, 422);
});

test('admin users: lockout protection and email clashes', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  const { admin, intern, adminToken } = await ctx.bootstrap();

  assert.equal((await ctx.request('DELETE', `/api/users/${admin.id}`, { token: adminToken })).status, 409);
  assert.equal((await ctx.request('PATCH', `/api/users/${admin.id}`, { token: adminToken, body: { role: 'INTERN' } })).status, 409);
  assert.equal((await ctx.request('PATCH', `/api/users/${admin.id}`, { token: adminToken, body: { is_active: false } })).status, 409);
  assert.equal((await ctx.request('PATCH', `/api/users/${intern.id}`, { token: adminToken, body: { email_address: ADMIN.email } })).status, 409);
  assert.equal((await ctx.request('PATCH', `/api/users/${intern.id}`, { token: adminToken, body: { email_address: INTERN.email } })).status, 200, 'keeping own email is fine');
});

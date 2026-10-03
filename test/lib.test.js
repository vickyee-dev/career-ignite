'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { signToken, verifyToken } = require('../src/lib/jwt');
const { hashPassword, verifyPassword } = require('../src/lib/password');
const { f, parse } = require('../src/lib/validate');
const { pagination, sorting, idParam } = require('../src/lib/query');
const { createRateLimiter } = require('../src/lib/rateLimit');
const { loadConfig, parseDuration } = require('../src/config');

const SECRET = 'a-very-long-test-secret-0123456789abcdef';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('jwt: sign/verify round trip', () => {
  const token = signToken({ sub: 7, role: 'ADMIN' }, SECRET, 60, 1_000_000);
  const claims = verifyToken(token, SECRET, 1_000_000);
  assert.equal(claims.sub, 7);
  assert.equal(claims.role, 'ADMIN');
  assert.equal(claims.exp - claims.iat, 60);
});

test('jwt: rejects expired, tampered, wrong-secret and malformed tokens', () => {
  const token = signToken({ sub: 1 }, SECRET, 60, 0);
  assert.throws(() => verifyToken(token, SECRET, 61_000), { status: 401 }, 'expired');
  assert.throws(() => verifyToken(token, 'other-secret-other-secret-other-secret', 1000), { status: 401 });
  const [h, , s] = token.split('.');
  const forged = `${h}.${b64({ sub: 99, exp: 9999999999 })}.${s}`;
  assert.throws(() => verifyToken(forged, SECRET, 1000), { status: 401 }, 'payload swapped');
  for (const bad of ['', 'abc', 'a.b', 'a.b.c.d', undefined, null]) {
    assert.throws(() => verifyToken(bad, SECRET), { status: 401 });
  }
});

test('jwt: rejects alg=none and other algorithms', () => {
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 1, exp: 9999999999 })}.`;
  assert.throws(() => verifyToken(none, SECRET, 1000), { status: 401 });
  const hs512Header = b64({ alg: 'HS512', typ: 'JWT' });
  const payload = b64({ sub: 1, exp: 9999999999 });
  const sig = crypto.createHmac('sha512', SECRET).update(`${hs512Header}.${payload}`).digest('base64url');
  assert.throws(() => verifyToken(`${hs512Header}.${payload}.${sig}`, SECRET, 1000), { status: 401 });
});

test('password: hash is salted and verifies correctly', async () => {
  const a = await hashPassword('Secret123');
  const b = await hashPassword('Secret123');
  assert.notEqual(a, b, 'unique salt per hash');
  assert.match(a, /^scrypt\$\d+\$\d+\$\d+\$/);
  assert.equal(await verifyPassword('Secret123', a), true);
  assert.equal(await verifyPassword('secret123', a), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
  assert.equal(await verifyPassword('x', null), false, 'unknown user path');
});

test('validate: coerces, trims and strips unknown fields', () => {
  const schema = { name: f.string({ required: true, max: 5 }), email: f.email({ required: true }), ok: f.boolean({ default: true }) };
  assert.deepEqual(parse(schema, { name: '  Bob ', email: ' BOB@Example.COM ', hack: 1 }), {
    name: 'Bob',
    email: 'bob@example.com',
    ok: true,
  });
});

test('validate: reports every error at once', () => {
  const schema = { a: f.string({ required: true }), b: f.int({ required: true, min: 1 }), c: f.enum(['X', 'Y'], { required: true }) };
  try {
    parse(schema, { b: 0, c: 'Z' });
    assert.fail('should throw');
  } catch (err) {
    assert.equal(err.status, 422);
    assert.deepEqual(Object.keys(err.details).sort(), ['a', 'b', 'c']);
  }
});

test('validate: partial mode skips absent fields; null only where nullable', () => {
  const schema = { a: f.string({ required: true }), b: f.string({ nullable: true }), c: f.string({}) };
  assert.deepEqual(parse(schema, { b: null }, { partial: true }), { b: null });
  assert.throws(() => parse(schema, { c: null }, { partial: true }), { status: 422 });
});

test('validate: dates reject impossible days and non-ISO strings', () => {
  const schema = { d: f.date({ required: true }) };
  assert.ok(parse(schema, { d: '2026-02-28' }).d instanceof Date);
  assert.ok(parse(schema, { d: '2026-02-28T10:00:00Z' }).d instanceof Date);
  for (const bad of ['2026-02-31', 'tomorrow', '12/31/2026', 20260101, '2026-13-01']) {
    assert.throws(() => parse(schema, { d: bad }), { status: 422 }, String(bad));
  }
});

test('validate: password strength, currency, body shape', () => {
  assert.throws(() => parse({ p: f.password({ required: true }) }, { p: 'short1' }), { status: 422 });
  assert.throws(() => parse({ p: f.password({ required: true }) }, { p: 'onlyletters' }), { status: 422 });
  assert.equal(parse({ c: f.currency({ required: true }) }, { c: 'kes' }).c, 'KES');
  assert.throws(() => parse({ c: f.currency({ required: true }) }, { c: 'KENYA' }), { status: 422 });
  assert.throws(() => parse({}, []), { status: 422 });
  assert.throws(() => parse({}, null), { status: 422 });
});

test('query: pagination defaults, caps and validation', () => {
  assert.deepEqual(pagination({}), { page: 1, limit: 20, skip: 0, take: 20 });
  assert.deepEqual(pagination({ page: '3', limit: '10' }), { page: 3, limit: 10, skip: 20, take: 10 });
  assert.equal(pagination({ limit: '9999' }).limit, 100);
  for (const bad of [{ page: '0' }, { page: '-1' }, { limit: 'abc' }, { page: '1.5' }]) {
    assert.throws(() => pagination(bad), { status: 422 });
  }
});

test('query: sorting is whitelisted; id params are strict', () => {
  assert.deepEqual(sorting({ sort: '-title' }, ['title'], 'title'), { title: 'desc' });
  assert.deepEqual(sorting({}, ['title'], 'title'), { title: 'asc' });
  assert.throws(() => sorting({ sort: 'password' }, ['title'], 'title'), { status: 422 });
  assert.equal(idParam({ id: '42' }), 42);
  for (const bad of ['0', '-1', 'abc', '1e3', '99999999999', '']) assert.throws(() => idParam({ id: bad }), { status: 422 });
});

test('rate limiter: blocks after max, resets after the window', () => {
  let t = 0;
  const limiter = createRateLimiter({ now: () => t });
  const rule = { max: 2, windowMs: 1000 };
  assert.equal(limiter.hit('k', rule).allowed, true);
  assert.equal(limiter.hit('k', rule).allowed, true);
  const blocked = limiter.hit('k', rule);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  assert.equal(limiter.hit('other', rule).allowed, true, 'keys are independent');
  t = 1001;
  assert.equal(limiter.hit('k', rule).allowed, true, 'window elapsed');
});

test('config: defaults, durations and production safety checks', () => {
  assert.equal(parseDuration('15m'), 900);
  assert.equal(parseDuration('2h'), 7200);
  assert.equal(parseDuration('7d'), 604800);
  assert.equal(parseDuration(undefined, 5), 5);
  assert.throws(() => parseDuration('soon'));

  const dev = loadConfig({});
  assert.equal(dev.port, 3000);
  assert.ok(dev.jwtSecret.length >= 32, 'ephemeral secret generated in dev');

  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' }), /32/);
  assert.equal(loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) }).isProduction, true);
  assert.deepEqual(loadConfig({ CORS_ORIGIN: 'http://a.com, http://b.com' }).corsOrigins, ['http://a.com', 'http://b.com']);
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, validOpportunity } = require('./helpers/testApp');
const { createHttpServer } = require('../src/server/http');

async function start(t, env = {}) {
  const ctx = createTestApp({ CORS_ORIGIN: 'https://app.example.com', MAX_UPLOAD_MB: '1', ...env });
  const server = createHttpServer({ app: ctx.app, config: ctx.config, logger: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
    ctx.cleanup();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { ctx, base };
}
const json = (body) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('http: health, security headers and JSON error shape', async (t) => {
  const { base } = await start(t);
  const ok = await fetch(`${base}/api/health`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, 'ok');
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(ok.headers.get('x-frame-options'), 'DENY');
  assert.equal(ok.headers.get('cache-control'), 'no-store');

  const missing = await fetch(`${base}/api/nope`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'not_found');

  const wrongMethod = await fetch(`${base}/api/health`, { method: 'DELETE' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET');
});

test('http: invalid JSON and non-object bodies are 400', async (t) => {
  const { base } = await start(t);
  for (const body of ['{oops', '[1,2]', '"str"']) {
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(res.status, 400, body);
  }
});

test('http: CORS allows only configured origins; preflight answers 204', async (t) => {
  const { base } = await start(t);
  const allowed = await fetch(`${base}/api/health`, { headers: { Origin: 'https://app.example.com' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example.com');
  const denied = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example.com' } });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);

  const pre = await fetch(`${base}/api/opportunities`, { method: 'OPTIONS', headers: { Origin: 'https://app.example.com' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
});

test('http: oversized bodies get 413 (JSON and uploads) and the server stays healthy', async (t) => {
  const { ctx, base } = await start(t);
  const { internToken } = await ctx.bootstrap();

  const bigJson = await fetch(`${base}/api/auth/login`, { method: 'POST', ...json({ password: 'x'.repeat(2 * 1024 * 1024) }) });
  assert.equal(bigJson.status, 413);

  const tooBigUpload = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(1024 * 1024 + 10)]); // limit is 1 MB here
  const bigUpload = await fetch(`${base}/api/documents?name=a&filename=a.pdf`, {
    method: 'POST',
    body: tooBigUpload,
    headers: { authorization: `Bearer ${internToken}` },
  });
  assert.equal(bigUpload.status, 413);
  assert.equal(ctx.db.document._rows.length, 0);

  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test('http: end-to-end register -> login -> apply -> upload -> download over real sockets', async (t) => {
  const { ctx, base } = await start(t);
  const { adminToken } = await ctx.bootstrap();
  const auth = (token) => ({ authorization: `Bearer ${token}` });

  const created = await fetch(`${base}/api/opportunities`, { method: 'POST', headers: { ...auth(adminToken), 'content-type': 'application/json' }, body: JSON.stringify(validOpportunity()) });
  assert.equal(created.status, 201);
  const opp = (await created.json()).data;

  const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', ...json({ first_name: 'New', last_name: 'Intern', email_address: 'new@example.com', password: 'Passw0rd123' }) });
  assert.equal(reg.status, 201);
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', ...json({ email_address: 'new@example.com', password: 'Passw0rd123' }) });
  const { token } = await login.json();

  const apply = await fetch(`${base}/api/opportunities/${opp.id}/apply`, { method: 'POST', headers: auth(token) });
  assert.equal(apply.status, 201);

  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from([0, 1, 2, 3, 255, 254, 253])]);
  const up = await fetch(`${base}/api/documents?name=Photo&filename=me%20(1).png`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/octet-stream' }, body: bytes });
  assert.equal(up.status, 201);
  const doc = (await up.json()).data;
  assert.equal(doc.file_name, 'me (1).png');

  const dl = await fetch(`${base}${doc.download_url}`, { headers: auth(token) });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'image/png');
  assert.match(dl.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''me%20\(1\)\.png$/);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), bytes, 'binary round trip is lossless');

  assert.equal((await fetch(`${base}${doc.download_url}`)).status, 401);
});

test('http: unexpected errors become a generic 500 without leaking details', async (t) => {
  const { ctx, base } = await start(t);
  ctx.db.user.findUnique = async () => { throw new Error('connection string postgres://secret'); };
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', ...json({ email_address: 'a@b.cc', password: 'x' }) });
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.ok(!text.includes('postgres://'));
  assert.equal(JSON.parse(text).error.code, 'internal_error');
});

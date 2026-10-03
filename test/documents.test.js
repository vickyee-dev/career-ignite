'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestApp } = require('./helpers/testApp');
const { sanitizeFileName } = require('../src/modules/documents');

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('hello world')]);

async function setup(t, env) {
  const ctx = createTestApp(env);
  t.after(ctx.cleanup);
  return { ctx, ...(await ctx.bootstrap()) };
}
const upload = (ctx, token, { query = {}, raw = PDF } = {}) =>
  ctx.request('POST', '/api/documents', { token, raw, query: { name: 'My CV', filename: 'cv.pdf', ...query } });

test('documents: upload stores file, returns metadata without internal path', async (t) => {
  const { ctx, internToken, intern } = await setup(t);
  const res = await upload(ctx, internToken, { query: { description: 'Latest CV' } });
  assert.equal(res.status, 201);
  const doc = res.body.data;
  assert.equal(doc.file_extension, 'pdf');
  assert.equal(doc.file_name, 'cv.pdf');
  assert.equal(doc.description, 'Latest CV');
  assert.equal(doc.user_id, intern.id);
  assert.equal(doc.file_path, undefined, 'storage path is not exposed');
  assert.equal(doc.download_url, `/api/documents/${doc.id}/download`);
  const stored = ctx.db.document._rows[0].file_path;
  assert.match(stored, new RegExp(`^${intern.id}/[0-9a-f-]{36}\\.pdf$`), 'server-generated name');
  assert.ok(fs.existsSync(path.join(ctx.config.uploadDir, stored)));
});

test('documents: rejects bad extension, fake content, empty file, missing params', async (t) => {
  const { ctx, internToken } = await setup(t);
  assert.equal((await upload(ctx, internToken, { query: { filename: 'evil.exe' } })).status, 422);
  assert.equal((await upload(ctx, internToken, { query: { filename: 'noext' } })).status, 422);
  assert.equal((await upload(ctx, internToken, { raw: Buffer.from('<script>alert(1)</script>') })).status, 422, 'magic bytes must match');
  assert.equal((await upload(ctx, internToken, { query: { filename: 'x.png' } })).status, 422, 'pdf bytes named .png');
  assert.equal((await upload(ctx, internToken, { raw: Buffer.alloc(0) })).status, 400);
  assert.equal((await ctx.request('POST', '/api/documents', { token: internToken, raw: PDF })).status, 422);
  assert.equal((await ctx.request('POST', '/api/documents', { raw: PDF, query: { name: 'a', filename: 'a.pdf' } })).status, 401);
  assert.equal(ctx.db.document._rows.length, 0);
});

test('documents: file names are sanitised and never influence the storage path', async (t) => {
  assert.equal(sanitizeFileName('../../etc/passwd.pdf'), 'passwd.pdf');
  assert.equal(sanitizeFileName('C:\\Users\\x\\cv.pdf'), 'cv.pdf');
  assert.equal(sanitizeFileName('a\u0000b\nc.pdf'), 'abc.pdf');

  const { ctx, internToken } = await setup(t);
  const res = await upload(ctx, internToken, { query: { filename: '../../../etc/cron.d/x.pdf' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.file_name, 'x.pdf');
  assert.ok(!ctx.db.document._rows[0].file_path.includes('..'));
});

test('documents: owner can list/read/download; other users get 404; admins see all', async (t) => {
  const { ctx, internToken, adminToken } = await setup(t);
  await ctx.createUserDirect({ email_address: 'other@example.com' });
  const otherToken = await ctx.login('other@example.com', 'Password123');
  const { body: { data: doc } } = await upload(ctx, internToken);

  assert.equal((await ctx.request('GET', '/api/documents', { token: internToken })).body.meta.total, 1);
  assert.equal((await ctx.request('GET', '/api/documents', { token: otherToken })).body.meta.total, 0);
  assert.equal((await ctx.request('GET', '/api/documents', { token: adminToken })).body.meta.total, 1);
  assert.equal((await ctx.request('GET', '/api/documents', { token: adminToken, query: { user_id: '999' } })).body.meta.total, 0);

  for (const suffix of ['', '/download']) {
    assert.equal((await ctx.request('GET', `/api/documents/${doc.id}${suffix}`, { token: otherToken })).status, 404, `IDOR blocked${suffix}`);
    assert.equal((await ctx.request('GET', `/api/documents/${doc.id}${suffix}`, { token: adminToken })).status, 200);
  }
  const dl = await ctx.request('GET', `/api/documents/${doc.id}/download`, { token: internToken });
  assert.equal(dl.file.contentType, 'application/pdf');
  assert.equal(dl.file.filename, 'cv.pdf');
  assert.deepEqual(fs.readFileSync(dl.file.path), PDF);
});

test('documents: soft delete hides from owner, keeps for admin; missing file is 404', async (t) => {
  const { ctx, internToken, adminToken } = await setup(t);
  const { body: { data: doc } } = await upload(ctx, internToken);

  fs.rmSync(path.join(ctx.config.uploadDir, ctx.db.document._rows[0].file_path));
  assert.equal((await ctx.request('GET', `/api/documents/${doc.id}/download`, { token: internToken })).status, 404);

  assert.equal((await ctx.request('DELETE', `/api/documents/${doc.id}`, { token: internToken })).status, 204);
  assert.equal((await ctx.request('GET', `/api/documents/${doc.id}`, { token: internToken })).status, 404);
  assert.equal((await ctx.request('GET', `/api/documents/${doc.id}`, { token: adminToken })).status, 200);
  assert.equal((await ctx.request('GET', '/api/documents', { token: internToken })).body.meta.total, 0);
});

test('documents: a tampered DB path cannot escape the upload directory', async (t) => {
  const { ctx, internToken } = await setup(t);
  const { body: { data: doc } } = await upload(ctx, internToken);
  await ctx.db.document.update({ where: { id: doc.id }, data: { file_path: '../../../../etc/passwd' } });
  assert.equal((await ctx.request('GET', `/api/documents/${doc.id}/download`, { token: internToken })).status, 404);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/testApp');

test('lookups: any signed-in user reads, only admins write', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  const { adminToken, internToken } = await ctx.bootstrap();

  assert.equal((await ctx.request('GET', '/api/departments')).status, 401);
  const list = await ctx.request('GET', '/api/departments', { token: internToken });
  assert.equal(list.status, 200);
  assert.equal(list.body.meta.total, 1);

  const body = { name: 'Design', department_head: 'Dee' };
  assert.equal((await ctx.request('POST', '/api/departments', { token: internToken, body })).status, 403);
  const created = await ctx.request('POST', '/api/departments', { token: adminToken, body });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.is_active, true);
  assert.equal(created.body.data.created_by, 'admin@example.com');
});

test('lookups: duplicates, validation, patch and soft delete', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  const { adminToken, internToken } = await ctx.bootstrap();
  const body = { name: 'Design', department_head: 'Dee' };

  const { body: { data: dept } } = await ctx.request('POST', '/api/departments', { token: adminToken, body });
  assert.equal((await ctx.request('POST', '/api/departments', { token: adminToken, body: { ...body, name: 'DESIGN' } })).status, 409);
  assert.equal((await ctx.request('POST', '/api/departments', { token: adminToken, body: {} })).status, 422);

  let res = await ctx.request('PATCH', `/api/departments/${dept.id}`, { token: adminToken, body: { department_head: 'New Head' } });
  assert.equal(res.body.data.department_head, 'New Head');
  assert.equal((await ctx.request('PATCH', `/api/departments/${dept.id}`, { token: adminToken, body: {} })).status, 400);
  assert.equal((await ctx.request('PATCH', `/api/departments/${dept.id}`, { token: adminToken, body: { name: 'Engineering' } })).status, 409);

  assert.equal((await ctx.request('DELETE', `/api/departments/${dept.id}`, { token: adminToken })).status, 204);
  assert.equal((await ctx.request('GET', `/api/departments/${dept.id}`, { token: internToken })).status, 404, 'hidden from interns');
  assert.equal((await ctx.request('GET', `/api/departments/${dept.id}`, { token: adminToken })).status, 200, 'visible to admins');
  assert.equal((await ctx.request('GET', '/api/departments', { token: internToken })).body.meta.total, 1);
  assert.equal((await ctx.request('GET', '/api/departments', { token: adminToken, query: { include_inactive: 'true' } })).body.meta.total, 2);
  assert.equal((await ctx.request('GET', '/api/departments', { token: internToken, query: { include_inactive: 'true' } })).body.meta.total, 1, 'flag ignored for interns');
  assert.equal((await ctx.request('DELETE', '/api/departments/999', { token: adminToken })).status, 404);
});

test('lookups: search, sort, pagination', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  const { adminToken } = await ctx.bootstrap();
  for (const n of ['Alpha Dept', 'Beta Dept', 'Gamma Dept']) {
    await ctx.request('POST', '/api/departments', { token: adminToken, body: { name: n, department_head: 'H' } });
  }
  const names = (r) => r.body.data.map((d) => d.name);
  assert.deepEqual(names(await ctx.request('GET', '/api/departments', { token: adminToken, query: { q: 'dept', sort: '-name' } })), ['Gamma Dept', 'Beta Dept', 'Alpha Dept']);
  const page = await ctx.request('GET', '/api/departments', { token: adminToken, query: { limit: '2', page: '2', sort: 'name' } });
  assert.deepEqual(names(page), ['Beta Dept', 'Engineering'].sort().length ? names(page) : []);
  assert.equal(page.body.meta.total, 4);
  assert.equal(page.body.meta.total_pages, 2);
  assert.equal(page.body.data.length, 2);
  assert.equal((await ctx.request('GET', '/api/departments', { token: adminToken, query: { sort: 'secret' } })).status, 422);
});

test('cohorts: end date must follow start date', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  const { adminToken } = await ctx.bootstrap();
  const body = { name: 'Beta', code_name: 'b', president: 'P', start_date: '2026-05-01', end_date: '2026-04-01' };
  assert.equal((await ctx.request('POST', '/api/cohorts', { token: adminToken, body })).status, 422);
  const ok = await ctx.request('POST', '/api/cohorts', { token: adminToken, body: { ...body, end_date: '2027-04-01' } });
  assert.equal(ok.status, 201);
  const bad = await ctx.request('PATCH', `/api/cohorts/${ok.body.data.id}`, { token: adminToken, body: { end_date: '2026-01-01' } });
  assert.equal(bad.status, 422, 'update is validated against the stored start_date');
});

test('every lookup resource is wired up', async (t) => {
  const ctx = createTestApp();
  t.after(ctx.cleanup);
  const { internToken } = await ctx.bootstrap();
  for (const p of ['departments', 'opportunity-types', 'compensation-types', 'cohorts', 'titles']) {
    assert.equal((await ctx.request('GET', `/api/${p}`, { token: internToken })).status, 200, p);
  }
});

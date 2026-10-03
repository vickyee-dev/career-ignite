'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, validOpportunity } = require('./helpers/testApp');

async function setup(t) {
  const ctx = createTestApp({ JWT_EXPIRES_IN: '400d' }); // tests move the clock by months
  t.after(ctx.cleanup);
  const auth = await ctx.bootstrap();
  const res = await ctx.request('POST', '/api/opportunities', { token: auth.adminToken, body: validOpportunity() });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { ctx, ...auth, opp: res.body.data };
}

test('opportunities: create normalises currency and lookup values', async (t) => {
  const { ctx, adminToken, opp } = await setup(t);
  assert.equal(opp.compensation_currency, 'KES');
  const res = await ctx.request('POST', '/api/opportunities', { token: adminToken, body: validOpportunity({ department: 'engineering', title: 'Two' }) });
  assert.equal(res.body.data.department, 'Engineering');
});

test('opportunities: rejects unknown lookups, past expiry, negative pay, non-admins', async (t) => {
  const { ctx, adminToken, internToken } = await setup(t);
  const post = (token, body) => ctx.request('POST', '/api/opportunities', { token, body });
  assert.equal((await post(adminToken, validOpportunity({ department: 'Narnia' }))).body.error.details.department.includes('Narnia'), true);
  assert.equal((await post(adminToken, validOpportunity({ opportunity_type: 'Nope' }))).status, 422);
  assert.equal((await post(adminToken, validOpportunity({ compensation_type: 'Nope' }))).status, 422);
  assert.equal((await post(adminToken, validOpportunity({ expiry_date: '2025-01-01' }))).body.error.details.expiry_date, 'must be in the future');
  assert.equal((await post(adminToken, validOpportunity({ compensation_amount: -5 }))).status, 422);
  assert.equal((await post(internToken, validOpportunity())).status, 403);
  assert.equal((await post(null, validOpportunity())).status, 401);
});

test('opportunities: public listing shows only open ones; admin can widen it', async (t) => {
  const { ctx, adminToken, opp } = await setup(t);
  const hidden = await ctx.request('POST', '/api/opportunities', { token: adminToken, body: validOpportunity({ title: 'Hidden', is_active: false }) });
  const soon = await ctx.request('POST', '/api/opportunities', { token: adminToken, body: validOpportunity({ title: 'Soon', expiry_date: '2026-02-01' }) });

  const titles = async (token, query) => (await ctx.request('GET', '/api/opportunities', { token, query })).body.data.map((o) => o.title).sort();
  assert.deepEqual(await titles(null), ['Backend Intern', 'Soon']);
  assert.deepEqual(await titles(adminToken, { include_inactive: 'true' }), ['Backend Intern', 'Hidden', 'Soon']);

  ctx.clock.set('2026-03-01T00:00:00Z'); // "Soon" has now expired
  assert.deepEqual(await titles(null), ['Backend Intern']);
  assert.deepEqual(await titles(adminToken, { include_expired: 'true' }), ['Backend Intern', 'Soon']);
  assert.equal((await ctx.request('GET', `/api/opportunities/${soon.body.data.id}`)).status, 404);
  assert.equal((await ctx.request('GET', `/api/opportunities/${hidden.body.data.id}`)).status, 404);
  assert.equal((await ctx.request('GET', `/api/opportunities/${hidden.body.data.id}`, { token: adminToken })).status, 200);
  assert.equal((await ctx.request('GET', `/api/opportunities/${opp.id}`)).status, 200);
});

test('opportunities: filters, search and sorting', async (t) => {
  const { ctx, adminToken } = await setup(t);
  await ctx.db.department.create({ data: { name: 'Design', department_head: 'D', is_active: true, created_by: 't' } });
  await ctx.request('POST', '/api/opportunities', { token: adminToken, body: validOpportunity({ title: 'UX Intern', department: 'Design', compensation_amount: 10 }) });
  const get = async (query) => (await ctx.request('GET', '/api/opportunities', { query })).body.data.map((o) => o.title);
  assert.deepEqual(await get({ department: 'design' }), ['UX Intern']);
  assert.deepEqual(await get({ q: 'BACKEND' }), ['Backend Intern']);
  assert.deepEqual(await get({ sort: 'compensation_amount' }), ['UX Intern', 'Backend Intern']);
  assert.equal((await ctx.request('GET', '/api/opportunities', { query: { sort: 'created_by' } })).status, 422);
  assert.equal((await ctx.request('GET', '/api/opportunities', { headers: { authorization: 'Bearer bad' } })).status, 401, 'bad token is rejected even on optional-auth routes');
});

test('opportunities: patch and soft delete', async (t) => {
  const { ctx, adminToken, opp } = await setup(t);
  const patched = await ctx.request('PATCH', `/api/opportunities/${opp.id}`, { token: adminToken, body: { title: 'Renamed', department: 'ENGINEERING' } });
  assert.equal(patched.body.data.title, 'Renamed');
  assert.equal(patched.body.data.department, 'Engineering');
  assert.equal((await ctx.request('PATCH', `/api/opportunities/${opp.id}`, { token: adminToken, body: { department: 'Narnia' } })).status, 422);
  assert.equal((await ctx.request('DELETE', `/api/opportunities/${opp.id}`, { token: adminToken })).status, 204);
  assert.equal((await ctx.request('GET', `/api/opportunities/${opp.id}`)).status, 404);
  assert.equal((await ctx.request('PATCH', '/api/opportunities/999', { token: adminToken, body: { title: 'x' } })).status, 404);
});

test('applications: full lifecycle (apply, duplicate, review, withdraw, re-apply)', async (t) => {
  const { ctx, adminToken, internToken, intern, opp } = await setup(t);
  const apply = () => ctx.request('POST', `/api/opportunities/${opp.id}/apply`, { token: internToken });

  assert.equal((await ctx.request('POST', `/api/opportunities/${opp.id}/apply`)).status, 401);
  const first = await apply();
  assert.equal(first.status, 201);
  assert.equal(first.body.data.status, 'APPLIED');
  assert.equal(first.body.data.opportunity.title, 'Backend Intern');
  assert.equal((await apply()).status, 409, 'cannot apply twice');

  const mine = await ctx.request('GET', '/api/me/applications', { token: internToken });
  assert.equal(mine.body.meta.total, 1);
  assert.equal(mine.body.data[0].opportunity.id, opp.id);
  assert.equal((await ctx.request('GET', '/api/me/applications', { token: internToken, query: { status: 'BOGUS' } })).status, 422);

  const applicants = await ctx.request('GET', `/api/opportunities/${opp.id}/applicants`, { token: adminToken });
  assert.equal(applicants.body.data[0].user.email_address, intern.email_address);
  assert.equal(applicants.body.data[0].user.password, undefined, 'applicant payload excludes secrets');
  assert.equal((await ctx.request('GET', `/api/opportunities/${opp.id}/applicants`, { token: internToken })).status, 403);

  const appId = first.body.data.id;
  assert.equal((await ctx.request('PATCH', `/api/applications/${appId}`, { token: internToken, body: { status: 'ACCEPTED' } })).status, 403, 'interns cannot self-accept');
  assert.equal((await ctx.request('PATCH', `/api/applications/${appId}`, { token: adminToken, body: { status: 'WITHDRAWN' } })).status, 422);
  assert.equal((await ctx.request('PATCH', `/api/applications/${appId}`, { token: adminToken, body: { status: 'SHORTLISTED' } })).body.data.status, 'SHORTLISTED');
  assert.equal((await ctx.request('GET', `/api/opportunities/${opp.id}/applicants`, { token: adminToken, query: { status: 'SHORTLISTED' } })).body.meta.total, 1);

  assert.equal((await ctx.request('DELETE', `/api/applications/${appId}`, { token: internToken })).status, 204);
  assert.equal((await ctx.request('PATCH', `/api/applications/${appId}`, { token: adminToken, body: { status: 'ACCEPTED' } })).status, 409);
  const again = await apply();
  assert.equal(again.status, 200, 're-activates the withdrawn application');
  assert.equal(again.body.data.id, appId);
  assert.equal(again.body.data.status, 'APPLIED');
  assert.equal(ctx.db.opportunityUser._rows.length, 1, 'still a single row');
});

test('applications: closed opportunities and other users are protected', async (t) => {
  const { ctx, adminToken, internToken, opp } = await setup(t);
  const other = await ctx.createUserDirect({ email_address: 'other@example.com' });
  const otherToken = await ctx.login('other@example.com', 'Password123');

  const app = await ctx.request('POST', `/api/opportunities/${opp.id}/apply`, { token: internToken });
  assert.equal((await ctx.request('DELETE', `/api/applications/${app.body.data.id}`, { token: otherToken })).status, 404, "cannot withdraw someone else's application");
  assert.equal((await ctx.request('GET', '/api/me/applications', { token: otherToken })).body.meta.total, 0);
  assert.equal((await ctx.request('DELETE', `/api/applications/${app.body.data.id}`, { token: adminToken })).status, 204, 'admins may withdraw');

  ctx.clock.set('2026-07-01T00:00:00Z');
  const closed = await ctx.request('POST', `/api/opportunities/${opp.id}/apply`, { token: otherToken });
  assert.equal(closed.status, 409);
  assert.equal((await ctx.request('POST', '/api/opportunities/999/apply', { token: otherToken })).status, 404);
  assert.ok(other.id);
});

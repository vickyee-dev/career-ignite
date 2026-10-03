'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeDb } = require('./helpers/fakeDb');
const { seed } = require('../prisma/seed');
const { verifyPassword } = require('../src/lib/password');

test('seed: creates reference data + admin, and is idempotent', async () => {
  const db = createFakeDb();
  const opts = { adminEmail: 'Boss@Example.com', adminPassword: 'Str0ngPass!' };
  const first = await seed(db, opts);
  assert.ok(first.created > 15);
  assert.equal(db.department._rows.length, 5);
  assert.equal(db.title._rows.length, 6);

  const admin = db.user._rows[0];
  assert.equal(admin.role, 'ADMIN');
  assert.equal(admin.email_address, 'boss@example.com');
  assert.notEqual(admin.password, 'Str0ngPass!');
  assert.equal(await verifyPassword('Str0ngPass!', admin.password), true);

  const second = await seed(db, opts);
  assert.equal(second.created, 0, 'second run adds nothing');
});

test('seed --demo: interns, opportunities and applications, also idempotent', async () => {
  const db = createFakeDb();
  await seed(db, { demo: true });
  assert.equal(db.user._rows.filter((u) => u.role === 'INTERN').length, 5);
  assert.equal(db.opportunity._rows.length, 6);
  assert.equal(db.opportunityUser._rows.length, 5);
  assert.ok(db.user._rows.every((u) => !u.password || u.password.startsWith('scrypt$')), 'no plaintext passwords');
  const before = JSON.stringify([db.user._rows.length, db.opportunity._rows.length, db.opportunityUser._rows.length]);
  await seed(db, { demo: true });
  assert.equal(JSON.stringify([db.user._rows.length, db.opportunity._rows.length, db.opportunityUser._rows.length]), before);
});

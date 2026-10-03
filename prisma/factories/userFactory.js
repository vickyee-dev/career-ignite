'use strict';

const { faker } = require('@faker-js/faker');
const { hashPassword } = require('../../src/lib/password');

const DEFAULT_PASSWORD = 'Password123!';

/** @param {import('@prisma/client').PrismaClient} db */
async function createUser(db, { password = DEFAULT_PASSWORD, ...overrides } = {}) {
  const first_name = faker.person.firstName();
  const last_name = faker.person.lastName();
  return db.user.create({
    data: {
      title: 'Mr.',
      first_name,
      middle_name: faker.person.middleName(),
      last_name,
      phone_number: `07${faker.string.numeric(8)}`,
      cohort: null,
      email_address: faker.internet.email({ firstName: first_name, lastName: last_name }).toLowerCase(),
      password: await hashPassword(password), // never store plaintext
      role: 'INTERN',
      is_active: true,
      created_by: 'seed',
      ...overrides,
    },
  });
}

module.exports = { createUser, DEFAULT_PASSWORD };

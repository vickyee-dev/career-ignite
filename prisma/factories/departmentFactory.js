'use strict';

const { faker } = require('@faker-js/faker');

/** @param {import('@prisma/client').PrismaClient} db */
async function createDepartment(db, overrides = {}) {
  return db.department.create({
    data: {
      name: faker.commerce.department(),
      department_head: faker.person.fullName(),
      description: faker.lorem.paragraph(),
      is_active: true,
      created_by: 'seed',
      ...overrides,
    },
  });
}

module.exports = { createDepartment };

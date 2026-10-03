'use strict';

const { faker } = require('@faker-js/faker');

/** @param {import('@prisma/client').PrismaClient} db */
async function createOpportunity(db, overrides = {}) {
  return db.opportunity.create({
    data: {
      title: faker.person.jobTitle(),
      department: 'Engineering',
      opportunity_type: 'Internship',
      opportunity_description: faker.lorem.paragraphs(2),
      core_competencies: 'Communication, Problem solving, Teamwork',
      compensation_type: 'Stipend',
      compensation_currency: 'KES',
      compensation_amount: faker.number.int({ min: 15000, max: 60000 }),
      expiry_date: faker.date.soon({ days: 60 }),
      is_active: true,
      created_by: 'seed',
      ...overrides,
    },
  });
}

module.exports = { createOpportunity };

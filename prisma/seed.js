'use strict';

/**
 * Database seeder.   npm run db:seed            -> reference data + admin account
 *                    npm run db:seed -- --demo  -> additionally: demo interns, opportunities, applications
 *
 * Idempotent: safe to run repeatedly; existing rows are left untouched.
 * Environment: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (required in production).
 */

const { createUser } = require('./factories/userFactory');
const { createOpportunity } = require('./factories/opportunityFactory');
const { hashPassword } = require('../src/lib/password');

const DEPARTMENTS = [
  ['Engineering', 'Head of Engineering', 'Software, data and infrastructure teams.'],
  ['Design', 'Head of Design', 'Product, UX and brand design.'],
  ['Marketing', 'Head of Marketing', 'Growth, content and communications.'],
  ['Finance', 'Chief Financial Officer', 'Accounting, treasury and financial planning.'],
  ['People & Culture', 'Head of People', 'Recruitment, learning and employee experience.'],
];
const OPPORTUNITY_TYPES = [
  ['Internship', 'Fixed-term placement for students and recent graduates.'],
  ['Graduate Trainee', 'Structured programme for graduates within 2 years of completing studies.'],
  ['Apprenticeship', 'Paid on-the-job training combined with study.'],
  ['Fellowship', 'Short, project-based placement for early-career professionals.'],
];
const COMPENSATION_TYPES = [
  ['Stipend', 'Fixed monthly allowance.'],
  ['Salary', 'Standard monthly salary.'],
  ['Hourly', 'Paid per hour worked.'],
  ['Unpaid', 'Volunteer or academic-credit placement.'],
];
const TITLES = ['Mr.', 'Ms.', 'Mrs.', 'Dr.', 'Prof.', 'Mx.'];
const COHORTS = [['Alpha', 'alpha', 'Cohort President']];

const DEMO_INTERNS = [
  ['Amina', 'Wanjiru', 'amina'],
  ['Brian', 'Otieno', 'brian'],
  ['Cynthia', 'Mutua', 'cynthia'],
  ['David', 'Kamau', 'david'],
  ['Esther', 'Achieng', 'esther'],
];
const DEMO_OPPORTUNITIES = [
  ['Software Engineering Intern', 'Engineering', 'Internship', 'KES', 40000],
  ['Data Analyst Intern', 'Engineering', 'Internship', 'KES', 35000],
  ['Product Design Intern', 'Design', 'Internship', 'KES', 30000],
  ['Digital Marketing Trainee', 'Marketing', 'Graduate Trainee', 'KES', 45000],
  ['Finance Apprentice', 'Finance', 'Apprenticeship', 'KES', 28000],
  ['HR Fellow', 'People & Culture', 'Fellowship', 'KES', 32000],
];

/** Create the row only if nothing matches `where`. Returns [row, wasCreated]. */
async function ensure(model, where, data) {
  const existing = await model.findFirst({ where });
  if (existing) return [existing, false];
  return [await model.create({ data: { ...where, ...data } }), true];
}

/**
 * @param {import('@prisma/client').PrismaClient} db
 * @param {{demo?: boolean, adminEmail?: string, adminPassword?: string, log?: (msg: string) => void}} options
 */
async function seed(db, { demo = false, adminEmail, adminPassword, log = () => {} } = {}) {
  const meta = { is_active: true, created_by: 'seed' };
  const counts = { created: 0 };
  const track = ([, created]) => {
    if (created) counts.created += 1;
  };

  for (const [name, department_head, description] of DEPARTMENTS) {
    track(await ensure(db.department, { name }, { department_head, description, ...meta }));
  }
  for (const [type, description] of OPPORTUNITY_TYPES) {
    track(await ensure(db.opportunityType, { type }, { description, ...meta }));
  }
  for (const [type, description] of COMPENSATION_TYPES) {
    track(await ensure(db.compensationType, { type }, { description, ...meta }));
  }
  for (const name of TITLES) {
    track(await ensure(db.title, { name }, { description: `Form of address: ${name}`, ...meta }));
  }
  const now = new Date();
  for (const [name, code_name, president] of COHORTS) {
    const end = new Date(now);
    end.setFullYear(end.getFullYear() + 1);
    track(await ensure(db.cohort, { name }, { code_name, president, start_date: now, end_date: end, ...meta }));
  }
  log('Reference data ready');

  if (adminEmail && adminPassword) {
    const created = await ensure(db.user, { email_address: adminEmail.toLowerCase() }, {
      title: 'Ms.',
      first_name: 'Platform',
      middle_name: null,
      last_name: 'Admin',
      password: await hashPassword(adminPassword),
      role: 'ADMIN',
      ...meta,
    });
    track(created);
    log(`Admin account: ${adminEmail}${created[1] ? ' (created)' : ' (already existed)'}`);
  }

  if (demo) {
    for (const [first_name, last_name, handle] of DEMO_INTERNS) {
      const email_address = `${handle}@careerignite.local`;
      if (!(await db.user.findFirst({ where: { email_address } }))) {
        await createUser(db, { first_name, last_name, email_address, cohort: 'Alpha', title: null });
        counts.created += 1;
      }
    }
    for (const [title, department, opportunity_type, compensation_currency, compensation_amount] of DEMO_OPPORTUNITIES) {
      if (!(await db.opportunity.findFirst({ where: { title } }))) {
        await createOpportunity(db, { title, department, opportunity_type, compensation_currency, compensation_amount });
        counts.created += 1;
      }
    }
    // A few applications, spread across interns/opportunities.
    const interns = await db.user.findMany({ where: { email_address: { endsWith: '@careerignite.local' }, role: 'INTERN' } });
    const opportunities = await db.opportunity.findMany({ where: { title: { in: DEMO_OPPORTUNITIES.map((o) => o[0]) } } });
    for (const [i, intern] of interns.entries()) {
      const opportunity = opportunities[i % opportunities.length];
      if (!opportunity) continue;
      const where = { user_id: intern.id, opportunity_id: opportunity.id };
      track(await ensure(db.opportunityUser, where, { status: 'APPLIED', is_active: true }));
    }
    log(`Demo data ready (interns log in with password "Password123!")`);
  }

  return counts;
}

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    /* no .env */
  }
  const isProduction = process.env.NODE_ENV === 'production';
  const adminEmail = process.env.SEED_ADMIN_EMAIL || (isProduction ? undefined : 'admin@careerignite.local');
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || (isProduction ? undefined : 'ChangeMe123!');
  if (isProduction && (!adminEmail || !adminPassword)) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD when seeding in production');
  }
  if (isProduction && process.argv.includes('--demo')) throw new Error('Refusing to seed demo data in production');

  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    const result = await seed(db, { demo: process.argv.includes('--demo'), adminEmail, adminPassword, log: console.log });
    console.log(`Done. ${result.created} new record(s) created.`);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seed };

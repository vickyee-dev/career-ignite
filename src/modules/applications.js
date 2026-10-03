'use strict';

const { f, parse } = require('../lib/validate');
const { conflict, notFound, validation } = require('../lib/errors');
const { pagination, pageMeta, idParam } = require('../lib/query');
const { ok, created, noContent } = require('../core/response');
const { assertOwnerOrAdmin } = require('../core/auth');
const { findOpportunity, isOpen } = require('./opportunities');

const STATUSES = ['APPLIED', 'SHORTLISTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'];
const REVIEW_STATUSES = STATUSES.filter((s) => s !== 'WITHDRAWN');

const summariseOpportunity = (o) => o && {
  id: o.id,
  title: o.title,
  department: o.department,
  opportunity_type: o.opportunity_type,
  expiry_date: o.expiry_date,
  is_active: o.is_active,
};
const summariseUser = (u) => u && {
  id: u.id,
  title: u.title,
  first_name: u.first_name,
  middle_name: u.middle_name,
  last_name: u.last_name,
  email_address: u.email_address,
  phone_number: u.phone_number,
  cohort: u.cohort,
};

function statusFilter(value) {
  if (!STATUSES.includes(value)) throw validation({ status: `must be one of: ${STATUSES.join(', ')}` });
  return value;
}

/** Batch-loads related rows with one `IN` query each (no N+1). */
async function expand(db, applications, { opportunities = false, users = false }) {
  const byId = async (model, ids) =>
    new Map((await db[model].findMany({ where: { id: { in: [...new Set(ids)] } } })).map((r) => [r.id, r]));
  const opps = opportunities ? await byId('opportunity', applications.map((a) => a.opportunity_id)) : null;
  const people = users ? await byId('user', applications.map((a) => a.user_id)) : null;
  return applications.map((a) => ({
    ...a,
    ...(opps && { opportunity: summariseOpportunity(opps.get(a.opportunity_id)) }),
    ...(people && { user: summariseUser(people.get(a.user_id)) }),
  }));
}

const routes = [
  {
    method: 'POST',
    path: '/api/opportunities/:id/apply',
    auth: 'user',
    async handler({ db, params, user, now }) {
      const opportunityId = idParam(params);
      const opportunity = await findOpportunity(db, opportunityId);
      if (!isOpen(opportunity, now)) throw conflict('This opportunity is closed');

      const existing = await db.opportunityUser.findFirst({
        where: { user_id: user.id, opportunity_id: opportunityId },
      });
      if (existing && existing.status !== 'WITHDRAWN') throw conflict('You have already applied to this opportunity');

      const application = existing
        ? await db.opportunityUser.update({ where: { id: existing.id }, data: { status: 'APPLIED', is_active: true } })
        : await db.opportunityUser.create({
            data: { user_id: user.id, opportunity_id: opportunityId, status: 'APPLIED', is_active: true },
          });
      const [expanded] = await expand(db, [application], { opportunities: true });
      return existing ? ok({ data: expanded }) : created({ data: expanded });
    },
  },
  {
    method: 'GET',
    path: '/api/me/applications',
    auth: 'user',
    async handler({ db, user, query }) {
      const { page, limit, skip, take } = pagination(query);
      const where = { user_id: user.id };
      if (query.status) where.status = statusFilter(query.status);
      const [rows, total] = await Promise.all([
        db.opportunityUser.findMany({ where, orderBy: { created_at: 'desc' }, skip, take }),
        db.opportunityUser.count({ where }),
      ]);
      return ok({ data: await expand(db, rows, { opportunities: true }), meta: pageMeta(total, page, limit) });
    },
  },
  {
    method: 'GET',
    path: '/api/opportunities/:id/applicants',
    auth: 'admin',
    async handler({ db, params, query }) {
      const opportunityId = idParam(params);
      await findOpportunity(db, opportunityId);
      const { page, limit, skip, take } = pagination(query);
      const where = { opportunity_id: opportunityId };
      if (query.status) where.status = statusFilter(query.status);
      const [rows, total] = await Promise.all([
        db.opportunityUser.findMany({ where, orderBy: { created_at: 'asc' }, skip, take }),
        db.opportunityUser.count({ where }),
      ]);
      return ok({ data: await expand(db, rows, { users: true }), meta: pageMeta(total, page, limit) });
    },
  },
  {
    method: 'PATCH',
    path: '/api/applications/:id',
    auth: 'admin',
    async handler({ db, params, body }) {
      const id = idParam(params);
      const { status } = parse({ status: f.enum(REVIEW_STATUSES, { required: true }) }, body);
      const application = await db.opportunityUser.findUnique({ where: { id } });
      if (!application) throw notFound('Application not found');
      if (application.status === 'WITHDRAWN') throw conflict('The applicant has withdrawn this application');
      const updated = await db.opportunityUser.update({ where: { id }, data: { status } });
      return ok({ data: updated });
    },
  },
  {
    method: 'DELETE',
    path: '/api/applications/:id',
    auth: 'user',
    async handler({ db, params, user }) {
      const id = idParam(params);
      const application = await db.opportunityUser.findUnique({ where: { id } });
      if (!application) throw notFound('Application not found');
      assertOwnerOrAdmin(user, application.user_id);
      // Withdrawing keeps the audit trail; the intern may re-apply while the role is open.
      await db.opportunityUser.update({ where: { id }, data: { status: 'WITHDRAWN', is_active: false } });
      return noContent();
    },
  },
];

module.exports = { routes, STATUSES };

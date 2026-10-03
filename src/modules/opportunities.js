'use strict';

const { f, parse } = require('../lib/validate');
const { badRequest, notFound, validation } = require('../lib/errors');
const { pagination, pageMeta, sorting, flag, textSearch, idParam } = require('../lib/query');
const { ok, created, noContent } = require('../core/response');
const { isAdmin, actor } = require('../core/auth');
const { resolveLookup } = require('./lookup');

const schema = {
  title: f.string({ required: true, max: 255 }),
  department: f.string({ required: true, max: 255 }),
  opportunity_type: f.string({ required: true, max: 255 }),
  opportunity_description: f.string({ required: true, max: 20000 }),
  core_competencies: f.string({ required: true, max: 20000 }),
  compensation_type: f.string({ required: true, max: 255 }),
  compensation_currency: f.currency({ required: true }),
  compensation_amount: f.number({ required: true, min: 0, max: 1e9 }),
  expiry_date: f.date({ required: true }),
  is_active: f.boolean({ default: true }),
};

// column on the opportunity -> the lookup table that must contain the value
const LOOKUPS = {
  department: { model: 'department', column: 'name' },
  opportunity_type: { model: 'opportunityType', column: 'type' },
  compensation_type: { model: 'compensationType', column: 'type' },
};

async function normaliseLookups(db, data) {
  for (const [field, target] of Object.entries(LOOKUPS)) {
    if (data[field] !== undefined) data[field] = await resolveLookup(db, { ...target, value: data[field], field });
  }
}

async function findOpportunity(db, id) {
  const row = await db.opportunity.findUnique({ where: { id } });
  if (!row) throw notFound('Opportunity not found');
  return row;
}

/** Everyone but admins only ever sees open (active + unexpired) opportunities. */
const isOpen = (o, now) => o.is_active && o.expiry_date > now;

const routes = [
  {
    method: 'GET',
    path: '/api/opportunities',
    auth: 'optional',
    async handler({ db, query, user, now }) {
      const { page, limit, skip, take } = pagination(query);
      const where = {};
      const admin = isAdmin(user);
      if (!(admin && flag(query, 'include_inactive'))) where.is_active = true;
      if (!(admin && flag(query, 'include_expired'))) where.expiry_date = { gt: now };
      for (const field of Object.keys(LOOKUPS)) {
        if (query[field]) where[field] = { equals: query[field], mode: 'insensitive' };
      }
      const or = textSearch(query.q, ['title', 'opportunity_description', 'core_competencies']);
      if (or) where.OR = or;
      const orderBy = sorting(query, ['created_at', 'expiry_date', 'title', 'compensation_amount'], '-created_at');
      const [data, total] = await Promise.all([
        db.opportunity.findMany({ where, orderBy, skip, take }),
        db.opportunity.count({ where }),
      ]);
      return ok({ data, meta: pageMeta(total, page, limit) });
    },
  },
  {
    method: 'GET',
    path: '/api/opportunities/:id',
    auth: 'optional',
    async handler({ db, params, user, now }) {
      const row = await findOpportunity(db, idParam(params));
      if (!isAdmin(user) && !isOpen(row, now)) throw notFound('Opportunity not found');
      return ok({ data: row });
    },
  },
  {
    method: 'POST',
    path: '/api/opportunities',
    auth: 'admin',
    async handler({ db, body, user, now }) {
      const data = parse(schema, body);
      if (data.expiry_date <= now) throw validation({ expiry_date: 'must be in the future' });
      await normaliseLookups(db, data);
      const row = await db.opportunity.create({ data: { ...data, created_by: actor(user) } });
      return created({ data: row });
    },
  },
  {
    method: 'PATCH',
    path: '/api/opportunities/:id',
    auth: 'admin',
    async handler({ db, params, body }) {
      const id = idParam(params);
      await findOpportunity(db, id);
      const data = parse(schema, body, { partial: true });
      if (Object.keys(data).length === 0) throw badRequest('No updatable fields supplied');
      await normaliseLookups(db, data);
      const row = await db.opportunity.update({ where: { id }, data });
      return ok({ data: row });
    },
  },
  {
    method: 'DELETE',
    path: '/api/opportunities/:id',
    auth: 'admin',
    async handler({ db, params }) {
      const id = idParam(params);
      await findOpportunity(db, id);
      await db.opportunity.update({ where: { id }, data: { is_active: false } });
      return noContent();
    },
  },
];

module.exports = { routes, findOpportunity, isOpen };

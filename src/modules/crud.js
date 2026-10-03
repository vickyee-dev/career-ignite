'use strict';

const { parse } = require('../lib/validate');
const { badRequest, conflict, notFound } = require('../lib/errors');
const { pagination, pageMeta, sorting, flag, textSearch, idParam } = require('../lib/query');
const { ok, created, noContent } = require('../core/response');
const { isAdmin, actor } = require('../core/auth');

/**
 * Generates the five standard endpoints for an admin-managed lookup table:
 *
 *   GET    /api/<path>        list (any signed-in user)   ?q= &sort= &page= &limit= &include_inactive=
 *   GET    /api/<path>/:id    read
 *   POST   /api/<path>        create          (admin)
 *   PATCH  /api/<path>/:id    partial update  (admin)
 *   DELETE /api/<path>/:id    soft delete     (admin)  -> is_active = false
 */
function crudRoutes({ path, model, label, schema, search, sortable, defaultSort, uniqueBy, refine }) {
  const base = `/api/${path}`;

  async function findOr404(db, id) {
    const row = await db[model].findUnique({ where: { id } });
    if (!row) throw notFound(`${label} not found`);
    return row;
  }

  async function assertUnique(db, value, selfId) {
    const clash = await db[model].findFirst({
      where: { [uniqueBy]: { equals: value, mode: 'insensitive' } },
    });
    if (clash && clash.id !== selfId) throw conflict(`A ${label.toLowerCase()} with that ${uniqueBy} already exists`);
  }

  return [
    {
      method: 'GET',
      path: base,
      auth: 'user',
      async handler({ db, query, user }) {
        const { page, limit, skip, take } = pagination(query);
        const where = {};
        if (!(isAdmin(user) && flag(query, 'include_inactive'))) where.is_active = true;
        const or = textSearch(query.q, search);
        if (or) where.OR = or;
        const orderBy = sorting(query, sortable, defaultSort);
        const [data, total] = await Promise.all([
          db[model].findMany({ where, orderBy, skip, take }),
          db[model].count({ where }),
        ]);
        return ok({ data, meta: pageMeta(total, page, limit) });
      },
    },
    {
      method: 'GET',
      path: `${base}/:id`,
      auth: 'user',
      async handler({ db, params, user }) {
        const row = await findOr404(db, idParam(params));
        if (!row.is_active && !isAdmin(user)) throw notFound(`${label} not found`);
        return ok({ data: row });
      },
    },
    {
      method: 'POST',
      path: base,
      auth: 'admin',
      async handler({ db, body, user }) {
        const data = parse(schema, body);
        refine?.(data);
        await assertUnique(db, data[uniqueBy]);
        const row = await db[model].create({ data: { ...data, created_by: actor(user) } });
        return created({ data: row });
      },
    },
    {
      method: 'PATCH',
      path: `${base}/:id`,
      auth: 'admin',
      async handler({ db, params, body }) {
        const id = idParam(params);
        const existing = await findOr404(db, id);
        const data = parse(schema, body, { partial: true });
        if (Object.keys(data).length === 0) throw badRequest('No updatable fields supplied');
        refine?.({ ...existing, ...data });
        if (data[uniqueBy] !== undefined) await assertUnique(db, data[uniqueBy], id);
        const row = await db[model].update({ where: { id }, data });
        return ok({ data: row });
      },
    },
    {
      method: 'DELETE',
      path: `${base}/:id`,
      auth: 'admin',
      async handler({ db, params }) {
        const id = idParam(params);
        await findOr404(db, id);
        await db[model].update({ where: { id }, data: { is_active: false } });
        return noContent();
      },
    },
  ];
}

module.exports = { crudRoutes };

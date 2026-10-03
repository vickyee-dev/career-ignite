'use strict';

const { f, parse } = require('../lib/validate');
const { badRequest, conflict, notFound, unauthorized, validation } = require('../lib/errors');
const { pagination, pageMeta, sorting, flag, textSearch, idParam } = require('../lib/query');
const { hashPassword, verifyPassword } = require('../lib/password');
const { signToken } = require('../lib/jwt');
const { ok, created, noContent } = require('../core/response');
const { ROLES, actor } = require('../core/auth');
const { resolveLookup } = require('./lookup');

// ---- schemas ----------------------------------------------------------------
const profile = {
  title: f.string({ max: 50, nullable: true }),
  first_name: f.string({ max: 50, required: true }),
  middle_name: f.string({ max: 50, nullable: true }),
  last_name: f.string({ max: 50, required: true }),
  phone_number: f.string({
    max: 30,
    nullable: true,
    pattern: /^\+?[0-9][0-9 ()-]{5,28}$/,
    patternMessage: 'must be a valid phone number',
  }),
  cohort: f.string({ max: 150, nullable: true }),
};

const registerSchema = {
  ...profile,
  email_address: f.email({ required: true }),
  password: f.password({ required: true }),
};
const loginSchema = {
  email_address: f.email({ required: true }),
  password: f.string({ required: true, max: 128, trim: false }),
};
const adminCreateSchema = {
  ...registerSchema,
  role: f.enum(ROLES, { default: 'INTERN' }),
  is_active: f.boolean({ default: true }),
};
const adminUpdateSchema = adminCreateSchema; // PATCH parses it with { partial: true }
const selfUpdateSchema = {
  ...profile,
  password: f.password({}),
  current_password: f.string({ max: 128, trim: false }),
};

// ---- helpers ----------------------------------------------------------------
/** Never leak the password hash. */
const publicUser = ({ password, ...rest }) => rest;

async function normaliseCohort(db, data) {
  if (data.cohort) data.cohort = await resolveLookup(db, { model: 'cohort', column: 'name', value: data.cohort, field: 'cohort' });
}

async function assertEmailFree(db, email, selfId) {
  const clash = await db.user.findUnique({ where: { email_address: email } });
  if (clash && clash.id !== selfId) throw conflict('That email address is already registered');
}

function issueToken(user, config, now) {
  return signToken({ sub: user.id, role: user.role }, config.jwtSecret, config.jwtTtlSeconds, now.getTime());
}

// ---- routes -----------------------------------------------------------------
const routes = [
  {
    method: 'POST',
    path: '/api/auth/register',
    auth: 'public',
    rateLimit: true,
    async handler({ db, body }) {
      const data = parse(registerSchema, body);
      await normaliseCohort(db, data);
      await assertEmailFree(db, data.email_address);
      const user = await db.user.create({
        data: {
          ...data,
          password: await hashPassword(data.password),
          role: 'INTERN',
          is_active: true,
          created_by: 'self-registration',
        },
      });
      return created({ data: publicUser(user) });
    },
  },
  {
    method: 'POST',
    path: '/api/auth/login',
    auth: 'public',
    rateLimit: true,
    async handler({ db, body, config, now }) {
      const { email_address, password } = parse(loginSchema, body);
      const user = await db.user.findUnique({ where: { email_address } });
      const valid = await verifyPassword(password, user?.password);
      // One generic message for every failure mode: no account enumeration.
      if (!user || !valid || !user.is_active) throw unauthorized('Invalid email or password');
      return ok({
        token: issueToken(user, config, now),
        token_type: 'Bearer',
        expires_in: config.jwtTtlSeconds,
        user: publicUser(user),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    auth: 'user',
    handler: ({ user }) => ok({ data: publicUser(user) }),
  },
  {
    method: 'PATCH',
    path: '/api/me',
    auth: 'user',
    async handler({ db, user, body }) {
      const { current_password, ...data } = parse(selfUpdateSchema, body, { partial: true });
      if (data.password !== undefined) {
        if (!current_password) throw validation({ current_password: 'is required to change your password' });
        if (!(await verifyPassword(current_password, user.password))) {
          throw validation({ current_password: 'is incorrect' });
        }
        data.password = await hashPassword(data.password);
      }
      if (Object.keys(data).length === 0) throw badRequest('No updatable fields supplied');
      await normaliseCohort(db, data);
      const updated = await db.user.update({ where: { id: user.id }, data });
      return ok({ data: publicUser(updated) });
    },
  },

  // ---- administration ------------------------------------------------------
  {
    method: 'GET',
    path: '/api/users',
    auth: 'admin',
    async handler({ db, query }) {
      const { page, limit, skip, take } = pagination(query);
      const where = {};
      if (!flag(query, 'include_inactive')) where.is_active = true;
      if (query.role) {
        if (!ROLES.includes(query.role)) throw validation({ role: `must be one of: ${ROLES.join(', ')}` });
        where.role = query.role;
      }
      if (query.cohort) where.cohort = { equals: query.cohort, mode: 'insensitive' };
      const or = textSearch(query.q, ['first_name', 'last_name', 'email_address']);
      if (or) where.OR = or;
      const orderBy = sorting(query, ['created_at', 'first_name', 'last_name', 'email_address'], '-created_at');
      const [rows, total] = await Promise.all([
        db.user.findMany({ where, orderBy, skip, take }),
        db.user.count({ where }),
      ]);
      return ok({ data: rows.map(publicUser), meta: pageMeta(total, page, limit) });
    },
  },
  {
    method: 'POST',
    path: '/api/users',
    auth: 'admin',
    async handler({ db, body, user }) {
      const data = parse(adminCreateSchema, body);
      await normaliseCohort(db, data);
      await assertEmailFree(db, data.email_address);
      const row = await db.user.create({
        data: { ...data, password: await hashPassword(data.password), created_by: actor(user) },
      });
      return created({ data: publicUser(row) });
    },
  },
  {
    method: 'GET',
    path: '/api/users/:id',
    auth: 'admin',
    async handler({ db, params }) {
      const row = await db.user.findUnique({ where: { id: idParam(params) } });
      if (!row) throw notFound('User not found');
      return ok({ data: publicUser(row) });
    },
  },
  {
    method: 'PATCH',
    path: '/api/users/:id',
    auth: 'admin',
    async handler({ db, params, body, user }) {
      const id = idParam(params);
      const existing = await db.user.findUnique({ where: { id } });
      if (!existing) throw notFound('User not found');
      const data = parse(adminUpdateSchema, body, { partial: true });
      if (Object.keys(data).length === 0) throw badRequest('No updatable fields supplied');
      if (id === user.id && (data.role === 'INTERN' || data.is_active === false)) {
        throw conflict('You cannot demote or deactivate your own account');
      }
      if (data.email_address !== undefined) await assertEmailFree(db, data.email_address, id);
      await normaliseCohort(db, data);
      if (data.password !== undefined) data.password = await hashPassword(data.password);
      const row = await db.user.update({ where: { id }, data });
      return ok({ data: publicUser(row) });
    },
  },
  {
    method: 'DELETE',
    path: '/api/users/:id',
    auth: 'admin',
    async handler({ db, params, user }) {
      const id = idParam(params);
      if (id === user.id) throw conflict('You cannot deactivate your own account');
      if (!(await db.user.findUnique({ where: { id } }))) throw notFound('User not found');
      await db.user.update({ where: { id }, data: { is_active: false } });
      return noContent();
    },
  },
];

module.exports = { routes, publicUser };

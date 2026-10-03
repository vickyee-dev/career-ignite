'use strict';

/**
 * Minimal in-memory stand-in for Prisma Client, used by the test-suite so the API can be
 * exercised end-to-end without PostgreSQL. It implements only the subset of the Prisma
 * query API that the application uses:
 *
 *   findUnique / findFirst / findMany / count / create / update
 *   where:   equality, equals|contains|startsWith|endsWith (+ mode: 'insensitive'),
 *            in, not, gt/gte/lt/lte, OR, AND, NOT
 *   orderBy: { field: 'asc' | 'desc' } (or an array of those), skip, take
 *
 * It also mimics the DB-level behaviour the schema relies on: auto-increment ids,
 * column defaults, `@updatedAt`, and unique constraints (throws a P2002-style error).
 */

const MODELS = {
  user: { defaults: () => ({ role: 'INTERN' }), stamps: true, unique: [['email_address']] },
  department: { stamps: true },
  opportunity: { stamps: true },
  opportunityUser: {
    defaults: () => ({ status: 'APPLIED' }),
    created: true,
    unique: [['user_id', 'opportunity_id']],
  },
  document: { stamps: true },
  opportunityType: { stamps: true },
  compensationType: { stamps: true },
  cohort: { stamps: true },
  title: { stamps: true },
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);
const comparable = (v) => (v instanceof Date ? v.getTime() : v);

function matchValue(actual, cond) {
  if (!isPlainObject(cond)) return comparable(actual) === comparable(cond);
  const insensitive = cond.mode === 'insensitive';
  const norm = (v) => (insensitive && typeof v === 'string' ? v.toLowerCase() : comparable(v));
  const a = norm(actual);
  return Object.entries(cond).every(([op, expected]) => {
    switch (op) {
      case 'mode': return true;
      case 'equals': return a === norm(expected);
      case 'not': return !matchValue(actual, expected);
      case 'in': return expected.some((e) => a === norm(e));
      case 'contains': return typeof a === 'string' && a.includes(norm(expected));
      case 'startsWith': return typeof a === 'string' && a.startsWith(norm(expected));
      case 'endsWith': return typeof a === 'string' && a.endsWith(norm(expected));
      case 'gt': return a > comparable(expected);
      case 'gte': return a >= comparable(expected);
      case 'lt': return a < comparable(expected);
      case 'lte': return a <= comparable(expected);
      default: throw new Error(`fakeDb: unsupported operator "${op}"`);
    }
  });
}

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === 'OR') return cond.some((w) => matches(row, w));
    if (key === 'AND') return [].concat(cond).every((w) => matches(row, w));
    if (key === 'NOT') return ![].concat(cond).some((w) => matches(row, w));
    return matchValue(row[key], cond);
  });
}

function sortRows(rows, orderBy) {
  if (!orderBy) return rows;
  const rules = [].concat(orderBy).flatMap((o) => Object.entries(o));
  return [...rows].sort((x, y) => {
    for (const [field, dir] of rules) {
      const a = comparable(x[field]);
      const b = comparable(y[field]);
      if (a === b) continue;
      const cmp = typeof a === 'string' ? a.localeCompare(b) : a < b ? -1 : 1;
      return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function createFakeDb({ now = () => new Date() } = {}) {
  const db = {};
  for (const [name, spec] of Object.entries(MODELS)) {
    const rows = [];
    let nextId = 1;
    const clone = (r) => structuredClone(r);

    const assertUnique = (candidate, selfId) => {
      for (const cols of spec.unique || []) {
        const clash = rows.find(
          (r) => r.id !== selfId && cols.every((c) => candidate[c] != null && r[c] === candidate[c]),
        );
        if (clash) {
          const err = new Error(`Unique constraint failed on ${name}(${cols.join(', ')})`);
          err.code = 'P2002';
          throw err;
        }
      }
    };

    db[name] = {
      _rows: rows,
      async findUnique({ where }) {
        const row = rows.find((r) => matches(r, where));
        return row ? clone(row) : null;
      },
      async findFirst({ where, orderBy } = {}) {
        const row = sortRows(rows.filter((r) => matches(r, where)), orderBy)[0];
        return row ? clone(row) : null;
      },
      async findMany({ where, orderBy, skip = 0, take } = {}) {
        const sorted = sortRows(rows.filter((r) => matches(r, where)), orderBy);
        return sorted.slice(skip, take === undefined ? undefined : skip + take).map(clone);
      },
      async count({ where } = {}) {
        return rows.filter((r) => matches(r, where)).length;
      },
      async create({ data }) {
        const t = now();
        const row = {
          ...(spec.defaults?.() ?? {}),
          ...clone(data),
          id: nextId,
          ...(spec.stamps && { created_at: t, updated_at: t }),
          ...(spec.created && { created_at: t }),
        };
        // Prisma would reject unknown columns; keep tests honest about the model shape.
        assertUnique(row);
        nextId += 1;
        rows.push(row);
        return clone(row);
      },
      async update({ where, data }) {
        const row = rows.find((r) => matches(r, where));
        if (!row) {
          const err = new Error('Record to update not found.');
          err.code = 'P2025';
          throw err;
        }
        const next = { ...row, ...clone(data), ...(spec.stamps && { updated_at: now() }) };
        assertUnique(next, row.id);
        Object.assign(row, next);
        return clone(row);
      },
    };
  }
  return db;
}

module.exports = { createFakeDb };

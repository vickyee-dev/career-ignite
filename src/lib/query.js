'use strict';

const { validation } = require('./errors');

const MAX_LIMIT = 100;

function positiveInt(raw, name, fallback) {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw validation({ [name]: 'must be a positive integer' });
  return Number(raw);
}

/** ?page=2&limit=20 -> { page, limit, skip, take } */
function pagination(query) {
  const page = positiveInt(query.page, 'page', 1);
  const limit = Math.min(positiveInt(query.limit, 'limit', 20), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

const pageMeta = (total, page, limit) => ({
  page,
  limit,
  total,
  total_pages: Math.max(1, Math.ceil(total / limit)),
});

/** ?sort=-created_at  -> { created_at: 'desc' } (whitelisted fields only) */
function sorting(query, allowed, fallback) {
  const raw = query.sort || fallback;
  const desc = raw.startsWith('-');
  const key = desc ? raw.slice(1) : raw;
  if (!allowed.includes(key)) {
    throw validation({ sort: `must be one of: ${allowed.join(', ')} (prefix with - for descending)` });
  }
  return { [key]: desc ? 'desc' : 'asc' };
}

const flag = (query, name) => query[name] === 'true' || query[name] === '1';

/** Shared `where` fragment for free-text search over several columns. */
function textSearch(q, fields) {
  const term = typeof q === 'string' ? q.trim() : '';
  if (!term) return undefined;
  return fields.map((field) => ({ [field]: { contains: term, mode: 'insensitive' } }));
}

/** Route :id params must be positive integers (Postgres SERIAL). */
function idParam(params, name = 'id') {
  const raw = params[name];
  if (!/^\d{1,9}$/.test(raw) || Number(raw) < 1) throw validation({ [name]: 'must be a positive integer' });
  return Number(raw);
}

module.exports = { pagination, pageMeta, sorting, flag, textSearch, idParam };

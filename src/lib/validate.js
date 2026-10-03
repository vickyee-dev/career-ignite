'use strict';

const { validation } = require('./errors');

// ---- field builders ---------------------------------------------------------
// Every field is optional unless `required: true`. `nullable: true` allows null.
const field = (type, opts = {}) => ({ type, ...opts });

const f = {
  string: (o) => field('string', o),
  email: (o) => field('email', o),
  password: (o) => field('password', o),
  int: (o) => field('int', o),
  number: (o) => field('number', o),
  boolean: (o) => field('boolean', o),
  date: (o) => field('date', o),
  currency: (o) => field('currency', o),
  enum: (values, o) => field('enum', { values, ...o }),
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** @returns {{value: any} | {error: string}} */
function check(def, v) {
  const fail = (error) => ({ error });
  switch (def.type) {
    case 'string': {
      if (typeof v !== 'string') return fail('must be a string');
      const s = def.trim === false ? v : v.trim();
      const min = def.min ?? 1;
      const max = def.max ?? 10000;
      if (s.length < min) return fail(min <= 1 ? 'must not be empty' : `must be at least ${min} characters`);
      if (s.length > max) return fail(`must be at most ${max} characters`);
      if (def.pattern && !def.pattern.test(s)) return fail(def.patternMessage || 'has an invalid format');
      return { value: s };
    }
    case 'email': {
      if (typeof v !== 'string') return fail('must be a string');
      const s = v.trim().toLowerCase();
      if (s.length > 200 || !EMAIL_RE.test(s)) return fail('must be a valid email address');
      return { value: s };
    }
    case 'password': {
      if (typeof v !== 'string') return fail('must be a string');
      if (v.length < 8 || v.length > 128) return fail('must be between 8 and 128 characters');
      if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return fail('must contain at least one letter and one number');
      return { value: v };
    }
    case 'int':
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return fail('must be a number');
      if (def.type === 'int' && !Number.isInteger(v)) return fail('must be an integer');
      if (def.min !== undefined && v < def.min) return fail(`must be at least ${def.min}`);
      if (def.max !== undefined && v > def.max) return fail(`must be at most ${def.max}`);
      return { value: v };
    }
    case 'boolean':
      return typeof v === 'boolean' ? { value: v } : fail('must be true or false');
    case 'date': {
      if (typeof v !== 'string' || !DATE_RE.test(v.trim())) return fail('must be an ISO 8601 date (YYYY-MM-DD or full timestamp)');
      const d = new Date(v.trim());
      if (Number.isNaN(d.getTime())) return fail('must be a valid date');
      // V8 rolls 2025-02-31 over to March 3rd; reject such impossible dates.
      if (v.trim().length === 10 && d.toISOString().slice(0, 10) !== v.trim()) return fail('must be a valid date');
      return { value: d };
    }
    case 'currency': {
      const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
      return /^[A-Z]{3}$/.test(s) ? { value: s } : fail('must be a 3-letter ISO 4217 currency code');
    }
    case 'enum':
      return def.values.includes(v) ? { value: v } : fail(`must be one of: ${def.values.join(', ')}`);
    /* c8 ignore next 2 */
    default:
      throw new Error(`Unknown field type ${def.type}`);
  }
}

/**
 * Validates `input` against `schema` and returns a clean object containing only
 * known fields. With `partial: true` (PATCH) absent fields are simply skipped.
 */
function parse(schema, input, { partial = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw validation({ _body: 'must be a JSON object' });
  }
  const out = {};
  const errors = {};
  for (const [key, def] of Object.entries(schema)) {
    let v = input[key];
    if (v === undefined) {
      if (partial) continue;
      if (def.default !== undefined) {
        out[key] = typeof def.default === 'function' ? def.default() : def.default;
      } else if (def.required) {
        errors[key] = 'is required';
      }
      continue;
    }
    if (v === null) {
      if (def.nullable) out[key] = null;
      else errors[key] = 'must not be null';
      continue;
    }
    const result = check(def, v);
    if ('error' in result) errors[key] = result.error;
    else out[key] = result.value;
  }
  if (Object.keys(errors).length) throw validation(errors);
  return out;
}

const pick = (schema, keys) => Object.fromEntries(keys.map((k) => [k, schema[k]]));
const omit = (schema, keys) => Object.fromEntries(Object.entries(schema).filter(([k]) => !keys.includes(k)));

module.exports = { f, parse, pick, omit };

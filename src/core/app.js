'use strict';

const { AppError, unauthorized, forbidden, badRequest, notFound, conflict, tooMany } = require('../lib/errors');
const { verifyToken } = require('../lib/jwt');
const { createRateLimiter } = require('../lib/rateLimit');

const compile = (route) => {
  const keys = [];
  const source = route.path.replace(/:([a-z_]+)/gi, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { ...route, keys, re: new RegExp(`^${source}/?$`) };
};

/**
 * Transport-agnostic application core.
 *
 *   handle({ method, path, query, headers, rawBody, ip }) -> { status, body?, file?, headers? }
 *
 * The HTTP server (src/server/http.js) is a thin adapter around `handle`, and the
 * test-suite calls it directly. `db` is a Prisma Client (or a compatible fake).
 */
function createApp({ db, config, routes, now = () => new Date(), logger = console }) {
  const table = routes.map(compile);
  const limiter = createRateLimiter({ now: () => now().getTime() });

  function match(method, path) {
    const candidates = [];
    for (const route of table) {
      const m = route.re.exec(path);
      if (!m) continue;
      candidates.push(route);
      if (route.method !== method) continue;
      const params = {};
      try {
        route.keys.forEach((key, i) => (params[key] = decodeURIComponent(m[i + 1])));
      } catch {
        throw badRequest('Malformed URL path');
      }
      return { route, params };
    }
    if (candidates.length) {
      const allow = [...new Set(candidates.map((r) => r.method))].join(', ');
      throw new AppError(405, 'method_not_allowed', `Use one of: ${allow}`, undefined, { Allow: allow });
    }
    throw notFound('No such endpoint');
  }

  /** Max request body (bytes) for a route, so the transport can enforce it while reading. */
  function bodyLimit(method, path) {
    try {
      const { route } = match(method, path);
      return route.bodyLimit ? route.bodyLimit(config) : config.jsonBodyLimitBytes;
    } catch {
      return config.jsonBodyLimitBytes;
    }
  }

  async function authenticate(headers, mode) {
    if (mode === 'public') return null;
    const header = headers.authorization;
    if (!header) {
      if (mode === 'optional') return null;
      throw unauthorized();
    }
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorized('Use "Authorization: Bearer <token>"');
    const claims = verifyToken(token, config.jwtSecret, now().getTime());
    // Always re-check the DB so deactivated users / role changes apply immediately.
    const user = await db.user.findUnique({ where: { id: claims.sub } });
    if (!user || !user.is_active) throw unauthorized('Invalid or expired token');
    if (mode === 'admin' && user.role !== 'ADMIN') throw forbidden('Administrator access required');
    return user;
  }

  function parseBody(route, rawBody) {
    if (route.body === 'raw') return rawBody ?? Buffer.alloc(0);
    if (!rawBody || rawBody.length === 0) return {};
    let parsed;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw badRequest('Request body is not valid JSON');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw badRequest('Request body must be a JSON object');
    }
    return parsed;
  }

  function toErrorResponse(err) {
    if (err instanceof AppError) {
      const error = { code: err.code, message: err.message };
      if (err.details) error.details = err.details;
      return { status: err.status, headers: err.headers, body: { error } };
    }
    // Prisma known-request errors (duck-typed so tests need no Prisma import)
    if (err && typeof err.code === 'string' && /^P20\d\d$/.test(err.code)) {
      if (err.code === 'P2002') return toErrorResponse(conflict('A record with the same unique value already exists'));
      if (err.code === 'P2003') return toErrorResponse(conflict('The record is referenced by, or references, other records'));
      if (err.code === 'P2025') return toErrorResponse(notFound());
    }
    logger.error?.('Unhandled error:', err);
    return {
      status: 500,
      body: { error: { code: 'internal_error', message: 'Something went wrong on our side' } },
    };
  }

  async function handle(req) {
    try {
      const { route, params } = match(req.method, req.path);

      if (route.rateLimit) {
        const rule = config.authRateLimit;
        const r = limiter.hit(`${route.path}|${req.ip}`, rule);
        if (!r.allowed) throw tooMany(r.retryAfterSeconds);
      }

      const user = await authenticate(req.headers || {}, route.auth);
      const body = parseBody(route, req.rawBody);

      const result = await route.handler({
        params,
        query: req.query || {},
        body,
        headers: req.headers || {},
        user,
        db,
        config,
        now: now(),
      });
      return result ?? { status: 204 };
    } catch (err) {
      return toErrorResponse(err);
    }
  }

  return { handle, match, bodyLimit, toErrorResponse };
}

module.exports = { createApp };

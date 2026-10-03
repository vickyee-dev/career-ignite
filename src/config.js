'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

/** "15m" | "2h" | "7d" | "3600" -> seconds */
function parseDuration(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const match = /^(\d+)\s*([smhd])?$/.exec(String(value).trim());
  if (!match) throw new Error(`Invalid duration "${value}" (expected e.g. 30m, 12h, 7d)`);
  return Number(match[1]) * UNITS[match[2] || 's'];
}

function toInt(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

/**
 * Builds the runtime configuration from environment variables.
 * Pure function (takes `env`) so it is trivial to test.
 */
function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  let jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    if (isProduction) throw new Error('JWT_SECRET must be set in production');
    // Dev/test convenience: ephemeral secret (tokens die on restart).
    jwtSecret = crypto.randomBytes(32).toString('hex');
  } else if (isProduction && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }

  return {
    nodeEnv,
    isProduction,
    port: toInt(env.PORT, 3000, 'PORT'),
    jwtSecret,
    jwtTtlSeconds: parseDuration(env.JWT_EXPIRES_IN, 3600),
    corsOrigins: (env.CORS_ORIGIN || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY === 'true',
    uploadDir: path.resolve(env.UPLOAD_DIR || 'uploads'),
    maxUploadBytes: toInt(env.MAX_UPLOAD_MB, 5, 'MAX_UPLOAD_MB') * 1024 * 1024,
    jsonBodyLimitBytes: 1024 * 1024,
    authRateLimit: {
      max: toInt(env.AUTH_RATE_LIMIT_MAX, 20, 'AUTH_RATE_LIMIT_MAX'),
      windowMs: parseDuration(env.AUTH_RATE_LIMIT_WINDOW, 900) * 1000,
    },
  };
}

module.exports = { loadConfig, parseDuration };

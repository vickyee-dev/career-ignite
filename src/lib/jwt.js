'use strict';

const crypto = require('node:crypto');
const { unauthorized } = require('./errors');

// Minimal HS256 JSON Web Token implementation (RFC 7519) built on node:crypto.
// The algorithm is pinned: tokens declaring any other alg (incl. "none") are rejected.

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

const mac = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest();

function signToken(claims, secret, ttlSeconds, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  const payload = Buffer.from(JSON.stringify({ ...claims, iat, exp: iat + ttlSeconds })).toString(
    'base64url',
  );
  const signature = mac(`${HEADER}.${payload}`, secret).toString('base64url');
  return `${HEADER}.${payload}.${signature}`;
}

function verifyToken(token, secret, nowMs = Date.now()) {
  const invalid = () => unauthorized('Invalid or expired token');
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw invalid();
  const [header, payload, signature] = parts;

  if (header !== HEADER) throw invalid(); // pins alg + typ

  const expected = mac(`${header}.${payload}`, secret);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw invalid();
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(nowMs / 1000)) throw invalid();
  return claims;
}

module.exports = { signToken, verifyToken };

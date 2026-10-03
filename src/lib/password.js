'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// scrypt cost parameters (OWASP-recommended minimum: N=2^15 w/ r=8 is stronger,
// N=2^14 keeps memory under Node's default 32 MiB maxmem and ~50ms/hash).
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** Returns a self-describing hash: scrypt$N$r$p$salt$hash (base64). */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), derived.toString('base64')].join('$');
}

let dummyHash;

/**
 * Constant-ish time verification. When `stored` is missing we still burn a
 * hash computation so response time does not reveal whether an account exists.
 */
async function verifyPassword(password, stored) {
  if (!stored) {
    dummyHash ??= hashPassword('not-a-real-password');
    const [, n, r, p, salt, hash] = (await dummyHash).split('$');
    await scrypt(password, Buffer.from(salt, 'base64'), Buffer.from(hash, 'base64').length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };

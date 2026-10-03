'use strict';

const { forbidden, notFound } = require('../lib/errors');

const ROLES = ['ADMIN', 'INTERN'];

const isAdmin = (user) => user?.role === 'ADMIN';

/** Value stored in the `created_by` audit columns. */
const actor = (user) => user.email_address || `user:${user.id}`;

/** Owner-or-admin gate. Non-owners get 404 so record existence is not leaked. */
function assertOwnerOrAdmin(user, ownerId) {
  if (!isAdmin(user) && user.id !== ownerId) throw notFound();
}

function assertAdmin(user) {
  if (!isAdmin(user)) throw forbidden();
}

module.exports = { ROLES, isAdmin, actor, assertOwnerOrAdmin, assertAdmin };

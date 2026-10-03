'use strict';

const { validation } = require('../lib/errors');

/**
 * Several tables reference lookup values by *name* rather than by foreign key
 * (e.g. opportunities.department). This guards that integrity at the API layer and
 * returns the canonical spelling so "engineering" is stored as "Engineering".
 */
async function resolveLookup(db, { model, column, value, field }) {
  const row = await db[model].findFirst({
    where: { [column]: { equals: value, mode: 'insensitive' }, is_active: true },
  });
  if (!row) throw validation({ [field]: `"${value}" is not an active ${field.replace(/_/g, ' ')}` });
  return row[column];
}

module.exports = { resolveLookup };

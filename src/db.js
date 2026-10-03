'use strict';

const { PrismaClient } = require('@prisma/client');

// One shared client per process (Prisma manages its own connection pool).
module.exports = new PrismaClient();

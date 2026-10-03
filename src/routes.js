'use strict';

const { ok } = require('./core/response');

const health = {
  method: 'GET',
  path: '/api/health',
  auth: 'public',
  handler: () => ok({ status: 'ok', uptime_seconds: Math.round(process.uptime()) }),
};

module.exports = [
  health,
  ...require('./modules/users').routes,
  ...require('./modules/lookups').routes,
  ...require('./modules/opportunities').routes,
  ...require('./modules/applications').routes,
  ...require('./modules/documents').routes,
];

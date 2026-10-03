'use strict';

// Load .env if present (Node >= 20.12). Real environment variables always win.
try {
  process.loadEnvFile();
} catch {
  /* no .env file: fine, e.g. in production */
}

const { loadConfig } = require('./config');
const { createApp } = require('./core/app');
const { createHttpServer } = require('./server/http');
const routes = require('./routes');

const config = loadConfig();
const db = require('./db');

const app = createApp({ db, config, routes });
const server = createHttpServer({ app, config });

server.listen(config.port, () => {
  console.log(`CareerIgnite API listening on http://localhost:${config.port} (${config.nodeEnv})`);
  if (!process.env.JWT_SECRET) console.warn('JWT_SECRET not set: using an ephemeral secret (tokens reset on restart).');
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await db.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref(); // hard stop if connections linger
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

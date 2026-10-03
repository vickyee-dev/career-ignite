'use strict';

const fs = require('node:fs');
const http = require('node:http');

const { payloadTooLarge, notFound, badRequest } = require('../lib/errors');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-site',
};

/** Reads the request body, aborting with 413 once `limit` bytes are exceeded. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) return reject(payloadTooLarge(limit));
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        reject(payloadTooLarge(limit));
        req.removeAllListeners('data');
        req.resume(); // drain & discard the rest
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Thin HTTP adapter around the transport-agnostic `app.handle`.
 * Responsibilities: parsing, CORS, security headers, body limits, streaming files.
 */
function createHttpServer({ app, config, logger = console }) {
  const allowedOrigins = new Set(config.corsOrigins);
  const allowAnyOrigin = allowedOrigins.has('*');

  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return;
    res.setHeader('Vary', 'Origin');
    if (allowAnyOrigin || allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', allowAnyOrigin ? '*' : origin);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Retry-After');
    }
  }

  function writeJson(res, status, body, headers = {}) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
      ...(payload && { 'Content-Type': 'application/json; charset=utf-8' }),
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(payload);
  }

  return http.createServer(async (req, res) => {
    const started = Date.now();
    res.on('finish', () => {
      if (!config.silent) logger.info?.(`${req.method} ${req.url.split('?')[0]} ${res.statusCode} ${Date.now() - started}ms`);
    });
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    applyCors(req, res);

    let result;
    try {
      let url;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        throw badRequest('Malformed request URL');
      }
      const method = req.method.toUpperCase();

      if (method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
        return writeJson(res, 204);
      }

      let rawBody;
      if (['POST', 'PATCH', 'PUT'].includes(method)) {
        rawBody = await readBody(req, app.bodyLimit(method, url.pathname));
      }

      const forwarded = config.trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim();
      result = await app.handle({
        method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        rawBody,
        ip: forwarded || req.socket.remoteAddress || 'unknown',
      });
    } catch (err) {
      result = app.toErrorResponse(err);
      if (err.status === 413) res.setHeader('Connection', 'close');
    }

    if (result.file) {
      const { path: filePath, filename, contentType } = result.file;
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => (res.headersSent ? res.destroy() : writeJson(res, 404, app.toErrorResponse(notFound()).body)));
      stream.on('open', () => {
        res.writeHead(200, {
          'Content-Type': contentType,
          // RFC 5987 encoding keeps odd characters in names from breaking the header
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          'Cache-Control': 'private, no-store',
        });
        stream.pipe(res);
      });
    } else {
      writeJson(res, result.status, result.body, result.headers);
    }
  });
}

module.exports = { createHttpServer };

'use strict';

/** An error that is safe to show to API clients. */
class AppError extends Error {
  constructor(status, code, message, details, headers) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

const badRequest = (message, details) => new AppError(400, 'bad_request', message, details);
const validation = (details, message = 'Validation failed') =>
  new AppError(422, 'validation_error', message, details);
const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'unauthorized', message);
const forbidden = (message = 'You do not have permission to do that') =>
  new AppError(403, 'forbidden', message);
const notFound = (message = 'Resource not found') => new AppError(404, 'not_found', message);
const conflict = (message) => new AppError(409, 'conflict', message);
const tooMany = (retryAfterSeconds) =>
  new AppError(429, 'rate_limited', 'Too many requests, please try again later', undefined, {
    'Retry-After': String(retryAfterSeconds),
  });
const payloadTooLarge = (limit) =>
  new AppError(413, 'payload_too_large', `Request body exceeds the ${limit} byte limit`);

module.exports = {
  AppError,
  badRequest,
  validation,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooMany,
  payloadTooLarge,
};

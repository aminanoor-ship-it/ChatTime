class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const badRequest = (message) => new HttpError(400, message);
const forbidden = (message = 'You do not have permission to do that.') => new HttpError(403, message);
const notFound = (message = 'Not found.') => new HttpError(404, message);

function toId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function requireId(value, label = 'item') {
  const id = toId(value);
  if (!id) throw badRequest(`Invalid ${label}.`);
  return id;
}

// Wraps an async route so thrown errors reach the Express error handler.
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const bool = (value) => Boolean(Number(value));

module.exports = { HttpError, badRequest, forbidden, notFound, toId, requireId, handle, bool };

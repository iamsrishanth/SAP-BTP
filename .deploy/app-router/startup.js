'use strict'

const approuter = require('@sap/approuter')

// query-string 7 still depends on a CommonJS decoder with GHSA-vcc3-ghjq-m6fr.
// Reject malformed encoding before the router's query rewriting can call its
// expensive tolerant fallback. Keep the residual advisory visible in npm audit.
const MAX_REQUEST_TARGET_BYTES = 8192

function rejectTarget(res, statusCode, code, message) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify({ error: { code, message } }))
}

function validateRequestTarget(req, res, next) {
  const target = req.url
  if (typeof target !== 'string' || Buffer.byteLength(target, 'utf8') > MAX_REQUEST_TARGET_BYTES) {
    return rejectTarget(res, 414, 'REQUEST_TARGET_TOO_LONG', 'The request URL exceeds the supported size.')
  }
  try {
    // Decode only for validation. Forward the exact original URL and preserve
    // OData expressions, duplicate query parameters, UTF-8 and literal pluses.
    decodeURIComponent(target)
  } catch {
    return rejectTarget(res, 400, 'INVALID_URL_ENCODING', 'The request URL contains malformed percent encoding.')
  }
  next()
}

function createRouter() {
  const router = approuter()
  router.first.use(validateRequestTarget)
  return router
}

if (require.main === module) {
  createRouter().start()
}

module.exports = { createRouter, validateRequestTarget, MAX_REQUEST_TARGET_BYTES }

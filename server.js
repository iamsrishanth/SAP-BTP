const cds = require('@sap/cds')
const demoProfileMiddleware = require('./srv/demo-profile')

// Extend CAP's normal middleware chain after signature verification and before
// protocol authorization. Do not replace the configured XSUAA auth strategy.
if (typeof cds.middlewares.add !== 'function') {
  throw new Error('Demo profiles require CAP cds.middlewares.add support after auth.')
}
cds.middlewares.add(demoProfileMiddleware, { after: 'auth' })

// Preserve CAP's standard bootstrap, service loading, and listening listeners.
module.exports = cds.server

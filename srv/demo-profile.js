const cds = require('@sap/cds')
const { XsuaaSecurityContext, XsuaaToken } = require('@sap/xssec')

const HEADER = 'x-asset-demo-profile'
const SESSION = Symbol('asset-demo-profile-session')
const PROFILES = Object.freeze({
  'it.admin': Object.freeze({ role: 'ITAdmin' }),
  'compliance.manager': Object.freeze({ role: 'ComplianceManager' }),
  'employee.alex': Object.freeze({ role: 'Employee', userId: 'employee.alex' }),
  'employee.jamie': Object.freeze({ role: 'Employee', userId: 'employee.jamie' })
})

function isVerifiedPerson(user) {
  if (!user?.is('authenticated-user') || !user.is('DemoOperator') ||
      user.is('system-user') || user.is('internal-user')) return false
  // This feature is deliberately limited to the existing XSUAA strategy. A
  // mocked/basic user or privileged CAP user cannot opt in by claiming a role.
  const securityContext = user.authInfo
  if (!(securityContext instanceof XsuaaSecurityContext) ||
      !(securityContext.token instanceof XsuaaToken)) return false
  if (securityContext.config?.skipValidation === true ||
      securityContext.service?.config?.validation?.enabled === false) return false
  const payload = securityContext.token.getPayload()
  if (!payload || typeof payload.grant_type !== 'string' || !payload.grant_type ||
      ['client_credentials', 'client_x509'].includes(payload.grant_type)) return false
  // CAP's XSUAA middleware derives person IDs from this validated claim. It
  // derives technical IDs separately, so require that same person identity.
  return typeof user.id === 'string' && !!user.id.trim() &&
    typeof payload.user_name === 'string' && !!payload.user_name.trim() &&
    payload.user_name === user.id
}

function forbidden(code, message) {
  return Object.assign(new Error(message), { status: 403, code })
}

function demoProfileMiddleware(req, res, next) {
  const context = cds.context
  const originalUser = context?.user
  const provided = Object.hasOwn(req.headers || {}, HEADER)
  const profile = provided ? req.headers[HEADER] : 'sap'
  const available = process.env.ASSET_DEMO_PROFILES_ENABLED === 'true' && isVerifiedPerson(originalUser)

  // Reject every attempted selection when the feature or person permission is
  // absent, including an explicit "sap" header. No request header authenticates
  // a user or controls arbitrary IDs, tenants, attributes, or role names.
  if (provided && !available) {
    return next(forbidden('ASSET_DEMO_PROFILE_FORBIDDEN', 'Demo profiles are unavailable for this authenticated session.'))
  }
  if (provided && (typeof profile !== 'string' ||
      (profile !== 'sap' && !Object.hasOwn(PROFILES, profile)))) {
    return next(forbidden('ASSET_DEMO_PROFILE_INVALID', 'Select a supported demo profile.'))
  }

  if (context) {
    const session = Object.freeze({ originalUser, available, activeProfile: profile })
    Object.defineProperty(context, SESSION, { value: session })
    // CAP exposes the original HTTP request to nested transaction and batch
    // contexts. This request-local record also keeps sessionInfo accurate there.
    if (context.http?.req) Object.defineProperty(context.http.req, SESSION, { value: session })

    if (profile !== 'sap') {
      const selected = PROFILES[profile]
      context.user = new cds.User({
        // Writable profiles retain the real actor for CAP managed audit fields.
        // Employee aliases are restricted by the existing read-only CDS role.
        id: selected.userId || originalUser.id,
        roles: [selected.role],
        attr: { ...originalUser.attr },
        authInfo: originalUser.authInfo
      })
    }
  }
  return next()
}

function getDemoProfileSessionInfo(context = cds.context) {
  const session = context?.[SESSION] || context?.context?.[SESSION] || context?.http?.req?.[SESSION]
  const originalUser = session?.originalUser || context?.user
  return {
    demoProfilesAvailable: session?.available === true,
    activeDemoProfile: session?.activeProfile || 'sap',
    demoOperatorUserId: originalUser?.is('authenticated-user') ? originalUser.id : ''
  }
}

module.exports = demoProfileMiddleware
module.exports.getDemoProfileSessionInfo = getDemoProfileSessionInfo

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cds = require('@sap/cds')
const { XsuaaSecurityContext, XsuaaToken } = require('@sap/xssec')
const demoProfile = require('../srv/demo-profile')
const { getDemoProfileSessionInfo } = demoProfile

// Unit fixtures represent CAP's already verified auth result. They do not test
// JWT signatures; no test authentication hook is installed in application code.
function verifiedUser({ id = 'sap.operator@example.test', roles = ['DemoOperator', 'ITAdmin', 'ComplianceManager'], payload = {} } = {}) {
  const token = new XsuaaToken(null, {
    header: { alg: 'RS256' },
    payload: { user_name: id, grant_type: 'authorization_code', zid: 'verified-tenant', ...payload }
  })
  return new cds.User({
    id, roles, attr: { email: id, department: ['IT'] },
    authInfo: new XsuaaSecurityContext(null, token, { skipValidation: false })
  })
}

function apply(user, { profile = 'sap', header = true, extraHeaders = {} } = {}) {
  const req = { headers: { ...extraHeaders, ...(header ? { 'x-asset-demo-profile': profile } : {}) } }
  const context = new cds.EventContext({ user, tenant: 'verified-tenant', http: { req, res: {} } })
  cds.context = context
  let calls = 0
  let error
  demoProfile(req, {}, value => { calls += 1; error = value })
  assert.equal(calls, 1, 'Middleware must finish exactly once')
  return { context, error }
}

function assertForbidden(user, selection) {
  const { context, error } = apply(user, selection)
  assert.equal(error?.status, 403)
  assert.equal(context.user, user, 'A rejected profile must not change the verified principal')
  assert.equal(getDemoProfileSessionInfo(context).demoProfilesAvailable, false)
  return error
}

describe('Scoped XSUAA demo profiles', function () {
  let previousFlag
  let previousContext

  beforeEach(function () {
    previousFlag = process.env.ASSET_DEMO_PROFILES_ENABLED
    previousContext = cds.context
    process.env.ASSET_DEMO_PROFILES_ENABLED = 'true'
  })

  afterEach(function () {
    if (previousFlag === undefined) delete process.env.ASSET_DEMO_PROFILES_ENABLED
    else process.env.ASSET_DEMO_PROFILES_ENABLED = previousFlag
    cds.context = previousContext
  })

  it('rejects forged headers from anonymous and Basic/mock users', function () {
    assertForbidden(cds.User.anonymous, { profile: 'it.admin' })
    assertForbidden(new cds.User({ id: 'mock.operator', roles: ['DemoOperator', 'ITAdmin'] }), { profile: 'employee.alex' })
    assertForbidden(cds.User.privileged, { profile: 'it.admin' })
    const forgedAuthInfo = new cds.User({
      id: 'forged', roles: ['DemoOperator'],
      authInfo: { token: { getPayload: () => ({ user_name: 'forged', grant_type: 'authorization_code' }) } }
    })
    assertForbidden(forgedAuthInfo, { profile: 'it.admin' })
  })

  it('requires DemoOperator even when the verified user has every business role', function () {
    const user = verifiedUser({ roles: ['ITAdmin', 'Employee', 'ComplianceManager'] })
    assertForbidden(user, { profile: 'it.admin' })
    assertForbidden(user, { profile: 'sap' })
    const native = apply(user, { header: false })
    assert.equal(native.error, undefined)
    assert.equal(native.context.user, user)
    assert.equal(getDemoProfileSessionInfo().demoProfilesAvailable, false)
  })

  it('is disabled unless the exact feature flag is true', function () {
    const user = verifiedUser()
    for (const flag of [undefined, '', 'false', 'TRUE', '1']) {
      if (flag === undefined) delete process.env.ASSET_DEMO_PROFILES_ENABLED
      else process.env.ASSET_DEMO_PROFILES_ENABLED = flag
      assertForbidden(user, { profile: 'it.admin' })
      assertForbidden(user, { profile: 'sap' })
      const native = apply(user, { header: false })
      assert.equal(native.error, undefined)
      assert.equal(native.context.user, user)
      assert.equal(getDemoProfileSessionInfo().demoProfilesAvailable, false)
    }
  })

  it('rejects unknown, malformed, multiple, or arbitrary identity selections', function () {
    const user = verifiedUser()
    for (const profile of ['', 'native', 'administrator', 'employee.other', 'ITAdmin', '__proto__', 'constructor', 'toString',
      'it.admin,employee.alex', ' it.admin', 'it.admin ', ['it.admin'], null, 1]) {
      assert.equal(assertForbidden(user, { profile }).code, 'ASSET_DEMO_PROFILE_INVALID')
    }
  })

  it('keeps native SAP scopes and the original principal by default or for sap', function () {
    for (const header of [false, true]) {
      const user = verifiedUser()
      const { context, error } = apply(user, { header, profile: 'sap' })
      assert.equal(error, undefined)
      assert.equal(context.user, user)
      assert.equal(context.user.is('ITAdmin'), true)
      assert.equal(context.user.is('ComplianceManager'), true)
      assert.deepEqual(getDemoProfileSessionInfo(), {
        demoProfilesAvailable: true, activeDemoProfile: 'sap', demoOperatorUserId: user.id
      })
    }
  })

  it('narrows each selected profile to one business role with fixed employee IDs', function () {
    const profiles = [
      ['it.admin', 'ITAdmin', 'sap.operator@example.test'],
      ['compliance.manager', 'ComplianceManager', 'sap.operator@example.test'],
      ['employee.alex', 'Employee', 'employee.alex'],
      ['employee.jamie', 'Employee', 'employee.jamie']
    ]
    for (const [profile, role, id] of profiles) {
      const user = verifiedUser()
      const { context, error } = apply(user, { profile })
      assert.equal(error, undefined)
      assert.notEqual(context.user, user)
      assert.equal(context.user.id, id)
      assert.deepEqual(Object.keys(context.user.roles), [role])
      for (const candidate of ['DemoOperator', 'ITAdmin', 'Employee', 'ComplianceManager']) {
        assert.equal(context.user.is(candidate), candidate === role)
      }
      assert.deepEqual(getDemoProfileSessionInfo(), {
        demoProfilesAvailable: true, activeDemoProfile: profile, demoOperatorUserId: user.id
      })
      assert.equal(user.id, 'sap.operator@example.test')
      assert.equal(user.is('ITAdmin'), true, 'The original authenticated user must not be mutated')
    }
  })

  it('allows the dedicated operator scope to select only the fixed demo business roles', function () {
    const user = verifiedUser({ roles: ['DemoOperator'] })
    const admin = apply(user, { profile: 'it.admin' })
    assert.equal(admin.error, undefined)
    assert.equal(admin.context.user.is('ITAdmin'), true)
    assert.equal(admin.context.user.is('Employee'), false)
    const employee = apply(user, { profile: 'employee.alex' })
    assert.equal(employee.error, undefined)
    assert.equal(employee.context.user.is('Employee'), true)
    assert.equal(employee.context.user.is('ITAdmin'), false)
    assert.equal(user.is('ITAdmin'), false)
  })

  it('preserves validated authInfo, user attributes, and tenant and ignores identity headers', function () {
    const user = verifiedUser()
    const { context, error } = apply(user, {
      profile: 'employee.alex', extraHeaders: { 'x-user-id': 'other', 'x-tenant': 'other', 'x-role': 'ITAdmin' }
    })
    assert.equal(error, undefined)
    assert.equal(context.user.authInfo, user.authInfo)
    assert.deepEqual(context.user.attr, user.attr)
    assert.notEqual(context.user.attr, user.attr)
    assert.equal(context.tenant, 'verified-tenant')
    assert.equal(context.user.id, 'employee.alex')
    assert.equal(context.user.is('ITAdmin'), false)
  })

  it('rejects machine, system, missing-identity, and inconsistent token principals', function () {
    for (const grant_type of ['client_credentials', 'client_x509', '', undefined]) {
      assertForbidden(verifiedUser({ payload: { grant_type } }), { profile: 'it.admin' })
    }
    for (const role of ['system-user', 'internal-user']) {
      assertForbidden(verifiedUser({ roles: ['DemoOperator', role] }), { profile: 'it.admin' })
    }
    for (const user_name of [undefined, '', ' ', 'different.actor']) {
      assertForbidden(verifiedUser({ payload: { user_name } }), { profile: 'it.admin' })
    }
    assertForbidden(verifiedUser({ id: ' ' }), { profile: 'it.admin' })
    const unvalidated = verifiedUser()
    unvalidated.authInfo.config.skipValidation = true
    assertForbidden(unvalidated, { profile: 'it.admin' })
  })

  it('keeps simultaneous users, tenants, and native requests isolated across asynchronous work', async function () {
    const sharedUser = verifiedUser()
    const run = async (user, profile, tenant, header = true) => {
      const { context, error } = apply(user, { profile, header })
      assert.equal(error, undefined)
      context.tenant = tenant
      await new Promise(resolve => setImmediate(resolve))
      const info = getDemoProfileSessionInfo()
      assert.equal(cds.context, context)
      assert.equal(cds.context.tenant, tenant)
      return { user: context.user, info }
    }
    const [alex, jamie, native] = await Promise.all([
      run(sharedUser, 'employee.alex', 'tenant-a'),
      run(sharedUser, 'employee.jamie', 'tenant-b'),
      run(sharedUser, 'sap', 'tenant-native', false)
    ])
    assert.equal(alex.user.id, 'employee.alex')
    assert.equal(jamie.user.id, 'employee.jamie')
    assert.equal(native.user, sharedUser)
    assert.equal(native.info.activeDemoProfile, 'sap')
    assert.equal(sharedUser.id, 'sap.operator@example.test')
    assert.equal(sharedUser.is('ITAdmin'), true)
  })

  it('retains original actor information in nested CAP contexts and returns safe defaults outside HTTP', function () {
    const user = verifiedUser()
    const { context } = apply(user, { profile: 'employee.alex' })
    const nested = new cds.EventContext({ user: context.user, http: context.http })
    assert.deepEqual(getDemoProfileSessionInfo(nested), {
      demoProfilesAvailable: true, activeDemoProfile: 'employee.alex', demoOperatorUserId: user.id
    })
    assert.deepEqual(getDemoProfileSessionInfo(undefined), getDemoProfileSessionInfo(context))
    cds.context = undefined
    assert.deepEqual(getDemoProfileSessionInfo(), {
      demoProfilesAvailable: false, activeDemoProfile: 'sap', demoOperatorUserId: ''
    })
  })
})

describe('Demo profile integration with the existing CAP application', function () {
  this.timeout(30000)

  it('preserves bootstrap/seeding, HTTP auth, employee row isolation, and SAP actor audit fields', function () {
    const script = String.raw`
      const assert = require('node:assert/strict')
      const path = require('node:path')
      const crypto = require('node:crypto')
      const project = process.argv[1]
      const cds = require(require.resolve('@sap/cds', { paths: [project] }))
      cds.root = project
      // The CLI's --in-memory normally overrides the configured URL. This
      // harness calls cds.server directly, so force SQLite memory explicitly.
      cds.env.requires.db.credentials = { url: ':memory:' }
      cds.env.requires.db.schema_evolution = false
      const { XsuaaService } = require(require.resolve('@sap/xssec', { paths: [project] }))
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
      const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture-key', alg: 'RS256', use: 'sig' }
      // Replace only remote JWKS retrieval with this test issuer's generated
      // public key. Standard CAP/XSUAA audience, time, and signature validation
      // remain active. No SAP binding or persisted credential is loaded.
      XsuaaService.prototype.fetchJwks = async () => ({ keys: [jwk] })
      cds.env.requires.auth = {
        kind: 'xsuaa',
        credentials: { xsappname: 'fixture-app', clientid: 'fixture-client', uaadomain: 'fixture.invalid', url: 'https://fixture.invalid' }
      }
      const actor = 'real.sap.operator@example.test'
      function jwt({ id = actor, roles = ['DemoOperator', 'ITAdmin', 'ComplianceManager'], grant = 'authorization_code', signingKey = privateKey } = {}) {
        const now = Math.floor(Date.now() / 1000)
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture-key' })).toString('base64url')
        const payload = Buffer.from(JSON.stringify({
          user_name: id, grant_type: grant, zid: 'fixture-tenant', aud: ['fixture-app'], cid: 'fixture-client',
          scope: roles.map(role => 'fixture-app.' + role), iat: now, exp: now + 300
        })).toString('base64url')
        const content = header + '.' + payload
        return content + '.' + crypto.sign('RSA-SHA256', Buffer.from(content), signingKey).toString('base64url')
      }
      const operatorToken = jwt()
      const profileMiddleware = require(path.join(project, 'srv/demo-profile'))
      let bootstrapCalls = 0
      cds.on('bootstrap', () => { bootstrapCalls += 1 })
      const standardServer = cds.server
      const applicationServer = require(path.join(project, 'server'))
      assert.equal(applicationServer, standardServer)
      const authIndex = cds.middlewares.before.findIndex(mw => mw.factory === cds.middlewares.auth)
      assert.ok(authIndex >= 0)
      assert.equal(cds.middlewares.before[authIndex + 1], profileMiddleware)
      assert.equal(cds.requires.auth.kind, 'xsuaa')
      assert.equal(cds.requires.db.credentials.url, ':memory:')

      async function main() {
        const server = await applicationServer({ service: 'all', from: '*', in_memory: true, port: 0 })
        try {
          assert.equal(bootstrapCalls, 1)
          const { seedDemoData } = require(path.join(project, 'db/seed'))
          const seeded = await seedDemoData()
          assert.equal(seeded.seeded, true)
          assert.equal(seeded.assetCount, 16)
          const base = 'http://127.0.0.1:' + server.address().port + '/odata/v4/asset-management/'
          async function request(endpoint, { profile, token = operatorToken, method = 'GET', data } = {}) {
            const headers = token ? { authorization: 'Bearer ' + token } : {}
            if (profile !== undefined) headers['x-asset-demo-profile'] = profile
            if (data) headers['content-type'] = 'application/json'
            const response = await fetch(base + endpoint, { method, headers, body: data ? JSON.stringify(data) : undefined })
            const body = await response.json().catch(() => null)
            return { status: response.status, body }
          }
          const native = await request('sessionInfo()')
          assert.equal(native.status, 200, JSON.stringify(native.body))
          assert.equal(native.body.userId, actor)
          assert.equal(native.body.demoProfilesAvailable, true)
          assert.equal(native.body.activeDemoProfile, 'sap')
          assert.equal(native.body.demoOperatorUserId, actor)
          assert.equal((await request('sessionInfo()', { token: null, profile: 'it.admin' })).status, 403)
          assert.equal((await fetch(base + 'sessionInfo()')).status, 401)
          const unrelatedKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
          assert.equal((await request('sessionInfo()', { token: jwt({ signingKey: unrelatedKey }), profile: 'it.admin' })).status, 401)
          assert.equal((await request('sessionInfo()', { token: jwt({ roles: ['ITAdmin'] }), profile: 'it.admin' })).status, 403)
          assert.equal((await request('sessionInfo()', { token: jwt({ grant: 'client_credentials' }), profile: 'it.admin' })).status, 403)
          assert.equal((await request('sessionInfo()', { profile: 'employee.other' })).status, 403)
          const operatorOnlyToken = jwt({ roles: ['DemoOperator'] })
          assert.equal((await request('Assets', { token: operatorOnlyToken })).status, 403)
          assert.equal((await request('Assets', { token: operatorOnlyToken, profile: 'it.admin' })).status, 200)
          assert.equal((await request('MyAssets', { token: operatorOnlyToken, profile: 'employee.alex' })).status, 200)
          process.env.ASSET_DEMO_PROFILES_ENABLED = 'false'
          assert.equal((await request('sessionInfo()', { profile: 'it.admin' })).status, 403)
          assert.equal((await request('sessionInfo()')).body.demoProfilesAvailable, false)
          process.env.ASSET_DEMO_PROFILES_ENABLED = 'true'
          for (const [profile, role, id] of [
            ['it.admin', 'ITAdmin', actor], ['compliance.manager', 'ComplianceManager', actor],
            ['employee.alex', 'Employee', 'employee.alex'], ['employee.jamie', 'Employee', 'employee.jamie']
          ]) {
            const session = await request('sessionInfo()', { profile })
            assert.equal(session.status, 200, JSON.stringify(session.body))
            assert.equal(session.body.userId, id)
            assert.deepEqual(session.body.roles, [role])
            assert.equal(session.body.demoOperatorUserId, actor)
            assert.equal(session.body.activeDemoProfile, profile)
          }
          const alexAssets = await request('MyAssets', { profile: 'employee.alex' })
          assert.equal(alexAssets.status, 200)
          assert.deepEqual(alexAssets.body.value.map(row => row.assetName), ['DEMO-Allocated-Laptop-Alex'])
          const jamieAssets = await request('MyAssets', { profile: 'employee.jamie' })
          assert.equal(jamieAssets.status, 200)
          assert.deepEqual(jamieAssets.body.value.map(row => row.assetName), ['DEMO-Allocated-Software-Jamie'])
          const alexFiltered = await request("MyAssets?$filter=assetName eq 'DEMO-Allocated-Software-Jamie'", { profile: 'employee.alex' })
          assert.equal(alexFiltered.status, 200)
          assert.deepEqual(alexFiltered.body.value, [])
          for (const profile of ['employee.alex', 'employee.jamie', 'compliance.manager']) {
            assert.equal((await request('Assets', { profile })).status, 403)
            assert.equal((await request('Assets', { profile, method: 'POST', data: { assetName: 'FORBIDDEN', type: 'Hardware', purchaseDate: '2026-09-01' } })).status, 403)
            assert.equal((await request('allocateAsset', { profile, method: 'POST', data: { assetID: alexAssets.body.value[0].assetID, employeeUserId: 'employee.jamie' } })).status, 403)
          }
          const created = await request('Assets', { profile: 'it.admin', method: 'POST', data: { assetName: 'AUDIT-SAP-ACTOR', type: 'Hardware', purchaseDate: '2026-09-01' } })
          assert.equal(created.status, 201, JSON.stringify(created.body))
          assert.equal(created.body.createdBy, actor)
          assert.equal(created.body.modifiedBy, actor)
          const allocated = await request('allocateAsset', { profile: 'it.admin', method: 'POST', data: { assetID: created.body.assetID, employeeUserId: 'employee.alex' } })
          assert.equal(allocated.status, 200, JSON.stringify(allocated.body))
          assert.equal(allocated.body.modifiedBy, actor)
          const audit = await request('AllocationHistories', { profile: 'it.admin' })
          const newHistory = audit.body.value.find(row => row.assetID_assetID === created.body.assetID)
          assert.equal(newHistory.createdBy, actor)
          assert.equal(newHistory.modifiedBy, actor)
          const simultaneous = await Promise.all([
            request('sessionInfo()', { profile: 'employee.alex' }), request('sessionInfo()', { profile: 'employee.jamie' }), request('sessionInfo()')
          ])
          assert.deepEqual(simultaneous.map(result => result.body.userId), ['employee.alex', 'employee.jamie', actor])
          const history = await cds.db.run(cds.ql.SELECT.from('it.asset.lifecycle.AllocationHistory'))
          assert.equal(history.length, 4)
          console.log('CAP profile integration passed: bootstrap, seeded fixtures, signed JWT HTTP profiles, signature rejection, isolation, roles, audit actor')
        } finally {
          cds.context = undefined
          await new Promise(resolve => server.close(resolve))
          await cds.db.disconnect()
        }
      }
      main().catch(error => { console.error(error); process.exitCode = 1 })
    `
    const tempRoot = fs.realpathSync(os.tmpdir())
    const isolatedDirectory = fs.mkdtempSync(path.join(tempRoot, 'cap-demo-profiles-'))
    const child = spawnSync(process.execPath, ['-e', script, path.join(__dirname, '..')], {
      cwd: isolatedDirectory,
      env: {
        ...process.env, NODE_ENV: 'test', CDS_ENV: 'test', ASSET_DEMO_PROFILES_ENABLED: 'true', ASSET_SEED_DEMO: 'true',
        ASSET_FIXED_TODAY: '2026-09-28', ASSET_TIME_ZONE: 'Asia/Kolkata'
      },
      encoding: 'utf8', timeout: 25000
    })
    try {
      assert.ifError(child.error)
      assert.equal(child.status, 0, child.stdout + child.stderr)
      assert.match(child.stdout, /CAP profile integration passed/)
    } finally {
      const resolvedDirectory = fs.realpathSync(isolatedDirectory)
      assert.equal(path.dirname(resolvedDirectory), tempRoot)
      assert.ok(path.basename(resolvedDirectory).startsWith('cap-demo-profiles-'))
      fs.rmSync(resolvedDirectory, { recursive: true, force: true })
    }
  })
})

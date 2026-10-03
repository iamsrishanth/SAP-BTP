const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const cds = require('@sap/cds')
const transfer = require('../srv/demo-data-transfer')

const ROOT = path.resolve(__dirname, '..')
const TODAY = '2026-09-28'
const CLOCK = { businessDate: TODAY, timeZone: 'Asia/Kolkata' }
const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
const C = '00000000-0000-4000-8000-000000000003'
const H = '10000000-0000-4000-8000-000000000001'
const AUDIT = { createdAt: '2026-08-01T08:01:02.123Z', createdBy: 'original.creator', modifiedAt: '2026-09-03T09:04:05.456Z', modifiedBy: 'original.modifier' }
const copy = value => JSON.parse(JSON.stringify(value))
function fixtureRows() {
  return {
    Employee: [
      { userId: 'employee.MixedCase@Example.com', displayName: 'Alex Morgan', active: true, ...AUDIT },
      { userId: 'employee.inactive', displayName: 'Inactive Employee', active: false, createdAt: null, createdBy: null, modifiedAt: null, modifiedBy: null }
    ],
    Asset: [
      { assetID: C, assetName: 'Retired laptop', type: 'Hardware', purchaseDate: '2025-03-01', expiryDate: '2026-03-01', status: 'Retired', allocatedTo: null, allocatedToUserId: null, maintenanceReason: null, retiredAt: '2026-09-02T10:11:12.345Z', retirementReason: 'End of supported life', ...AUDIT },
      { assetID: A, assetName: 'Allocated software', type: 'Software', purchaseDate: '2026-01-01', expiryDate: '2026-10-03', status: 'Allocated', allocatedTo: 'Alex Morgan', allocatedToUserId: 'employee.MixedCase@Example.com', maintenanceReason: null, retiredAt: null, retirementReason: null, ...AUDIT },
      { assetID: B, assetName: 'Maintenance hardware', type: 'Hardware', purchaseDate: '2026-01-02', expiryDate: null, status: 'In Maintenance', allocatedTo: null, allocatedToUserId: null, maintenanceReason: 'Keyboard replacement', retiredAt: null, retirementReason: null, ...AUDIT }
    ],
    AllocationHistory: [
      { allocID: H, assetID_assetID: A, employeeName: 'Alex Morgan', employeeUserId: 'employee.MixedCase@Example.com', assignedDate: '2026-09-02', returnedDate: null, ...AUDIT },
      { allocID: '10000000-0000-4000-8000-000000000002', assetID_assetID: A, employeeName: 'Inactive Employee', employeeUserId: 'employee.inactive', assignedDate: '2026-01-02', returnedDate: '2026-02-02', ...AUDIT },
      { allocID: '10000000-0000-4000-8000-000000000003', assetID_assetID: C, employeeName: 'Historical display name', employeeUserId: 'employee.inactive', assignedDate: '2025-04-01', returnedDate: '2025-05-01', ...AUDIT }
    ]
  }
}
const snapshotOf = rows => transfer.createSnapshot(rows, CLOCK)
function shaFile(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function binding(credentials = {}) {
  return { hana: [{ name: transfer.EXPECTED_SERVICE, label: 'hana', plan: 'hdi-shared', credentials: {
    database_id: transfer.EXPECTED_DATABASE_ID,
    host: `${transfer.EXPECTED_DATABASE_ID}.hana.trial-eu10.hanacloud.ondemand.com`,
    password: 'SYNTHETIC_SECRET_DO_NOT_LOG', ...credentials
  } }] }
}
function checkedBinding(vcapServices, expectedDatabaseId = transfer.EXPECTED_DATABASE_ID, expectedService = transfer.EXPECTED_SERVICE) {
  return transfer.assertHanaBinding({ vcapServices, expectedDatabaseId, expectedService })
}

describe('Demo data snapshot transfer (temporary persistent SQLite)', function () {
  this.timeout(30000)
  let directory, model, databases, nextDatabase, originalMaxListeners, shutdownListeners
  before(async function () {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-demo-transfer-'))
    databases = []
    nextDatabase = 0
    shutdownListeners = []
    originalMaxListeners = cds.getMaxListeners()
    cds.setMaxListeners(originalMaxListeners + 24)
    await cds.plugins
    model = await cds.load(path.join(ROOT, 'db', 'schema.cds'))
  })
  after(async function () {
    for (const db of databases) await db.disconnect()
    for (const listener of shutdownListeners) cds.removeListener('shutdown', listener)
    cds.setMaxListeners(originalMaxListeners)
    fs.rmSync(directory, { recursive: true, force: true })
  })
  async function database() {
    const file = path.join(directory, `database-${nextDatabase++}.sqlite`)
    const db = await cds.connect.to({ kind: 'sqlite', model, credentials: { url: file }, silent: true })
    shutdownListeners.push(cds.listeners('shutdown').at(-1))
    await cds.deploy(model).to(db, { silent: true })
    databases.push(db)
    return { db, file }
  }
  async function counts(db) {
    const rows = await transfer.exportSnapshot(db, CLOCK)
    return rows.counts
  }
  async function assertEmpty(db) { assert.deepEqual(await counts(db), { Employee: 0, Asset: 0, AllocationHistory: 0 }) }

  it('preserves every UUID, literal history FK, employee identity and business/audit field', async function () {
    const { db: source, file } = await database()
    const { db: destination } = await database()
    const original = snapshotOf(fixtureRows())
    await transfer.importSnapshot(source, original)
    const exported = await transfer.exportSnapshot(source, CLOCK)
    assert.deepEqual(exported, original)
    assert.deepEqual(transfer.exportSqliteSnapshot(file, CLOCK), original)
    assert.equal((await transfer.importSnapshot(destination, exported)).status, 'imported')
    assert.deepEqual(await transfer.exportSnapshot(destination, CLOCK), original)
    const history = await destination.run(cds.ql.SELECT.one.from('it.asset.lifecycle.AllocationHistory').where({ allocID: H }))
    assert.equal(history.assetID_assetID, A)
    assert.equal(history.createdBy, AUDIT.createdBy)
    assert.equal(history.modifiedAt, AUDIT.modifiedAt)
    const legacyEmployee = await destination.run(cds.ql.SELECT.one.from('it.asset.lifecycle.Employee').where({ userId: 'employee.inactive' }))
    assert.equal(legacyEmployee.createdAt, null)
    assert.equal(legacyEmployee.createdBy, null)
  })

  it('exports deterministically without mutating or seeding the persistent source', async function () {
    const { db, file } = await database()
    const original = snapshotOf(fixtureRows())
    await transfer.importSnapshot(db, original)
    const before = shaFile(file)
    const first = transfer.exportSqliteSnapshot(file, CLOCK)
    const reverse = fixtureRows()
    for (const rows of Object.values(reverse)) rows.reverse()
    assert.equal(JSON.stringify(first), JSON.stringify(snapshotOf(reverse)))
    assert.deepEqual(transfer.exportSqliteSnapshot(file, CLOCK), first)
    assert.equal(shaFile(file), before)
    assert.deepEqual(await transfer.exportSnapshot(db, CLOCK), original)
    assert.deepEqual(first.counts, { Employee: 2, Asset: 3, AllocationHistory: 3 })
    assert.equal(first.businessDate, TODAY)
    assert.equal(first.timeZone, 'Asia/Kolkata')
    assert.match(first.hash, /^sha256:[a-f0-9]{64}$/)
  })

  it('reports a repeated identical import without replacing rows or their audits', async function () {
    const { db } = await database()
    const original = snapshotOf(fixtureRows())
    assert.equal((await transfer.importSnapshot(db, original)).status, 'imported')
    const repeated = await transfer.importSnapshot(db, copy(original))
    assert.deepEqual(repeated, { status: 'already-imported', counts: original.counts, hash: original.hash })
    assert.deepEqual(await transfer.exportSnapshot(db, CLOCK), original)
  })

  it('rejects a different populated destination without modifying a single row', async function () {
    const { db } = await database()
    const original = snapshotOf(fixtureRows())
    await transfer.importSnapshot(db, original)
    const changed = fixtureRows()
    changed.Asset[0].assetName = 'Different snapshot'
    await assert.rejects(transfer.importSnapshot(db, snapshotOf(changed)), error => error.code === 'DESTINATION_NOT_EMPTY')
    assert.deepEqual(await transfer.exportSnapshot(db, CLOCK), original)
  })

  it('requires all tables to be empty, including an employee-only destination', async function () {
    const { db } = await database()
    const employee = fixtureRows().Employee[0]
    await db.run(cds.ql.INSERT.into('it.asset.lifecycle.Employee').entries(employee))
    await assert.rejects(transfer.importSnapshot(db, snapshotOf(fixtureRows())), error => error.code === 'DESTINATION_NOT_EMPTY')
    assert.deepEqual(await counts(db), { Employee: 1, Asset: 0, AllocationHistory: 0 })
    assert.deepEqual((await transfer.exportSnapshot(db, CLOCK)).rows.Employee, [employee])
  })

  it('rolls back earlier employee inserts if a later database constraint fails', async function () {
    const { db } = await database()
    await db.run('CREATE TRIGGER reject_asset BEFORE INSERT ON it_asset_lifecycle_Asset BEGIN SELECT RAISE(ABORT, \'synthetic constraint failure\'); END')
    await assert.rejects(transfer.importSnapshot(db, snapshotOf(fixtureRows())), /synthetic constraint failure/)
    await assertEmpty(db)
  })

  it('rejects broken foreign keys, inconsistent employee mappings and duplicate active history', async function () {
    const { db } = await database()
    const invalid = [
      rows => { rows.AllocationHistory[0].assetID_assetID = '99999999-0000-4000-8000-000000000001' },
      rows => { rows.AllocationHistory[0].employeeUserId = 'unknown.employee' },
      rows => { rows.Asset.find(row => row.assetID === A).allocatedTo = 'Wrong employee name' },
      rows => { rows.Employee[0].active = false },
      rows => { rows.AllocationHistory.push({ ...rows.AllocationHistory[0], allocID: '99999999-0000-4000-8000-000000000002' }) },
      rows => { rows.AllocationHistory[0].returnedDate = '2026-09-03' },
      rows => { rows.Asset.find(row => row.assetID === A).status = 'Available' }
    ]
    for (const mutate of invalid) {
      const input = copy(snapshotOf(fixtureRows()))
      mutate(input.rows)
      await assert.rejects(transfer.importSnapshot(db, input), error => error.code === 'INVALID_SNAPSHOT')
      await assertEmpty(db)
    }
  })

  it('rejects missing/unknown fields, duplicate keys, invalid types, dates, UUIDs and audit values', async function () {
    const { db } = await database()
    const invalid = [
      rows => { delete rows.Asset[0].retirementReason },
      rows => { rows.AllocationHistory[0].asset_assetID = A },
      rows => { rows.Employee[0].password = 'must never be included' },
      rows => { rows.Asset[0].type = 'Phone' },
      rows => { rows.Asset[0].status = 'Deleted' },
      rows => { rows.Asset[0].purchaseDate = '2026-02-30' },
      rows => { rows.AllocationHistory[0].returnedDate = '2026-09-01' },
      rows => { rows.Asset[0].assetID = 'not-a-uuid' },
      rows => { rows.Employee[0].active = 1 },
      rows => { rows.Employee[0].createdAt = '2026-02-30T08:01:02.123Z' },
      rows => { rows.Employee[0].modifiedBy = '' },
      rows => { rows.Employee.push(copy(rows.Employee[0])) }
    ]
    for (const mutate of invalid) {
      const input = copy(snapshotOf(fixtureRows()))
      mutate(input.rows)
      await assert.rejects(transfer.importSnapshot(db, input), error => error.code === 'INVALID_SNAPSHOT')
      await assertEmpty(db)
    }
    const badHash = copy(snapshotOf(fixtureRows()))
    badHash.rows.Asset[0].assetName = 'Tampered valid text'
    await assert.rejects(transfer.importSnapshot(db, badHash), error => error.code === 'HASH_MISMATCH')
    await assertEmpty(db)
  })

  it('rejects malformed metadata, unsupported versions and count/hash mismatches before writing', async function () {
    const { db } = await database()
    const invalid = [
      snapshot => { snapshot.version = 2 },
      snapshot => { snapshot.businessDate = '2026-13-01' },
      snapshot => { snapshot.timeZone = 'Invalid/Zone' },
      snapshot => { snapshot.counts.Employee += 1 },
      snapshot => { snapshot.credentials = {} },
      snapshot => { snapshot.hash = 'sha256:wrong' }
    ]
    for (const mutate of invalid) {
      const input = copy(snapshotOf(fixtureRows()))
      mutate(input)
      await assert.rejects(transfer.importSnapshot(db, input), error => ['INVALID_SNAPSHOT', 'HASH_MISMATCH'].includes(error.code))
      await assertEmpty(db)
    }
  })

  it('allows only the explicitly expected HANA service/database identity and a strict host fallback', function () {
    assert.equal(checkedBinding(JSON.stringify(binding())).service, transfer.EXPECTED_SERVICE)
    const hostOnly = binding()
    delete hostOnly.hana[0].credentials.database_id
    assert.equal(checkedBinding(hostOnly).databaseId, transfer.EXPECTED_DATABASE_ID)
    for (const credentials of [
      { database_id: '99999999-0000-4000-8000-000000000001' },
      { host: '99999999-0000-4000-8000-000000000001.hana.trial-eu10.hanacloud.ondemand.com' },
      { database_id: undefined, host: `${transfer.EXPECTED_DATABASE_ID}.evil.example` },
      { database_id: undefined, host: `prefix-${transfer.EXPECTED_DATABASE_ID}.hana.trial-eu10.hanacloud.ondemand.com` },
      { database_id: undefined, host: `https://${transfer.EXPECTED_DATABASE_ID}.hana.trial-eu10.hanacloud.ondemand.com` }
    ]) assert.throws(() => checkedBinding(binding(credentials)), error => error.code === 'BINDING_MISMATCH')
    const wrongName = binding()
    wrongName.hana[0].name = 'wrong-service'
    assert.throws(() => checkedBinding(wrongName), error => error.code === 'BINDING_MISMATCH')
    const duplicate = binding()
    duplicate.hana.push(copy(duplicate.hana[0]))
    assert.throws(() => checkedBinding(duplicate), error => error.code === 'BINDING_MISMATCH')
    const wrongPlan = binding()
    wrongPlan.hana[0].plan = 'other'
    assert.throws(() => checkedBinding(wrongPlan), error => error.code === 'BINDING_MISMATCH')
    assert.throws(() => checkedBinding(binding(), null), error => error.code === 'BINDING_MISMATCH')
    assert.throws(() => checkedBinding('{invalid'), error => error.code === 'BINDING_MISMATCH')
  })

  it('rejects an approved database_id paired with any unapproved or malformed destination host', function () {
    for (const host of [
      'unrelated.example',
      `${transfer.EXPECTED_DATABASE_ID}.evil.example`,
      `prefix-${transfer.EXPECTED_DATABASE_ID}.hana.trial-eu10.hanacloud.ondemand.com`,
      `unrelated.${transfer.EXPECTED_DATABASE_ID}.hana.trial-eu10.hanacloud.ondemand.com`,
      `${transfer.EXPECTED_DATABASE_ID}.hana.trial-eu10.hanacloud.ondemand.com.evil.example`,
      `${transfer.EXPECTED_DATABASE_ID}..hana.trial-eu10.hanacloud.ondemand.com`,
      `https://${transfer.EXPECTED_DATABASE_ID}.hana.trial-eu10.hanacloud.ondemand.com`,
      undefined, null, ''
    ]) {
      const vcap = binding({ database_id: transfer.EXPECTED_DATABASE_ID, host })
      assert.throws(() => checkedBinding(vcap), error => error.code === 'BINDING_MISMATCH')
    }
    assert.equal(checkedBinding(binding()).databaseId, transfer.EXPECTED_DATABASE_ID)
  })

  it('exports through the standalone CLI to a private temp file and never overwrites it', async function () {
    const { db, file } = await database()
    const original = snapshotOf(fixtureRows())
    await transfer.importSnapshot(db, original)
    const output = path.join(directory, 'snapshot.json')
    const command = ['scripts/export-demo-data.js', '--database', file, '--output', output]
    const options = { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'development', CDS_ENV: 'development', ASSET_FIXED_TODAY: TODAY, ASSET_TIME_ZONE: CLOCK.timeZone } }
    const result = spawnSync(process.execPath, command, options)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), original)
    assert.equal(JSON.parse(result.stdout).status, 'exported')
    const hash = shaFile(output)
    const repeat = spawnSync(process.execPath, command, options)
    assert.equal(repeat.status, 1)
    assert.equal(shaFile(output), hash)
    assert.deepEqual(await transfer.exportSnapshot(db, CLOCK), original)
    assert.throws(() => transfer.writeSnapshot(original, path.join(ROOT, 'snapshot.json'), { projectRoot: ROOT }), error => error.code === 'PRIVATE_PATH_REQUIRED')
    const project = path.join(directory, 'project')
    fs.mkdirSync(project)
    const packaged = path.join(project, 'demo-data-private', 'bas-sqlite-snapshot.json')
    transfer.writeSnapshot(original, packaged, { projectRoot: project })
    assert.deepEqual(JSON.parse(fs.readFileSync(packaged, 'utf8')), original)
    assert.throws(() => transfer.writeSnapshot(original, packaged, { projectRoot: project }), error => error.code === 'EEXIST')
  })

  it('rejects CLI destination guards before touching a database and never logs VCAP secrets', function () {
    const input = path.join(directory, 'cli-input.json')
    fs.writeFileSync(input, JSON.stringify(snapshotOf(fixtureRows())))
    const command = ['scripts/import-demo-data.js', '--input', input, '--expected-database-id', transfer.EXPECTED_DATABASE_ID, '--expected-service', transfer.EXPECTED_SERVICE]
    for (const wrong of [
      binding({ database_id: '99999999-0000-4000-8000-000000000001' }),
      binding({ database_id: transfer.EXPECTED_DATABASE_ID, host: 'unrelated.example' })
    ]) {
      const result = spawnSync(process.execPath, command, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, VCAP_SERVICES: JSON.stringify(wrong) } })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /BINDING_MISMATCH/)
      assert.ok(!`${result.stdout}${result.stderr}`.includes('SYNTHETIC_SECRET_DO_NOT_LOG'))
    }
    const missingGuard = spawnSync(process.execPath, ['scripts/import-demo-data.js', '--input', input], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(missingGuard.status, 1)
    assert.match(missingGuard.stderr, /Usage:/)
  })
})

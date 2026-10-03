const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const cds = require('@sap/cds')
const { businessToday, businessTimeZone } = require('./date-rules')

const FORMAT = 'sap-btp-it-asset-lifecycle-demo-snapshot'
const VERSION = 1
const EXPECTED_DATABASE_ID = '0dda540b-396a-487b-b665-805ed690ec14'
const EXPECTED_SERVICE = 'sap-btp-it-asset-lifecycle-db'
const NAMESPACE = 'it.asset.lifecycle'
const AUDIT = ['createdAt', 'createdBy', 'modifiedAt', 'modifiedBy']
const ENTITIES = {
  Employee: { key: 'userId', fields: ['userId', 'displayName', 'active', ...AUDIT] },
  Asset: { key: 'assetID', fields: ['assetID', 'assetName', 'type', 'purchaseDate', 'expiryDate', 'status', 'allocatedTo', 'allocatedToUserId', 'maintenanceReason', 'retiredAt', 'retirementReason', ...AUDIT] },
  AllocationHistory: { key: 'allocID', fields: ['allocID', 'assetID_assetID', 'employeeName', 'employeeUserId', 'assignedDate', 'returnedDate', ...AUDIT] }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TYPES = new Set(['Hardware', 'Software'])
const STATUSES = new Set(['Available', 'Allocated', 'In Maintenance', 'Retired'])

class SnapshotError extends Error {
  constructor(code, message) { super(message); this.name = 'SnapshotError'; this.code = code }
}
function fail(message, code = 'INVALID_SNAPSHOT') { throw new SnapshotError(code, message) }
function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`)
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    fail(`${label} must contain exactly the documented fields.`)
  }
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
function date(value, label, nullable = false) {
  if (nullable && value === null) return
  if (!validDate(value)) fail(`${label} must be a valid YYYY-MM-DD date.`)
}
function timestamp(value, label) {
  if (value === null) return
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(`${label} must be null or a valid UTC timestamp with millisecond precision.`)
  }
}
function string(value, label, length, nullable = false) {
  if (nullable && value === null) return
  if (typeof value !== 'string' || !value.trim() || value.length > length || /[\p{Cc}\p{Cf}]/u.test(value)) {
    fail(`${label} must contain valid text within the schema length.`)
  }
}
function uuid(value, label) { if (typeof value !== 'string' || !UUID.test(value)) fail(`${label} must be a UUID.`) }
function timeZone(value) {
  if (typeof value !== 'string' || !value || value.length > 100) fail('timeZone must be a valid IANA time zone.')
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date(0)) }
  catch { fail('timeZone must be a valid IANA time zone.') }
}
function canonicalRows(rows) {
  return Object.fromEntries(Object.entries(ENTITIES).map(([entity, { key, fields }]) => [entity,
    rows[entity].map(row => Object.fromEntries(fields.map(field => [field, row[field]])))
      .sort((a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0)
  ]))
}
function payloadFor(snapshot) {
  return { format: FORMAT, version: VERSION, businessDate: snapshot.businessDate, timeZone: snapshot.timeZone,
    counts: Object.fromEntries(Object.keys(ENTITIES).map(entity => [entity, snapshot.rows[entity].length])),
    rows: canonicalRows(snapshot.rows) }
}
function hashFor(payload) { return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}` }

function validateRows(rows, businessDate) {
  exactKeys(rows, Object.keys(ENTITIES), 'rows')
  for (const [entity, { key, fields }] of Object.entries(ENTITIES)) {
    if (!Array.isArray(rows[entity])) fail(`rows.${entity} must be an array.`)
    const keys = new Set()
    for (const row of rows[entity]) {
      exactKeys(row, fields, entity)
      const identity = entity === 'Employee' ? row[key] : typeof row[key] === 'string' ? row[key].toLowerCase() : row[key]
      if (keys.has(identity)) fail(`${entity} contains duplicate keys.`)
      keys.add(identity)
      for (const field of ['createdAt', 'modifiedAt']) timestamp(row[field], `${entity}.${field}`)
      for (const field of ['createdBy', 'modifiedBy']) string(row[field], `${entity}.${field}`, 255, true)
      if (row.createdAt && row.modifiedAt && row.modifiedAt < row.createdAt) fail(`${entity} audit dates are out of order.`)
      if (entity === 'Employee') {
        string(row.userId, 'Employee.userId', 255)
        string(row.displayName, 'Employee.displayName', 200)
        if (row.userId !== row.userId.trim() || row.displayName !== row.displayName.trim()) fail('Employee identity must have no surrounding whitespace.')
        if (typeof row.active !== 'boolean') fail('Employee.active must be a boolean.')
      } else if (entity === 'Asset') {
        uuid(row.assetID, 'Asset.assetID')
        string(row.assetName, 'Asset.assetName', 200)
        if (!TYPES.has(row.type)) fail('Asset.type is unsupported.')
        if (!STATUSES.has(row.status)) fail('Asset.status is unsupported.')
        date(row.purchaseDate, 'Asset.purchaseDate')
        date(row.expiryDate, 'Asset.expiryDate', true)
        if (row.purchaseDate > businessDate || (row.expiryDate && row.expiryDate < row.purchaseDate)) fail('Asset dates are out of order.')
        for (const [field, length] of [['allocatedTo', 200], ['allocatedToUserId', 255], ['maintenanceReason', 500], ['retirementReason', 500]]) {
          string(row[field], `Asset.${field}`, length, true)
        }
        timestamp(row.retiredAt, 'Asset.retiredAt')
      } else {
        uuid(row.allocID, 'AllocationHistory.allocID')
        uuid(row.assetID_assetID, 'AllocationHistory.assetID_assetID')
        string(row.employeeName, 'AllocationHistory.employeeName', 200)
        string(row.employeeUserId, 'AllocationHistory.employeeUserId', 255)
        date(row.assignedDate, 'AllocationHistory.assignedDate')
        date(row.returnedDate, 'AllocationHistory.returnedDate', true)
        if (row.assignedDate > businessDate || (row.returnedDate && (row.returnedDate < row.assignedDate || row.returnedDate > businessDate))) {
          fail('AllocationHistory dates are out of order.')
        }
      }
    }
  }
  const employees = new Map(rows.Employee.map(row => [row.userId, row]))
  const assets = new Map(rows.Asset.map(row => [row.assetID.toLowerCase(), row]))
  const active = new Map()
  for (const row of rows.AllocationHistory) {
    const asset = assets.get(row.assetID_assetID.toLowerCase())
    if (!asset || asset.assetID !== row.assetID_assetID) fail('AllocationHistory references an unknown asset identity.')
    if (!employees.has(row.employeeUserId)) fail('AllocationHistory references an unknown employee identity.')
    if (row.assignedDate < asset.purchaseDate) fail('AllocationHistory predates asset purchase.')
    if (row.returnedDate === null) {
      if (active.has(row.assetID_assetID)) fail('An asset has multiple active allocation histories.')
      active.set(row.assetID_assetID, row)
    }
  }
  for (const asset of rows.Asset) {
    const history = active.get(asset.assetID)
    if (asset.status === 'Allocated') {
      const employee = employees.get(asset.allocatedToUserId)
      if (!employee || !employee.active || employee.displayName !== asset.allocatedTo || !history ||
          history.employeeUserId !== asset.allocatedToUserId || history.employeeName !== asset.allocatedTo) {
        fail('Allocated asset, employee identity and active history must agree.')
      }
    } else if (history || asset.allocatedTo !== null || asset.allocatedToUserId !== null) {
      fail('An unallocated asset must have no assignee or active history.')
    }
  }
}

function validateSnapshot(snapshot) {
  exactKeys(snapshot, ['format', 'version', 'businessDate', 'timeZone', 'counts', 'rows', 'hash'], 'snapshot')
  if (snapshot.format !== FORMAT || snapshot.version !== VERSION) fail('Unsupported snapshot format or version.')
  date(snapshot.businessDate, 'businessDate')
  timeZone(snapshot.timeZone)
  validateRows(snapshot.rows, snapshot.businessDate)
  exactKeys(snapshot.counts, Object.keys(ENTITIES), 'counts')
  for (const entity of Object.keys(ENTITIES)) {
    if (!Number.isSafeInteger(snapshot.counts[entity]) || snapshot.counts[entity] !== snapshot.rows[entity].length) fail('Snapshot counts do not match rows.')
  }
  const payload = payloadFor(snapshot)
  if (snapshot.hash !== hashFor(payload)) fail('Snapshot hash does not match its contents.', 'HASH_MISMATCH')
  return { ...payload, hash: snapshot.hash }
}

function createSnapshot(rows, { businessDate = businessToday(), timeZone: zone = businessTimeZone() } = {}) {
  date(businessDate, 'businessDate')
  timeZone(zone)
  validateRows(rows, businessDate)
  const payload = payloadFor({ rows, businessDate, timeZone: zone })
  return { ...payload, hash: hashFor(payload) }
}

function checkDatabase(db) {
  if (!db?.isDatabaseService || typeof db.tx !== 'function') fail('An actual CAP database service is required.', 'INVALID_DATABASE')
  if (!['sqlite', 'hana'].includes(db.kind || db.options?.kind)) fail('Only SQLite and HANA database services are supported.', 'INVALID_DATABASE')
}
async function readRows(tx) {
  const rows = {}
  for (const [entity, { fields }] of Object.entries(ENTITIES)) {
    rows[entity] = await tx.run(cds.ql.SELECT.from(`${NAMESPACE}.${entity}`).columns(...fields))
  }
  return rows
}
function systemContext() { return { user: new cds.User.Privileged('demo-data-transfer') } }

async function exportSnapshot(db, options = {}) {
  checkDatabase(db)
  return db.tx(systemContext(), async tx => createSnapshot(await readRows(tx), options))
}

async function importSnapshot(db, input) {
  checkDatabase(db)
  const snapshot = validateSnapshot(input)
  return db.tx(systemContext(), async tx => {
    if ((db.kind || db.options.kind) === 'hana') {
      // Empty result sets cannot be protected with row locks. Lock all three
      // fixed tables before checking emptiness, and hold the locks until commit.
      if (cds.env.sql.names && cds.env.sql.names !== 'plain') fail('HANA import requires the project plain SQL naming mode.', 'INVALID_DATABASE')
      for (const entity of Object.keys(ENTITIES)) {
        await tx.run(`LOCK TABLE "IT_ASSET_LIFECYCLE_${entity.toUpperCase()}" IN EXCLUSIVE MODE`)
      }
    }
    const existing = canonicalRows(await readRows(tx))
    if (Object.values(existing).some(rows => rows.length > 0)) {
      if (JSON.stringify(existing) === JSON.stringify(snapshot.rows)) {
        return { status: 'already-imported', counts: snapshot.counts, hash: snapshot.hash }
      }
      fail('Destination contains different data; import requires all three tables to be empty.', 'DESTINATION_NOT_EMPTY')
    }
    for (const entity of Object.keys(ENTITIES)) {
      if (snapshot.rows[entity].length) await tx.run(cds.ql.INSERT.into(`${NAMESPACE}.${entity}`).entries(snapshot.rows[entity]))
    }
    // Compare inside the transaction so database conversions or managed-field
    // defaults cannot silently change the snapshot; any mismatch rolls back.
    if (JSON.stringify(canonicalRows(await readRows(tx))) !== JSON.stringify(snapshot.rows)) {
      fail('Database did not preserve every snapshot field; the import was rolled back.', 'PRESERVATION_FAILED')
    }
    return { status: 'imported', counts: snapshot.counts, hash: snapshot.hash }
  })
}

function exportSqliteSnapshot(databasePath, options = {}) {
  if (!databasePath || databasePath === ':memory:' || !fs.statSync(databasePath).isFile()) {
    fail('Export requires an existing persistent SQLite file.', 'INVALID_DATABASE')
  }
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    db.exec('BEGIN')
    const rows = {}
    for (const [entity, { fields }] of Object.entries(ENTITIES)) {
      const columns = fields.map(field => `"${field}"`).join(', ')
      rows[entity] = db.prepare(`SELECT ${columns} FROM "it_asset_lifecycle_${entity}"`).all()
      if (entity === 'Employee') for (const row of rows[entity]) {
        if (![0, 1].includes(row.active)) fail('Stored Employee.active is invalid.')
        row.active = Boolean(row.active)
      }
    }
    const snapshot = createSnapshot(rows, options)
    db.exec('COMMIT')
    return snapshot
  } finally { db.close() }
}

function writeSnapshot(snapshot, outputPath, { projectRoot = cds.root } = {}) {
  const validated = validateSnapshot(snapshot)
  const destination = path.resolve(outputPath)
  const relative = path.relative(path.resolve(projectRoot), destination)
  const insideProject = relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  if (insideProject && !['demo-data-private', 'db-backups', 'gen'].includes(relative.split(path.sep)[0])) {
    fail('Save snapshots outside the project or in its ignored demo-data-private/db-backups/gen directory.', 'PRIVATE_PATH_REQUIRED')
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
  fs.writeFileSync(destination, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  return { counts: validated.counts, hash: validated.hash }
}

function assertHanaBinding({ vcapServices, expectedDatabaseId, expectedService } = {}) {
  if (expectedDatabaseId !== EXPECTED_DATABASE_ID || expectedService !== EXPECTED_SERVICE) {
    fail('Both expected destination identifiers must explicitly match the approved HANA destination.', 'BINDING_MISMATCH')
  }
  let bindings
  try { bindings = typeof vcapServices === 'string' ? JSON.parse(vcapServices) : vcapServices }
  catch { fail('VCAP_SERVICES must contain valid JSON.', 'BINDING_MISMATCH') }
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) fail('VCAP_SERVICES is required.', 'BINDING_MISMATCH')
  if (Object.values(bindings).some(group => !Array.isArray(group))) fail('VCAP_SERVICES contains an invalid service group.', 'BINDING_MISMATCH')
  const matching = Object.entries(bindings).flatMap(([label, group]) => group.map(binding => ({ label, binding })))
    .filter(({ binding }) => binding?.name === expectedService)
  if (matching.length !== 1) fail('Exactly one expected named HANA binding is required.', 'BINDING_MISMATCH')
  const { binding, label } = matching[0]
  if (label !== 'hana' || binding.plan !== 'hdi-shared' || (binding.label && binding.label !== 'hana') ||
      (binding.instance_name && binding.instance_name !== expectedService)) fail('Expected service must be an unambiguous HANA HDI binding.', 'BINDING_MISMATCH')
  const credentials = binding.credentials
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) fail('Expected HANA binding has no credentials.', 'BINDING_MISMATCH')
  const id = credentials.database_id
  const host = credentials.host
  const hostMatches = typeof host === 'string' && host.length <= 253 &&
    host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) &&
    host.split('.')[0].toLowerCase() === expectedDatabaseId && host.toLowerCase().endsWith('.hanacloud.ondemand.com')
  // The claimed database_id cannot override an inconsistent endpoint. Always
  // require the actual destination host to identify the approved SAP database.
  if (!hostMatches || (id !== undefined && id !== expectedDatabaseId)) {
    fail('Expected binding does not identify the approved HANA database.', 'BINDING_MISMATCH')
  }
  return { binding, databaseId: expectedDatabaseId, service: expectedService }
}

async function connectHanaForImport({ root, binding } = {}) {
  if (process.env.NODE_ENV !== 'production' || process.env.ASSET_SEED_DEMO !== 'false') fail('Import requires production mode with demo seeding disabled.', 'INVALID_DATABASE')
  cds.root = path.resolve(root || process.cwd())
  await cds.plugins
  const csnPath = path.join(cds.root, 'srv', 'csn.json')
  const model = await cds.load(fs.existsSync(csnPath) ? csnPath : path.join(cds.root, 'db', 'schema.cds'))
  // Select the validated binding explicitly rather than allowing CAP to pick
  // the first HANA service when an application has multiple bindings.
  return cds.connect.to({ kind: 'hana', model, credentials: binding.credentials, silent: true })
}

module.exports = {
  FORMAT, VERSION, EXPECTED_DATABASE_ID, EXPECTED_SERVICE, ENTITIES, SnapshotError,
  createSnapshot, validateSnapshot, exportSnapshot, importSnapshot, exportSqliteSnapshot,
  writeSnapshot, assertHanaBinding, connectHanaForImport
}

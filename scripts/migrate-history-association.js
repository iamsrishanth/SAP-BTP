const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const cds = require('@sap/cds')

const HISTORY_TABLE = 'it_asset_lifecycle_AllocationHistory'
const OLD_COLUMN = 'asset_assetID'
const NEW_COLUMN = 'assetID_assetID'
const EMPLOYEE_TABLE = 'it_asset_lifecycle_Employee'
const EMPLOYEE_AUDIT_COLUMNS = {
  createdAt: 'TIMESTAMP', createdBy: 'NVARCHAR(255)',
  modifiedAt: 'TIMESTAMP', modifiedBy: 'NVARCHAR(255)'
}
const quoteIdentifier = value => `"${String(value).replaceAll('"', '""')}"`
const quoteLiteral = value => `'${String(value).replaceAll("'", "''")}'`

function columnsFor(database, name) {
  return database.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all()
}

function assertExactSchema(database, afterImage) {
  for (const [name, definition] of Object.entries(afterImage.definitions)) {
    if (definition.kind !== 'entity' || definition['@cds.persistence.skip'] || definition['@cds.persistence.exists']) continue
    const physicalName = definition['@cds.persistence.name'] || name.replaceAll('.', '_')
    const actual = new Set(columnsFor(database, physicalName).map(column => column.name.toLowerCase()))
    const expected = new Set(Object.entries(definition.elements || {})
      .filter(([, element]) => !element.virtual && !['cds.Association', 'cds.Composition'].includes(element.type))
      .map(([elementName, element]) => (element['@cds.persistence.name'] || elementName).toLowerCase()))
    if (actual.size !== expected.size || [...expected].some(column => !actual.has(column))) {
      throw new Error(`Refusing to baseline ${physicalName}: its persisted columns do not match the current CDS model. The transaction was rolled back; inspect the backup before applying other schema changes.`)
    }
  }
}

/** Local SQLite-only migration. Never connects to HANA or modifies business rows. */
async function migrateHistoryAssociation({ databasePath, backupDirectory, model } = {}) {
  if (!databasePath) {
    if (cds.env.requires.db?.kind !== 'sqlite') throw new Error('This migration supports local SQLite only.')
    databasePath = cds.env.requires.db.credentials?.url || 'db.sqlite'
  }
  if (databasePath === ':memory:') return { migrated: false, reason: 'in-memory database' }
  const resolvedPath = path.resolve(cds.root, databasePath)
  if (!fs.existsSync(resolvedPath)) return { migrated: false, reason: 'database does not exist yet' }
  const { DatabaseSync } = require('node:sqlite')
  const database = new DatabaseSync(resolvedPath)
  let transactionOpen = false
  try {
    database.exec('PRAGMA busy_timeout = 5000')
    const historyColumns = columnsFor(database, HISTORY_TABLE)
    if (!historyColumns.length) {
      const businessTables = database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'it_asset_lifecycle_%'").all()
      if (businessTables.length) throw new Error('The local database has an incomplete asset schema; migration cannot safely proceed.')
      return { migrated: false, reason: 'no asset schema exists yet' }
    }
    const names = new Set(historyColumns.map(column => column.name.toLowerCase()))
    const hasOld = names.has(OLD_COLUMN.toLowerCase())
    const hasNew = names.has(NEW_COLUMN.toLowerCase())
    if (hasOld === hasNew) throw new Error('Expected exactly one recognized history association column; refusing an ambiguous migration.')
    const baselineExists = database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='cds_model'").get()
    const employeeColumnNames = new Set(columnsFor(database, EMPLOYEE_TABLE).map(column => column.name.toLowerCase()))
    const missingAuditColumns = Object.keys(EMPLOYEE_AUDIT_COLUMNS).filter(name => !employeeColumnNames.has(name.toLowerCase()))
    if (hasNew && baselineExists && !missingAuditColumns.length) return { migrated: false, reason: 'association, employee audit fields and schema baseline are already migrated' }

    await cds.plugins
    const currentModel = model || cds.minify(await cds.load('*'))
    const { afterImage } = cds.compile.to.sql.delta(currentModel, { dialect: 'sqlite' })
    const destination = path.resolve(backupDirectory || path.join(cds.root, 'db-backups'))
    fs.mkdirSync(destination, { recursive: true })
    const backupPath = path.join(destination, `${path.basename(resolvedPath)}.before-history-association.${Date.now()}.${randomUUID()}.sqlite`)
    // SQLite creates a consistent snapshot including committed WAL contents.
    database.exec(`VACUUM INTO ${quoteLiteral(backupPath)}`)
    database.exec('BEGIN IMMEDIATE')
    transactionOpen = true
    if (hasOld) database.exec(`ALTER TABLE ${quoteIdentifier(HISTORY_TABLE)} RENAME COLUMN ${quoteIdentifier(OLD_COLUMN)} TO ${quoteIdentifier(NEW_COLUMN)}`)
    // Existing employee mappings predate auditing. Add nullable fields without
    // fabricating an administrator or timestamp for those historical rows.
    for (const name of missingAuditColumns) {
      database.exec(`ALTER TABLE ${quoteIdentifier(EMPLOYEE_TABLE)} ADD COLUMN ${quoteIdentifier(name)} ${EMPLOYEE_AUDIT_COLUMNS[name]}`)
    }
    assertExactSchema(database, afterImage)
    if (!baselineExists) database.exec('CREATE TABLE cds_model (csn CLOB)')
    else database.exec('DELETE FROM cds_model')
    database.prepare('INSERT INTO cds_model (csn) VALUES (?)').run(JSON.stringify(afterImage))
    database.exec('COMMIT')
    transactionOpen = false
    return { migrated: hasOld || missingAuditColumns.length > 0, associationRenamed: hasOld, employeeAuditColumnsAdded: missingAuditColumns, baselineCreated: !baselineExists, backupPath, databasePath: resolvedPath }
  } finally {
    if (transactionOpen) database.exec('ROLLBACK')
    database.close()
  }
}

if (require.main === module) {
  migrateHistoryAssociation()
    .then(result => console.log('History association migration:', JSON.stringify(result)))
    .catch(error => {
      console.error('History association migration failed:', error.message)
      process.exitCode = 1
    })
}

module.exports = { migrateHistoryAssociation }

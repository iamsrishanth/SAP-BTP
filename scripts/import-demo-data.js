#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

function argumentsFor(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    if (!['--input', '--expected-database-id', '--expected-service'].includes(name) || !argv[index + 1] || argv[index + 1].startsWith('--') || options[name]) throw new Error('arguments')
    options[name] = argv[index + 1]
  }
  if (Object.keys(options).length !== 3) throw new Error('arguments')
  return options
}

async function main() {
  let options
  try { options = argumentsFor(process.argv.slice(2)) }
  catch { console.error('Usage: node scripts/import-demo-data.js --input <snapshot.json> --expected-database-id <approved-HANA-ID> --expected-service <approved-HDI-service>'); process.exitCode = 1; return }
  process.env.NODE_ENV = 'production'
  process.env.CDS_ENV = 'production'
  process.env.ASSET_SEED_DEMO = 'false'
  process.env.DEBUG = ''
  const transfer = require('../srv/demo-data-transfer')
  let db
  try {
    const { binding } = transfer.assertHanaBinding({
      vcapServices: process.env.VCAP_SERVICES,
      expectedDatabaseId: options['--expected-database-id'], expectedService: options['--expected-service']
    })
    let snapshot
    try { snapshot = JSON.parse(fs.readFileSync(path.resolve(options['--input']), 'utf8')) }
    catch { throw new transfer.SnapshotError('INVALID_SNAPSHOT', 'Snapshot file must be readable UTF-8 JSON.') }
    transfer.validateSnapshot(snapshot)
    db = await transfer.connectHanaForImport({ root: path.resolve(__dirname, '..'), binding })
    console.log(JSON.stringify(await transfer.importSnapshot(db, snapshot)))
  } catch (error) {
    console.error(error instanceof transfer.SnapshotError ? `${error.code}: ${error.message}` : 'IMPORT_FAILED: Database connection or transaction failed; no import was committed.')
    process.exitCode = 1
  } finally {
    if (db) {
      try { await db.disconnect() }
      catch { console.error('DISCONNECT_FAILED: Database connection cleanup failed.'); process.exitCode = 1 }
    }
  }
}

if (require.main === module) main()

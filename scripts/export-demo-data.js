#!/usr/bin/env node
const path = require('node:path')

function argumentsFor(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    if (!['--output', '--database'].includes(name) || !argv[index + 1] || argv[index + 1].startsWith('--') || options[name]) throw new Error('arguments')
    options[name] = argv[index + 1]
  }
  if (!options['--output']) throw new Error('arguments')
  return options
}

async function main() {
  let options
  try { options = argumentsFor(process.argv.slice(2)) }
  catch { console.error('Usage: node scripts/export-demo-data.js --output <private-file.json> [--database <persistent.sqlite>]'); process.exitCode = 1; return }
  process.env.ASSET_SEED_DEMO = 'false'
  process.env.DEBUG = ''
  const cds = require('@sap/cds')
  const transfer = require('../srv/demo-data-transfer')
  const root = path.resolve(__dirname, '..')
  cds.root = root
  try {
    if (cds.env.requires.db?.kind !== 'sqlite') throw new transfer.SnapshotError('INVALID_DATABASE', 'Export requires the local SQLite profile.')
    const configured = options['--database'] || cds.env.requires.db.credentials?.url
    if (!configured) throw new transfer.SnapshotError('INVALID_DATABASE', 'A persistent SQLite database must be specified.')
    const snapshot = transfer.exportSqliteSnapshot(path.resolve(root, configured))
    const result = transfer.writeSnapshot(snapshot, options['--output'], { projectRoot: root })
    console.log(JSON.stringify({ status: 'exported', businessDate: snapshot.businessDate, timeZone: snapshot.timeZone, ...result }))
  } catch (error) {
    console.error(error instanceof transfer.SnapshotError ? `${error.code}: ${error.message}` : 'EXPORT_FAILED: Unable to read the persistent database or create the private snapshot file.')
    process.exitCode = 1
  }
}

if (require.main === module) main()

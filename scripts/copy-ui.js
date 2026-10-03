const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const source = path.join(projectRoot, 'app')
const destination = path.join(projectRoot, 'gen', 'srv', 'app')

if (!fs.existsSync(path.join(source, 'index.html'))) {
  throw new Error('SAPUI5 app entry point app/index.html was not found.')
}
if (!fs.existsSync(path.join(projectRoot, 'gen', 'srv', 'package.json'))) {
  throw new Error('CAP production output gen/srv is missing. Run cds build --production first.')
}

fs.cpSync(source, destination, { recursive: true, force: true })
const serviceScripts = path.join(projectRoot, 'gen', 'srv', 'scripts')
fs.mkdirSync(serviceScripts, { recursive: true })
fs.copyFileSync(path.join(__dirname, 'import-demo-data.js'), path.join(serviceScripts, 'import-demo-data.js'))
// A snapshot is included only when explicitly exported for this authorized trial
// migration. No startup listener imports it, and no production seed is enabled.
const privateSnapshot = path.join(projectRoot, 'demo-data-private', 'bas-sqlite-snapshot.json')
const targetSnapshotDir = path.join(projectRoot, 'gen', 'srv', 'demo-data-private')
const targetSnapshot = path.join(targetSnapshotDir, 'bas-sqlite-snapshot.json')
if (fs.existsSync(privateSnapshot)) {
  fs.mkdirSync(targetSnapshotDir, { recursive: true })
  fs.copyFileSync(privateSnapshot, targetSnapshot)
} else {
  // Repeated packaging must not retain a prior private snapshot after the
  // explicitly exported source has been removed.
  fs.rmSync(targetSnapshot, { force: true })
}
process.stdout.write(`Copied SAPUI5 assets from ${path.relative(projectRoot, source)} to ${path.relative(projectRoot, destination)}.\n`)

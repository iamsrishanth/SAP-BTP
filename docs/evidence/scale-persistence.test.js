'use strict'

// Executable backend acceptance harness. Uses actual CAP HTTP servers, separate
// OS processes and one disposable file-backed SQLite database. Never db.sqlite.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { fork } = require('node:child_process')
const { createHash } = require('node:crypto')
const projectRoot = path.resolve(__dirname, '../..')
const TODAY = '2026-10-01'
const TOTAL_ASSETS = 1200
const PAGE_SIZE = 50
const ROOT = '/odata/v4/asset-management/'
const logPath = path.join(__dirname, 'scale-persistence-2026-10-01.log')
const reportPath = path.join(__dirname, 'scale-persistence-2026-10-01.json')
const users = {
  admin: ['it.admin', 'demo-admin'],
  alex: ['employee.alex', 'demo-employee'],
  jamie: ['employee.jamie', 'demo-employee']
}

function plusDays(days) {
  const date = new Date(`${TODAY}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function isDisposablePath(value) {
  const resolved = path.resolve(value)
  return resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(path.dirname(resolved)).startsWith('sap-asset-scale-')
}

function audit(row) {
  return { ...row, createdAt: `${TODAY}T00:00:00.000Z`, modifiedAt: `${TODAY}T00:00:00.000Z`, createdBy: 'synthetic-scale-fixture', modifiedBy: 'synthetic-scale-fixture' }
}

async function runServer() {
  const databasePath = process.env.ASSET_SCALE_DATABASE
  assert.ok(databasePath && isDisposablePath(databasePath), 'Server must use a disposable OS temporary database')
  const cds = require('@sap/cds')
  await cds.plugins
  cds.env.requires.db.kind = 'sqlite'
  cds.env.requires.db.credentials = { url: databasePath }
  cds.env.requires.db.schema_evolution = 'auto'
  await cds.deploy('*', { schema_evolution: 'auto' }).to('db')
  let fixture = null
  if (process.env.ASSET_SCALE_INITIAL_SEED === 'true') {
    const { Asset, Employee, AllocationHistory } = cds.entities('it.asset.lifecycle')
    const assets = []
    const histories = []
    const states = ['Available', 'Available', 'Allocated', 'Allocated', 'In Maintenance', 'Retired']
    for (let index = 0; index < TOTAL_ASSETS; index += 1) {
      const group = index % 6
      const assetID = cds.utils.uuid()
      const hardware = index % 2 === 0
      const allocated = states[group] === 'Allocated'
      const userId = group === 2 ? 'employee.alex' : group === 3 ? 'employee.jamie' : null
      const displayName = group === 2 ? 'Alex Morgan' : group === 3 ? 'Jamie Chen' : null
      assets.push(audit({
        assetID, assetName: `SCALE-${hardware ? 'LAPTOP' : 'LICENSE'}-${String(index).padStart(4, '0')}`,
        type: hardware ? 'Hardware' : 'Software', purchaseDate: plusDays(-90), expiryDate: plusDays(90),
        status: states[group], allocatedTo: allocated ? displayName : null, allocatedToUserId: allocated ? userId : null,
        maintenanceReason: group === 4 ? 'Synthetic maintenance fixture' : null,
        retirementReason: group === 5 ? 'Synthetic retirement fixture' : null,
        retiredAt: group === 5 ? `${TODAY}T00:00:00.000Z` : null
      }))
      if (allocated) histories.push(audit({
        allocID: cds.utils.uuid(), assetID_assetID: assetID, employeeName: displayName,
        employeeUserId: userId, assignedDate: plusDays(-10), returnedDate: null
      }))
    }
    await cds.db.run(async tx => {
      await tx.run(cds.ql.INSERT.into(Employee).entries([
        audit({ userId: 'employee.alex', displayName: 'Alex Morgan', active: true }),
        audit({ userId: 'employee.jamie', displayName: 'Jamie Chen', active: true })
      ]))
      await tx.run(cds.ql.INSERT.into(Asset).entries(assets))
      await tx.run(cds.ql.INSERT.into(AllocationHistory).entries(histories))
    })
    fixture = { assets: assets.length, activeHistories: histories.length, alexAssigned: 200, jamieAssigned: 200, foreignAssetID: assets[3].assetID }
  }
  const server = await cds.server({ port: 0 })
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve))
  let stopping = false
  process.on('message', async message => {
    if (message?.command !== 'stop' || stopping) return
    stopping = true
    try {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      await cds.db.disconnect()
      process.exit(0)
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })
  process.send({ ready: true, pid: process.pid, port: server.address().port, fixture, databasePath })
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`
  fs.appendFileSync(logPath, line)
  process.stdout.write(line)
}

function startServer(databasePath, initialSeed, report) {
  return new Promise((resolve, reject) => {
    const child = fork(__filename, ['--server'], {
      cwd: projectRoot,
      env: {
        ...process.env, NODE_ENV: 'development', CDS_ENV: 'development', ASSET_SEED_DEMO: 'false',
        ASSET_FIXED_TODAY: TODAY, ASSET_TIME_ZONE: 'Asia/Kolkata', ASSET_EXPIRY_WARNING_DAYS: '30', ASSET_IDLE_DAYS: '30',
        ASSET_SCALE_DATABASE: databasePath, ASSET_SCALE_INITIAL_SEED: String(initialSeed)
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    report.processes.push({ pid: child.pid, initialSeed, ready: false, closed: false })
    const record = report.processes.at(-1)
    let ready = false
    const timer = setTimeout(() => { child.kill(); reject(new Error('CAP child did not become ready within 30 seconds')) }, 30000)
    child.stdout.on('data', data => fs.appendFileSync(logPath, `[child ${child.pid} stdout] ${data}`))
    child.stderr.on('data', data => fs.appendFileSync(logPath, `[child ${child.pid} stderr] ${data}`))
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      record.closed = true
      record.exitCode = code
      record.signal = signal
      if (!ready) { clearTimeout(timer); reject(new Error(`CAP child exited before ready: ${code}, ${signal}`)) }
    })
    child.on('message', message => {
      if (!message?.ready) return
      ready = true
      clearTimeout(timer)
      Object.assign(record, { ready: true, port: message.port, databasePath: message.databasePath, fixture: message.fixture })
      log(`CAP process ready pid=${child.pid} port=${message.port} initialSeed=${initialSeed}`)
      resolve({ child, record, baseURL: `http://127.0.0.1:${message.port}${ROOT}` })
    })
  })
}

async function stopServer(running) {
  if (!running || running.record.closed) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { running.child.kill(); reject(new Error('CAP child did not close gracefully within 10 seconds')) }, 10000)
    running.child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code !== 0 || signal) return reject(new Error(`CAP child stop failed: ${code}, ${signal}`))
      log(`CAP process fully stopped pid=${running.child.pid} exitCode=${code}`)
      resolve()
    })
    running.child.send({ command: 'stop' })
  })
}

async function request(running, route, { user = 'admin', method = 'GET', payload } = {}) {
  const response = await fetch(running.baseURL + route, {
    method, headers: { Authorization: `Basic ${Buffer.from(users[user].join(':')).toString('base64')}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(15000)
  })
  const raw = await response.text()
  let body
  try { body = JSON.parse(raw) } catch { body = raw }
  return { status: response.status, body }
}

async function pages(running, entity, expected, user = 'admin', filter = '') {
  const seen = new Set()
  let pageCount = 0
  for (let skip = 0; skip < expected; skip += PAGE_SIZE) {
    const response = await request(running, `${entity}?$count=true&$orderby=assetName&$top=${PAGE_SIZE}&$skip=${skip}${filter}`, { user })
    assert.equal(response.status, 200)
    assert.equal(response.body['@odata.count'], expected)
    assert.equal(response.body.value.length, Math.min(PAGE_SIZE, expected - skip))
    for (const asset of response.body.value) {
      assert.ok(!seen.has(asset.assetID), `Duplicate page asset ${asset.assetID}`)
      seen.add(asset.assetID)
      if (user === 'alex') {
        assert.equal(asset.allocatedTo, 'Alex Morgan')
        assert.equal(asset.type, 'Hardware')
        assert.ok(!Object.hasOwn(asset, 'allocatedToUserId'))
      }
      if (filter) { assert.equal(asset.type, 'Hardware'); assert.equal(asset.status, 'Available'); assert.ok(asset.assetName.includes('LAPTOP')) }
    }
    pageCount += 1
  }
  const empty = await request(running, `${entity}?$count=true&$orderby=assetName&$top=${PAGE_SIZE}&$skip=${expected}${filter}`, { user })
  assert.equal(empty.body.value.length, 0)
  assert.equal(empty.body['@odata.count'], expected)
  assert.equal(seen.size, expected)
  return { entity, user, pageSize: PAGE_SIZE, pageCount, count: expected, uniqueAssets: seen.size, duplicateAssets: 0, terminalPageEmpty: true, idSetSHA256: createHash('sha256').update([...seen].sort().join('\n')).digest('hex') }
}

async function main() {
  fs.writeFileSync(logPath, `Backend scale and process-restart persistence acceptance\nBusiness date: ${TODAY}, timezone: Asia/Kolkata\nScope: real CAP HTTP; disposable local SQLite; browser/cloud/HANA not exercised\n`)
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sap-asset-scale-'))
  const databasePath = path.join(tempDirectory, 'isolated.sqlite')
  assert.ok(isDisposablePath(databasePath))
  const report = { status: 'NOT RUN', businessDate: TODAY, timeZone: 'Asia/Kolkata', node: process.version, fixtureAssets: TOTAL_ASSETS, processes: [], checks: [], limitations: ['Backend HTTP paging verified; browser pagination not exercised.', 'SQLite process persistence verified; cloud HANA persistence and authentication not exercised.'] }
  let running
  const started = Date.now()
  try {
    running = await startServer(databasePath, true, report)
    assert.equal(running.record.fixture.assets, TOTAL_ASSETS)
    assert.equal((await request(running, 'sessionInfo()')).body.businessToday, TODAY)
    assert.equal(Number((await request(running, 'Assets/$count')).body), TOTAL_ASSETS)
    report.checks.push({ name: 'inventory paging at scale', status: 'PASS', ...await pages(running, 'Assets', TOTAL_ASSETS) })
    log('PASS inventory: 1200 assets, 24 pages of 50, accurate count, no duplicate IDs, empty terminal page')
    const combined = `&$search=LAPTOP&$filter=${encodeURIComponent("type eq 'Hardware' and status eq 'Available'")}`
    report.checks.push({ name: 'combined search/type/status filtering', status: 'PASS', ...await pages(running, 'Assets', 200, 'admin', combined) })
    log('PASS combined filter: Hardware + Available + LAPTOP search produces exactly 200 assets, 4 pages')
    report.checks.push({ name: 'employee scoped paging at scale', status: 'PASS', ...await pages(running, 'MyAssets', 200, 'alex') })
    const widened = await request(running, `MyAssets?$count=true&$filter=${encodeURIComponent("allocatedTo eq 'Jamie Chen'")}`, { user: 'alex' })
    assert.equal(widened.body.value.length, 0)
    assert.equal(widened.body['@odata.count'], 0)
    assert.equal((await request(running, `MyAssets(${running.record.fixture.foreignAssetID})`, { user: 'alex' })).status, 404)
    assert.equal((await request(running, 'Assets?$top=50', { user: 'alex' })).status, 403)
    report.checks.push({ name: 'identity widening and foreign key denied at scale', status: 'PASS', widenedCount: 0, foreignKeyStatus: 404, inventoryStatus: 403 })
    log('PASS employee scope: 200 own assets in 4 pages; foreign key404, broad foreign filter0, inventory403')
    const registration = await request(running, 'Assets', { method: 'POST', payload: { assetName: 'PERSIST-AFTER-FULL-RESTART', type: 'Hardware', purchaseDate: plusDays(-5) } })
    assert.equal(registration.status, 201)
    const assetID = registration.body.assetID
    const allocation = await request(running, 'allocateAsset', { method: 'POST', payload: { assetID, employeeUserId: 'employee.alex' } })
    assert.equal(allocation.status, 200)
    assert.equal(allocation.body.status, 'Allocated')
    const historyRoute = `AllocationHistories?$filter=${encodeURIComponent(`assetID_assetID eq ${assetID}`)}&$top=50`
    const beforeHistory = (await request(running, historyRoute)).body.value
    assert.equal(beforeHistory.length, 1)
    assert.equal(beforeHistory[0].returnedDate, null)
    assert.equal(beforeHistory[0].assignedDate, TODAY)
    const allocID = beforeHistory[0].allocID
    await stopServer(running)
    running = undefined
    assert.ok(fs.statSync(databasePath).size > 0)
    report.sqliteAfterAllocation = { bytes: fs.statSync(databasePath).size, sha256: createHash('sha256').update(fs.readFileSync(databasePath)).digest('hex') }

    running = await startServer(databasePath, false, report)
    assert.notEqual(report.processes[0].pid, running.record.pid)
    const persisted = await request(running, `Assets(${assetID})`)
    assert.equal(persisted.status, 200)
    assert.equal(persisted.body.status, 'Allocated')
    assert.equal(persisted.body.allocatedToUserId, 'employee.alex')
    assert.equal(persisted.body.allocatedTo, 'Alex Morgan')
    assert.equal(Number((await request(running, 'Assets/$count')).body), TOTAL_ASSETS + 1)
    const afterHistory = (await request(running, historyRoute)).body.value
    assert.equal(afterHistory.length, 1)
    assert.equal(afterHistory[0].allocID, allocID)
    assert.equal(afterHistory[0].returnedDate, null)
    assert.equal((await request(running, `MyAssets(${assetID})`, { user: 'alex' })).status, 200)
    assert.equal(Number((await request(running, 'MyAssets/$count', { user: 'alex' })).body), 201)
    report.checks.push({ name: 'allocation and history persist after full process restart', status: 'PASS', assetID, allocID, allocatedToUserId: 'employee.alex', assignedDate: TODAY, historyRows: 1, inventoryCount: 1201, employeeCount: 201 })
    log(`PASS persisted allocation after full process restart: asset=${assetID} history=${allocID}`)
    const returned = await request(running, 'returnAsset', { method: 'POST', payload: { assetID } })
    assert.equal(returned.status, 200)
    assert.equal(returned.body.status, 'Available')
    await stopServer(running)
    running = undefined

    running = await startServer(databasePath, false, report)
    const finalAsset = (await request(running, `Assets(${assetID})`)).body
    assert.equal(finalAsset.status, 'Available')
    assert.equal(finalAsset.allocatedTo, null)
    assert.equal(finalAsset.allocatedToUserId, null)
    const finalHistory = (await request(running, historyRoute)).body.value
    assert.equal(finalHistory.length, 1)
    assert.equal(finalHistory[0].allocID, allocID)
    assert.equal(finalHistory[0].returnedDate, TODAY)
    assert.equal((await request(running, `MyAssets(${assetID})`, { user: 'alex' })).status, 404)
    report.checks.push({ name: 'return and immutable prior history persist after another full restart', status: 'PASS', assetID, allocID, statusAfterRestart: 'Available', returnedDate: TODAY, formerEmployeeReadStatus: 404 })
    log('PASS persisted return after second full restart: Available, assignment cleared, same history record closed, former employee404')
    await stopServer(running)
    running = undefined
    assert.ok(report.processes.every(record => record.closed && record.exitCode === 0))
    report.status = 'PASS'
  } catch (error) {
    report.status = 'FAIL'
    report.error = { message: error.message, stack: error.stack }
    log(`FAIL ${error.stack}`)
    process.exitCode = 1
  } finally {
    try { await stopServer(running) } catch (error) { report.cleanupError = error.message; report.status = 'FAIL'; process.exitCode = 1 }
    assert.ok(isDisposablePath(databasePath), 'Unsafe fixture cleanup path')
    fs.rmSync(tempDirectory, { recursive: true, force: true })
    report.fixtureRemoved = !fs.existsSync(tempDirectory)
    report.durationMilliseconds = Date.now() - started
    report.recordedAtUTC = new Date().toISOString()
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
    log(`RESULT ${report.status}; ${report.checks.length} checks; ${report.processes.length} CAP processes; fixtureRemoved=${report.fixtureRemoved}; duration=${report.durationMilliseconds}ms`)
  }
}

if (process.argv.includes('--server')) runServer().catch(error => { console.error(error); process.exit(1) })
else main().catch(error => { console.error(error); process.exitCode = 1 })

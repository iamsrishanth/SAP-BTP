// These values make compliance cases reproducible on every run and machine.
process.env.ASSET_FIXED_TODAY = '2026-09-28'
process.env.ASSET_TIME_ZONE = 'Asia/Kolkata'
process.env.ASSET_EXPIRY_WARNING_DAYS = '30'
process.env.ASSET_IDLE_DAYS = '30'
process.env.ASSET_SEED_DEMO = 'true'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const cds = require('@sap/cds')
// The normal application profile uses persistent db.sqlite. Force a fresh
// in-memory SQLite database for the test server so CAP deploys its schema
// without touching the developer's local database.
const http = cds.test('serve', 'all', '--in-memory')
const { GET, POST, PUT, PATCH, DELETE } = http

const ROOT = '/odata/v4/asset-management/'
const TODAY = '2026-09-28'
const USERS = {
  admin: { username: 'it.admin', password: 'demo-admin' },
  alex: { username: 'employee.alex', password: 'demo-employee' },
  jamie: { username: 'employee.jamie', password: 'demo-employee' },
  compliance: { username: 'compliance.manager', password: 'demo-compliance' }
}
// Schema snapshot from initial project commit 5a02795: old association name,
// and no audit fields on Employee. The fixture must not derive from new DDL.
const LEGACY_SCHEMA = `
namespace it.asset.lifecycle;
using { managed } from '@sap/cds/common';
entity Asset : managed {
  key assetID : UUID;
  assetName : String(200) not null;
  type : String(20) not null;
  purchaseDate : Date not null;
  expiryDate : Date;
  status : String(30) not null default 'Available';
  allocatedTo : String(200);
  allocatedToUserId : String(255);
  maintenanceReason : String(500);
  retiredAt : Timestamp;
  retirementReason : String(500);
}
entity AllocationHistory : managed {
  key allocID : UUID;
  asset : Association to Asset not null;
  employeeName : String(200) not null;
  employeeUserId : String(255) not null;
  assignedDate : Date not null;
  returnedDate : Date;
}
entity Employee {
  key userId : String(255);
  displayName : String(200) not null;
  active : Boolean not null default true;
}
`
let fixtureNumber = 0

function options(user) {
  return { auth: user, validateStatus: () => true }
}

function noAuthOptions() {
  return { validateStatus: () => true }
}

function plusDays(days) {
  const date = new Date(`${TODAY}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function body(response) {
  return response?.data?.value ?? response?.data
}

function rows(response) {
  const value = body(response)
  return Array.isArray(value) ? value : []
}

function uniqueName(prefix = 'TEST') {
  fixtureNumber += 1
  return `${prefix}-${Date.now()}-${fixtureNumber}`
}

async function createAsset({
  name = uniqueName(), type = 'Hardware', purchaseDate = plusDays(-60), expiryDate
} = {}) {
  const payload = { assetName: name, type, purchaseDate }
  if (expiryDate !== undefined) payload.expiryDate = expiryDate
  const response = await POST(`${ROOT}Assets`, payload, options(USERS.admin))
  assert.equal(response.status, 201, `Asset creation failed: ${JSON.stringify(response.data)}`)
  assert.ok(body(response)?.assetID, 'CAP should return the generated assetID')
  return body(response)
}

async function compliance(user = USERS.compliance) {
  const response = await GET(`${ROOT}complianceAlerts()`, options(user))
  assert.equal(response.status, 200, `Compliance read failed: ${JSON.stringify(response.data)}`)
  return body(response)
}

async function historyFor(assetID) {
  const response = await GET(`${ROOT}AllocationHistories?$top=1000`, options(USERS.admin))
  assert.equal(response.status, 200, `History read failed: ${JSON.stringify(response.data)}`)
  return rows(response).filter(row => row.assetID_assetID === assetID)
}

async function allocate(assetID, employeeUserId = 'employee.alex', user = USERS.admin) {
  return POST(`${ROOT}allocateAsset`, { assetID, employeeUserId }, options(user))
}

async function returnAsset(assetID, user = USERS.admin) {
  return POST(`${ROOT}returnAsset`, { assetID }, options(user))
}

describe('Asset Management CAP service', function () {
  this.timeout(30000)

  it('reports authenticated principal IDs and restricts each role at the API boundary', async function () {
    const alex = body(await GET(`${ROOT}sessionInfo()`, options(USERS.alex)))
    assert.equal(alex.userId, 'employee.alex')
    assert.deepEqual(alex.roles, ['Employee'])
    assert.equal(alex.businessToday, TODAY)
    assert.equal(alex.timeZone, 'Asia/Kolkata')

    const admin = body(await GET(`${ROOT}sessionInfo()`, options(USERS.admin)))
    assert.equal(admin.userId, 'it.admin')
    assert.ok(admin.roles.includes('ITAdmin'))

    const inventoryForEmployee = await GET(`${ROOT}Assets?$top=1`, options(USERS.alex))
    assert.equal(inventoryForEmployee.status, 403)
    const inventoryForCompliance = await GET(`${ROOT}Assets?$top=1`, options(USERS.compliance))
    assert.equal(inventoryForCompliance.status, 403)
    const historyForEmployee = await GET(`${ROOT}AllocationHistories?$top=1`, options(USERS.alex))
    assert.equal(historyForEmployee.status, 403)
    const employeesForCompliance = await GET(`${ROOT}Employees?$top=1`, options(USERS.compliance))
    assert.equal(employeesForCompliance.status, 403)
    const complianceForEmployee = await GET(`${ROOT}complianceAlerts()`, options(USERS.alex))
    assert.equal(complianceForEmployee.status, 403)
    const unauthenticated = await GET(`${ROOT}Assets?$top=1`, noAuthOptions())
    assert.equal(unauthenticated.status, 401)

    const employees = await GET(`${ROOT}Employees?$filter=active eq true`, options(USERS.admin))
    assert.equal(employees.status, 200)
    assert.ok(rows(employees).some(employee => employee.userId === 'employee.alex'))
    assert.ok(rows(employees).some(employee => employee.userId === 'employee.jamie'))

    const protectedAsset = await createAsset({ name: uniqueName('ROLE-GUARD') })
    const employeeWrite = await allocate(protectedAsset.assetID, 'employee.jamie', USERS.alex)
    assert.equal(employeeWrite.status, 403)
    const unchanged = await GET(`${ROOT}Assets(${protectedAsset.assetID})`, options(USERS.admin))
    assert.equal(body(unchanged).status, 'Available')
  })

  it('enforces employee identity server-side even when a client submits a broader filter', async function () {
    const alexResponse = await GET(`${ROOT}MyAssets?$top=100`, options(USERS.alex))
    const jamieResponse = await GET(`${ROOT}MyAssets?$top=100`, options(USERS.jamie))
    assert.equal(alexResponse.status, 200)
    assert.equal(jamieResponse.status, 200)
    const alexAssets = rows(alexResponse)
    const jamieAssets = rows(jamieResponse)
    assert.ok(alexAssets.some(asset => asset.assetName === 'DEMO-Allocated-Laptop-Alex'))
    assert.ok(jamieAssets.some(asset => asset.assetName === 'DEMO-Allocated-Software-Jamie'))
    assert.ok(alexAssets.every(asset => asset.assetName !== 'DEMO-Allocated-Software-Jamie'))
    assert.ok(jamieAssets.every(asset => asset.assetName !== 'DEMO-Allocated-Laptop-Alex'))
    assert.ok(alexAssets.every(asset => !Object.hasOwn(asset, 'allocatedToUserId')))

    const widened = await GET(
      `${ROOT}MyAssets?$filter=${encodeURIComponent("allocatedTo eq 'Jamie Chen'")}`,
      options(USERS.alex)
    )
    assert.equal(widened.status, 200)
    assert.ok(rows(widened).every(asset => asset.assetName !== 'DEMO-Allocated-Software-Jamie'))
  })

  it('preserves employee key predicates, selected fields and accurate scoped counts', async function () {
    const initial = rows(await GET(`${ROOT}MyAssets`, options(USERS.alex)))
    const foreign = rows(await GET(`${ROOT}MyAssets`, options(USERS.jamie)))[0]
    const extra = await createAsset({ name: uniqueName('MY-ASSETS-KEY') })
    assert.equal((await allocate(extra.assetID)).status, 200)
    const ownKey = await GET(`${ROOT}MyAssets(${extra.assetID})`, options(USERS.alex))
    assert.equal(ownKey.status, 200)
    assert.equal(body(ownKey).assetID, extra.assetID)
    for (const id of [foreign.assetID, '00000000-0000-4000-8000-000000000001']) {
      assert.equal((await GET(`${ROOT}MyAssets(${id})`, options(USERS.alex))).status, 404)
    }
    const count = await GET(`${ROOT}MyAssets/$count`, options(USERS.alex))
    assert.equal(count.status, 200)
    assert.equal(Number(count.data), initial.length + 1)
    const paged = await GET(`${ROOT}MyAssets?$count=true&$top=1&$skip=1`, options(USERS.alex))
    assert.equal(paged.status, 200)
    assert.equal(paged.data['@odata.count'], initial.length + 1)
    assert.equal(rows(paged).length, 1)
    const selected = await GET(`${ROOT}MyAssets?$select=assetName`, options(USERS.alex))
    assert.equal(selected.status, 200)
    assert.ok(rows(selected).every(row => Object.keys(row).every(key => ['assetID', 'assetName'].includes(key))))
    assert.equal((await returnAsset(extra.assetID)).status, 200)
  })

  it('provisions exact trusted subject mappings with authenticated administrator auditing', async function () {
    const subject = `employee.MixedCase-${Date.now()}@Example.com`
    const provisioned = await POST(`${ROOT}provisionEmployee`, { userId: ` ${subject} `, displayName: ' New Employee ' }, options(USERS.admin))
    assert.equal(provisioned.status, 200)
    const { '@odata.context': context, ...mapping } = body(provisioned)
    assert.equal(context, '$metadata#Employees/$entity')
    assert.deepEqual(mapping, { userId: subject, displayName: 'New Employee', active: true })
    const { Employee } = cds.entities('it.asset.lifecycle')
    const stored = await cds.db.run(cds.ql.SELECT.one.from(Employee).where({ userId: subject }))
    assert.equal(stored.createdBy, 'it.admin')
    assert.equal(stored.modifiedBy, 'it.admin')
    assert.ok(stored.createdAt)
    assert.ok(stored.modifiedAt)
    const caseVariant = subject.toLowerCase()
    assert.equal((await POST(`${ROOT}provisionEmployee`, { userId: caseVariant, displayName: 'Case Distinct' }, options(USERS.admin))).status, 200)
    const asset = await createAsset({ name: uniqueName('PROVISIONED-ASSIGNEE') })
    assert.equal((await allocate(asset.assetID, subject)).status, 200)
    const allocated = body(await GET(`${ROOT}Assets(${asset.assetID})`, options(USERS.admin)))
    assert.equal(allocated.allocatedToUserId, subject)
    assert.equal(allocated.allocatedTo, 'New Employee')
    const mappingRead = body(await GET(`${ROOT}Employees('${encodeURIComponent(subject)}')`, options(USERS.admin)))
    assert.deepEqual(Object.keys(mappingRead).filter(key => !key.startsWith('@')).sort(), ['active', 'displayName', 'userId'])
    // Development mocked auth can create a role-less principal for an unknown
    // username. A persisted mapping must not promote that principal's roles.
    const mappedPrincipal = { username: subject, password: 'development-only' }
    const mappingSession = body(await GET(`${ROOT}sessionInfo()`, options(mappedPrincipal)))
    assert.equal(mappingSession.userId, subject)
    assert.deepEqual(mappingSession.roles, [])
    assert.equal((await GET(`${ROOT}MyAssets`, options(mappedPrincipal))).status, 403)
    assert.equal((await GET(`${ROOT}Assets`, options(mappedPrincipal))).status, 403)
    assert.ok(!Object.hasOwn(stored, 'password'))
  })

  it('rejects invalid, duplicate and non-admin employee provisioning without mutable mappings', async function () {
    const valid = { userId: uniqueName('PROVISION-DENIED'), displayName: 'New Employee' }
    for (const user of [USERS.alex, USERS.compliance]) {
      assert.equal((await POST(`${ROOT}provisionEmployee`, valid, options(user))).status, 403)
      assert.equal((await POST(`${ROOT}Employees`, valid, options(user))).status, 403)
    }
    for (const payload of [
      {}, { userId: ' ', displayName: 'New Employee' }, { userId: 'employee.new', displayName: ' ' },
      { userId: 'x'.repeat(256), displayName: 'New Employee' }, { userId: 'employee.new', displayName: 'x'.repeat(201) },
      { userId: 'employee.new\n', displayName: 'New Employee' }, { userId: 'employee.\u0000new', displayName: 'New Employee' },
      { userId: 'employee.new', displayName: 'New\tEmployee' }, { userId: 'employee.new\u202E', displayName: 'New Employee' }
    ]) assert.equal((await POST(`${ROOT}provisionEmployee`, payload, options(USERS.admin))).status, 400)
    for (const userId of ['employee.alex', 'employee.inactive']) {
      const duplicate = await POST(`${ROOT}provisionEmployee`, { userId, displayName: 'Forged Rename' }, options(USERS.admin))
      assert.equal(duplicate.status, 409)
      assert.equal(duplicate.data.error.code, 'EMPLOYEE_ALREADY_EXISTS')
    }
    const inactive = body(await GET(`${ROOT}Employees('employee.inactive')`, options(USERS.admin)))
    assert.equal(inactive.active, false)
    assert.equal(inactive.displayName, 'Inactive Employee')
    assert.equal((await POST(`${ROOT}Employees`, valid, options(USERS.admin))).status, 403)
    assert.equal((await PATCH(`${ROOT}Employees('employee.alex')`, { displayName: 'Forged Rename' }, options(USERS.admin))).status, 403)
    assert.equal((await DELETE(`${ROOT}Employees('employee.alex')`, options(USERS.admin))).status, 403)
  })

  it('allows one concurrent mapping insert without duplicate or overwritten identity records', async function () {
    const userId = uniqueName('PROVISION-CONCURRENT')
    const responses = await Promise.all(['First Snapshot', 'Second Snapshot'].map(displayName => POST(`${ROOT}provisionEmployee`, { userId, displayName }, options(USERS.admin))))
    assert.equal(responses.filter(response => response.status === 200).length, 1)
    assert.equal(responses.filter(response => response.status === 409).length, 1)
    const { Employee } = cds.entities('it.asset.lifecycle')
    const persisted = await cds.db.run(cds.ql.SELECT.from(Employee).where({ userId }))
    assert.equal(persisted.length, 1)
    assert.equal(persisted[0].displayName, body(responses.find(response => response.status === 200)).displayName)
    assert.equal(persisted[0].createdBy, 'it.admin')
  })

  it('registers, reads, edits, and safely deletes only an unassigned asset without history', async function () {
    const created = await createAsset({ name: uniqueName('CRUD'), type: 'Hardware' })
    const id = created.assetID
    const read = await GET(`${ROOT}Assets(${id})`, options(USERS.admin))
    assert.equal(read.status, 200)
    assert.equal(body(read).status, 'Available')
    assert.equal(body(read).allocatedTo, null)

    const patch = await PATCH(`${ROOT}Assets(${id})`, { assetName: `${created.assetName}-renamed` }, options(USERS.admin))
    assert.equal(patch.status, 200)
    assert.equal(body(patch).assetName, `${created.assetName}-renamed`)

    const forbiddenLifecyclePatch = await PATCH(`${ROOT}Assets(${id})`, { status: 'Allocated' }, options(USERS.admin))
    assert.equal(forbiddenLifecyclePatch.status, 400)
    const forbiddenUpsert = await PUT(`${ROOT}Assets(${id})`, {
      assetID: id,
      assetName: 'FORGED-UPsert',
      type: 'Software',
      purchaseDate: plusDays(-10),
      expiryDate: plusDays(10),
      status: 'Allocated',
      allocatedTo: 'Alex Morgan',
      allocatedToUserId: 'employee.alex'
    }, options(USERS.admin))
    assert.ok(forbiddenUpsert.status >= 400 && forbiddenUpsert.status < 500)
    const stored = await GET(`${ROOT}Assets(${id})`, options(USERS.admin))
    assert.equal(body(stored).status, 'Available')
    assert.equal(body(stored).assetName, `${created.assetName}-renamed`)

    const deleted = await DELETE(`${ROOT}Assets(${id})`, options(USERS.admin))
    assert.ok(deleted.status === 200 || deleted.status === 204, `Delete failed: ${JSON.stringify(deleted.data)}`)
    const missing = await GET(`${ROOT}Assets(${id})`, options(USERS.admin))
    assert.equal(missing.status, 404)
  })

  it('rejects invalid registration fields, types, dates, and missing software expiry', async function () {
    const badStatus = await POST(`${ROOT}Assets`, {
      assetName: uniqueName('BAD-STATUS'), type: 'Hardware', purchaseDate: plusDays(-5), status: 'Allocated'
    }, options(USERS.admin))
    assert.equal(badStatus.status, 400)

    const badIdentity = await POST(`${ROOT}Assets`, {
      assetName: uniqueName('BAD-IDENTITY'), type: 'Hardware', purchaseDate: plusDays(-5), allocatedToUserId: 'employee.alex'
    }, options(USERS.admin))
    assert.equal(badIdentity.status, 400)

    const badType = await POST(`${ROOT}Assets`, {
      assetName: uniqueName('BAD-TYPE'), type: 'Tablet', purchaseDate: plusDays(-5)
    }, options(USERS.admin))
    assert.equal(badType.status, 400)

    const futurePurchase = await POST(`${ROOT}Assets`, {
      assetName: uniqueName('FUTURE-PURCHASE'), type: 'Hardware', purchaseDate: plusDays(1)
    }, options(USERS.admin))
    assert.equal(futurePurchase.status, 400)

    const missingLicenseDate = await POST(`${ROOT}Assets`, {
      assetName: uniqueName('MISSING-LICENSE-DATE'), type: 'Software', purchaseDate: plusDays(-5)
    }, options(USERS.admin))
    assert.equal(missingLicenseDate.status, 400)

    const pastLicenseDate = await POST(`${ROOT}Assets`, {
      assetName: uniqueName('EXPIRY-BEFORE-PURCHASE'), type: 'Software',
      purchaseDate: plusDays(-5), expiryDate: plusDays(-6)
    }, options(USERS.admin))
    assert.equal(pastLicenseDate.status, 400)
  })

  it('rejects absent names, absent purchase dates and invalid calendar dates without creating rows', async function () {
    const before = Number((await GET(`${ROOT}Assets/$count`, options(USERS.admin))).data)
    const badPayloads = [
      { type: 'Hardware', purchaseDate: plusDays(-5) },
      { assetName: ' ', type: 'Hardware', purchaseDate: plusDays(-5) },
      { assetName: uniqueName('NO-PURCHASE-DATE'), type: 'Hardware' },
      ...['2026-02-30', '2026-13-01', '0000-00-00', '2026-9-1'].map(purchaseDate => ({ assetName: uniqueName('BAD-CALENDAR'), type: 'Hardware', purchaseDate }))
    ]
    for (const payload of badPayloads) assert.equal((await POST(`${ROOT}Assets`, payload, options(USERS.admin))).status, 400)
    assert.equal(Number((await GET(`${ROOT}Assets/$count`, options(USERS.admin))).data), before)
  })

  it('rejects nonexistent lifecycle UUIDs, missing arguments and inactive or unknown assignees', async function () {
    const absent = '00000000-0000-4000-8000-000000000002'
    for (const action of ['allocateAsset', 'returnAsset', 'renewSoftwareLicense', 'placeInMaintenance', 'releaseFromMaintenance', 'retireAsset']) {
      const payload = { assetID: absent }
      if (action === 'allocateAsset') payload.employeeUserId = 'employee.alex'
      if (action === 'renewSoftwareLicense') payload.newExpiryDate = plusDays(100)
      if (['placeInMaintenance', 'retireAsset'].includes(action)) payload.reason = 'Test validation'
      assert.equal((await POST(`${ROOT}${action}`, payload, options(USERS.admin))).status, 404, action)
      assert.equal((await POST(`${ROOT}${action}`, {}, options(USERS.admin))).status, 400, `${action} missing arguments`)
    }
    const asset = await createAsset({ name: uniqueName('INVALID-ASSIGNEE') })
    for (const employee of ['employee.unknown', 'employee.inactive', "employee.alex' OR '1'='1"]) {
      assert.equal((await allocate(asset.assetID, employee)).status, 400)
    }
    assert.equal((await historyFor(asset.assetID)).length, 0)
    assert.equal(body(await GET(`${ROOT}Assets(${asset.assetID})`, options(USERS.admin))).status, 'Available')
  })

  it('allocates atomically, records the trusted employee, returns once, and preserves history', async function () {
    const created = await createAsset({ name: uniqueName('ALLOCATE'), type: 'Hardware' })
    const allocation = await allocate(created.assetID)
    assert.equal(allocation.status, 200)
    assert.equal(body(allocation).status, 'Allocated')
    assert.equal(body(allocation).allocatedTo, 'Alex Morgan')

    const history = await historyFor(created.assetID)
    assert.equal(history.length, 1)
    assert.equal(history[0].employeeName, 'Alex Morgan')
    assert.equal(history[0].employeeUserId, 'employee.alex')
    assert.equal(history[0].returnedDate, null)
    assert.equal(history[0].assignedDate, TODAY)
    assert.equal(history[0].assetID_assetID, created.assetID)

    const duplicate = await allocate(created.assetID, 'employee.jamie')
    assert.equal(duplicate.status, 409)
    assert.equal((await historyFor(created.assetID)).length, 1)

    const returned = await returnAsset(created.assetID)
    assert.equal(returned.status, 200)
    assert.equal(body(returned).status, 'Available')
    assert.equal(body(returned).allocatedTo, null)
    assert.equal(body(returned).allocatedToUserId, null)
    const closedHistory = await historyFor(created.assetID)
    assert.equal(closedHistory.length, 1)
    assert.equal(closedHistory[0].returnedDate, TODAY)

    const duplicateReturn = await returnAsset(created.assetID)
    assert.equal(duplicateReturn.status, 409)
    const afterRepeatedReturn = await GET(`${ROOT}Assets(${created.assetID})`, options(USERS.admin))
    assert.equal(body(afterRepeatedReturn).status, 'Available')
    assert.equal((await historyFor(created.assetID)).length, 1)

    const reassigned = await allocate(created.assetID, 'employee.jamie')
    assert.equal(reassigned.status, 200)
    const fullHistory = await historyFor(created.assetID)
    assert.equal(fullHistory.length, 2)
    assert.equal(fullHistory.filter(row => row.returnedDate == null).length, 1)
    assert.equal(fullHistory.find(row => row.employeeUserId === 'employee.alex').returnedDate, TODAY)
  })

  it('allows only one of two concurrent allocation requests to commit', async function () {
    const created = await createAsset({ name: uniqueName('CONCURRENT'), type: 'Hardware' })
    const results = await Promise.all([
      allocate(created.assetID, 'employee.alex'),
      allocate(created.assetID, 'employee.jamie')
    ])
    const successful = results.filter(result => result.status >= 200 && result.status < 300)
    assert.equal(successful.length, 1, `Expected one allocation winner; statuses were ${results.map(r => r.status).join(', ')}`)
    assert.ok(results.some(result => result.status === 409), 'The losing request must receive a conflict')
    const active = (await historyFor(created.assetID)).filter(row => row.returnedDate == null)
    assert.equal(active.length, 1)
    const persisted = await GET(`${ROOT}Assets(${created.assetID})`, options(USERS.admin))
    assert.equal(body(persisted).status, 'Allocated')
  })

  it('rejects missing, duplicate and mismatched active return histories without partial updates', async function () {
    const { AllocationHistory } = cds.entities('it.asset.lifecycle')
    for (const corruption of ['missing', 'duplicate', 'employee-id', 'employee-name']) {
      const asset = await createAsset({ name: uniqueName(`RETURN-${corruption}`) })
      assert.equal((await allocate(asset.assetID)).status, 200)
      const before = body(await GET(`${ROOT}Assets(${asset.assetID})`, options(USERS.admin)))
      const active = await cds.db.run(cds.ql.SELECT.one.from(AllocationHistory).where({ assetID_assetID: asset.assetID, returnedDate: null }))
      // Imported/corrupted-state fixtures are injected only into the isolated test database.
      if (corruption === 'missing') await cds.db.run(cds.ql.DELETE.from(AllocationHistory).where({ allocID: active.allocID }))
      if (corruption === 'duplicate') await cds.db.run(cds.ql.INSERT.into(AllocationHistory).entries({ ...active, allocID: cds.utils.uuid() }))
      if (corruption === 'employee-id') await cds.db.run(cds.ql.UPDATE(AllocationHistory).set({ employeeUserId: 'employee.jamie' }).where({ allocID: active.allocID }))
      if (corruption === 'employee-name') await cds.db.run(cds.ql.UPDATE(AllocationHistory).set({ employeeName: 'Jamie Chen' }).where({ allocID: active.allocID }))
      const returned = await returnAsset(asset.assetID)
      assert.equal(returned.status, 409, corruption)
      assert.equal(returned.data.error.code, 'ALLOCATION_HISTORY_INCONSISTENT', corruption)
      const after = body(await GET(`${ROOT}Assets(${asset.assetID})`, options(USERS.admin)))
      for (const field of ['status', 'allocatedTo', 'allocatedToUserId', 'modifiedAt', 'modifiedBy']) assert.equal(after[field], before[field], `${corruption}: ${field}`)
      const histories = await historyFor(asset.assetID)
      assert.ok(histories.every(history => history.returnedDate === null), corruption)
      assert.equal(histories.length, corruption === 'missing' ? 0 : corruption === 'duplicate' ? 2 : 1)
    }
  })

  it('renews only software, updates compliance immediately, and leaves allocation status separate', async function () {
    const license = await createAsset({
      name: uniqueName('RENEW'), type: 'Software', purchaseDate: plusDays(-100), expiryDate: plusDays(15)
    })
    const renewed = await POST(`${ROOT}renewSoftwareLicense`, {
      assetID: license.assetID, newExpiryDate: plusDays(90)
    }, options(USERS.admin))
    assert.equal(renewed.status, 200)
    assert.equal(body(renewed).expiryDate, plusDays(90))
    assert.equal(body(renewed).status, 'Available')

    const alertSummary = await compliance()
    assert.ok(!alertSummary.expiringLicenses.some(row => row.assetID === license.assetID))
    assert.ok(!alertSummary.expiredLicenses.some(row => row.assetID === license.assetID))

    const expiredAssigned = await createAsset({
      name: uniqueName('EXPIRED-ASSIGNED'), type: 'Software', purchaseDate: plusDays(-100), expiryDate: plusDays(-1)
    })
    assert.equal((await allocate(expiredAssigned.assetID)).status, 200)
    const complianceWithAssignedExpired = await compliance()
    assert.ok(complianceWithAssignedExpired.expiredLicenses.some(row => row.assetID === expiredAssigned.assetID))
    const stillAllocated = await GET(`${ROOT}Assets(${expiredAssigned.assetID})`, options(USERS.admin))
    assert.equal(body(stillAllocated).status, 'Allocated')

    const hardware = await createAsset({ name: uniqueName('WARRANTY'), type: 'Hardware' })
    const wrongRenewal = await POST(`${ROOT}renewSoftwareLicense`, {
      assetID: hardware.assetID, newExpiryDate: plusDays(90)
    }, options(USERS.admin))
    assert.equal(wrongRenewal.status, 400)
    const nonExtending = await POST(`${ROOT}renewSoftwareLicense`, {
      assetID: license.assetID, newExpiryDate: plusDays(30)
    }, options(USERS.admin))
    assert.equal(nonExtending.status, 400)
    const expiryToday = await POST(`${ROOT}renewSoftwareLicense`, {
      assetID: license.assetID, newExpiryDate: TODAY
    }, options(USERS.admin))
    assert.equal(expiryToday.status, 400)
  })

  it('distinguishes expired, expiring, warranty, missing-date, and idle boundary cases', async function () {
    const summary = await compliance()
    assert.equal(summary.businessToday, TODAY)
    assert.equal(summary.expiryWarningDays, 30)
    assert.equal(summary.idleThresholdDays, 30)

    const expired = summary.expiredLicenses.find(row => row.assetName === 'DEMO-Expired-Software-License')
    assert.equal(expired.alertType, 'Expired License')
    assert.equal(expired.daysRemaining, -5)

    for (const name of ['DEMO-License-Expires-Today', 'DEMO-License-Warning-Day-30']) {
      const row = summary.expiringLicenses.find(alert => alert.assetName === name)
      assert.ok(row, `${name} should be in the expiring-soon group`)
      assert.equal(row.alertType, 'License Expiring Soon')
    }
    assert.equal(summary.expiringLicenses.find(row => row.assetName === 'DEMO-License-Expires-Today').daysRemaining, 0)
    assert.equal(summary.expiringLicenses.find(row => row.assetName === 'DEMO-License-Warning-Day-30').daysRemaining, 30)
    assert.ok(!summary.expiringLicenses.some(row => row.assetName === 'DEMO-License-Warning-Day-31'))

    const warranty = summary.hardwareWarrantyAlerts.find(row => row.assetName === 'DEMO-Hardware-Warranty-Expiring')
    assert.equal(warranty.alertType, 'Warranty Expiring Soon')
    assert.equal(warranty.type, 'Hardware')
    assert.ok(!summary.expiredLicenses.some(row => row.assetName === 'DEMO-Retired-Laptop'))

    const expiredHardware = await createAsset({ name: uniqueName('EXPIRED-HARDWARE-WARRANTY'), type: 'Hardware', expiryDate: plusDays(-1) })
    const hardwareSummary = await compliance()
    const hardwareAlert = hardwareSummary.hardwareWarrantyAlerts.find(row => row.assetID === expiredHardware.assetID)
    assert.equal(hardwareAlert.alertType, 'Warranty Expired')
    assert.equal(hardwareAlert.type, 'Hardware')
    assert.equal(hardwareAlert.daysRemaining, -1)
    assert.ok(!hardwareSummary.expiredLicenses.some(row => row.assetID === expiredHardware.assetID))
    assert.ok(!hardwareSummary.expiringLicenses.some(row => row.assetID === expiredHardware.assetID))

    const noSoftwareDate = summary.missingDateAlerts.find(row => row.assetName === 'DEMO-Legacy-License-No-Expiry')
    const noWarrantyDate = summary.missingDateAlerts.find(row => row.assetName === 'DEMO-Hardware-No-Warranty-Date')
    assert.equal(noSoftwareDate.alertType, 'Missing License Expiry')
    assert.equal(noWarrantyDate.alertType, 'Missing Hardware Warranty')
    assert.ok(!Object.hasOwn(noSoftwareDate, 'employeeUserId'))

    const idlePurchaseBaseline = summary.idleAssets.find(row => row.assetName === 'DEMO-Idle-Laptop')
    const idleReturnBaseline = summary.idleAssets.find(row => row.assetName === 'DEMO-Returned-Idle-Monitor')
    assert.equal(idlePurchaseBaseline.daysIdle, 45)
    assert.equal(idlePurchaseBaseline.idleSince, plusDays(-45))
    assert.equal(idleReturnBaseline.daysIdle, 31)
    assert.equal(idleReturnBaseline.idleSince, plusDays(-31))
    assert.ok(!summary.idleAssets.some(row => row.assetName === 'DEMO-Allocated-Laptop-Alex'))
    assert.ok(!summary.idleAssets.some(row => row.assetName === 'DEMO-Maintenance-Workstation'))
    assert.ok(!summary.idleAssets.some(row => row.assetName === 'DEMO-Retired-Laptop'))

    const thirtyDayAsset = await createAsset({ name: uniqueName('IDLE-DAY-30'), purchaseDate: plusDays(-30) })
    const afterExactBoundary = await compliance()
    assert.ok(!afterExactBoundary.idleAssets.some(row => row.assetID === thirtyDayAsset.assetID))
    const thirtyOneDayAsset = await createAsset({ name: uniqueName('IDLE-DAY-31'), purchaseDate: plusDays(-31) })
    const afterOverBoundary = await compliance()
    const idle = afterOverBoundary.idleAssets.find(row => row.assetID === thirtyOneDayAsset.assetID)
    assert.equal(idle.daysIdle, 31)
  })

  it('blocks retirement of allocated assets, preserves history, and forbids allocation after retirement', async function () {
    const created = await createAsset({ name: uniqueName('RETIRE'), type: 'Hardware' })
    assert.equal((await allocate(created.assetID)).status, 200)
    const blocked = await POST(`${ROOT}retireAsset`, {
      assetID: created.assetID, reason: 'Disposed'
    }, options(USERS.admin))
    assert.equal(blocked.status, 409)
    const physicalDeleteBlocked = await DELETE(`${ROOT}Assets(${created.assetID})`, options(USERS.admin))
    assert.equal(physicalDeleteBlocked.status, 409)

    assert.equal((await returnAsset(created.assetID)).status, 200)
    const retired = await POST(`${ROOT}retireAsset`, {
      assetID: created.assetID, reason: 'Beyond repair'
    }, options(USERS.admin))
    assert.equal(retired.status, 200)
    assert.equal(body(retired).status, 'Retired')
    assert.equal(body(retired).retirementReason, 'Beyond repair')
    assert.equal((await historyFor(created.assetID)).length, 1)
    assert.equal((await allocate(created.assetID)).status, 409)
  })

  it('applies controlled maintenance transitions and denies generic history manipulation', async function () {
    const created = await createAsset({ name: uniqueName('MAINTENANCE') })
    const placed = await POST(`${ROOT}placeInMaintenance`, {
      assetID: created.assetID, reason: 'Fan noise'
    }, options(USERS.admin))
    assert.equal(placed.status, 200)
    assert.equal(body(placed).status, 'In Maintenance')
    assert.equal(body(placed).maintenanceReason, 'Fan noise')
    assert.equal((await allocate(created.assetID)).status, 409)

    const released = await POST(`${ROOT}releaseFromMaintenance`, { assetID: created.assetID }, options(USERS.admin))
    assert.equal(released.status, 200)
    assert.equal(body(released).status, 'Available')

    const historyCreate = await POST(`${ROOT}AllocationHistories`, {
      assetID_assetID: created.assetID, employeeName: 'Forged', employeeUserId: 'employee.alex', assignedDate: TODAY
    }, options(USERS.admin))
    assert.ok(historyCreate.status >= 400 && historyCreate.status < 500)
    const allHistory = await GET(`${ROOT}AllocationHistories?$top=1`, options(USERS.admin))
    const sample = rows(allHistory)[0]
    assert.ok(sample)
    const historyPatch = await PATCH(`${ROOT}AllocationHistories(${sample.allocID})`, { returnedDate: TODAY }, options(USERS.admin))
    assert.ok(historyPatch.status >= 400 && historyPatch.status < 500)
    const historyUpsert = await PUT(`${ROOT}AllocationHistories(${sample.allocID})`, {
      ...sample,
      employeeName: 'Forged'
    }, options(USERS.admin))
    assert.ok(historyUpsert.status >= 400 && historyUpsert.status < 500)
    const historyDelete = await DELETE(`${ROOT}AllocationHistories(${sample.allocID})`, options(USERS.admin))
    assert.ok(historyDelete.status >= 400 && historyDelete.status < 500)
  })

  it('never enables demo runtime seeding in a production environment or profile', function () {
    for (const environment of [{ NODE_ENV: 'production' }, { CDS_ENV: 'production' }]) {
      const result = spawnSync(process.execPath, ['-e', "const assert=require('node:assert/strict');assert.equal(require('./db/seed').shouldSeedDemoData(),false)"], {
        cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'development', CDS_ENV: 'development', ASSET_SEED_DEMO: 'true', ...environment }
      })
      assert.equal(result.status, 0, result.stderr)
    }
  })

  it('migrates the required history association idempotently while preserving rows and a backup', async function () {
    const { DatabaseSync } = require('node:sqlite')
    const { migrateHistoryAssociation } = require('../scripts/migrate-history-association')
    const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-history-migration-'))
    const fixturePath = path.join(fixtureDirectory, 'legacy.sqlite')
    let database
    try {
      const model = cds.minify(await cds.load('*'))
      const legacyModel = cds.minify(cds.compile({
        'db/schema.cds': LEGACY_SCHEMA,
        '@sap/cds/common.cds': fs.readFileSync(require.resolve('@sap/cds/common.cds'), 'utf8'),
        'srv/asset-management-service.cds': fs.readFileSync(path.join(__dirname, '../srv/asset-management-service.cds'), 'utf8')
      }))
      legacyModel.definitions['cds.outbox.Messages'] = structuredClone(model.definitions['cds.outbox.Messages'])
      const schema = cds.compile.to.sql(legacyModel, { dialect: 'sqlite' })
      database = new DatabaseSync(fixturePath)
      for (const statement of schema) database.exec(statement)
      assert.deepEqual(database.prepare('PRAGMA table_info(it_asset_lifecycle_Employee)').all().map(column => column.name), ['userId', 'displayName', 'active'])
      database.prepare('INSERT INTO it_asset_lifecycle_Employee (userId,displayName,active) VALUES (?,?,?)').run('employee.alex', 'Alex Morgan', 1)
      const id = cds.utils.uuid()
      const allocationId = cds.utils.uuid()
      database.prepare('INSERT INTO it_asset_lifecycle_Asset (assetID,assetName,type,purchaseDate,status,allocatedTo,allocatedToUserId) VALUES (?,?,?,?,?,?,?)').run(id, 'PRESERVED', 'Hardware', plusDays(-15), 'Allocated', 'Alex Morgan', 'employee.alex')
      database.prepare('INSERT INTO it_asset_lifecycle_AllocationHistory (allocID,asset_assetID,employeeName,employeeUserId,assignedDate,returnedDate) VALUES (?,?,?,?,?,?)').run(allocationId, id, 'Alex Morgan', 'employee.alex', TODAY, null)
      database.close()
      database = undefined
      const migrated = await migrateHistoryAssociation({ databasePath: fixturePath, backupDirectory: path.join(fixtureDirectory, 'backups'), model })
      assert.equal(migrated.migrated, true)
      assert.equal(migrated.associationRenamed, true)
      assert.equal(migrated.employeeAuditColumnsAdded.length, 4)
      assert.ok(fs.existsSync(migrated.backupPath))
      database = new DatabaseSync(fixturePath)
      const history = database.prepare('SELECT * FROM it_asset_lifecycle_AllocationHistory').all()
      assert.equal(history.length, 1)
      assert.equal(history[0].allocID, allocationId)
      assert.equal(history[0].assetID_assetID, id)
      assert.equal(history[0].employeeUserId, 'employee.alex')
      assert.equal(history[0].returnedDate, null)
      assert.equal(database.prepare('SELECT assetID FROM it_asset_lifecycle_Asset').get().assetID, id)
      const preservedEmployee = database.prepare('SELECT * FROM it_asset_lifecycle_Employee').get()
      assert.equal(preservedEmployee.userId, 'employee.alex')
      assert.equal(preservedEmployee.displayName, 'Alex Morgan')
      assert.equal(preservedEmployee.active, 1)
      for (const field of ['createdAt', 'createdBy', 'modifiedAt', 'modifiedBy']) assert.equal(preservedEmployee[field], null)
      const baseline = JSON.parse(database.prepare('SELECT csn FROM cds_model').get().csn)
      const delta = cds.compile.to.sql.delta(model, { dialect: 'sqlite' }, baseline)
      assert.deepEqual(delta.drops, [])
      assert.deepEqual(delta.createsAndAlters, [])
      database.close()
      database = undefined
      const repeated = await migrateHistoryAssociation({ databasePath: fixturePath, backupDirectory: path.join(fixtureDirectory, 'backups'), model })
      assert.equal(repeated.migrated, false)
      assert.equal(fs.readdirSync(path.join(fixtureDirectory, 'backups')).length, 1)
      database = new DatabaseSync(migrated.backupPath, { readOnly: true })
      assert.equal(database.prepare('SELECT asset_assetID FROM it_asset_lifecycle_AllocationHistory').get().asset_assetID, id)
      assert.deepEqual(database.prepare('PRAGMA table_info(it_asset_lifecycle_Employee)').all().map(column => column.name), ['userId', 'displayName', 'active'])
    } finally {
      database?.close()
      if (!fixtureDirectory.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe temporary fixture cleanup path')
      fs.rmSync(fixtureDirectory, { recursive: true, force: true })
    }
  })
})

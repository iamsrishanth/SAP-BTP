// Independent audit harness: never accesses db.sqlite or app port 4004.
process.env.ASSET_FIXED_TODAY = '2026-10-01'
process.env.ASSET_TIME_ZONE = 'Asia/Kolkata'
process.env.ASSET_SEED_DEMO = 'true'
const assert = require('node:assert/strict')
const cds = require('@sap/cds')
const fs = require('node:fs')
const http = cds.test('serve', 'all', '--in-memory')
const { GET, POST, PATCH, PUT, DELETE } = http
const ROOT = '/odata/v4/asset-management/'
const admin = { auth: { username: 'it.admin', password: 'demo-admin' }, validateStatus: () => true }
const alex = { auth: { username: 'employee.alex', password: 'demo-employee' }, validateStatus: () => true }
const compliance = { auth: { username: 'compliance.manager', password: 'demo-compliance' }, validateStatus: () => true }
const body = r => r.data?.value ?? r.data
let fixtures
const observations = []
function observe(name, r) { observations.push({ name, status: r.status, body: r.data }); }
async function create(name, type = 'Hardware') {
  const r = await POST(ROOT + 'Assets', { assetName: name, type, purchaseDate: '2026-09-01', ...(type === 'Software' ? { expiryDate: '2026-11-01' } : {}) }, admin)
  assert.equal(r.status, 201)
  return body(r)
}
describe('Independent adversarial security and lifecycle audit', function () {
  this.timeout(30000)
  before(async () => {
    const r = await GET(ROOT + 'Assets?$top=1000', admin)
    assert.equal(r.status, 200)
    fixtures = Object.fromEntries(body(r).map(a => [a.assetName, a]))
  })
  after(() => { fs.writeFileSync('docs/evidence/audit-security-observations.json', JSON.stringify(observations, null, 2) + '\n') })
  it('employee single key read returns the exact requested own asset', async () => {
    const own = fixtures['DEMO-Allocated-Laptop-Alex']
    const r = await GET(ROOT + `MyAssets(${own.assetID})`, alex)
    console.log('AUDIT own-key', r.status, JSON.stringify(r.data))
    observe('own-key', r)
    assert.equal(r.status, 200)
    assert.equal(body(r).assetID, own.assetID)
  })
  it('employee foreign key and unknown key read return 404', async () => {
    const statuses = []
    for (const id of [fixtures['DEMO-Allocated-Software-Jamie'].assetID, '00000000-0000-4000-8000-000000000001']) {
      const r = await GET(ROOT + `MyAssets(${id})`, alex)
      console.log('AUDIT foreign-or-unknown-key', id, r.status, JSON.stringify(r.data))
      observe('foreign-or-unknown-key:' + id, r)
      statuses.push(r.status)
    }
    assert.deepEqual(statuses, [404, 404])
  })
  it('employee count and paged count remain scoped and accurate', async () => {
    const count = await GET(ROOT + 'MyAssets/$count', alex)
    const paged = await GET(ROOT + 'MyAssets?$count=true&$top=1&$skip=0', alex)
    console.log('AUDIT counts', count.status, JSON.stringify(count.data), paged.status, JSON.stringify(paged.data))
    observe('count', count)
    observe('paged-count', paged)
    assert.equal(count.status, 200)
    assert.equal(Number(count.data), 1)
    assert.equal(paged.data['@odata.count'], 1)
  })
  it('employee detail selects the exact key when the employee has several assignments', async () => {
    const a = await create('AUDIT-ALEX-SECOND-ASSET')
    assert.equal((await POST(ROOT + 'allocateAsset', { assetID: a.assetID, employeeUserId: 'employee.alex' }, admin)).status, 200)
    const r = await GET(ROOT + `MyAssets(${a.assetID})`, alex)
    observe('second-own-key', r)
    assert.equal(r.status, 200)
    assert.equal(body(r).assetID, a.assetID)
    const count = await GET(ROOT + 'MyAssets/$count', alex)
    observe('multiple-own-count', count)
    assert.equal(Number(count.data), 2)
  })
  it('employee cannot navigate or expand into inventory/history private data', async () => {
    const own = fixtures['DEMO-Allocated-Laptop-Alex']
    const history = await GET(ROOT + 'AllocationHistories?$expand=assetID', alex)
    const inventory = await GET(ROOT + `Assets(${own.assetID})/allocatedToUserId`, alex)
    const unknownExpand = await GET(ROOT + 'MyAssets?$expand=assetID', alex)
    assert.equal(history.status, 403)
    assert.equal(inventory.status, 403)
    assert.equal(unknownExpand.status, 400)
    const rows = await GET(ROOT + "MyAssets?$filter=assetName ne 'nothing'&$select=assetName", alex)
    assert.equal(rows.status, 200)
    assert.ok(body(rows).every(row => !('allocatedToUserId' in row) && !('createdBy' in row)))
  })
  it('all employee and compliance writes are rejected', async () => {
    const target = fixtures['DEMO-Available-Monitor']
    for (const role of [alex, compliance]) {
      for (const action of ['allocateAsset', 'returnAsset', 'renewSoftwareLicense', 'placeInMaintenance', 'releaseFromMaintenance', 'retireAsset']) {
        const r = await POST(ROOT + action, { assetID: target.assetID, employeeUserId: 'employee.alex', newExpiryDate: '2027-01-01', reason: 'test' }, role)
        assert.equal(r.status, 403, `${action}: ${r.status}`)
      }
      assert.equal((await POST(ROOT + 'Assets', { assetName: 'FORGED', type: 'Hardware', purchaseDate: '2026-09-01' }, role)).status, 403)
      assert.equal((await PATCH(ROOT + `Assets(${target.assetID})`, { assetName: 'FORGED' }, role)).status, 403)
      assert.equal((await DELETE(ROOT + `Assets(${target.assetID})`, role)).status, 403)
    }
  })
  it('missing resource PUT/PATCH cannot create incomplete inventory or history', async () => {
    const id = '00000000-0000-4000-8000-000000000002'
    for (const mutate of [PUT, PATCH]) {
      const r = await mutate(ROOT + `Assets(${id})`, { assetName: 'FORGED-PARTIAL' }, admin)
      console.log('AUDIT partial-upsert', r.status, JSON.stringify(r.data))
      assert.ok(r.status >= 400 && r.status < 500)
      assert.equal((await GET(ROOT + `Assets(${id})`, admin)).status, 404)
    }
    assert.ok((await PUT(ROOT + `AllocationHistories(${id})`, { employeeName: 'FORGED' }, admin)).status >= 400)
  })
  it('invalid calendar dates and unknown identifiers fail without mutation', async () => {
    for (const purchaseDate of ['2026-02-30', '2026-13-01', '0000-00-00', '2026-9-1']) {
      const r = await POST(ROOT + 'Assets', { assetName: 'BAD-DATE', type: 'Hardware', purchaseDate }, admin)
      assert.equal(r.status, 400)
    }
    assert.equal((await POST(ROOT + 'allocateAsset', { assetID: '00000000-0000-4000-8000-000000000003', employeeUserId: 'employee.alex' }, admin)).status, 404)
    assert.equal((await POST(ROOT + 'allocateAsset', { assetID: fixtures['DEMO-Available-Monitor'].assetID, employeeUserId: 'employee.inactive' }, admin)).status, 400)
  })
  it('missing required registration fields and missing action arguments reject clearly', async () => {
    for (const payload of [{ type: 'Hardware', purchaseDate: '2026-09-01' }, { assetName: 'MISSING-PURCHASE', type: 'Hardware' }, { assetName: ' ', type: 'Hardware', purchaseDate: '2026-09-01' }]) {
      const r = await POST(ROOT + 'Assets', payload, admin)
      observe('missing-fields', r)
      assert.equal(r.status, 400)
    }
    for (const action of ['allocateAsset', 'returnAsset', 'renewSoftwareLicense', 'placeInMaintenance', 'releaseFromMaintenance', 'retireAsset']) {
      const r = await POST(ROOT + action, {}, admin)
      observe('missing-action:' + action, r)
      assert.equal(r.status, 400)
    }
  })
  it('all lifecycle actions reject nonexistent UUID and unknown/inactive assignees', async () => {
    for (const action of ['allocateAsset', 'returnAsset', 'renewSoftwareLicense', 'placeInMaintenance', 'releaseFromMaintenance', 'retireAsset']) {
      const data = { assetID: '00000000-0000-4000-8000-000000000003' }
      if (action === 'allocateAsset') data.employeeUserId = 'employee.alex'
      if (action === 'renewSoftwareLicense') data.newExpiryDate = '2027-01-01'
      if (['placeInMaintenance', 'retireAsset'].includes(action)) data.reason = 'test'
      const r = await POST(ROOT + action, data, admin)
      observe('unknown-action:' + action, r)
      assert.equal(r.status, 404)
    }
    for (const employeeUserId of ['employee.unknown', 'employee.inactive', "employee.alex' OR '1'='1"]) {
      const r = await POST(ROOT + 'allocateAsset', { assetID: fixtures['DEMO-Available-Monitor'].assetID, employeeUserId }, admin)
      observe('invalid-assignee:' + employeeUserId, r)
      assert.equal(r.status, 400)
    }
  })
  it('invalid and absent authentication receive 401', async () => {
    for (const config of [ { validateStatus: () => true }, { auth: { username: 'it.admin', password: 'wrong' }, validateStatus: () => true } ]) {
      assert.equal((await GET(ROOT + 'sessionInfo()', config)).status, 401)
      assert.equal((await GET(ROOT + 'Assets?$top=1', config)).status, 401)
    }
  })
  it('six simultaneous allocations produce one committed active history', async () => {
    const a = await create('AUDIT-CONCURRENT-SIX')
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => POST(ROOT + 'allocateAsset', { assetID: a.assetID, employeeUserId: i % 2 ? 'employee.jamie' : 'employee.alex' }, admin)))
    console.log('AUDIT concurrent-six', results.map(r => r.status).join(','))
    results.forEach((r, i) => observe('concurrent-six:' + i, r))
    assert.equal(results.filter(r => r.status === 200).length, 1)
    assert.equal(results.filter(r => r.status === 409).length, 5)
    const histories = await GET(ROOT + 'AllocationHistories?$filter=' + encodeURIComponent(`assetID_assetID eq ${a.assetID} and returnedDate eq null`), admin)
    assert.equal(body(histories).length, 1)
  })
  it('return rejects a mismatched active history identity and leaves data unchanged', async () => {
    const a = await create('AUDIT-MISMATCH-HISTORY')
    assert.equal((await POST(ROOT + 'allocateAsset', { assetID: a.assetID, employeeUserId: 'employee.alex' }, admin)).status, 200)
    const { AllocationHistory } = cds.entities('it.asset.lifecycle')
    // Isolated imported/corrupt-data fixture, not a mutation through the public API.
    await cds.db.run(cds.ql.UPDATE(AllocationHistory).set({ employeeName: 'Jamie Chen', employeeUserId: 'employee.jamie' }).where({ assetID_assetID: a.assetID, returnedDate: null }))
    const r = await POST(ROOT + 'returnAsset', { assetID: a.assetID }, admin)
    console.log('AUDIT inconsistent-return', r.status, JSON.stringify(r.data))
    observe('mismatched-history-return', r)
    assert.equal(r.status, 409)
    const stored = await GET(ROOT + `Assets(${a.assetID})`, admin)
    assert.equal(body(stored).status, 'Allocated')
  })
  it('return with missing or duplicated active history rejects with no partial changes', async () => {
    const { AllocationHistory } = cds.entities('it.asset.lifecycle')
    for (const count of [0, 2]) {
      const a = await create('AUDIT-HISTORY-COUNT-' + count)
      assert.equal((await POST(ROOT + 'allocateAsset', { assetID: a.assetID, employeeUserId: 'employee.alex' }, admin)).status, 200)
      const active = await cds.db.run(cds.ql.SELECT.one.from(AllocationHistory).where({ assetID_assetID: a.assetID, returnedDate: null }))
      if (count === 0) await cds.db.run(cds.ql.DELETE.from(AllocationHistory).where({ allocID: active.allocID }))
      else await cds.db.run(cds.ql.INSERT.into(AllocationHistory).entries({ ...active, allocID: cds.utils.uuid() }))
      const r = await POST(ROOT + 'returnAsset', { assetID: a.assetID }, admin)
      observe('history-count-' + count, r)
      assert.equal(r.status, 409)
      assert.equal(body(await GET(ROOT + `Assets(${a.assetID})`, admin)).status, 'Allocated')
    }
  })
  it('employee provisioning is admin-only and generic employee writes remain forbidden', async () => {
    const data = { userId: 'AUDIT-Provisioned@example.com', displayName: 'Provisioned Employee' }
    for (const config of [alex, compliance]) {
      assert.equal((await POST(ROOT + 'provisionEmployee', data, config)).status, 403)
      assert.equal((await POST(ROOT + 'Employees', { ...data, active: true }, config)).status, 403)
    }
    assert.equal((await POST(ROOT + 'provisionEmployee', data, { validateStatus: () => true })).status, 401)
    assert.equal((await POST(ROOT + 'Employees', { ...data, active: true }, admin)).status, 403)
    assert.equal((await PATCH(ROOT + "Employees('employee.alex')", { displayName: 'FORGED' }, admin)).status, 403)
    assert.equal((await DELETE(ROOT + "Employees('employee.alex')", admin)).status, 403)
  })
  it('provisioned identity preserves case and audit actor and duplicates cannot overwrite it', async () => {
    const r = await POST(ROOT + 'provisionEmployee', { userId: ' AUDIT-Provisioned@Example.com ', displayName: ' New Employee ' }, admin)
    observe('provision-identity', r)
    assert.equal(r.status, 200)
    assert.equal(body(r).userId, 'AUDIT-Provisioned@Example.com')
    assert.equal(body(r).displayName, 'New Employee')
    assert.equal(body(r).active, true)
    assert.equal((await POST(ROOT + 'provisionEmployee', { userId: 'AUDIT-Provisioned@Example.com', displayName: 'FORGED REPLACEMENT' }, admin)).status, 409)
    const { Employee } = cds.entities('it.asset.lifecycle')
    const stored = await cds.db.run(cds.ql.SELECT.one.from(Employee).where({ userId: 'AUDIT-Provisioned@Example.com' }))
    assert.equal(stored.displayName, 'New Employee')
    assert.equal(stored.createdBy, 'it.admin')
    assert.ok(stored.createdAt)
    assert.equal(stored.modifiedBy, 'it.admin')
  })
  it('employee provisioning validates blanks, missing fields, lengths and control characters', async () => {
    for (const data of [ {}, { userId: ' ', displayName: 'Person' }, { userId: 'employee.a', displayName: ' ' }, { userId: 'a'.repeat(256), displayName: 'Person' }, { userId: 'employee.a', displayName: 'a'.repeat(201) }, { userId: 'employee.\nattack', displayName: 'Person' }, { userId: 'employee.a', displayName: 'Person\u0000Forged' } ]) {
      const r = await POST(ROOT + 'provisionEmployee', data, admin)
      observe('invalid-provision', r)
      assert.equal(r.status, 400)
    }
  })
  it('concurrent provisioning creates one mapping and refuses to overwrite the winner', async () => {
    const id = 'AUDIT-ConcurrentSubject@example.com'
    const results = await Promise.all(['One', 'Two'].map(displayName => POST(ROOT + 'provisionEmployee', { userId: id, displayName }, admin)))
    results.forEach((r, i) => observe('concurrent-provision:' + i, r))
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
    const { Employee } = cds.entities('it.asset.lifecycle')
    const stored = await cds.db.run(cds.ql.SELECT.from(Employee).where({ userId: id }))
    assert.equal(stored.length, 1)
    assert.equal(stored[0].displayName, body(results.find(r => r.status === 200)).displayName)
  })
  it('unknown roleless principals and provisioned subjects gain no inventory or Employee permissions', async () => {
    for (const username of ['AUDIT-Provisioned@Example.com', 'AUDIT-UnknownNoRoles@example.com']) {
      const config = { auth: { username, password: 'development-only' }, validateStatus: () => true }
      const session = await GET(ROOT + 'sessionInfo()', config)
      observe('roleless-session:' + username, session)
      assert.equal(session.status, 200)
      assert.equal(body(session).userId, username)
      assert.deepEqual(body(session).roles, [])
      for (const endpoint of ['MyAssets', 'Assets', 'Employees', 'AllocationHistories', 'complianceAlerts()']) {
        const r = await GET(ROOT + endpoint, config)
        observe('roleless-denial:' + endpoint, r)
        assert.equal(r.status, 403)
      }
      assert.equal((await POST(ROOT + 'provisionEmployee', { userId: 'SHOULD-NOT-EXIST', displayName: 'Forged' }, config)).status, 403)
    }
  })
})

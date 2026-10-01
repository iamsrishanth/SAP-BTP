const cds = require('@sap/cds')
const { INSERT, SELECT } = cds.ql
const { businessToday, businessTimeZone } = require('../srv/date-rules')

function offset(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function addManagedFields(row, user = 'demo-seed') {
  const now = new Date().toISOString()
  return { ...row, createdAt: now, createdBy: user, modifiedAt: now, modifiedBy: user }
}

function activeProfiles() {
  return Array.isArray(cds.env.profiles) ? cds.env.profiles : []
}

function shouldSeedDemoData() {
  const profiles = activeProfiles()
  if (process.env.NODE_ENV === 'production' || profiles.includes('production')) return false
  if (process.env.ASSET_SEED_DEMO === 'false') return false
  return process.env.ASSET_SEED_DEMO === 'true' || profiles.includes('development') || profiles.includes('test')
}

function buildDemoData(today = businessToday()) {
  // The CAP mocked-auth profile resolves req.user.id to the configured
  // username (without a `mock/` prefix); seed the same stable keys that the
  // service reads from the authenticated principal.
  const employeeAlex = 'employee.alex'
  const employeeJamie = 'employee.jamie'
  const employees = [
    { userId: employeeAlex, displayName: 'Alex Morgan', active: true },
    { userId: employeeJamie, displayName: 'Jamie Chen', active: true },
    { userId: 'employee.inactive', displayName: 'Inactive Employee', active: false }
  ]
  const assetIds = Object.fromEntries([
    'availableMonitor', 'idleLaptop', 'maintenanceWorkstation', 'retiredLaptop', 'validLicense',
    'expiringLicense', 'expiredLicense', 'expiresTodayLicense', 'warningBoundaryLicense',
    'outsideWarningLicense', 'legacyNoDateLicense', 'missingWarrantyHardware', 'warrantySoonHardware',
    'allocatedLaptopAlex', 'allocatedSoftwareJamie', 'returnedIdleMonitor'
  ].map(key => [key, cds.utils.uuid()]))
  const createdBy = 'demo-seed'

  const assets = [
    { assetID: assetIds.availableMonitor, assetName: 'DEMO-Available-Monitor', type: 'Hardware', purchaseDate: offset(today, -12), expiryDate: offset(today, 350), status: 'Available', allocatedTo: null, allocatedToUserId: null },
    { assetID: assetIds.idleLaptop, assetName: 'DEMO-Idle-Laptop', type: 'Hardware', purchaseDate: offset(today, -45), expiryDate: offset(today, 320), status: 'Available', allocatedTo: null, allocatedToUserId: null },
    { assetID: assetIds.maintenanceWorkstation, assetName: 'DEMO-Maintenance-Workstation', type: 'Hardware', purchaseDate: offset(today, -50), expiryDate: null, status: 'In Maintenance', allocatedTo: null, allocatedToUserId: null, maintenanceReason: 'Scheduled keyboard replacement' },
    { assetID: assetIds.retiredLaptop, assetName: 'DEMO-Retired-Laptop', type: 'Hardware', purchaseDate: offset(today, -500), expiryDate: offset(today, -300), status: 'Retired', allocatedTo: null, allocatedToUserId: null, retiredAt: `${today}T12:00:00.000Z`, retirementReason: 'End of supported life' },
    { assetID: assetIds.validLicense, assetName: 'DEMO-Valid-Software-License', type: 'Software', purchaseDate: offset(today, -120), expiryDate: offset(today, 180), status: 'Available', allocatedTo: null, allocatedToUserId: null },
    { assetID: assetIds.expiringLicense, assetName: 'DEMO-Expiring-Software-License', type: 'Software', purchaseDate: offset(today, -180), expiryDate: offset(today, 15), status: 'Available', allocatedTo: null, allocatedToUserId: null },
    { assetID: assetIds.expiredLicense, assetName: 'DEMO-Expired-Software-License', type: 'Software', purchaseDate: offset(today, -360), expiryDate: offset(today, -5), status: 'Available', allocatedTo: null, allocatedToUserId: null },
    { assetID: assetIds.expiresTodayLicense, assetName: 'DEMO-License-Expires-Today', type: 'Software', purchaseDate: offset(today, -60), expiryDate: today, status: 'Available', allocatedTo: null, allocatedToUserId: null },
    { assetID: assetIds.warningBoundaryLicense, assetName: 'DEMO-License-Warning-Day-30', type: 'Software', purchaseDate: offset(today, -100), expiryDate: offset(today, 30), status: 'Available', allocatedTo: null, allocatedToUserId: null },
    { assetID: assetIds.outsideWarningLicense, assetName: 'DEMO-License-Warning-Day-31', type: 'Software', purchaseDate: offset(today, -100), expiryDate: offset(today, 31), status: 'Available', allocatedTo: null, allocatedToUserId: null },
    // This represents a legacy imported record; new Software registrations require expiryDate.
    { assetID: assetIds.legacyNoDateLicense, assetName: 'DEMO-Legacy-License-No-Expiry', type: 'Software', purchaseDate: offset(today, -400), expiryDate: null, status: 'Available', allocatedTo: null, allocatedToUserId: null },
    { assetID: assetIds.missingWarrantyHardware, assetName: 'DEMO-Hardware-No-Warranty-Date', type: 'Hardware', purchaseDate: offset(today, -80), expiryDate: null, status: 'Available', allocatedTo: null, allocatedToUserId: null },
    { assetID: assetIds.warrantySoonHardware, assetName: 'DEMO-Hardware-Warranty-Expiring', type: 'Hardware', purchaseDate: offset(today, -330), expiryDate: offset(today, 20), status: 'Available', allocatedTo: null, allocatedToUserId: null },
    { assetID: assetIds.allocatedLaptopAlex, assetName: 'DEMO-Allocated-Laptop-Alex', type: 'Hardware', purchaseDate: offset(today, -150), expiryDate: offset(today, 215), status: 'Allocated', allocatedTo: 'Alex Morgan', allocatedToUserId: employeeAlex },
    { assetID: assetIds.allocatedSoftwareJamie, assetName: 'DEMO-Allocated-Software-Jamie', type: 'Software', purchaseDate: offset(today, -210), expiryDate: offset(today, 90), status: 'Allocated', allocatedTo: 'Jamie Chen', allocatedToUserId: employeeJamie },
    { assetID: assetIds.returnedIdleMonitor, assetName: 'DEMO-Returned-Idle-Monitor', type: 'Hardware', purchaseDate: offset(today, -120), expiryDate: offset(today, 245), status: 'Available', allocatedTo: null, allocatedToUserId: null }
  ].map(asset => addManagedFields(asset, createdBy))

  const allocations = [
    {
      allocID: cds.utils.uuid(), assetID_assetID: assetIds.allocatedLaptopAlex,
      employeeName: 'Alex Morgan', employeeUserId: employeeAlex,
      assignedDate: offset(today, -12), returnedDate: null
    },
    {
      allocID: cds.utils.uuid(), assetID_assetID: assetIds.allocatedSoftwareJamie,
      employeeName: 'Jamie Chen', employeeUserId: employeeJamie,
      assignedDate: offset(today, -40), returnedDate: null
    },
    {
      allocID: cds.utils.uuid(), assetID_assetID: assetIds.returnedIdleMonitor,
      employeeName: 'Jamie Chen', employeeUserId: employeeJamie,
      assignedDate: offset(today, -100), returnedDate: offset(today, -31)
    }
  ].map(row => addManagedFields(row, createdBy))

  return { employees, assets, allocations }
}

async function seedDemoData(cdsInstance = cds) {
  if (!shouldSeedDemoData()) return { seeded: false, reason: 'non-development profile' }
  const { Asset, AllocationHistory, Employee } = cdsInstance.entities('it.asset.lifecycle')
  const { employees, assets, allocations } = buildDemoData(businessToday())
  return cdsInstance.tx(async tx => {
    const existingAsset = await tx.run(SELECT.one.from(Asset).columns('assetID'))
    if (existingAsset) return { seeded: false, reason: 'inventory already contains data' }

    const existingEmployees = await tx.run(SELECT.from(Employee).columns('userId'))
    const knownUserIds = new Set(existingEmployees.map(row => row.userId))
    const missingEmployees = employees.filter(employee => !knownUserIds.has(employee.userId))
    if (missingEmployees.length) await tx.run(INSERT.into(Employee).entries(missingEmployees))
    await tx.run(INSERT.into(Asset).entries(assets))
    await tx.run(INSERT.into(AllocationHistory).entries(allocations))
    return { seeded: true, assetCount: assets.length, allocationCount: allocations.length }
  })
}

if (shouldSeedDemoData()) {
  // `served` fires before the server has finished connecting/deploying the database.
  // Seed after listening so the schema is available (also under cds.test).
  cds.once('listening', async () => {
    try {
      const result = await seedDemoData(cds)
      if (result.seeded) cds.log('asset-seed').info(`Inserted ${result.assetCount} relative-date demo assets and ${result.allocationCount} history records.`)
    } catch (error) {
      cds.log('asset-seed').error('Development demo-data seeding failed.', error)
      throw error
    }
  })
}

module.exports = { seedDemoData, buildDemoData, businessToday, businessTimeZone, shouldSeedDemoData }

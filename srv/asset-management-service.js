const cds = require('@sap/cds')
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql
const { businessToday, businessTimeZone } = require('./date-rules')

// Demo fixtures live outside the generated service package. Load their
// development-only listener only when demo seeding is enabled; the production
// MTA explicitly sets ASSET_SEED_DEMO=false and therefore never resolves db/seed.
if (!cds.env.profiles.includes('production') && process.env.ASSET_SEED_DEMO !== 'false') {
  require('../db/seed')
}

const EXPECTED_ROLES = ['ITAdmin', 'Employee', 'ComplianceManager']
const PUBLIC_MY_ASSET_COLUMNS = [
  'assetID', 'assetName', 'type', 'purchaseDate', 'expiryDate', 'status', 'allocatedTo'
]
const CREATE_FIELDS = new Set(['assetName', 'type', 'purchaseDate', 'expiryDate'])
const UPDATE_FIELDS = new Set(['assetName'])
const VALID_TYPES = new Set(['Hardware', 'Software'])
const VALID_STATES = new Set(['Available', 'Allocated', 'In Maintenance', 'Retired'])

function configuredInteger(name, fallback, min = 0, max = 3650) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

function validDateString(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = value
  const parsed = new Date(`${date}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : null
}

function dateOffset(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function calendarDaysBetween(from, to) {
  const a = new Date(`${from}T00:00:00.000Z`).getTime()
  const b = new Date(`${to}T00:00:00.000Z`).getTime()
  return Math.floor((b - a) / 86_400_000)
}

function reject(req, status, code, message) {
  req.reject({ status, code, message })
}

function isDatabaseLockError(error) {
  let current = error
  while (current) {
    const code = String(current.code || '')
    const message = String(current.message || '')
    if (/SQLITE_(BUSY|LOCKED)/i.test(code) || /database is (?:locked|busy)/i.test(message)) return true
    current = current.cause
  }
  return false
}

function isDuplicateKeyError(error) {
  let current = error
  while (current) {
    const code = String(current.code || '')
    const message = String(current.message || '')
    if (['ENTITY_ALREADY_EXISTS', 'SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE', '301'].includes(code) ||
      /UNIQUE constraint failed|unique constraint violated/i.test(message)) return true
    current = current.cause
  }
  return false
}

function mapConcurrentWriteError(req, error) {
  if (isDatabaseLockError(error)) {
    reject(req, 409, 'ASSET_CONCURRENT_CHANGE', 'The asset changed during this request. Refresh the inventory and try again.')
  }
  throw error
}

function affectedRows(result) {
  if (Number.isInteger(result)) return result
  if (result && Number.isInteger(result.affectedRows)) return result.affectedRows
  if (result && Number.isInteger(result.changes)) return result.changes
  if (Array.isArray(result) && result[0] && Number.isInteger(result[0].affectedRows)) {
    return result[0].affectedRows
  }
  return undefined
}

function assertOneRow(req, result, code = 'ASSET_CONCURRENT_CHANGE') {
  const count = affectedRows(result)
  if (count !== 1) {
    if (count === 0) reject(req, 409, code, 'The asset has changed or is no longer in the required state.')
    throw new Error(`Expected one database row to change, received ${String(count)}`)
  }
}

function auditUpdate(userId) {
  const now = new Date().toISOString()
  return { modifiedAt: now, modifiedBy: userId }
}

function auditInsert(userId) {
  const now = new Date().toISOString()
  return { createdAt: now, createdBy: userId, modifiedAt: now, modifiedBy: userId }
}

function requirePrincipal(req) {
  const userId = req.user?.id
  if (typeof userId !== 'string' || !userId.trim()) {
    reject(req, 401, 'AUTHENTICATION_REQUIRED', 'An authenticated user identity is required.')
  }
  return userId
}

function extractAssetID(req) {
  return req.data?.assetID || req.params?.[0]?.assetID || req.params?.[0]?.ID
}

function validateReason(req, reason, fieldName = 'reason') {
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
    reject(req, 400, 'INVALID_REASON', `${fieldName} is required and must be no longer than 500 characters.`)
  }
  return reason.trim()
}

function validateAssetName(req, name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) {
    reject(req, 400, 'INVALID_ASSET_NAME', 'assetName is required and must be no longer than 200 characters.')
  }
  return name.trim()
}

function validateEmployeeMappingText(req, value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength || /[\p{Cc}\p{Cf}]/u.test(value)) {
    reject(req, 400, 'INVALID_EMPLOYEE_MAPPING', `${field} is required, must contain no control characters, and must be no longer than ${maxLength} characters.`)
  }
  // Authenticated subject IDs are stable and case-sensitive. Trim surrounding
  // whitespace only; never derive authorization from the display name.
  return value.trim()
}

function validType(req, type) {
  if (!VALID_TYPES.has(type)) reject(req, 400, 'INVALID_ASSET_TYPE', 'type must be Hardware or Software.')
}

function validatePurchaseDate(req, value) {
  const date = validDateString(value)
  if (!date) reject(req, 400, 'INVALID_PURCHASE_DATE', 'purchaseDate must be a valid date in YYYY-MM-DD format.')
  if (date > businessToday()) reject(req, 400, 'FUTURE_PURCHASE_DATE', 'purchaseDate cannot be in the future.')
  return date
}

function validateExpiryDate(req, value, purchaseDate, type, required) {
  if (value == null || value === '') {
    if (required) reject(req, 400, 'MISSING_EXPIRY_DATE', 'Software assets require an expiryDate.')
    return null
  }
  const date = validDateString(value)
  if (!date) reject(req, 400, 'INVALID_EXPIRY_DATE', 'expiryDate must be a valid date in YYYY-MM-DD format.')
  if (date < purchaseDate) {
    reject(req, 400, 'EXPIRY_BEFORE_PURCHASE', `${type === 'Software' ? 'License' : 'Warranty'} expiry cannot precede purchaseDate.`)
  }
  return date
}

function appendWhere(select, predicate) {
  const previous = select.where
  select.where = previous?.length
    ? [{ xpr: previous }, 'and', ...predicate]
    : predicate
}

function asDate(value) {
  return validDateString(value)
}

function alertRow(asset, extras = {}) {
  return {
    assetID: asset.assetID,
    assetName: asset.assetName,
    type: asset.type,
    status: asset.status,
    ...extras
  }
}

async function readAsset(tx, DbAsset, assetID) {
  return tx.run(SELECT.one.from(DbAsset).where({ assetID }))
}

async function activeHistoryFor(tx, DbAllocationHistory, assetID) {
  return tx.run(
    SELECT.from(DbAllocationHistory).columns('allocID').where({ assetID_assetID: assetID, returnedDate: null })
  )
}

module.exports = class AssetManagementService extends cds.ApplicationService {
  init() {
    const { Assets, AllocationHistories, MyAssets } = this.entities
    const { Asset: DbAsset, AllocationHistory: DbAllocationHistory, Employee: DbEmployee } =
      cds.entities('it.asset.lifecycle')

    this.before('CREATE', Assets, req => {
      const data = req.data || {}
      const extra = Object.keys(data).filter(field => !CREATE_FIELDS.has(field) && field !== 'assetID')
      if (extra.length) {
        reject(req, 400, 'SERVER_MANAGED_FIELD', `Registration cannot set: ${extra.join(', ')}.`)
      }
      data.assetName = validateAssetName(req, data.assetName)
      validType(req, data.type)
      const purchaseDate = validatePurchaseDate(req, data.purchaseDate)
      const expiryDate = validateExpiryDate(
        req, data.expiryDate, purchaseDate, data.type, data.type === 'Software'
      )
      data.assetID = cds.utils.uuid()
      data.purchaseDate = purchaseDate
      data.expiryDate = expiryDate
      data.status = 'Available'
      data.allocatedTo = null
      data.allocatedToUserId = null
      data.maintenanceReason = null
      data.retiredAt = null
      data.retirementReason = null
    })

    this.before('UPDATE', Assets, req => {
      const data = req.data || {}
      const extra = Object.keys(data).filter(field => !UPDATE_FIELDS.has(field) && field !== 'assetID')
      if (extra.length) {
        reject(req, 400, 'LIFECYCLE_ACTION_REQUIRED', `Use a lifecycle action to change: ${extra.join(', ')}.`)
      }
      if (!Object.keys(data).some(field => UPDATE_FIELDS.has(field))) {
        reject(req, 400, 'EMPTY_ASSET_UPDATE', 'An assetName update is required.')
      }
      data.assetName = validateAssetName(req, data.assetName)
    })

    this.before('UPSERT', Assets, req => {
      reject(req, 405, 'ASSET_UPSERT_FORBIDDEN', 'Use POST Assets to register a new asset; lifecycle changes require their named actions.')
    })

    this.on('DELETE', Assets, async req => {
      const assetID = extractAssetID(req)
      if (!assetID) reject(req, 400, 'ASSET_ID_REQUIRED', 'A single assetID is required for deletion.')
      const tx = cds.tx(req)
      try {
        const asset = await readAsset(tx, DbAsset, assetID)
        if (!asset) reject(req, 404, 'ASSET_NOT_FOUND', 'Asset was not found.')
        if (asset.status !== 'Available' || asset.allocatedToUserId || asset.allocatedTo) {
          reject(req, 409, 'ASSET_NOT_DELETABLE', 'Only an unassigned Available asset without allocation history can be physically deleted.')
        }
        const history = await tx.run(
          SELECT.one.from(DbAllocationHistory).columns('allocID').where({ assetID_assetID: assetID })
        )
        if (history) {
          reject(req, 409, 'ASSET_HAS_HISTORY', 'Assets with allocation history must be retired instead of deleted.')
        }
        const result = await tx.run(
          DELETE.from(DbAsset).where({
            assetID,
            status: 'Available',
            allocatedToUserId: null,
            allocatedTo: null
          })
        )
        assertOneRow(req, result)
        return { assetID }
      } catch (error) {
        mapConcurrentWriteError(req, error)
      }
    })

    this.on('READ', MyAssets, async req => {
      const userId = requirePrincipal(req)
      const query = structuredClone(req.query)
      const select = query?.SELECT
      if (!select) reject(req, 400, 'INVALID_MY_ASSETS_QUERY', 'A collection read query is required.')

      // Run against the persistence entity and inject an untrusted-client-proof identity predicate.
      // Only the public MyAssets fields are selected, even when a client requests `*`.
      const firstReference = select.from?.ref?.[0]
      if (!firstReference || select.from.ref.length !== 1) {
        reject(req, 400, 'INVALID_MY_ASSETS_QUERY', 'A direct MyAssets read query is required.')
      }
      // OData key predicates are embedded in the FROM reference. Preserve them
      // while replacing only the service projection name with its persistence entity.
      select.from.ref[0] = typeof firstReference === 'string'
        ? DbAsset.name
        : { ...firstReference, id: DbAsset.name }
      const isCountQuery = select.columns?.length === 1 && select.columns[0].func === 'count'
      if (!isCountQuery) {
        const requested = select.columns
        select.columns = !requested?.length || requested.some(column => column === '*' || column.ref?.[0] === '*')
          ? PUBLIC_MY_ASSET_COLUMNS.map(name => ({ ref: [name] }))
          : requested.filter(column => column.ref?.length === 1 && PUBLIC_MY_ASSET_COLUMNS.includes(column.ref[0]))
        if (!select.columns.length) reject(req, 400, 'INVALID_MY_ASSETS_COLUMNS', 'Select public MyAssets fields only.')
      }
      appendWhere(select, [{ ref: ['allocatedToUserId'] }, '=', { val: userId }])
      return cds.tx(req).run(query)
    })

    this.before('CREATE', AllocationHistories, req => {
      reject(req, 405, 'HISTORY_LIFECYCLE_ONLY', 'Allocation history is created only by allocateAsset.')
    })
    this.before('UPDATE', AllocationHistories, req => {
      reject(req, 405, 'HISTORY_LIFECYCLE_ONLY', 'Allocation history is closed only by returnAsset.')
    })
    this.before('DELETE', AllocationHistories, req => {
      reject(req, 405, 'HISTORY_IMMUTABLE', 'Allocation history cannot be deleted.')
    })
    this.before('UPSERT', AllocationHistories, req => {
      reject(req, 405, 'HISTORY_IMMUTABLE', 'Allocation history cannot be upserted.')
    })

    this.on('provisionEmployee', async req => {
      const actorId = requirePrincipal(req)
      const userId = validateEmployeeMappingText(req, req.data.userId, 'userId', 255)
      const displayName = validateEmployeeMappingText(req, req.data.displayName, 'displayName', 200)
      const tx = cds.tx(req)
      try {
        const existing = await tx.run(SELECT.one.from(DbEmployee).columns('userId').where({ userId }))
        if (existing) reject(req, 409, 'EMPLOYEE_ALREADY_EXISTS', 'This authenticated subject already has an employee mapping. Existing mappings cannot be overwritten.')
        await tx.run(INSERT.into(DbEmployee).entries({ userId, displayName, active: true, ...auditInsert(actorId) }))
        return { userId, displayName, active: true }
      } catch (error) {
        if (isDuplicateKeyError(error)) reject(req, 409, 'EMPLOYEE_ALREADY_EXISTS', 'This authenticated subject already has an employee mapping. Existing mappings cannot be overwritten.')
        if (isDatabaseLockError(error)) reject(req, 409, 'EMPLOYEE_CONCURRENT_CHANGE', 'Employee mappings changed during this request. Refresh the employee list before retrying.')
        throw error
      }
    })

    this.on('allocateAsset', async req => {
      requirePrincipal(req)
      const { assetID, employeeUserId } = req.data
      if (typeof assetID !== 'string' || !assetID.trim()) reject(req, 400, 'ASSET_ID_REQUIRED', 'assetID is required.')
      if (typeof employeeUserId !== 'string' || !employeeUserId.trim()) {
        reject(req, 400, 'EMPLOYEE_ID_REQUIRED', 'employeeUserId is required.')
      }
      const tx = cds.tx(req)
      const actorId = req.user.id
      const today = businessToday()
      try {
        const asset = await readAsset(tx, DbAsset, assetID)
        if (!asset) reject(req, 404, 'ASSET_NOT_FOUND', 'Asset was not found.')
        if (!VALID_STATES.has(asset.status)) reject(req, 409, 'INVALID_ASSET_STATE', 'Asset has an unsupported lifecycle status.')
        if (asset.status !== 'Available' || asset.allocatedTo || asset.allocatedToUserId) {
          reject(req, 409, 'ASSET_NOT_AVAILABLE', 'Only an unassigned Available asset can be allocated.')
        }
        if (!VALID_TYPES.has(asset.type) || !asDate(asset.purchaseDate) || asDate(asset.purchaseDate) > today) {
          reject(req, 409, 'ASSET_DATA_INVALID', 'The asset has an unsupported type or invalid purchase date.')
        }
        const employee = await tx.run(
          SELECT.one.from(DbEmployee).where({ userId: employeeUserId, active: true })
        )
        if (!employee) reject(req, 400, 'EMPLOYEE_NOT_ACTIVE', 'Select an active employee from the trusted employee list.')
        const activeHistory = await activeHistoryFor(tx, DbAllocationHistory, assetID)
        if (activeHistory.length) {
          reject(req, 409, 'ACTIVE_HISTORY_EXISTS', 'The asset already has an active allocation history record.')
        }

        const result = await tx.run(
          UPDATE(DbAsset)
            .set({
              status: 'Allocated',
              allocatedTo: employee.displayName,
              allocatedToUserId: employee.userId,
              ...auditUpdate(actorId)
            })
            .where({ assetID, status: 'Available', allocatedTo: null, allocatedToUserId: null })
        )
        assertOneRow(req, result, 'ASSET_NOT_AVAILABLE')

        await tx.run(INSERT.into(DbAllocationHistory).entries({
          allocID: cds.utils.uuid(),
          assetID_assetID: assetID,
          employeeName: employee.displayName,
          employeeUserId: employee.userId,
          assignedDate: today,
          returnedDate: null,
          ...auditInsert(actorId)
        }))
        const updated = await readAsset(tx, DbAsset, assetID)
        if (!updated) throw new Error('Allocated asset disappeared before transaction completion.')
        return updated
      } catch (error) {
        if (error?.status || error?.code === 'ASSET_NOT_AVAILABLE' || error?.code === 'ACTIVE_HISTORY_EXISTS') throw error
        mapConcurrentWriteError(req, error)
      }
    })

    this.on('returnAsset', async req => {
      requirePrincipal(req)
      const assetID = req.data.assetID
      if (typeof assetID !== 'string' || !assetID.trim()) reject(req, 400, 'ASSET_ID_REQUIRED', 'assetID is required.')
      const tx = cds.tx(req)
      const actorId = req.user.id
      const today = businessToday()
      try {
        const asset = await readAsset(tx, DbAsset, assetID)
        if (!asset) reject(req, 404, 'ASSET_NOT_FOUND', 'Asset was not found.')
        if (asset.status !== 'Allocated' || !asset.allocatedToUserId || !asset.allocatedTo) {
          reject(req, 409, 'ASSET_NOT_ALLOCATED', 'Only a currently allocated asset can be returned.')
        }
        const activeHistory = await tx.run(
          SELECT.from(DbAllocationHistory).where({ assetID_assetID: assetID, returnedDate: null })
        )
        if (activeHistory.length !== 1) {
          reject(req, 409, 'ALLOCATION_HISTORY_INCONSISTENT', 'Return requires exactly one active history record; no asset fields were changed.')
        }
        const history = activeHistory[0]
        if (history.employeeUserId !== asset.allocatedToUserId || history.employeeName !== asset.allocatedTo) {
          reject(req, 409, 'ALLOCATION_HISTORY_INCONSISTENT', 'The active history assignee does not match the current asset assignment; no asset fields were changed.')
        }
        const assignedDate = asDate(history.assignedDate)
        if (!assignedDate || today < assignedDate) {
          reject(req, 409, 'RETURN_DATE_INVALID', 'The business date cannot precede the allocation date.')
        }

        const result = await tx.run(
          UPDATE(DbAsset)
            .set({
              status: 'Available',
              allocatedTo: null,
              allocatedToUserId: null,
              ...auditUpdate(actorId)
            })
            .where({
              assetID,
              status: 'Allocated',
              allocatedToUserId: asset.allocatedToUserId,
              allocatedTo: asset.allocatedTo
            })
        )
        assertOneRow(req, result, 'ASSET_NOT_ALLOCATED')

        const closed = await tx.run(
          UPDATE(DbAllocationHistory)
            .set({ returnedDate: today, ...auditUpdate(actorId) })
            .where({
              allocID: history.allocID, assetID_assetID: assetID, returnedDate: null,
              employeeUserId: asset.allocatedToUserId, employeeName: asset.allocatedTo
            })
        )
        assertOneRow(req, closed, 'ALLOCATION_HISTORY_INCONSISTENT')
        const updated = await readAsset(tx, DbAsset, assetID)
        if (!updated) throw new Error('Returned asset disappeared before transaction completion.')
        return updated
      } catch (error) {
        if (error?.status || error?.code === 'ASSET_NOT_ALLOCATED' || error?.code === 'ALLOCATION_HISTORY_INCONSISTENT') throw error
        mapConcurrentWriteError(req, error)
      }
    })

    this.on('renewSoftwareLicense', async req => {
      requirePrincipal(req)
      const { assetID, newExpiryDate } = req.data
      if (typeof assetID !== 'string' || !assetID.trim()) reject(req, 400, 'ASSET_ID_REQUIRED', 'assetID is required.')
      const tx = cds.tx(req)
      const today = businessToday()
      try {
        const asset = await readAsset(tx, DbAsset, assetID)
        if (!asset) reject(req, 404, 'ASSET_NOT_FOUND', 'Asset was not found.')
        if (asset.status === 'Retired') reject(req, 409, 'ASSET_RETIRED', 'A retired asset cannot be renewed.')
        if (asset.type !== 'Software') reject(req, 400, 'SOFTWARE_ONLY', 'Only Software assets can use license renewal.')
        const expiry = validDateString(newExpiryDate)
        if (!expiry) reject(req, 400, 'INVALID_EXPIRY_DATE', 'newExpiryDate must be a valid date in YYYY-MM-DD format.')
        const currentExpiry = asset.expiryDate == null ? null : validDateString(asset.expiryDate)
        if (expiry <= today || (currentExpiry && expiry <= currentExpiry)) {
          reject(req, 400, 'RENEWAL_MUST_EXTEND', 'newExpiryDate must be later than today and the current expiryDate.')
        }
        const result = await tx.run(
          UPDATE(DbAsset)
            .set({ expiryDate: expiry, ...auditUpdate(req.user.id) })
            .where({ assetID, type: 'Software', status: asset.status, expiryDate: asset.expiryDate ?? null })
        )
        assertOneRow(req, result, 'ASSET_CONCURRENT_CHANGE')
        return readAsset(tx, DbAsset, assetID)
      } catch (error) {
        if (error?.status || error?.code === 'ASSET_CONCURRENT_CHANGE') throw error
        mapConcurrentWriteError(req, error)
      }
    })

    this.on('placeInMaintenance', async req => {
      requirePrincipal(req)
      const assetID = req.data.assetID
      if (typeof assetID !== 'string' || !assetID.trim()) reject(req, 400, 'ASSET_ID_REQUIRED', 'assetID is required.')
      const reason = validateReason(req, req.data.reason)
      const tx = cds.tx(req)
      try {
        const asset = await readAsset(tx, DbAsset, assetID)
        if (!asset) reject(req, 404, 'ASSET_NOT_FOUND', 'Asset was not found.')
        if (asset.status !== 'Available' || asset.allocatedTo || asset.allocatedToUserId) {
          reject(req, 409, 'ASSET_NOT_AVAILABLE', 'Only an unassigned Available asset can enter maintenance.')
        }
        if ((await activeHistoryFor(tx, DbAllocationHistory, assetID)).length) {
          reject(req, 409, 'ACTIVE_HISTORY_EXISTS', 'An asset with an active allocation cannot enter maintenance.')
        }
        const result = await tx.run(
          UPDATE(DbAsset)
            .set({ status: 'In Maintenance', maintenanceReason: reason, ...auditUpdate(req.user.id) })
            .where({ assetID, status: 'Available', allocatedTo: null, allocatedToUserId: null })
        )
        assertOneRow(req, result, 'ASSET_NOT_AVAILABLE')
        return readAsset(tx, DbAsset, assetID)
      } catch (error) {
        if (error?.status || error?.code === 'ASSET_NOT_AVAILABLE') throw error
        mapConcurrentWriteError(req, error)
      }
    })

    this.on('releaseFromMaintenance', async req => {
      requirePrincipal(req)
      const assetID = req.data.assetID
      if (typeof assetID !== 'string' || !assetID.trim()) reject(req, 400, 'ASSET_ID_REQUIRED', 'assetID is required.')
      const tx = cds.tx(req)
      try {
        const asset = await readAsset(tx, DbAsset, assetID)
        if (!asset) reject(req, 404, 'ASSET_NOT_FOUND', 'Asset was not found.')
        if (asset.status !== 'In Maintenance' || asset.allocatedTo || asset.allocatedToUserId) {
          reject(req, 409, 'NOT_IN_MAINTENANCE', 'Only an unassigned asset in maintenance can be released.')
        }
        if ((await activeHistoryFor(tx, DbAllocationHistory, assetID)).length) {
          reject(req, 409, 'ACTIVE_HISTORY_EXISTS', 'An asset with an active allocation cannot be released from maintenance.')
        }
        const result = await tx.run(
          UPDATE(DbAsset)
            .set({ status: 'Available', maintenanceReason: null, ...auditUpdate(req.user.id) })
            .where({ assetID, status: 'In Maintenance' })
        )
        assertOneRow(req, result, 'NOT_IN_MAINTENANCE')
        return readAsset(tx, DbAsset, assetID)
      } catch (error) {
        if (error?.status || error?.code === 'NOT_IN_MAINTENANCE') throw error
        mapConcurrentWriteError(req, error)
      }
    })

    this.on('retireAsset', async req => {
      requirePrincipal(req)
      const assetID = req.data.assetID
      if (typeof assetID !== 'string' || !assetID.trim()) reject(req, 400, 'ASSET_ID_REQUIRED', 'assetID is required.')
      const reason = validateReason(req, req.data.reason)
      const tx = cds.tx(req)
      try {
        const asset = await readAsset(tx, DbAsset, assetID)
        if (!asset) reject(req, 404, 'ASSET_NOT_FOUND', 'Asset was not found.')
        if (!['Available', 'In Maintenance'].includes(asset.status) || asset.allocatedTo || asset.allocatedToUserId) {
          reject(req, 409, 'RETURN_BEFORE_RETIREMENT', 'An allocated asset must be returned before retirement.')
        }
        if ((await activeHistoryFor(tx, DbAllocationHistory, assetID)).length) {
          reject(req, 409, 'ACTIVE_HISTORY_EXISTS', 'An active allocation history record must be returned before retirement.')
        }
        const result = await tx.run(
          UPDATE(DbAsset)
            .set({
              status: 'Retired',
              maintenanceReason: null,
              retirementReason: reason,
              retiredAt: new Date().toISOString(),
              ...auditUpdate(req.user.id)
            })
            .where({ assetID, status: asset.status, allocatedTo: null, allocatedToUserId: null })
        )
        assertOneRow(req, result, 'ASSET_CONCURRENT_CHANGE')
        return readAsset(tx, DbAsset, assetID)
      } catch (error) {
        if (error?.status || error?.code === 'ASSET_CONCURRENT_CHANGE') throw error
        mapConcurrentWriteError(req, error)
      }
    })

    this.on('complianceAlerts', async req => {
      requirePrincipal(req)
      const tx = cds.tx(req)
      const today = businessToday()
      const warningDays = configuredInteger('ASSET_EXPIRY_WARNING_DAYS', 30)
      const idleDays = configuredInteger('ASSET_IDLE_DAYS', 30)
      const warningEnd = dateOffset(today, warningDays)
      const assets = await tx.run(SELECT.from(DbAsset))
      const history = await tx.run(
        SELECT.from(DbAllocationHistory).columns('assetID_assetID', 'returnedDate')
      )

      const latestReturnByAsset = new Map()
      for (const allocation of history) {
        const returnedDate = asDate(allocation.returnedDate)
        if (!returnedDate) continue
        const assetID = allocation.assetID_assetID
        const previous = latestReturnByAsset.get(assetID)
        if (!previous || returnedDate > previous) latestReturnByAsset.set(assetID, returnedDate)
      }

      const expiredLicenses = []
      const expiringLicenses = []
      const hardwareWarrantyAlerts = []
      const idleAssets = []
      const missingDateAlerts = []

      for (const asset of assets) {
        if (asset.status === 'Retired') continue
        const expiryDate = asDate(asset.expiryDate)
        if (!expiryDate) {
          if (asset.type === 'Software') {
            missingDateAlerts.push(alertRow(asset, { alertType: 'Missing License Expiry' }))
          } else if (asset.type === 'Hardware') {
            missingDateAlerts.push(alertRow(asset, { alertType: 'Missing Hardware Warranty' }))
          }
        } else {
          const daysRemaining = calendarDaysBetween(today, expiryDate)
          if (asset.type === 'Software') {
            if (expiryDate < today) {
              expiredLicenses.push(alertRow(asset, { expiryDate, alertType: 'Expired License', daysRemaining }))
            } else if (expiryDate <= warningEnd) {
              expiringLicenses.push(alertRow(asset, { expiryDate, alertType: 'License Expiring Soon', daysRemaining }))
            }
          } else if (asset.type === 'Hardware') {
            if (expiryDate < today) {
              hardwareWarrantyAlerts.push(alertRow(asset, { expiryDate, alertType: 'Warranty Expired', daysRemaining }))
            } else if (expiryDate <= warningEnd) {
              hardwareWarrantyAlerts.push(alertRow(asset, { expiryDate, alertType: 'Warranty Expiring Soon', daysRemaining }))
            }
          }
        }

        if (asset.status === 'Available') {
          const idleSince = latestReturnByAsset.get(asset.assetID) || asDate(asset.purchaseDate)
          if (idleSince) {
            const daysIdle = calendarDaysBetween(idleSince, today)
            if (daysIdle > idleDays) {
              idleAssets.push(alertRow(asset, { idleSince, daysIdle, alertType: 'Idle Asset' }))
            }
          }
        }
      }

      return {
        businessToday: today,
        expiryWarningDays: warningDays,
        idleThresholdDays: idleDays,
        expiredLicenses,
        expiringLicenses,
        hardwareWarrantyAlerts,
        idleAssets,
        missingDateAlerts
      }
    })

    this.on('sessionInfo', req => {
      const userId = requirePrincipal(req)
      const roles = EXPECTED_ROLES.filter(role => req.user.is(role))
      return {
        userId,
        roles,
        businessToday: businessToday(),
        timeZone: businessTimeZone()
      }
    })

    return super.init()
  }
}

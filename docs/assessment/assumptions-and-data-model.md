# Assumptions and Data Model Design

## Purpose and status

This is the proposed design baseline for the IT Asset Lifecycle Management capstone. Choices below resolve ambiguities in the assessment so implementation and verification can use one consistent contract. They are assumptions, not additional assessment instructions. Confirm them against the running implementation before declaring any gate passed.

## Proposed architecture and runtime assumptions

- Backend: SAP CAP with the Node.js runtime.
- Local development: CAP with persistent SQLite storage.
- SAP BTP Cloud Foundry target: CAP with SAP HANA Cloud for persistence and XSUAA for authentication/role scopes.
- SAPUI5 is the browser client and calls the CAP OData service. Business rules and authorization stay in CAP.
- Local mock authentication is for reproducible development only. Cloud deployment must validate the authenticated XSUAA identity and assigned scopes.
- Local and deployed results are reported separately. The proposed architecture is not evidence that either target has been configured or accessed.

## Required entities and attributes

Names and meanings in this table are preserved from the assessment.

### Asset

| Attribute | Required type | Meaning preserved |
|---|---|---|
| assetID | UUID, primary key | Unique identifier for each asset. |
| assetName | String | Asset name or description. |
| type | String | Asset type, supported values Hardware or Software. |
| purchaseDate | Date | Date the asset was purchased. |
| expiryDate | Date | Software license expiry or hardware warranty end date. |
| status | String | Current asset lifecycle status. |
| allocatedTo | String | Assigned person or department display name/identifier; populated from trusted employee mapping for person assignments. |

### Allocation History

| Attribute | Required type | Meaning preserved |
|---|---|---|
| allocID | UUID, primary key | Unique identifier for each allocation record. |
| assetID | Association to Asset | The asset allocated; this must be a real managed CDS association to Asset. |
| employeeName | String | Employee display name at the time of assignment. |
| assignedDate | Date | Date the asset was assigned. |
| returnedDate | Date, nullable | Return date; null while the record is the active assignment. |

The proposed CDS source names the association element asset and targets Asset.assetID. CAP therefore generates the managed foreign-key property asset_assetID in persistence and the service representation where the key is exposed. This generated key represents the required assetID relationship; it must not be replaced with an unrelated string field or duplicated as a second manually managed relationship. If a different CDS association name is selected during implementation, update this note to state the generated property name actually produced by CAP.

## Justified supporting fields and entity

These additions exist only to make identity, audit, lifecycle, and compliance reliable.

| Addition | Proposed purpose |
|---|---|
| Asset.allocatedToUserId | Stores the authenticated employee identity associated with the current assignment. It is cleared on return. It is the authorization key; allocatedTo remains the required human-readable string. |
| AllocationHistory.employeeUserId | Immutable identity snapshot for the recipient of each historical assignment. Supports an employee's own-history filter without trusting a display name. |
| Employee.userId and Employee.displayName | Maps the canonical authenticated user identity to an enabled employee and the required display name. userId is unique. A small Employee mapping entity prevents authorization based on names. |
| Asset.createdAt, createdBy, modifiedAt, modifiedBy | CAP managed audit fields for inventory changes. |
| Asset.retiredAt and Asset.retirementReason | Explain and timestamp a terminal retirement/disposal while keeping the required status string. |
| Asset.maintenanceReason | Records the reason for moving an unassigned asset into maintenance; cleared when maintenance is completed or the asset is retired. |
| Employee.active | Lets IT Admins allocate only to an enabled identity mapping without deleting former employees from history. |

No persisted compliance flag or asset status is required for alerts: the `complianceAlerts()` function calculates labels from type, expiryDate, allocation history, and configured thresholds on each read, so renewal changes the result immediately. Alert labels include Expired License, License Expiring Soon, Warranty Expired, Warranty Expiring Soon, Missing License Expiry, Missing Hardware Warranty, and Idle Asset; they are not lifecycle statuses.

## Types, lifecycle status, and transitions

Supported type values are Hardware and Software. Hardware expiryDate describes warranty coverage only. Software expiryDate describes license validity only.

The lifecycle vocabulary is Available, Allocated, In Maintenance, and Retired.

- The assessment's example Active is replaced by the more specific Available (ready and unassigned) and Allocated (currently assigned) states. There is no separate Active state.
- Retired represents a disposed asset and is terminal. It is never treated as available.
- Allocation status and compliance status are separate. An expired license may remain Allocated; the warning never clears or changes the assignment.
- New purchased assets enter Available when required purchase data is valid.
- Available to Allocated is allowed only through the allocation action.
- Allocated to Available is allowed only through the return action, which closes the active history row.
- Available to In Maintenance is allowed through a controlled IT Admin action. In Maintenance to Available is allowed after service completion.
- Available or In Maintenance may transition to Retired through a controlled IT Admin disposal action.
- An Allocated asset must first be returned using the normal return workflow; retirement is rejected while an active allocation exists.
- Retired assets cannot be allocated, renewed, or returned as though currently active.
- Direct status edits and unrestricted history create/update/delete are disallowed.

An IT Admin may edit the permitted descriptive fields, such as assetName, through a guarded operation. Identity, type, purchaseDate, status, allocatedTo, and expiryDate are not generic editable fields. The type is fixed at registration; software renewal uses a dedicated operation, and hardware warranty correction/extension uses a separately guarded warranty operation if included.

## Date rules and compliance calculations

The business timezone is proposed as Asia/Kolkata, matching the current workspace timezone; it must remain configurable for deployment. Dates are date-only values. A single injected/configured business clock supplies businessToday to handlers, UI labels, seed scenarios, and tests.

- purchaseDate cannot be later than businessToday. assignedDate is the business date of allocation. returnedDate is the business date of return and cannot precede assignedDate.
- Software requires expiryDate at registration and renewal. Renewal expiry must be strictly later than both businessToday and the current expiryDate (when present), so renewal extends rather than shortens coverage.
- Hardware expiryDate is optional when warranty information is unavailable. If supplied, it cannot precede purchaseDate.
- expiryDate equal to businessToday remains valid through today. A license is expired only when expiryDate is earlier than businessToday.
- A software license is expiring soon when it is not expired and its expiryDate is from businessToday through businessToday plus 30 calendar days, inclusive. The 30-day window is configurable.
- An expired hardware warranty is labeled Warranty Expired, not Expired License. The same 30-day inclusive window may produce Warranty Expiring Soon.
- A missing software expiry on imported legacy data is a No Expiry Date data-quality condition; it is not silently counted as expired or expiring. New software registrations cannot omit it. Missing hardware warranty dates produce an informational No Warranty Date condition, not a license alert.
- Automated date tests use a controlled reference date and cover expiry yesterday, today, today plus 30, and today plus 31.

## Idle asset rule

The idle period is configurable and defaults to 30 calendar days. An asset is idle only when its lifecycle status is Available and more than 30 full calendar days have elapsed since its idle baseline. The baseline is the latest returnedDate in its allocation history; if there is no prior allocation, use purchaseDate. Exactly 30 days is not idle; day 31 is. Assets in Allocated, In Maintenance, or Retired status are excluded. PurchaseDate is required, so a baseline should exist; missing historical data is surfaced as a data-quality issue rather than guessed.

## Identity mapping and least-privilege roles

The security identity is the immutable canonical subject supplied by the authenticated CAP principal (for example, the XSUAA user identity), not a person's display name or the request's allocatedTo/employeeName value. The Employee mapping resolves that subject to an enabled employee record.

| Role | Read access | Write/actions |
|---|---|---|
| Employee | Only currently assigned asset details, filtered server-side by the authenticated userId. Allocation history is reserved for IT Admin because the assessment only requires employees to view their assigned assets. | No inventory or history writes. |
| IT Admin | Full inventory and allocation history needed to operate the lifecycle. | Register/purchase; edit permitted descriptive fields; allocate; return/deallocate; renew software; maintain/release; retire/dispose. |
| Compliance Manager | Read-only compliance and idle projections containing asset identity, type, lifecycle status, expiry, compliance label, and idle baseline as needed. The projection omits employee user IDs and does not expose full assignment history. | No inventory, allocation, renewal, or retirement writes. |

CAP authorization applies to entity reads, actions, and direct OData requests. UI visibility is only a usability feature. Employees is read-only for IT Admins in the current service contract; it has no mapping CREATE/UPDATE operation or shipped provisioning command. Production onboarding therefore requires a trusted, audited provisioning process that maps the authenticated principal ID to Employee.userId before allocation. Do not use the local mock-user seed for production.

## Transaction, concurrency, and safe deletion assumptions

Allocation validates the asset and enabled employee inside one transaction, then performs a database-atomic conditional transition requiring the asset to still be Available and unassigned. Exactly one request must change the row; a zero-row result is a conflict. The same transaction writes the single active Allocation History row and display fields. SQLite write serialization is used in local development; the HANA implementation must use transaction/row-lock or equivalent atomic conditional-update behavior. A database uniqueness safeguard for one active allocation per asset should be added where supported. Two simultaneous allocation requests must be tested against each configured adapter.

Return locks or conditionally transitions the Allocated row and closes exactly its active history record in the same transaction. The handler rejects missing or multiple active rows and any second return; rollback leaves both Asset and history unchanged.

No allocation history row is overwritten. History with allocation records is immutable except for the one-time return closure by the return action. Assets that have any history are never physically deleted; they are retired. A physical delete may be allowed only for an IT Admin and an asset with no history, using a guarded delete operation that checks the history relation transactionally. If the database/adapter cannot enforce the guard safely, disable physical delete entirely and use retirement.

## Implemented CAP service contract

The compiled service is AssetManagementService at /odata/v4/asset-management/. Its exposed entities are Assets, AllocationHistories, Employees, and employee-scoped MyAssets. IT Admins can read allocation history and employee mappings. Employees can read only MyAssets; the handler applies the authenticated principal filter server-side. Compliance Managers and IT Admins call the complianceAlerts() function; any authenticated user can call sessionInfo() for their own principal/role context.

Lifecycle operations exactly match srv/asset-management-service.cds: allocateAsset, returnAsset, renewSoftwareLicense, placeInMaintenance, releaseFromMaintenance, and retireAsset. Asset registration is POST Assets; permitted generic asset update is PATCH Assets for assetName only. DELETE Assets is guarded and physically deletes only an unassigned Available asset with no allocation history. Allocation history is read-only to clients; the allocate/return handlers create and close history rows. There is no registerAsset, updateAssetDetails, setHardwareWarranty, or deleteUnallocatedAsset action, and no employee-mapping write action. This section supersedes the earlier proposed operation list.

Generic API mutations are restricted so lifecycle state and history cannot bypass action handlers. Implemented actions return validation, authorization, not-found, conflict, or server errors without partial database writes.
## Local and Cloud Foundry differences

The current package configuration uses file-backed SQLite (db.sqlite) and mock users in development/test. Its production profile selects SAP HANA through @cap-js/hana and XSUAA authentication. The MTA declares a dedicated-tenant XSUAA application service, HANA HDI container, and standalone approuter. Local configuration is evidenced; Cloud Foundry deployment, role assignment, and production identity onboarding remain unverified.



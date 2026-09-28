# CAP Service Contract

This contract is the implementation boundary for the CAP backend and SAPUI5 client. Local code and Build Code changes should use the same entity and operation names. If a compiled CAP service requires a change, update this contract, the UI5 client, and the service definition document together.

## Service root and OData model

- CAP service: `AssetManagementService`.
- OData V4 root: `/odata/v4/asset-management/`.
- Persistence namespace: `it.asset.lifecycle`.
- Required entities: `Asset` and `AllocationHistory`.
- Collections exposed by the service: `Assets`, `AllocationHistories`, `Employees`, and `MyAssets`.
- `AllocationHistory.asset` is a managed CDS association to `Asset`. CAP's generated foreign-key property is `asset_assetID` (association name `asset` + key `assetID`). This is the service-visible representation of the required `assetID` relationship.

## Entity operations and access

| Collection | Purpose | Access |
|---|---|---|
| `Assets` | IT Admin inventory and lifecycle state, preserving every required Asset field. | IT Admin can read and register. Generic PATCH may change `assetName` only. Generic DELETE can remove an asset only if no history exists. Lifecycle fields are changed through named actions. |
| `MyAssets` | Employee's currently assigned assets, filtered by authenticated `req.user.id`. | Employee read only. A client filter cannot widen the server-side identity predicate. |
| `AllocationHistories` | Historical allocation trace, including generated `asset_assetID`, required employee display name, identity snapshot, assignment date, and nullable return date. | IT Admin read only. Direct create, update, upsert, and delete are rejected; return action closes one active row. |
| `Employees` | Enabled employee identities and display names used for allocation, with `userId`, `displayName`, and `active`. | IT Admin read only. The mapping is not an employee-maintained public endpoint. |

Generic `POST Assets` registers a purchased, unassigned asset and initializes its lifecycle status to `Available`. The client cannot set `Allocated`, `allocatedTo`, employee identity keys, or audit values at registration. Generic PATCH rejects changes to `status`, `allocatedTo`, identity keys, type, purchase date, expiry date, retirement fields, and audit fields. Generic DELETE is IT Admin only and is rejected once any allocation history exists; historical assets are retired through the lifecycle action. Generic writes to `AllocationHistories` are denied.

## Actions and functions

All writes require the IT Admin role, regardless of UI visibility. CAP applies authorization to direct OData requests. `employeeUserId` is resolved against the enabled Employee mapping; `employeeName` is populated by the server rather than trusted from the request.

| Operation | Parameters | Result |
|---|---|---|
| `allocateAsset` | `assetID: UUID`, `employeeUserId: String` | Atomically changes an eligible unassigned `Available` asset to `Allocated`, records the trusted employee display name and immutable user identity, and inserts exactly one active history row. |
| `returnAsset` | `assetID: UUID` | Atomically closes exactly one active history row with today's business date, clears both assignment values, and changes the asset to `Available`. |
| `renewSoftwareLicense` | `assetID: UUID`, `newExpiryDate: Date` | Extends a non-retired Software expiry only when the new date is later than today and the prior expiry. The next compliance read reflects it immediately. |
| `placeInMaintenance` | `assetID: UUID`, `reason: String` | Changes an unassigned `Available` asset to `In Maintenance`. |
| `releaseFromMaintenance` | `assetID: UUID` | Changes an `In Maintenance` asset to `Available`. |
| `retireAsset` | `assetID: UUID`, `reason: String` | Retires an unassigned `Available` or `In Maintenance` asset, records the reason and time, and preserves history. An allocated asset must first be returned. |
| `complianceAlerts` | none | Returns a `ComplianceSummary` with `businessToday`, configured thresholds, and grouped arrays `expiredLicenses`, `expiringLicenses`, `hardwareWarrantyAlerts`, `idleAssets`, and `missingDateAlerts`. Each row has `assetID`, `assetName`, `type`, `status`, and applicable `expiryDate`, `alertType`, `daysRemaining`, `idleSince`, and `daysIdle`. Available to IT Admin and Compliance Manager; employee identity fields are omitted. |
| `sessionInfo` | none | Returns `{ userId, roles, businessToday, timeZone }` for interface navigation. It is informational and grants no additional access. |

Lifecycle action results are the changed Asset record. `Employees` rows use `{ userId, displayName, active }`. Validation errors return a clear client error. Duplicate or stale lifecycle changes return a conflict. CAP executes each lifecycle mutation in the request transaction; asset and history changes commit together or roll back together.

## Search, filtering, and paging

Inventory reads use OData server-side `$search` where supported, `$filter`, `$orderby`, `$top`, and `$skip`. UI pages request a bounded page and retrieve later pages from the service. Employee identity filtering is enforced server-side. Compliance alerts use the same configurable expiry, timezone, and idle rules as test fixtures.

## Identity and local/cloud distinction

The immutable subject from the authenticated CAP principal (`req.user.id`) is the identity key. Local mocked user IDs are explicitly seeded for development and tests; the Employee mapping stores `userId` and a display name. `allocatedTo` and `employeeName` are human-readable snapshots and never authorization keys. On Cloud Foundry, CAP uses the authenticated XSUAA principal and role scopes; no mock users are enabled in production.

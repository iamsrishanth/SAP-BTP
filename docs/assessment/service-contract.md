# CAP Service Contract

This contract is the implementation boundary for the CAP backend and SAPUI5 client. Local code and Build Code changes should use the same entity and operation names. If a compiled CAP service requires a change, update this contract, the UI5 client, and the service definition document together.

## Service root and OData model

- CAP service: `AssetManagementService`.
- OData V4 root: `/odata/v4/asset-management/`.
- Persistence namespace: `it.asset.lifecycle`.
- Required entities: `Asset` and `AllocationHistory`.
- Collections exposed by the service: `Assets`, `AllocationHistories`, `Employees`, and `MyAssets`.
- `AllocationHistory.assetID` is the required managed CDS association to `Asset`. CAP's generated foreign-key property is `assetID_assetID` (association name `assetID` + target key `assetID`). The literal required association attribute and its semantics are preserved.

## Entity operations and access

| Collection | Purpose | Access |
|---|---|---|
| `Assets` | IT Admin inventory and lifecycle state, preserving every required Asset field. | IT Admin can read and register. Generic PATCH may change `assetName` only. Generic DELETE can remove an asset only if no history exists. Lifecycle fields are changed through named actions. |
| `MyAssets` | Employee's currently assigned assets, filtered by authenticated `req.user.id`. | Employee read only. A client filter cannot widen the server-side identity predicate. |
| `AllocationHistories` | Historical allocation trace, including generated `assetID_assetID`, required employee display name, identity snapshot, assignment date, and nullable return date. | IT Admin read only. Employee and Compliance Manager do not read history. Direct create, update, upsert, and delete are rejected; return action closes one active row. |
| `Employees` | Enabled employee identities and display names used for allocation, with `userId`, `displayName`, and `active`. | IT Admin reads; generic create/update/delete/upsert are denied. The controlled provisionEmployee action creates a new verified mapping. Employee and Compliance Manager have no directory access. |

Generic `POST Assets` registers a purchased, unassigned asset and initializes its lifecycle status to `Available`. The client cannot set `Allocated`, `allocatedTo`, employee identity keys, or audit values at registration. Generic PATCH rejects changes to `status`, `allocatedTo`, identity keys, type, purchase date, expiry date, retirement fields, and audit fields. Generic DELETE is IT Admin only and is rejected once any allocation history exists; historical assets are retired through the lifecycle action. Generic writes to `AllocationHistories` are denied.

## Actions and functions

All writes require the IT Admin role, regardless of UI visibility. CAP applies authorization to direct OData requests. `employeeUserId` is resolved against the enabled Employee mapping; `employeeName` is populated by the server rather than trusted from the request.

| Operation | Parameters | Result |
|---|---|---|
| `provisionEmployee` | `userId: String(255)`, `displayName: String(200)` | ITAdmin creates one active mapping for a verified authenticated subject. Trims surrounding whitespace, preserves case, rejects blanks/control characters/overlength values and duplicates, and records actor/time in managed audit fields. Returns public Employee fields; does not grant BTP roles or credentials. |
| `allocateAsset` | `assetID: UUID`, `employeeUserId: String` | Atomically changes an eligible unassigned `Available` asset to `Allocated`, records the trusted employee display name and immutable user identity, and inserts exactly one active history row. |
| `returnAsset` | `assetID: UUID` | Requires exactly one active row whose identity and display snapshot match the current assignment. Atomically closes it with today's business date, clears both assignment values, and changes the asset to `Available`. Missing, duplicate, mismatched, or already-closed active history is a conflict. |
| `renewSoftwareLicense` | `assetID: UUID`, `newExpiryDate: Date` | Extends a non-retired Software expiry only when the new date is later than today and the prior expiry. The next compliance read reflects it immediately. |
| `placeInMaintenance` | `assetID: UUID`, `reason: String` | Changes an unassigned `Available` asset to `In Maintenance`. |
| `releaseFromMaintenance` | `assetID: UUID` | Changes an `In Maintenance` asset to `Available`. |
| `retireAsset` | `assetID: UUID`, `reason: String` | Retires an unassigned `Available` or `In Maintenance` asset, records the reason and time, and preserves history. An allocated asset must first be returned. |
| `complianceAlerts` | none | Returns a `ComplianceSummary` with `businessToday`, configured thresholds, and grouped arrays `expiredLicenses`, `expiringLicenses`, `hardwareWarrantyAlerts`, `idleAssets`, and `missingDateAlerts`. Each row has `assetID`, `assetName`, `type`, `status`, and applicable `expiryDate`, `alertType`, `daysRemaining`, `idleSince`, and `daysIdle`. Available to IT Admin and Compliance Manager; employee identity fields are omitted. |
| `sessionInfo` | none | Returns `{ userId, roles, businessToday, timeZone }` for interface navigation. It is informational and grants no additional access. |

Lifecycle action results are the changed Asset record. `Employees` rows use `{ userId, displayName, active }`. Validation errors return a clear client error. Duplicate or stale lifecycle changes return a conflict. CAP executes each lifecycle mutation in the request transaction; asset and history changes commit together or roll back together.

## Search, filtering, and paging

Inventory reads use OData server-side `$search` where supported, `$filter`, `$orderby`, `$top`, and `$skip`. UI pages request a bounded page and retrieve later pages from the service. Employee identity filtering is enforced server-side. Compliance alerts use the same configurable expiry, timezone, and idle rules as test fixtures.

The implemented UI uses `$filter` for text/name/type or full UUID search, type/status filters, `$orderby`, `$count`, `$top=25`, and `$skip`; it does not depend on a disconnected inventory. The Employee handler preserves single-resource keys, selected public fields, and scoped count queries. A foreign/unknown Employee asset key returns 404. Current allocation directory/history requests are capped at 500/100 respectively without continuation controls; compliance returns grouped arrays after a full inventory/history calculation. Scale checks remain separate from contract presence.

## Identity and local/cloud distinction

The immutable subject from the authenticated CAP principal (`req.user.id`) is the identity key. Local mocked user IDs are explicitly seeded for development and tests; the Employee mapping stores `userId` and a display name. `allocatedTo` and `employeeName` are human-readable snapshots and never authorization keys. On Cloud Foundry, CAP uses the authenticated XSUAA principal and role scopes; no mock users are enabled in production.

Cloud onboarding uses `provisionEmployee` after an Admin verifies the recipient's actual authenticated `sessionInfo().userId`. Existing mappings cannot be overwritten or removed through the public API. Role collection assignment and Employee mapping creation are separate; neither alone demonstrates the Employee assignment flow. The [deployment guide](../deployment.md) gives the concrete sequence and remaining execution checks.

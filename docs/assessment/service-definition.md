# CAP Service Definition and Usage

The implemented contract is in [`srv/asset-management-service.cds`](../../srv/asset-management-service.cds), backed by [`db/schema.cds`](../../db/schema.cds) and lifecycle handlers in [`srv/asset-management-service.js`](../../srv/asset-management-service.js). CAP serves the OData V4 service at `/odata/v4/asset-management/`.

## Exposed entities

| Entity set | Access | Purpose |
|---|---|---|
| `Assets` | IT Admin reads; IT Admin creates; restricted IT Admin name-only updates; guarded deletes | Inventory. Lifecycle fields can change only through named operations. |
| `AllocationHistories` | IT Admin read-only | Immutable assignment history. Create, update, upsert, and delete requests are rejected; lifecycle handlers create records and set `returnedDate`. |
| `Employees` | IT Admin read; generic writes denied | Trusted active employee directory, keyed by verified authenticated CAP user ID; controlled provisionEmployee action creates a new mapping with persisted audit fields. |
| `MyAssets` | Employee read-only, server-filtered by authenticated subject | Only the calling employee's currently allocated assets. The server adds the identity predicate and returns only public asset fields. |

Every entity read is subject to its CDS role annotation. The `MyAssets` read handler also binds results to `req.user.id`; client query parameters cannot select a different employee. The Employee role does not expose the allocation history entity.

## Operations

| Operation | Method and path | Allowed role | Rule |
|---|---|---|---|
| `provisionEmployee(userId, displayName)` | `POST /odata/v4/asset-management/provisionEmployee` | ITAdmin | Creates an active mapping for an Admin-verified authenticated subject; trims whitespace, preserves case, rejects blanks/control characters/overlength/duplicates, audits actor/time, and grants no BTP roles or credentials. |
| `allocateAsset(assetID, employeeUserId)` | `POST /odata/v4/asset-management/allocateAsset` | ITAdmin | Requires Available and unassigned asset plus an active employee from `Employees`; atomically changes status/assignee and inserts one history row. |
| `returnAsset(assetID)` | `POST /odata/v4/asset-management/returnAsset` | ITAdmin | Requires exactly one active history row matching the asset's current employee ID and display name; atomically closes it, clears current assignee, and restores Available. Missing, duplicate, mismatched, or repeated returns fail without partial updates. |
| `renewSoftwareLicense(assetID, newExpiryDate)` | `POST /odata/v4/asset-management/renewSoftwareLicense` | ITAdmin | Software only; new date must be valid, later than today, and later than existing expiry when present. Alerts are calculated from the stored date on each read. |
| `placeInMaintenance(assetID, reason)` | `POST /odata/v4/asset-management/placeInMaintenance` | ITAdmin | Available, unassigned assets only; stores the reason. |
| `releaseFromMaintenance(assetID)` | `POST /odata/v4/asset-management/releaseFromMaintenance` | ITAdmin | Maintenance only; returns asset to Available. |
| `retireAsset(assetID, reason)` | `POST /odata/v4/asset-management/retireAsset` | ITAdmin | Available or maintenance assets only. An allocation must first be returned. Retired is terminal and past history remains. |
| `complianceAlerts()` | `GET /odata/v4/asset-management/complianceAlerts()` | ITAdmin or ComplianceManager | Returns grouped software expiry, hardware warranty, idle, and missing-date alerts with effective thresholds and business date. |
| `sessionInfo()` | `GET /odata/v4/asset-management/sessionInfo()` | Any authenticated user | Returns authenticated subject, recognized roles, business date, and timezone. |

`Assets` create requests accept only `assetName`, `type`, `purchaseDate`, and `expiryDate`; the backend generates a UUID and enforces Available/unassigned initial state. Direct generic updates accept only `assetName`. Direct operations changing status, expiry, allocation identity, retirement, or history are rejected or blocked by lifecycle rules. Physical deletion is allowed only for an unassigned Available asset with no allocation history; otherwise retire it.

Use OData server-side query options such as `$search`, `$filter`, `$orderby`, `$top`, and `$skip` on the `Assets` entity set for inventory queries. The SAPUI5 client should keep list queries paged. `MyAssets` remains identity-filtered by the server even when these options are present.

## Data model relationship and generated key

`AllocationHistory.assetID` is the assessment's required association attribute and is a real managed CDS association to `Asset`. CAP materializes its foreign key as `assetID_assetID`. The history entity preserves `allocID`, `assetID`, `employeeName`, `assignedDate`, and nullable `returnedDate`; `employeeUserId` is an additional immutable recipient identity snapshot for audit and consistency checks. Only IT Admin reads history; Employee and Compliance Manager are denied. Clients cannot write history rows directly.

The previous source named the association `asset`, generating `asset_assetID`. Historical logs retain that older source snapshot. [scripts/migrate-history-association.js](../../scripts/migrate-history-association.js) preserves existing SQLite history during the required-name change. It runs automatically before schema evolution in `npm run db:deploy`; stop the development server before applying schema maintenance.

## Error behavior

Handlers return application errors for missing/invalid values, nonexistent or inactive employees, unsupported types, forbidden transitions, repeated allocation/return, history inconsistency, renewal of non-software, and concurrent state changes. Expected categories are HTTP 400 for invalid input, 401 for absent authentication, 403 for insufficient role, 404 for missing records, 405 for forbidden history lifecycle writes where supported by CAP, and 409 for state conflicts. Actual CAP OData response bodies should be taken from the automated test logs rather than assumed from this summary.

## Configuration

The development and test profiles use CAP mock identities only. The production profile selects XSUAA. `ASSET_TIME_ZONE`, `ASSET_EXPIRY_WARNING_DAYS`, and `ASSET_IDLE_DAYS` configure dates and thresholds. `ASSET_FIXED_TODAY` fixes the business date for controlled runs; leave it unset for normal operation. `db/seed.js` seeds only a new non-production database.

For cloud onboarding, authenticate the recipient through the approuter and obtain their actual `sessionInfo().userId`; then have an authorized IT Admin verify and provision that exact ID. Example action body:

~~~json
{"userId":"<verified-sessionInfo-userId>","displayName":"<verified-employee-display-name>"}
~~~

This is an example body, not an executed provisioning record. Existing mappings cannot be overwritten through this action; generic Employee writes remain blocked. XSUAA role collection assignment is a separate BTP administrator step.

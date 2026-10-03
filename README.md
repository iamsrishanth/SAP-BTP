# IT Asset Lifecycle Management

SAP CAP (Node.js) and SAPUI5 capstone for registering, allocating, returning, renewing, and retiring company assets. The backend is the authority for lifecycle rules, identity filtering, and permissions. The SAPUI5 client calls the CAP OData V4 service; it contains no sample inventory of its own.

## Local setup and run

Use Node.js **24.x** and npm for the reproducible local and deployment build. The root package permits Node >=22, while the generated HDI deployer requires Node ^24; Node 24 satisfies all current module ranges. The checked-in root and approuter lock files support reproducible dependency installation.

~~~powershell
npm ci
npm run db:deploy
npm run watch
~~~

Open the UI at `http://localhost:4004/` while the CAP server is running. CAP also exposes the OData V4 service at `/odata/v4/asset-management/`; its metadata is at `/odata/v4/asset-management/$metadata`.

Development uses file-backed SQLite (`db.sqlite`). Stop the development server before schema maintenance. `npm run db:deploy` first runs the local [history-association migration](scripts/migrate-history-association.js), then CAP deploy with automatic schema evolution. The migration preserves the old `asset_assetID` values by renaming the column to `assetID_assetID`, creates a consistent SQLite backup under ignored `db-backups/`, checks the persisted columns against the current model, and establishes the schema baseline. It refuses ambiguous/incomplete schemas. A fresh database has no legacy column to migrate. Do not replace or delete an existing database to apply the contract update.

Demo records are seeded only into an empty non-production inventory after schema initialization. Their dates are relative to the business date at the first seed; later starts preserve them and do not re-date the inventory. Use the [controlled demonstration procedure](docs/assessment/demonstration-script.md) for repeatable boundary examples. Production selects SAP HANA through `@cap-js/hana`; cloud authentication uses XSUAA. Deployment does not automatically copy local SQLite contents. The [authorized trial transfer and cloud demo profiles](docs/cloud-demo-data.md) provide an explicit, guarded one-off data import and restricted demo-operator profiles.

## Demo users

These mock users are for local development and tests only. Use the `username` and password below with CAP's development mock authentication. CAP exposes the authenticated IDs as the raw usernames (for example, `employee.alex`), which are mapped to `Employee.userId`; authorization never uses the employee display name.

| Username | Password | Role | Purpose |
|---|---|---|---|
| `it.admin` | `demo-admin` | ITAdmin | Inventory and lifecycle workflows |
| `employee.alex` | `demo-employee` | Employee | Alex's assigned assets only |
| `employee.jamie` | `demo-employee` | Employee | Jamie's assigned assets only |
| `compliance.manager` | `demo-compliance` | ComplianceManager | Compliance and idle-asset alerts |

The credentials are disposable local assessment fixtures; do not reuse them in a deployed environment. Cloud deployment is configured for XSUAA and requires role-template/role-collection mapping and a trusted authenticated-user-to-employee mapping. IT Admin uses the controlled `provisionEmployee(userId, displayName)` action to create an active mapping from an actually verified `sessionInfo().userId`. It preserves case, rejects duplicate/invalid/control-character values, records the administrator in managed audit fields, and grants no identity-provider credentials or BTP roles. Generic Employee writes remain disabled.

## Configuration and behavior

- `ASSET_TIME_ZONE` sets the IANA timezone used for the business date; default: `Asia/Kolkata`.
- `ASSET_EXPIRY_WARNING_DAYS` sets the warning window; default: `30` days.
- `ASSET_IDLE_DAYS` sets the idle threshold; default: `30` days.
- `ASSET_FIXED_TODAY` fixes the business date for repeatable tests and demonstrations. Leave it unset for normal local operation.
- `ASSET_SEED_DEMO=false` disables development demo seeding; local development otherwise seeds an empty database with relative-date examples.

Expiry today is still valid and appears in “expiring soon”; expiry before today is expired. Hardware warranty alerts are separate from software license alerts. An available asset is idle only after more than the configured number of calendar days since its latest return or purchase date. Retired and maintenance assets are excluded from idle alerts. Allocated assets must be returned before retirement.

## Compile, build, and test

~~~powershell
npm run compile
npm test
npm run build
npm run copy:ui
~~~

`npm test` starts isolated in-memory SQLite with a fixed 2026-09-28 reference date and includes disposable migration fixtures; it does not reset `db.sqlite`. The current [root CAP test log](docs/evidence/2026-10-01-backend-tests.log) records **19 passing** tests. The independent adversarial review has a separate [review record](docs/evidence/independent-review-2026-10-01.md) and harness output; these are separate checks.

`npm run build` generates the CAP production modules. `npm run copy:ui` copies the actual SAPUI5 source into `gen/srv/app` for MTA packaging; rerun both after source changes. The approuter has its own locked dependencies and `npm test --prefix .deploy/app-router` verification script. Test/build command availability does not prove a run or deployment.

## Architecture and lifecycle

- `db/schema.cds` defines required `Asset` and `AllocationHistory` entities and the genuine required `AllocationHistory.assetID` association. CAP exposes its generated foreign-key property as `assetID_assetID`.
- `srv/asset-management-service.cds` exposes the service contract and role restrictions; `srv/asset-management-service.js` implements validation and lifecycle operations.
- `app/` is the SAPUI5 application served with the CAP service.
- `db/seed.js` provides relative-date first-run demo data; existing persisted seed dates remain unchanged on later runs.
- `mta.yaml` and `xs-security.json` describe the Cloud Foundry/HANA/XSUAA deployment path when available.

The exact assumptions, field additions, transitions, authorization rules, and service operations are documented in [Assumptions and Data Model](docs/assessment/assumptions-and-data-model.md) and [Service Definition](docs/assessment/service-definition.md).

## Submission documents and evidence

Start with the [full submission index](docs/assessment/submission-index.md) and [three-role demonstration script](docs/assessment/demonstration-script.md).

| Deliverable | File |
|---|---|
| Project Overview Document | [Project Overview](docs/assessment/project-overview.md) |
| Data Model Design | [Assumptions and Data Model](docs/assessment/assumptions-and-data-model.md) |
| CAP Service Definition | [CDS service source](srv/asset-management-service.cds) and [service usage notes](docs/assessment/service-definition.md) |
| Three-Sprint Plan | [Agile Sprint Plan](docs/assessment/agile-sprint-plan.md) |
| Test Case Sheet | [Test Case Sheet CSV](docs/assessment/test-case-sheet.csv) |
| Requirement-to-Evidence Matrix | [Acceptance Matrix CSV](docs/assessment/requirement-evidence-matrix.csv) |
| Cloud Foundry Deployment Steps | [Deployment Guide](docs/deployment.md) |
| Build Code Prompt Log | [Build Code Prompt Log](docs/assessment/build-code-prompt-log.md) |
| Execution Evidence Index | [Execution Evidence](docs/assessment/execution-evidence.md) |
| Official SAP Documentation | [Source index](docs/assessment/official-sap-sources.md) |
| Document Consistency Review | [Review and resolutions](docs/assessment/document-consistency-review.md) |

## SAP environment and deployment status

On 2026-10-01 the lead created the `ITAssetLifecycle` Full-Stack Node.js project from this Git repository in the SAP Build lobby and cloned source revision `f7d5c44` to `/home/user/projects/SAP-BTP` in the BAS devspace `ws-ue4j9`. In BAS, the repaired source compiled and built, the MTA archive was created, SQLite schema deployment succeeded with the history migration, and CAP started on port 4004. The live BAS preview was exercised for IT Admin inventory/search, Employee own-assets/detail, and Compliance Manager alerts. The current observations and screenshot limitations are in [BAS verification notes](docs/evidence/bas-environment-verification-2026-10-01.md); earlier terminal and inventory screenshots are indexed in [Execution Evidence](docs/assessment/execution-evidence.md).

The BAS preview observed by the lead is [the devspace port 4004 preview](https://port4004-workspaces-ws-ue4j9.us10.trial.applicationstudio.cloud.sap/); it requires the authorized BAS session and running development server. It is not a deployed Cloud Foundry app route.

The repaired source was deployed once to the authorized trial Cloud Foundry space on 2026-10-03. The router returned HTTP 200, and the live SAPUI5 route connected through the existing SAP BTP session as ComplianceManager. BTP Cockpit confirms that sap-btp-it-asset-lifecycle-db is bound to the CAP server and database deployer, and its live database_id matches the Running loyalty-reward-db HANA Cloud instance. The asset app has its own HDI container. See the [deployment result](docs/evidence/cloud-deploy-success-2026-10-03.md) and [deployment guide](docs/deployment.md). The ITAdmin role collection has no users, groups, or attribute mappings; an authorized ITAdmin identity is needed for the cloud Admin demonstration. Cloud role/lifecycle/persistence verification and Build Code code generation remain blocked or unrun. BAS preview, local SQLite, and Cloud Foundry evidence are tracked separately in the [requirement matrix](docs/assessment/requirement-evidence-matrix.csv).

Evidence and status are reported in the matrix and evidence index. The assessment portal and permanent submission remain under the user's control.

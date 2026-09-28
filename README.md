# IT Asset Lifecycle Management

SAP CAP (Node.js) and SAPUI5 capstone for registering, allocating, returning, renewing, and retiring company assets. The backend is the authority for lifecycle rules, identity filtering, and permissions. The SAPUI5 client calls the CAP OData V4 service; it contains no sample inventory of its own.

## Local setup and run

Prerequisites: Node.js 22 or newer and npm. The checked-in lock file is intended for reproducible dependency installation.

~~~powershell
npm ci
npm run db:deploy
npm run watch
~~~

Open the UI at `http://localhost:4004/` while the CAP server is running. CAP also exposes the OData V4 service at `/odata/v4/asset-management/`; its metadata is at `/odata/v4/asset-management/$metadata`.

Development uses file-backed SQLite (`db.sqlite`) so successful changes can persist across browser refreshes and server restarts. CAP requires `npm run db:deploy` to create or update this persistent database schema before starting the server; the `watch` command does not deploy a persistent SQLite schema automatically. Demo records are seeded only into an empty local development database after the schema exists. Delete the local database file only when you intend to reset that demo database. Production configuration selects SAP HANA through `@cap-js/hana`; local mock authentication must not be used as cloud authentication.

## Demo users

These mock users are for local development and tests only. Use the `username` and password below with CAP's development mock authentication. CAP exposes the authenticated IDs as the raw usernames (for example, `employee.alex`), which are mapped to `Employee.userId`; authorization never uses the employee display name.

| Username | Password | Role | Purpose |
|---|---|---|---|
| `it.admin` | `demo-admin` | ITAdmin | Inventory and lifecycle workflows |
| `employee.alex` | `demo-employee` | Employee | Alex's assigned assets only |
| `employee.jamie` | `demo-employee` | Employee | Jamie's assigned assets only |
| `compliance.manager` | `demo-compliance` | ComplianceManager | Compliance and idle-asset alerts |

The credentials are disposable local assessment fixtures; do not reuse them in a deployed environment. Cloud deployment is configured for XSUAA and requires role-template/role-collection mapping and an immutable user-subject-to-employee mapping.

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
npm run build
npm test
~~~

`npm test` runs the CAP HTTP integration suite against the documented local mock roles and a fixed reference date. Review the generated evidence files for the actual run result; these commands do not prove BAS, Build Code, or Cloud Foundry deployment use.

## Architecture and lifecycle

- `db/schema.cds` defines required `Asset` and `AllocationHistory` entities and the genuine `AllocationHistory.asset` association. CAP exposes the generated foreign-key property as `asset_assetID`.
- `srv/asset-management-service.cds` exposes the service contract and role restrictions; `srv/asset-management-service.js` implements validation and lifecycle operations.
- `app/` is the SAPUI5 application served with the CAP service.
- `db/seed.js` provides relative-date demo data, so expiring/expired/idle examples remain useful as the current date changes.
- `mta.yaml` and `xs-security.json` describe the Cloud Foundry/HANA/XSUAA deployment path when available.

The exact assumptions, field additions, transitions, authorization rules, and service operations are documented in [Assumptions and Data Model](docs/assessment/assumptions-and-data-model.md) and [Service Definition](docs/assessment/service-definition.md).

## Submission documents and evidence

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

Evidence and status are reported in the matrix and evidence index. Local test success does not establish cloud deployment or assessment submission. The assessment portal remains under the user's control.

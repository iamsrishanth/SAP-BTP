# SAP BTP Cloud Foundry Deployment Guide

Updated **2026-10-01 (Asia/Kolkata)** against the current MTA, trial extension, service contract, and lead environment observations. **This application's Cloud Foundry deployment and cloud smoke tests are not yet recorded as successful.** BAS execution, cloud access, HANA availability, and an actual deployed application are distinct evidence.

## Target inspected by the lead

| Item | Observed value / status |
|---|---|
| CF API | https://api.cf.us10-001.hana.ondemand.com |
| Organization / space | 6fd93d19trial / dev |
| Authentication | SSO refreshed; target selected by the lead. Do not store tokens or passcodes in the repository. |
| HANA availability | hana / hdi-shared plan available; existing HANA Cloud instance loyalty-reward-db reported Running. |
| Selected database ID | 0dda540b-396a-487b-b665-805ed690ec14 |
| Task service instances | Task-specific XSUAA and HDI service instances were present and bound to the task apps. The task service, router, and deployer applications were stopped at the last inspection. |
| Task route and cloud roles | A successful app deployment/runtime, usable route, role assignment, or cloud lifecycle result is not recorded. |

The [trial extension](../mta.trial.mtaext) selects this database by database_id. It provisions the task's separate HDI container and does not reuse another application's schema. Inspect the target before deployment; these observed account values should not be reused in another account.

## Deployment architecture

The [MTA descriptor](../mta.yaml) has ID sap-btp-it-asset-lifecycle:

| Module/resource | Actual configuration | Purpose |
|---|---|---|
| sap-btp-it-asset-lifecycle-srv | Node.js, gen/srv, nodejs_buildpack, 512M memory/disk | CAP/OData runtime plus copied SAPUI5 assets; binds HANA and XSUAA. |
| sap-btp-it-asset-lifecycle-db-deployer | hdb, gen/db, nodejs_buildpack, 256M memory/512M disk | Deploys generated database artifacts into the task's HDI container. |
| sap-btp-it-asset-lifecycle | approuter.nodejs, .deploy/app-router, 256M memory/disk | Public authenticated entry point; srv-api destination forwards the user token to CAP. |
| sap-btp-it-asset-lifecycle-auth | xsuaa / application, dedicated tenant, xs-security.json | Application scopes, role templates, and declared role collections. |
| sap-btp-it-asset-lifecycle-db | com.sap.xs.hdi-container, hana / hdi-shared | HANA persistence; trial extension supplies the selected database_id. |

The service module explicitly sets ASSET_SEED_DEMO=false and ASSET_TIME_ZONE=Asia/Kolkata. The production CAP profile uses HANA/XSUAA. Do not set ASSET_FIXED_TODAY for normal cloud operation. The default warning/idle thresholds are 30 days; overrides must be reflected in test/demo evidence.

Approuter xs-app.json routes the root to srv-api with CSRF protection. Its startup wrapper validates request-target size and percent encoding before the router handles requests. The source and locked router dependencies are part of the application package; inspect actual audit/runtime results in the independent review.

## Runtime and tooling prerequisites

Use **Node.js 24.x** and npm for the reproducible build. The root engine range allows >=22, the router allows Node 22 or 24, and the generated HDI deployer requires Node ^24. Check the actual generated package and Cloud Foundry Node buildpack support instead of assuming a root Node 22 install is sufficient.

Required tooling: CAP project dependencies installed with npm ci; Cloud MTA Build Tool; Cloud Foundry CLI v8 or later; MultiApps plugin; GNU Make where required by mbt on Windows. BAS provides a Linux development environment; inspect versions/tool availability there before use. Deployer permissions, quota, a running HANA instance/HDI entitlement, and XSUAA application entitlement must be available in the selected space.

~~~powershell
node --version
npm --version
cf --version
cf plugins
mbt --version
cf target
cf marketplace -e hana
cf marketplace -e xsuaa
~~~

Local tooling availability differs from the BAS environment; the initial local missing-tool record does not describe the later BAS target.

## Local persistence and preserving existing history

Local development uses db.sqlite; production HANA does not receive its contents. Stop the development server before schema maintenance, then use:

~~~powershell
npm ci
npm run db:deploy
npm run watch
~~~

The db:deploy script first invokes [the SQLite history migration](../scripts/migrate-history-association.js), then cds deploy --with-auto-schema-evolution. It renames the legacy asset_assetID history column to the required association FK assetID_assetID, creates a consistent backup under ignored db-backups/, validates persisted columns, and establishes the CDS schema baseline. It preserves history/business rows and refuses an ambiguous or incomplete schema. A fresh database has no legacy association to migrate. The helper is SQLite-only and is not a HANA migration tool.

Seed data is development/test-only, runs against an empty inventory, and keeps its first-seed dates across later starts. The production guard plus explicit MTA ASSET_SEED_DEMO=false prevent cloud mock seeding. Existing local files/backups should be preserved; no database reset is needed to apply the association rename.

## Verify and build the actual source

~~~powershell
npm run compile
npm test
npm run build
npm run copy:ui
npm ci --prefix .deploy/app-router
npm test --prefix .deploy/app-router
~~~

The main suite runs against isolated in-memory SQLite with a controlled business date. Its repair log records the actual result and source contract. Independent adversarial checks and router audit/tests have separate evidence. Rebuild after the final source edit, including employee provisioning, association migration, UI forms, or router changes.

MTA before-all performs:

~~~yaml
commands:
  - npm ci
  - npx cds build --production
  - npm run copy:ui
~~~

The copy step is a project script that packages app/ into gen/srv/app. Check the resulting UI/source hashes or archive contents. CAP build output alone is not an MTAR deployment result.

## Build and deploy to the authorized trial target

Authenticate through the actual SSO flow when a valid session is not already available:

~~~powershell
cf api https://api.cf.us10-001.hana.ondemand.com
cf login --sso
cf target -o 6fd93d19trial -s dev
cf target
mbt build -t gen --mtar mta.tar
cf deploy gen/mta.tar -e mta.trial.mtaext -f
~~~

The extension must match MTA ID sap-btp-it-asset-lifecycle and the selected running database. The -e option applies the deployment extension; the -f option skips a conflicting-process confirmation, so check the target and ongoing MTA operations before use. Deployment was authorized for this task's target and attempted after the packaging repair. It timed out before registering an operation; see the [deployment attempt record](evidence/cloud-deploy-attempt-2026-10-01.md). Do not infer success from the archive build.

After a future deployment completes:

~~~powershell
cf apps
cf services
cf routes
cf logs sap-btp-it-asset-lifecycle-srv --recent
cf logs sap-btp-it-asset-lifecycle-db-deployer --recent
cf logs sap-btp-it-asset-lifecycle --recent
~~~

Verify CAP and the router are running and the HDI deployer completed successfully. A database deployer can finish its deployment work without being a continuously running application. Confirm resource bindings and use the actual router route from cf apps/routes as the application URL.

## Role setup and trusted Employee provisioning

BTP application role assignment and the persisted Employee mapping are separate controls.

1. After XSUAA deployment, inspect the actual role collections declared from ITAdmin, ComplianceManager, and Employee templates. The MTA names include the organization and space. A BTP role administrator assigns the minimum required collection to each authorized user using Security > Role Collections. Confirm the correct identity-provider origin.
2. Authenticate through the router and call GET /odata/v4/asset-management/sessionInfo(). Confirm userId and expected role labels from the actual target. Do not infer a CAP subject from a display name, email, screenshot watermark, or local mock ID.
3. An authorized IT Admin verifies the recipient's exact authenticated userId and approved display name. Use the Admin **Add employee** form, or the actual controlled API:

   ~~~http
   POST /odata/v4/asset-management/provisionEmployee
   Content-Type: application/json

   {"userId":"<verified-sessionInfo-userId>","displayName":"<verified-employee-display-name>"}
   ~~~

4. The action creates an active mapping, preserves subject case, trims surrounding whitespace, rejects blank/control-character/overlength and duplicate values, and records the Admin actor/time. Existing mappings cannot be overwritten. Generic Employees CRUD remains denied.
5. Allocation resolves the trusted mapping; the recipient's MyAssets compares the authenticated userId with allocatedToUserId. Verify the Admin directory, actual allocation, and the recipient's own-only read through UI and direct API.

This is an executable supported workflow, not a claim that any production mapping or role was provisioned. The action does not create an identity-provider user, grant credentials, or assign BTP roles. Requests through the approuter must satisfy authentication and CSRF; the SAPUI5 controller obtains the token/session context before writes. Record actual response/status/fields, not secrets or token values.

## BAS and Build Code evidence

On 2026-10-01 the lead created ITAssetLifecycle from this Git repository in SAP Build and synchronized source revision f7d5c44 in BAS workspace ws-ue4j9. The repaired source compiled and built, UI assets copied, MTA archive built, SQLite migration/schema deployment succeeded, and CAP started on port 4004. The live preview showed Admin inventory/search, Employee own asset/detail, and Compliance alerts. The complete set of current observations and screenshot limits is recorded in [BAS verification notes](evidence/bas-environment-verification-2026-10-01.md). The checked-in BAS build/runtime/Admin images are authentic earlier captures; they do not claim the latest preview screenshot was saved.

The observed [port 4004 BAS preview](https://port4004-workspaces-ws-ue4j9.us10.trial.applicationstudio.cloud.sap/) requires the user's BAS session and running devspace. It is a development preview, not the Cloud Foundry router URL. The preview uses local SQLite and CAP development mock authentication, not the trial HANA/XSUAA bindings.

The exact actual Build Code/Joule prompt and its no-response result are in the [prompt log](assessment/build-code-prompt-log.md). The current BAS side chat has no model configured for generation. Build lobby project creation and BAS execution do not prove Joule code generation.

## Cloud smoke checks and troubleshooting

After actual deployment, verify role-specific direct API access, absence of unauthenticated inventory, Employee key/count/filter isolation, Compliance Manager alert-only data, controlled Admin provisioning/lifecycle actions, HANA allocation race behavior, history consistency, renewal/date/idle boundaries, retirement, and persistence after refresh/restart. Use actual production principals and evidence; SQLite test success does not establish HANA/XSUAA behavior.

| Symptom | Check / next action |
|---|---|
| MTAR build fails | Verify Node 24, locked installs, GNU Make/mbt, failing module command, and generated deployer engine. |
| cf deploy unavailable | Verify MultiApps plugin and actual authenticated API/org/space. |
| HDI provisioning fails | Verify running selected database, database_id extension, hdi-shared availability/entitlement, quota, and service events. |
| CAP staging fails | Check Node buildpack support, memory/disk quota, production dependencies, HANA/XSUAA bindings, and recent logs. |
| Router login/API/CSRF fails | Check XSUAA redirect/roles, srv-api destination/token forwarding, xs-app route, current authentication, and fetched CSRF token. |
| Employee assignment is missing | Compare actual sessionInfo userId with the provisioned Employee key and stored allocatedToUserId; verify an active assignment. |
| Mapping already exists | Do not overwrite the identity record; inspect the trusted directory and audit trail before any separately authorized correction. |
| Old SQLite history column error | Stop local server and run db:deploy; inspect migration backup/result. Do not apply the SQLite helper to HANA. |
| Demo rows appear in production | Stop/inspect the active production profile and MTA ASSET_SEED_DEMO=false; investigate without overwriting cloud data. |

The repaired MTA archive build succeeded in BAS. Two Cloud Foundry deployment clients then timed out at the initial archive-deploy step; the bounded attempt ended after 300 seconds before any new operation registered. The task apps were stopped and there is no deployed runtime evidence. Role assignment, production Employee onboarding, and cloud HANA smoke checks remain unrun. The current gate is **FAIL** for the deployment attempt; see the [attempt record](evidence/cloud-deploy-attempt-2026-10-01.md), [matrix](assessment/requirement-evidence-matrix.csv), and [evidence index](assessment/execution-evidence.md). Retry after the MultiApps deployment endpoint responds normally.

## Official references

Relevant command/configuration guidance was checked on 2026-10-01:

- [CAP deployment to Cloud Foundry](https://cap.cloud.sap/docs/guides/deploy/to-cf).
- [CAP SQLite](https://cap.cloud.sap/docs/guides/databases/sqlite) and [schema evolution](https://cap.cloud.sap/docs/guides/databases/schema-evolution).
- [CAP HANA Cloud](https://cap.cloud.sap/docs/guides/databases/hana), [authentication](https://cap.cloud.sap/docs/guides/security/authentication), and [authorization](https://cap.cloud.sap/docs/guides/security/authorization).
- [SAP MTA deployment commands, including -e](https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/65ddb1b51a0642148c6b468a759a8a2e.html).
- [SAP BTP Cloud Foundry SSO](https://help.sap.com/docs/btp/sap-business-technology-platform/log-on-manually-with-custom-identity-provider).
- [Complete official source index](assessment/official-sap-sources.md).



# SAP BTP Cloud Foundry Deployment Guide

**Status:** Matched to the current project configuration. **No Cloud Foundry deployment has been performed.** An authenticated CF target was observed during the latest environment check, but the task MTA has not been deployed and no app route, cloud URL, or cloud smoke test is evidenced.

## Deployment architecture

The checked-in MTA is **mta.yaml**, ID **sap-btp-it-asset-lifecycle**:

| Module/resource | Actual configuration | Purpose |
|---|---|---|
| sap-btp-it-asset-lifecycle-srv | Node.js at gen/srv with nodejs_buildpack; requires XSUAA and HANA | CAP runtime and OData service; UI assets are copied into gen/srv/app. |
| sap-btp-it-asset-lifecycle-db-deployer | HDB at gen/db; requires HANA | Deploys the HDI database artifacts. |
| sap-btp-it-asset-lifecycle | Standalone approuter.nodejs at .deploy/app-router | Public entry point; xs-app.json sends ^/(.*)$ to destination srv-api with CSRF protection. |
| sap-btp-it-asset-lifecycle-auth | Managed xsuaa, application plan, tenant-mode dedicated, xs-security.json | XSUAA authentication and role templates/collections for ITAdmin, ComplianceManager, Employee. |
| sap-btp-it-asset-lifecycle-db | com.sap.xs.hdi-container, hana offering, hdi-shared plan | Persistent HANA/HDI container. |

The approuter binds srv-api and forwards the authenticated token to CAP. The SAPUI5 manifest calls OData V4 at /odata/v4/asset-management/. MTA before-all runs npm run copy:ui, copying app/ into gen/srv/app.

## Local and Cloud Foundry profiles

| Concern | Local project | Cloud Foundry |
|---|---|---|
| Runtime | package.json requires Node >=22; captured local versions were Node 24.16.0 and npm 11.13.0. | Node.js CAP service module built from gen/srv. |
| Persistence | @cap-js/sqlite uses file-backed db.sqlite; automated tests use in-memory SQLite. | @cap-js/hana under the production profile, bound to the HDI container. Local SQLite contents are not copied to HANA. |
| Authentication | CAP mocked users from package.json in development/test; local-only fixtures. | Production profile selects XSUAA. The standalone approuter signs users in and forwards the token; CAP annotations enforce API permissions. |
| Demo seed | db/seed.js seeds relative-date fixtures only in development/test when enabled and only into an empty inventory. | Seed guard returns false when NODE_ENV=production or CAP profile is production. The MTA currently does not explicitly set ASSET_SEED_DEMO. Set ASSET_SEED_DEMO=false before the first cloud app start or add it to the MTA before deploying. Never seed production with local mock users. |

The security key is the authenticated CAP principal ID returned by sessionInfo(), not a display name. Confirm the principal value in the target XSUAA setup before provisioning employee mappings.

## Employee identity and role provisioning

Role assignment and the Employee mapping table are separate:

1. Deploy the XSUAA resource from xs-security.json. The MTA declares role collections based on ITAdmin, ComplianceManager, and Employee templates. Assign the corresponding collections in BTP Security administration and verify their deployed names.
2. Have each employee authenticate through the approuter and call GET /odata/v4/asset-management/sessionInfo(). The response userId is the key the service compares with allocatedToUserId. Verify it is the intended stable identity.
3. A trusted, audited operator process must provision one active Employee row with that userId and the correct displayName before an IT Admin allocates assets to the employee.
4. Verify IT Admin can read the mapping and select it for allocation; verify the employee sees only their own MyAssets.

**Current limitation:** Employees is read-only to IT Admins in the CAP service. The project has no employee mapping create/update action or shipped provisioning command. It cannot provision real user mappings through its public API. Do not add mock identities to production or treat these instructions as evidence that mappings exist. A controlled provisioning utility/process must be supplied and verified before cloud employee onboarding; no production identity mapping has been provisioned for this task.

## Prerequisites

- Cloud Foundry enabled in an authorized BTP subaccount, target org/space, and deployer permission (normally SpaceDeveloper). Role assignment may require a BTP user administrator.
- Target-space entitlements for the MTA's hana / hdi-shared and xsuaa / application service plans. Confirm marketplace availability in the actual region.
- Node.js 22+, npm, Cloud Foundry CLI, Cloud MTA Build Tool (mbt), CF MultiApps plugin, and GNU Make on Windows where required by mbt.
- package-lock.json, mta.yaml, xs-security.json, .deploy/app-router and application sources.
- ASSET_SEED_DEMO=false configured before the first production app start. This environment setting is not present in the current MTA.

~~~powershell
node --version
npm --version
cf --version
mbt --version
~~~

Initial inspection recorded Node 24.16.0/npm 11.13.0 and no cds, cf, mbt, btp, ui5, or java commands on PATH before dependency installation. A later check authenticated to a CF target. Neither fact is a deployment result.

## Local verification and actual MTA build configuration

Current package scripts: npm run compile invokes cds compile db/schema.cds srv/asset-management-service.cds --to json; npm run build invokes cds build --production; npm run copy:ui invokes node scripts/copy-ui.js; npm test runs Mocha on test/**/*.test.js with a 30 second timeout; npm run watch invokes cds watch; npm start invokes cds-serve.

The recorded local verification sequence was:

~~~powershell
npm ci
npm run compile
npm test
npm run build
npm run copy:ui
~~~

The test harness fixes ASSET_FIXED_TODAY to 2026-09-28, ASSET_TIME_ZONE to Asia/Kolkata, expiry/idle thresholds to 30 days, enables demo data, and starts CAP with in-memory SQLite. These are local test settings, not CF settings.

The checked-in mta.yaml before-all commands, in order, are:

~~~yaml
commands:
  - npm ci
  - npx cds build --production
  - npm run copy:ui
~~~

## Cloud Foundry CLI and deployment steps

Use the API endpoint returned in BTP cockpit for the authorized region; the endpoint and org/space below are placeholders.

~~~powershell
cf api https://api.cf.<region>.hana.ondemand.com
cf login --sso
cf target -o <org-name> -s <space-name>
cf target
mbt build -t gen --mtar mta.tar
cf deploy gen/mta.tar -f
~~~

mbt build evaluates the MTA before-all sequence and packages the CAP service, HDB deployer, standalone approuter, XSUAA resource, and HDI resource. Do not run deployment against a guessed endpoint or org/space. Set ASSET_SEED_DEMO=false before the app's first start.

After a successful deployment, inspect the actual MTA modules and routes:

~~~powershell
cf apps
cf services
cf routes
cf logs sap-btp-it-asset-lifecycle-srv --recent
~~~

The router root should open the app; its srv-api destination forwards API requests to CAP. No task app URL is currently available.

## Post-deployment checks

- Confirm all three MTA modules are started and XSUAA/HANA resources are bound.
- Check recent CAP logs for production startup and service bindings. Do not save credentials or tokens.
- Open the SAPUI5 client through the approuter and verify its OData V4 requests reach /odata/v4/asset-management/.
- Assign the correct role collection and verify direct API access for unauthenticated, Employee, Compliance Manager, and IT Admin users.
- Verify trusted Employee mappings before allocation; there is currently no public mapping write API.
- Exercise allocation, return, renewal, and retirement against HANA and confirm results after refresh. Do not import local db.sqlite.
- Save only genuine command outputs and browser evidence after execution; see [Execution Evidence](assessment/execution-evidence.md).

## Troubleshooting

| Symptom | Checks |
|---|---|
| MTA build fails | Confirm Node >=22, npm ci, Windows GNU Make, mbt installation, and the failing before-all command. |
| cf deploy unavailable | Confirm CF CLI and MultiApps plugin; verify the logged-in API/org/space. |
| HANA provisioning fails | Check hana / hdi-shared entitlements and deployment/service events. |
| XSUAA login fails | Compare deployed scopes/templates to xs-security.json; check role assignment and approuter binding. |
| App route opens but API fails | Check .deploy/app-router/xs-app.json, srv-api destination, forwarded token, CAP logs, and OData path. |
| Employee My Assets is empty | Confirm sessionInfo() userId has an active Employee mapping and that allocation writes the same allocatedToUserId. |
| Demo records appear in cloud | Stop the app, inspect the active production profile, set ASSET_SEED_DEMO=false before restart, and investigate HANA. Do not overwrite production data to debug. |

## Deployment status

**No deployment performed.** An authenticated CF target was observed, but this application's MTA has not been built or deployed to it. HANA/XSUAA provisioning, role assignment, Employee mapping provisioning, task app status/URL, and cloud smoke tests remain unverified.

## Official references

- [CAP: Deploy to Cloud Foundry](https://cap.cloud.sap/docs/guides/deploy/to-cf)
- [CAP: Using Databases](https://cap.cloud.sap/docs/guides/databases/new-dbs)
- [CAP: Authentication](https://cap.cloud.sap/docs/guides/security/authentication)
- [CAP: CAP-level Authorization](https://cap.cloud.sap/docs/guides/security/authorization)
- [SAP Help: Log on to Cloud Foundry with the CF CLI](https://help.sap.com/docs/btp/sap-business-technology-platform/log-on-to-cloud-foundry-environment-using-cloud-foundry-command-line-interface)
- [SAP Help: SAP Fiori Applications in the Cloud Foundry Environment](https://help.sap.com/docs/btp/sap-business-technology-platform/sap-fiori-applications-in-cloud-foundry-environment)

References checked against official SAP documentation on 2026-09-28. CF endpoints and service plans vary by account and region.



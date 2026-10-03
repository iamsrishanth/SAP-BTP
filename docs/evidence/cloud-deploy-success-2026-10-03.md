# Cloud Foundry Deployment and Runtime Smoke Record

**Observed:** 2026-10-03, Asia/Kolkata

**Target:** Authorized trial Cloud Foundry org 6fd93d19trial, space dev, API https://api.cf.us10-001.hana.ondemand.com

**Source:** BAS checkout at f7d5c44. The MTA archive was 12,350,679 bytes and was built on 2026-10-03 in that checkout.

**Result:** PASS for MTA deployment and the authenticated Compliance Manager runtime smoke described below.

## One deployment attempt

Before deployment, the BAS target was the expected trial org/space, no active MTA operation was listed, and the repaired archive was present. Both existing app instances were running. Exactly one new deployment command was started with a 300-second bound:

~~~sh
timeout 300s cf deploy mta_archives/sap-btp-it-asset-lifecycle_1.0.0.mtar -e mta.trial.mtaext
~~~

The command completed within the bound and printed “Process finished.” The output reported both the router and CAP service as started and available. The MTA process log identifier printed by the CLI was 11830519-bf1a-11f1-8306-eeee0a8d7796. A subsequent read-only cf mta-ops check returned “No multi-target app operations found,” meaning no operation remained active.

The observed application routes were:

- Router: https://6fd93d19trial-dev-sap-btp-it-asset-lifecycle.cfapps.us10-001.hana.ondemand.com/
- CAP service: https://6fd93d19trial-dev-sap-btp-it-asset-lifecycle-srv.cfapps.us10-001.hana.ondemand.com/

A bounded GET to the router root returned HTTP 200. The router page was opened in the browser and connected with the already authenticated SAP BTP session, leaving both local mock credential fields empty. CAP identified the current session as ComplianceManager and rendered the Compliance and idle assets view for business date 2026-10-03 (Asia/Kolkata). The dashboard returned empty lists and zero counts; no cloud demo data was created and no lifecycle mutation was performed.

## What this verifies

- The repaired MTA archive deployed successfully to the inspected trial org/space.
- The CF router and CAP service started and reported their routes.
- The application route returned HTTP 200, and the app connected through the existing authenticated SAP BTP session to CAP as a ComplianceManager.

## Remaining cloud checks

The live BTP Cockpit inspection confirmed that the generated ITAdmin (sap-btp-it-asset-lifecycle 6fd93d19trial-dev) role collection has no users, no user groups, and no attribute mappings. No role assignment was changed. No ITAdmin session was verified for the cloud demonstration; the tested session resolves as ComplianceManager. An authorized ITAdmin cloud session is required to proceed. This inspection does not rule out another role collection granting the same app role to an identity outside the tested session.

Only the current ComplianceManager session was exercised. IT Admin and Employee cloud access tests, direct API denial tests for each role, HANA lifecycle writes, allocation concurrency on HANA, and HANA persistence after refresh/restart have not run. The Compliance view showed no cloud records. Local SQLite lifecycle and persistence evidence remains separate.

## Live HANA service binding verification

On 2026-10-03 the lead inspected the referenced HANA Cloud Central page and the task's live HDI service in BTP Cockpit. The following values were observed without opening service credentials:

| Item | Observed value |
|---|---|
| HANA Cloud instance | loyalty-reward-db; Running |
| HANA database instance ID | 0dda540b-396a-487b-b665-805ed690ec14 |
| Task HDI service instance | sap-btp-it-asset-lifecycle-db |
| HDI service instance ID | 53378d07-f60b-440d-b46c-608351ae0f2e |
| Service / plan / scope | hana / hdi-shared / Cloud Foundry dev |
| Service status | Usable; Update Succeeded |
| Bound applications | sap-btp-it-asset-lifecycle-srv and sap-btp-it-asset-lifecycle-db-deployer; both binding statuses Created |

The HDI service's Actions > View Parameters > Current Configuration displayed:

~~~json
{"database_id":"0dda540b-396a-487b-b665-805ed690ec14"}
~~~

This matches the instance ID displayed under loyalty-reward-db > Connections and the selected database in mta.trial.mtaext. It verifies that the deployed asset application's dedicated HDI container is hosted in that HANA Cloud database. The app's HDI service is separate from the other service instances named loyalty-reward-db and LoyaltyProject-db. No shared schema access or cross-application data access was configured or tested. The BAS port 4004 preview continues to use development SQLite.

The live mapping and bindings verify the selected database connection configuration. No cloud asset write, allocation race, or persistence-after-restart test was performed during this read-only inspection.

The browser accessibility output included the signed-in identity, so it was not copied into this record. No screenshot of the authenticated cloud page or raw BAS terminal capture was saved. This sanitized note records the observed command completion, routes, HTTP result, role, date, and empty dashboard without storing account email, credentials, or tokens.

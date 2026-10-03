# Cloud demo data and profiles

## Why BAS and Cloud Foundry initially showed different data

The BAS port 4004 server uses its own persistent `db.sqlite` and development mock authentication. The Cloud Foundry service uses HANA and XSUAA. A deployment creates the HANA tables; it does not copy the BAS SQLite rows. Production seeding is deliberately disabled. The live asset HDI service, `sap-btp-it-asset-lifecycle-db`, is bound to database ID `0dda540b-396a-487b-b665-805ed690ec14` (`loyalty-reward-db`) and to the asset service and deployer. It is a dedicated container in that database.

## Transfer contract

The export reads the actual persistent SQLite database without changing it. The versioned snapshot preserves asset IDs, employee identity keys, allocation IDs, association property `assetID_assetID`, dates, statuses, and audit fields. It includes row counts and a SHA-256 digest. This is an exact copy of the source snapshot, not a regenerated seed.

The import is a one-off operator CLI, not an HTTP endpoint or application startup listener. It validates the intended HANA instance and HDI binding before connecting, validates every row and relationship, and imports all three tables in one transaction. The destination must be empty. Repeating the exact same snapshot may report `already-imported`; a nonempty destination containing different data is rejected. No existing application rows are deleted or overwritten.

From the BAS project root:

```sh
node scripts/export-demo-data.js --output demo-data-private/bas-sqlite-snapshot.json --database db.sqlite
npm run build
npm run copy:ui
mbt build
cf deploy mta_archives/sap-btp-it-asset-lifecycle_1.0.0.mtar -e mta.trial.mtaext
cf run-task sap-btp-it-asset-lifecycle-srv --name asset-demo-import --command 'node scripts/import-demo-data.js --input demo-data-private/bas-sqlite-snapshot.json --expected-database-id 0dda540b-396a-487b-b665-805ed690ec14 --expected-service sap-btp-it-asset-lifecycle-db'
cf tasks sap-btp-it-asset-lifecycle-srv
```

The private snapshot is ignored by Git. `copy:ui` packages it only when that exact explicitly exported file exists. The app does not load it automatically. Remove it from future packages once the migration is verified. Inspect task results and sanitized application logs; do not print `VCAP_SERVICES`, service credentials, or access tokens. Local SQLite and cloud HANA evolve independently after this one-time copy.

## Cloud demo profiles

Cloud authentication remains XSUAA. The base MTA disables demo profiles. The user-authorized trial extension enables them, but a verified human SAP session also needs the app's `DemoOperator` scope from the `AssetDemoOperator (sap-btp-it-asset-lifecycle <org>-<space>)` role collection. Creating the role collection does not assign it to anyone.

The profile selector is displayed only when CAP reports that the authenticated SAP operator is authorized. The UI sends `X-Asset-Demo-Profile` on each request, and middleware after XSUAA authentication selects one restricted effective role for that request. Client credentials, anonymous users, forged headers, and ordinary users without `DemoOperator` cannot use it.

| Profile | Effective CAP role | Identity and data |
|---|---|---|
| SAP identity | Original SAP scopes | Normal cloud session |
| Demo IT Admin (`it.admin`) | ITAdmin | Inventory and lifecycle operations; writes retain the real SAP actor ID |
| Demo Employee Alex (`employee.alex`) | Employee | Alex's own assignments only |
| Demo Employee Jamie (`employee.jamie`) | Employee | Jamie's own assignments only |
| Demo Compliance Manager (`compliance.manager`) | ComplianceManager | Compliance summary only; real SAP actor ID retained |

These are operator-controlled demo aliases, not four separate SAP login accounts. Each effective role is enforced by the existing CAP service policies, including direct API calls. A selected Employee profile loses the operator's Admin/Compliance scopes. Switching clears the prior view, asset history, filters, cached employee rows, form dialogs, and CSRF state. Pending confirmation callbacks reject a changed session. Responses from an earlier profile cannot repopulate a later profile.

After a role assignment, use **Sign out** in the cloud app and sign in again so the app receives a fresh XSUAA token. Connect using the SAP session without local mock credentials. Choose a demo profile. Local BAS mock users and passwords continue to work only in the local development profile.

## Verification status — 2026-10-03

The actual BAS SQLite database exported **16 assets, 3 employees, and 3 allocation histories** for business date 2026-10-03 (`Asia/Kolkata`). The snapshot digest is `sha256:f66b406dc05b98a6ffe51fdc25e1003e436157b679f7b8380f1d4615f590c2a6`. These persisted records were initially seeded on 2026-10-01; the import preserved those dates rather than re-dating rows. As a result, seed labels `Expires-Today`, `Warning-Day-30`, and `Warning-Day-31` refer to their original seed date and were 2 days expired and 28/29 days to expiry on 2026-10-03. Compliance uses each stored expiry and the current business date, so the labels and computed buckets can differ as time passes. Use a fresh isolated database or the fixed-clock tests for exact boundary demonstrations.

Two one-off tasks ran on `sap-btp-it-asset-lifecycle-srv` against database ID `0dda540b-396a-487b-b665-805ed690ec14` and HDI service `sap-btp-it-asset-lifecycle-db`. Both the first import and an identical repeat task finished `SUCCEEDED`. The CLI returns success only after it reads the imported entities back and verifies field-level equality with the snapshot. The deployed SAPUI5 Compliance view then showed 2 expired software licenses, 3 warning-window licenses, 1 hardware warranty alert, and 11 idle available assets, with the corresponding demo names and IDs; this matches BAS for the same business date. See [the transfer record](evidence/cloud-hana-import-2026-10-03.md), [BAS source export capture](evidence/bas-sqlite-export-2026-10-03.jpg), [repeat task status](evidence/cloud-hana-import-repeat-2026-10-03.png), and [live CF Compliance view](evidence/cloud-hana-compliance-2026-10-03.jpg).

The data is in the asset application's dedicated HDI container hosted on `loyalty-reward-db`; it is not copied into or merged with that HANA database's other schemas or app containers. Local SQLite and cloud HANA evolve independently after this one-time import.

The `AssetDemoOperator` role collection exists, but its final assignment to the current SAP identity has not been submitted. The assignment dialog is prepared for the restricted collection only; it does not include the broader generated ITAdmin collection. The app-profile assignment and cloud Admin/Employee views remain pending. This guide describes the mechanism and records the import evidence separately.

## Sources

- [CAP authentication and custom middleware](https://cap.cloud.sap/docs/node.js/authentication)
- [CAP deployment to Cloud Foundry](https://cap.cloud.sap/docs/guides/deploy/to-cf)
- [CAP HANA persistence](https://cap.cloud.sap/docs/guides/databases/hana)
- [Cloud Foundry application tasks](https://docs.cloudfoundry.org/devguide/using-tasks.html)
- [SAP application router logout](https://help.sap.com/docs/btp/sap-business-technology-platform/configure-redirect-urls-for-browser-logout)

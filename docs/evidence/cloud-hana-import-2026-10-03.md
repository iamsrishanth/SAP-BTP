# BAS SQLite snapshot imported to Cloud Foundry HANA — 2026-10-03

## Result

The BAS app's persistent SQLite snapshot was imported into the IT Asset Lifecycle application's HDI container, which is hosted by the running `loyalty-reward-db` HANA Cloud instance. The source export contains **16 assets, 3 employees, and 3 allocation history rows**, using business date **2026-10-03 (`Asia/Kolkata`)**. The exported snapshot digest is:

```text
sha256:f66b406dc05b98a6ffe51fdc25e1003e436157b679f7b8380f1d4615f590c2a6
```

The first one-off Cloud Foundry task, `asset-demo-import-20261003` (task ID 1), reached `SUCCEEDED` at **2026-10-03 13:05:40 UTC**. A second task, `asset-demo-import-repeat-20261003` (task ID 2), ran the same snapshot again and reached `SUCCEEDED` at **2026-10-03 13:11:34 UTC**. Its success demonstrates that the guarded repeat-import path accepts the already-imported identical snapshot without duplicating rows. Both tasks targeted database ID `0dda540b-396a-487b-b665-805ed690ec14` and HDI service `sap-btp-it-asset-lifecycle-db`.

The importer validates the approved database and service binding, imports all three entities transactionally, reads the entities back, and returns success only after field-by-field comparison with the snapshot. The cloud application then displayed the corresponding Compliance data for the same business date: **2 expired licenses, 3 licenses in the warning window, 1 hardware warranty alert, and 11 idle available assets**, including the same demo names and IDs shown in the BAS source. The cloud Compliance screenshot is cropped below the signed-in identity.

## Evidence

- [BAS source database counts and export digest](bas-sqlite-export-2026-10-03.jpg)
- [BAS source Compliance view](bas-source-compliance-2026-10-03.jpg)
- [Initial Cloud Foundry task submission and result](cloud-hana-import-task-2026-10-03.jpg)
- [Cloud Foundry task table: initial and repeat tasks succeeded](cloud-hana-import-repeat-2026-10-03.png)
- [Cloud application Compliance data after import](cloud-hana-compliance-2026-10-03.jpg)
- [Cloud Foundry MTA deployment output](cloud-demo-deploy-2026-10-03.jpg)

The one-off snapshot was kept in BAS's ignored `demo-data-private` directory and packaged for this migration. It was not added to Git. No service credentials, access tokens, or employee personal data were included in the repository. `loyalty-reward-db` hosts the application's dedicated HDI container; the import did not merge data into other HANA schemas or service instances.

## Remaining cloud work

The database transfer is verified, but this result does not prove a lifecycle write, allocation race, or persistence across a HANA app restart. The profile selector is deployed but requires the restricted `AssetDemoOperator` scope. Its role assignment dialog has the single intended collection selected; the final assignment action has not been submitted. Admin and Employee cloud-profile workflows remain pending.

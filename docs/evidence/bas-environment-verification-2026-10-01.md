# BAS and SAP Build Environment Verification

**Observed:** 2026-10-01 (Asia/Kolkata)
**Source revision:** `f7d5c44` (`Fix generated service packaging for date rules`)
**Scope:** This records lead observations in the SAP Build lobby, the associated BAS devspace, the local BAS CAP preview, and the connected demo users. It does not assert a Cloud Foundry deployment or successful Build Code generation.

## SAP Build and BAS setup

- Created the SAP Build lobby project `ITAssetLifecycle` from the Git repository and opened its BAS workspace `ws-ue4j9` at `/home/user/projects/SAP-BTP`.
- The BAS clone was synchronized to source commit `f7d5c44`, including the generated-service packaging repair.
- In BAS, the production CDS build and UI copy completed; the MTA build created an archive of about 12 MB.
- `npm run db:deploy` completed the association-column migration and CAP schema deployment to the workspace's file-backed `db.sqlite`. The migration retained existing local rows and created a backup under the ignored `db-backups/` directory.
- `npm run watch` started CAP 10.1.1 on port 4004 with development mock authentication. The UI preview loaded from the CAP-served application at the BAS port 4004 preview URL.

## UI observations against CAP

- **IT Admin:** inventory displayed 16 seeded assets; searching for `DEMO-Idle-Laptop` returned the single matching asset.
- **Employee:** signing in as the local `employee.alex` fixture showed Alex's assigned laptop and its asset detail. Allocation history is intentionally restricted to IT Admin.
- **Compliance Manager:** the Compliance-only view showed business date `2026-10-01 · Asia/Kolkata`, one expired software license, three expiring software licenses (including expiry today and the 30-day boundary), one hardware warranty alert, eleven idle available assets, and missing-date information. The UI separates hardware warranties from software license alerts.

These were direct observations in the live BAS preview. The current preview images were shown during the session but were not saved as local image files. The checked-in image `bas-ui-admin-inventory-2026-10-01.jpg` is an authentic earlier BAS inventory capture; it is not labeled as the current Compliance or Employee screenshot. The remote BAS terminal logs were created in the BAS clone but were not copied into this local submission package; this file is the lead's observation record, not a verbatim terminal transcript.

## Build Code status

The BAS side chat currently presents `Select a Model` and `Use GitHub Credentials` setup choices, with no configured model available for code generation. The only actual prompt submission is BC-01 in the [Build Code prompt log](../assessment/build-code-prompt-log.md); it was a read-only search prompt submitted on 2026-09-28, remained at `Thinking...`, and returned no result or code. Local coding in the Git clone, the SAP Build lobby project, and BAS build/run activity are recorded separately from Joule generation.

## Limits

- The preview uses CAP development mock identities and local SQLite, not deployed XSUAA or the trial HANA service.
- Full IT Admin UI edit, maintenance, and retirement paths were not all exercised in the current live preview.
- No Cloud Foundry route, deployed cloud runtime, role collection assignment, or cloud HANA lifecycle smoke test is evidenced.
- Assessment submission was not performed.

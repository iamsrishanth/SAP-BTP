# Assessment Submission Index

Updated **2026-10-03 (Asia/Kolkata)** for **Technology Industry — IT Asset Lifecycle Management**. This index identifies the application, required deliverables, and evidence records in this repository. It is a navigation artifact; it does not assert that all acceptance gates have passed.

The current acceptance status is recorded in the [requirement-to-evidence matrix](requirement-evidence-matrix.csv). As of 2026-10-03 it records 58 PASS, 0 FAIL, 4 BLOCKED, and 2 NOT RUN gates; see each row for its evidence and limitations. The authorized trial Cloud Foundry deployment, live HANA mapping/bindings, exact BAS SQLite snapshot import with successful identical repeat, and imported-data Compliance view pass. Build Code generation remains blocked. Cloud Admin/Employee profile verification is blocked while the restricted demo-operator assignment awaits action-time confirmation; HANA lifecycle checks remain unrun. Local logs, BAS runtime, Build Code generation, and cloud deployment are separate claims.

## Required deliverables

| Assessment deliverable | Authoritative artifact | What to inspect |
|---|---|---|
| 1. Project Overview Document | [Project overview](project-overview.md) | Business problem, objective, scope, roles, architecture, assumptions, and high-level flow diagram. |
| 2. Data Model Design | [Assumptions and data model](assumptions-and-data-model.md), backed by [actual CDS model](../../db/schema.cds) | Required attributes and keys, CDS association/generated foreign key, supporting identity/audit fields, date rules, lifecycle transitions, and deletion policy. See the consistency review for unresolved differences. |
| 3. Service Definition | [Actual CAP service CDS](../../srv/asset-management-service.cds), [service usage explanation](service-definition.md), [integration contract](service-contract.md) | Exposed entity sets, actions/functions, role restrictions, service root, parameters, response shapes, and errors. |
| 4. Agile Sprint Plan | [Three-sprint plan](agile-sprint-plan.md) | Three sprints covering all four assessment phases, five-day schedule, stories, acceptance criteria, and dependencies. |
| 5. Test Case Sheet | [CSV test case sheet](test-case-sheet.csv) | Requirement ID, scenario, preconditions, steps, expected and actual results, status, and evidence. IDs must agree with the current matrix. |
| 6. Deployment Steps | [Cloud Foundry deployment guide](../deployment.md), [MTA descriptor](../../mta.yaml), [XSUAA role definitions](../../xs-security.json) | Actual module/resource configuration; prerequisites, build/deploy commands, identity/role setup, execution checks, troubleshooting, and precise deployment status. |
| 7. Build Code Prompt Log | [Prompt log](build-code-prompt-log.md) | Exact submitted prompts, dates/sequences, actual outputs, affected files, corrections, validation, and proposed prompts clearly separated from executed prompts. |
| 8. Execution Evidence | [Evidence index](execution-evidence.md), [evidence directory](../evidence/) | Authentic local logs, screenshots, test output, accessibility results, and any subsequently captured SAP environment evidence. Failed historical diagnostics remain identifiable. |
| 9. README | [README](../../README.md) | Setup, dependencies, configuration, launch instructions, demo users, test commands, architecture, and document links. |

## Application source and configuration

| Area | Files |
|---|---|
| CAP domain and seed | [db/schema.cds](../../db/schema.cds), [db/seed.js](../../db/seed.js) |
| CAP service and lifecycle rules | [srv/asset-management-service.cds](../../srv/asset-management-service.cds), [srv/asset-management-service.js](../../srv/asset-management-service.js) |
| SAPUI5 application | [app/index.html](../../app/index.html), [app/manifest.json](../../app/manifest.json), [app/Component.js](../../app/Component.js), [XML view](../../app/view/App.view.xml), [controller](../../app/controller/App.controller.js), [styles](../../app/css/style.css) |
| Dependencies and run scripts | [package.json](../../package.json), [package-lock.json](../../package-lock.json) |
| Automated HTTP integration tests | [test/asset-lifecycle.test.js](../../test/asset-lifecycle.test.js) |
| Production build packaging | [scripts/copy-ui.js](../../scripts/copy-ui.js), [mta.yaml](../../mta.yaml) |
| Existing SQLite history migration | [scripts/migrate-history-association.js](../../scripts/migrate-history-association.js) |
| Cloud authentication and routing | [xs-security.json](../../xs-security.json), [approuter package](../../.deploy/app-router/package.json), [approuter routes](../../.deploy/app-router/xs-app.json) |
| Runtime exclusions | [.gitignore](../../.gitignore) |

The local SQLite database and sidecar files, dependency installations, generated build output, and private service-binding files are runtime artifacts excluded from source control. Recreate the development schema through the documented setup. Demo seeding runs against an empty non-production inventory; it does not replace an existing inventory.

The integrated model preserves the literal `AllocationHistory.assetID` association to `Asset`; its managed foreign-key property is `assetID_assetID`. Existing evidence from the earlier model used `asset_assetID` and must remain dated to that source snapshot. The history migration utility supports preserving the existing development database when applying this contract change; use its documented invocation after reviewing the migration source and backing up needed runtime data.

## Verification and demonstration aids

The [cloud demo data guide](../cloud-demo-data.md) explains the SQLite-to-HANA snapshot transfer and XSUAA-protected trial profile selector. The actual import and repeat task results are in the [HANA transfer record](../evidence/cloud-hana-import-2026-10-03.md); app-role verification remains pending.

| Aid | Purpose |
|---|---|
| [Requirement matrix](requirement-evidence-matrix.csv) | Gate-by-gate PASS, FAIL, BLOCKED, or NOT RUN with supporting evidence. |
| [Demonstration script](demonstration-script.md) | A repeatable walkthrough for IT Admin, Employee, and Compliance Manager, including purchase, assignment, return, renewal, maintenance, retirement, and persistence. Instructions are not execution evidence. |
| [Document consistency review](document-consistency-review.md) | Baseline discrepancies, lead integration resolutions, and residual documentation/scale limitations. |
| [Official SAP sources](official-sap-sources.md) | Current primary documentation supporting relevant CAP, SAPUI5, BTP, BAS, and Build Code commands/configuration. |

## Review and handover procedure

1. Install and launch with the README. Record the source revision and business date used for the run.
2. Compile and execute meaningful backend/integration checks. Capture current outputs rather than replacing them with reconstructed summaries.
3. Exercise the demonstration script in the running SAPUI5 app and record the actual result for each workflow and role.
4. The lead completed the BAS build, database deployment, startup, and role-view checks; see the [BAS verification notes](../evidence/bas-environment-verification-2026-10-01.md). The 2026-10-03 Cloud Foundry deployment, live HANA mapping/bindings, successful BAS snapshot import and repeat, and authenticated Compliance Manager view are recorded in the [cloud deployment result](../evidence/cloud-deploy-success-2026-10-03.md) and [HANA transfer record](../evidence/cloud-hana-import-2026-10-03.md). Build Code generation remains blocked. Demo-profile access is awaiting assignment confirmation; HANA lifecycle/concurrency/restart verification is unrun.
5. Independent backend findings were repaired and rerun; remaining scale, runtime pinning, full Admin UI, accessibility, Build Code generation, demo-role assignment, and HANA lifecycle verification limitations are explicit in the [consistency review](document-consistency-review.md) and matrix.
6. Compile, root integration tests, production build, and UI packaging were rerun after the final source repair. Evidence is dated and linked. The 2026-10-03 BAS SQLite export and Cloud Foundry import/Compliance screenshots are checked in with the HANA transfer record; the detailed Admin/Employee BAS workflow images remain the earlier 2026-10-01 captures.
7. Do not claim readiness while required gates remain failed, blocked, or unrun. The assessment portal and permanent submission remain under the user's control.

The assessment portal and permanent submission remain under the user's control.

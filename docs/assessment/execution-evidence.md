# Execution Evidence Index

**Snapshot:** 2026-09-28. This index separates local execution evidence from BAS/Build Code activity and cloud deployment. It does not claim that the assessment passed or was submitted.

## Current status

The local CAP and SAPUI5 application was started against file-backed SQLite and exercised in a browser. The backend suite passed 10 tests. The UI was used for registration, allocation, return, persistence after browser refresh, and software renewal. Employee and Compliance Manager views were opened with their local mock identities. An axe accessibility audit of the Compliance Manager page after the final shell/landmark fix reported zero violations.

The final source changed after the last production build and UI-copy command (the accessibility fix moved the ShellBar into the Page header and added Page landmarks). Re-run `npm run build` and `npm run copy:ui` before making a deployment package. UI retirement/maintenance was not browser-tested. The independent reviewer’s initial findings were repaired, but a final post-repair review has not been completed.

## Evidence register

| Evidence ID | Check | Result | Evidence / limitation |
|---|---|---|---|
| ENV-001 | Initial local environment and SAP workspace inspection | PASS for the inspection record | [environment-inspection.txt](../evidence/environment-inspection.txt) records local tools and read-only SAP Build/BAS workspace observations. Existing AssetMaintenance files were not changed. |
| NPM-001 | Clean dependency installation | PASS | [npm-ci.log](../evidence/npm-ci.log): `npm ci` completed. [npm-lock-update.log](../evidence/npm-lock-update.log): lock-file update completed. |
| DB-001 | Initialize persistent local SQLite schema | PASS | [local-db-deploy.log](../evidence/local-db-deploy.log): `npm run db:deploy` completed. SQLite database and sidecars are local ignored runtime files. |
| CAP-001 | CDS model/service compile | PASS | [cap-compile.log](../evidence/cap-compile.log): CAP compile output for schema and service. |
| TEST-001 | Backend lifecycle/security/compliance suite | PASS — 10 tests | [backend-tests.log](../evidence/backend-tests.log): all 10 HTTP integration tests passed against the fixed 2026-09-28 business date using in-memory SQLite. The suite covers roles, identity scoping, CRUD guards, allocation/return, concurrency, renewal, date/warranty/idle boundaries, retirement, maintenance, and history immutability. [backend-tests-initial-failure.log](../evidence/backend-tests-initial-failure.log) retains an earlier harness failure that was fixed before the passing run. |
| BUILD-001 | CAP production build | PASS for the earlier source snapshot | [cap-production-build.log](../evidence/cap-production-build.log) and [copy-ui.log](../evidence/copy-ui.log) show a successful CAP build and UI copy before the final accessibility markup change. Rebuild the current source before deployment. |
| APP-START-001 | Start local CAP app and observe service traffic | PASS | [local-run.log](../evidence/local-run.log) records the service at `/odata/v4/asset-management`, file-backed SQLite, and OData reads/writes from browser workflows. Setup requires `npm run db:deploy` before `npm run watch`. |
| UI-ADMIN-001 | Admin register, allocate, return, and history | PASS for the exercised path | [ui-admin-allocation-history.png](../evidence/ui-admin-allocation-history.png), [ui-admin-returned-history.png](../evidence/ui-admin-returned-history.png), and [ui-admin-persisted-detail.png](../evidence/ui-admin-persisted-detail.png) show the created asset, its assignment, return date, and retained history. The returned asset was found again after page refresh and sign-in. |
| UI-ADMIN-002 | Software license renewal | PASS for the exercised path | [ui-admin-renewal.png](../evidence/ui-admin-renewal.png) shows the software renewal success message and updated expiry. Backend validation/boundary tests are in [backend-tests.log](../evidence/backend-tests.log). |
| UI-EMP-001 | Employee My Assets | PASS for the displayed list | [ui-employee-my-assets.png](../evidence/ui-employee-my-assets.png) shows the Employee view with Alex’s own assigned laptop only. The screenshot predates the final ShellBar contrast/landmark refinement; the post-fix accessibility audit is recorded separately. |
| UI-COMP-001 | Compliance Manager alerts | PASS for the displayed view | [ui-compliance-alerts-final.png](../evidence/ui-compliance-alerts-final.png) shows distinct expired software, expiring software, hardware warranty, idle asset, and missing-date sections. Backend results include expiry today and the inclusive 30-day boundary. |
| UI-A11Y-001 | Accessibility audit after final UI markup/style adjustment | PASS — 0 violations | [ui-a11y-audit.json](../evidence/ui-a11y-audit.json): axe 4.12.1, 37 passes, zero violations, zero incomplete checks on the Compliance Manager page. It is a scoped page audit, not a full manual accessibility certification. |
| UI-SEARCH-001 | Inventory search/filter/paging at scale | NOT RUN | The UI requests server-side queries and pagination in source, but a large inventory/search/filter/paging walkthrough was not recorded. |
| BAS-001 | Implement/build/run this solution in BAS | NOT RUN | BAS was accessible and an existing AssetMaintenance project was inspected. This task’s local solution was not copied into or run from that existing workspace. |
| BC-01 | Actual Build Code/Joule prompt response | BLOCKED / pending | The exact read-only `/code-search` prompt is in [build-code-prompt-log.md](../assessment/build-code-prompt-log.md). Joule still showed `Thinking...` while indexing; no result or generated implementation is evidenced. |
| CF-ACCESS-001 | Observe authenticated Cloud Foundry target | PASS — target observed | An authenticated trial target was visible in BAS. Service plans, entitlements, and task-specific deployment were not checked. No secrets or credentials are recorded here. |
| CF-DEPLOY-001 | Build/deploy this MTA and verify cloud runtime | NOT RUN | No task-specific MTAR, application/service creation, route, role assignment, deployed URL, or cloud smoke test exists. |
| EMP-PROVISION-001 | Provision real cloud Employee identity mappings | BLOCKED | The service exposes employee mappings read-only; no production mapping was provisioned. Follow the trusted provisioning prerequisite in [deployment.md](../deployment.md). |
| REVIEW-001 | Final independent review and retest | NOT RUN | An initial independent review identified issues that were repaired. The reviewer has not completed a post-repair audit. |
| SUBMIT-001 | Permanent assessment submission | NOT PERFORMED | Assessment submission remains under the user’s control. |

## Screenshot and log inventory

The `docs/evidence/` directory contains the authentic local browser screenshots, successful backend/compile/build logs, startup and database initialization output, and the final axe JSON result. Earlier failed startup and UI-render diagnostics are retained with filenames that identify them as initial failures. `db.sqlite`, `gen/`, and browser session credentials are excluded from Git.

## Remaining acceptance gaps

- Build Code has not returned a result, and no code generation was completed there.
- This solution was not implemented or run in BAS.
- Cloud Foundry service-plan availability, MTA packaging for the latest UI source, deployment, role setup, and cloud execution remain unchecked.
- UI retirement/maintenance and broad search/filter/paging at inventory scale remain untested.
- A final independent review, updated complete acceptance matrix, and full-document consistency review remain outstanding.

Local passes above do not establish BAS use, Build Code generation, cloud deployment, hidden evaluator results, or assessment readiness.

## Official SAP guidance consulted

- [CAP SQLite database guide](https://cap.cloud.sap/docs/guides/databases/sqlite) for file-backed local schema initialization and deployment behavior.
- [SAPUI5 accessibility guide: landmark roles](https://ui5.sap.com/test-resources/sap/m/demokit/accessibilityGuide/webapp/topics/overview/applicationDeveloper/landmark.html) for page landmark configuration.

The broader version-specific Cloud Foundry, HANA, and authentication documentation review remains outstanding.

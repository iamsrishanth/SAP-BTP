# Documentation and Requirement Coverage Review

Review date: **2026-10-01 (Asia/Kolkata)**. Scope: README, model, service definitions/handlers, SAPUI5 controller/view, relative-date seed, integration tests, deployment configuration, assessment documents, and existing evidence references. This was a source/document inspection; it did not execute the application, inspect a live SAP browser session, run a new test, or certify cloud deployment.

This record captures the baseline findings before the lead's integration repairs and current SAP environment inspection. Source line references identify where each finding was reproduced at review time and may move after repairs. Findings remain open until their resolution and affected validation are recorded. The assigned documentation worker owns this file, the submission index, demonstration script, and official source index only.

## Findings requiring correction or an explicit decision

| ID / priority | Reproducible finding | Source/evidence references at baseline | Required correction and verification |
|---|---|---|---|
| DOC-01 / High | Test case requirement IDs use an earlier numbering scheme and disagree with the current matrix. For example the sheet's renewal is G-012, while the matrix's G-012 is invalid/repeated returns. Build Code, BAS, and Cloud Foundry rows also map to unrelated current gates. | `test-case-sheet.csv:12` and `requirement-evidence-matrix.csv:13`; sheet final three environment rows versus matrix G-048/G-051/G-052/G-054/G-055. | Remap all sheet rows to the current matrix IDs, including multiple IDs where a scenario covers more than one gate. Check every row's meaning, not only whether the ID exists. G-059/G-060 require this reconciliation. |
| DOC-02 / High | Some PASS actual-result summaries claim scenarios absent from the reviewed ten-test suite. Examples: invalid/inactive employee rejection; Compliance Manager history/write denial; calendar-invalid dates and missing required name/date; missing/nonexistent identifiers; roleless users; and inconsistent return history. | `test-case-sheet.csv:23` claims invalid-employee validation; `:22` claims compliance history/write denial; `:24` says roleless. `test/asset-lifecycle.test.js:88`, `:180`, `:213`, `:270` have narrower assertions. Matrix G-012/G-018 claim broad validation. | Add meaningful checks for each unverified requirement, capture current outputs, then update actual results/statuses. Otherwise narrow the case title/steps/result and retain unverified cases as NOT RUN. Code containing a validator is not recorded execution evidence. |
| DOC-03 / High | Data Model Design describes the relationship but lacks the requested relationship diagram. The Overview flow diagram does not replace a diagram of the two entities and cardinality. | Entire `assumptions-and-data-model.md`; genuine relationship in `db/schema.cds:26`. | Add an entity relationship diagram showing Asset and AllocationHistory, keys, many-history-to-one-asset relationship, generated FK, and justified Employee mapping. Recheck G-043 against the deliverable contents. |
| DOC-04 / High, lead decision | The assessment names `AllocationHistory.assetID` as the association attribute; the baseline source names it `asset`. The association is genuine, and the documentation explains `asset_assetID`, but it does not preserve the literal association property name. | `db/schema.cds:26`; `assumptions-and-data-model.md:37`, `:42`; `service-contract.md` generated-key note; matrix G-003. | Resolve the exact-name interpretation explicitly against the user's instruction to preserve required attributes. If retaining literal `assetID` is required, rename the association and update handlers, FK queries, tests, UI, compiled metadata, migration, and all documents together. Do not simply claim semantic equivalence proves the exact-name requirement. |
| DOC-05 / Medium | A supporting-field justification says `employeeUserId` supports an employee's own-history filter, while implemented history access is IT Admin only. | `assumptions-and-data-model.md:51`; `srv/asset-management-service.cds:17`; model's own role table. | Describe it as the immutable recipient identity for audit and consistency checks. State the actual restricted history role. This addition must not imply an unimplemented employee-history endpoint. |
| DOC-06 / Medium | Final model document still calls implemented decisions “proposed,” tells readers to update generated FK if a different name is selected, and says an implemented contract supersedes an earlier proposed operation list that is no longer present. | `assumptions-and-data-model.md:5`, `:42`, `:82`, `:121`. | Present current implemented assumptions and precise configuration. Separate actual local behavior from unverified cloud behavior; remove stale proposal/supersession wording after the contract is final. |
| DOC-07 / Medium | The idle rule says a missing baseline is surfaced as a data-quality issue, but the baseline handler skips an Available row when no valid purchase/return date exists. No baseline-missing alert is returned. | `assumptions-and-data-model.md:95`; `srv/asset-management-service.js:570` through `:577`. | Either document that valid required purchaseDate is enforced and invalid imported baselines are not currently reported, or implement an explicit data-quality alert and test it. Avoid claiming an alert not returned by the service. |
| DOC-08 / Medium | Missing-date prose uses “No Expiry Date”/“No Warranty Date,” whereas the backend's actual alert labels are “Missing License Expiry”/“Missing Hardware Warranty.” | `assumptions-and-data-model.md:90`; `srv/asset-management-service.js:549`, `:551`; actual labels elsewhere in the same document. | Use the exact returned labels consistently and distinguish explanatory prose from API enum/text values. |
| DOC-09 / High for cloud execution | Deployment instructions require trusted cloud Employee mappings but supply no provisioning command/action. Employees is read-only, so the required cloud Employee allocation/demo cannot be completed from the shipped API. | `docs/deployment.md:39`; `srv/asset-management-service.cds:20`; no provisioning script in `scripts/` at baseline. | Provide a controlled, audited mapping mechanism or an executable approved operator procedure, validate its production subject mapping, and record role/read isolation. This is an implementation/onboarding gap; an existing cloud login alone does not resolve it. |
| DOC-10 / Medium | Date-relative fixtures are seeded only into an empty inventory. Existing persisted seed records are not re-dated on subsequent days. A boundary demonstration against an older persisted seed must explicitly fix the reference date or use a fresh preserved development inventory. | `db/seed.js:157` onward; README relative-date/reproducibility statements; matrix G-036. | Clarify seed-once behavior and repeatable demonstration procedure. The new demonstration script records the controlled business date and avoids deleting existing data. Verify normal dynamic-date behavior separately. |
| DOC-11 / Medium | Inventory is paged at 25, but allocation directory and detail history are truncated at 500 and 100 respectively with no next-page controls in the baseline UI. Compliance reads every Asset and history record into one result. | `app/controller/App.controller.js:39`, `:587`, `:636`; `srv/asset-management-service.js:524` through `:527`. | Document actual limits, assess scale, and add paging/continuation where needed. Verify more than one inventory page and a history/directory exceeding bounds; do not claim full scale coverage from a 16-asset seed. |
| DOC-12 / Medium | SAPUI5 bootstraps from an unversioned CDN URL while manifest only declares minimum UI5 1.120.0. The exact runtime can change independently of the lock file. | `app/index.html:12`; `app/manifest.json` minUI5Version. | Record the actual runtime during evidence capture and consider pinning a supported UI5 runtime for repeatable submission. Recheck browser and production package after any pin/update. |
| DOC-13 / Medium | BAS/Build Code/CF historical observations are described, but the baseline evidence directory does not contain a dedicated submitted-Joule screenshot/result or task BAS build/run output. Written observation logs do not prove generated implementation. | `build-code-prompt-log.md:15`; `execution-evidence.md` BAS-001/BC-01/CF-DEPLOY-001; `docs/evidence/` baseline inventory. | Current lead environment inspection must capture actual contribution, prompt/result/accept/corrections and validation, BAS execution, and deployment state. Keep the historical pending record dated rather than rewriting it as success. |
| DOC-14 / High for deployment | The generated HDI deployer requires Node ^24 according to the captured build verification, while root/runtime prerequisites only say Node >=22. Generated-package runtime support must be checked separately from root installation. | `docs/evidence/2026-10-01-build-verification.json` deployment notes; README prerequisites; generated `gen/db/package.json` for the recorded build. | Record the current generated deployer engine range and ensure the authorized Cloud Foundry buildpack supports it. Update deployment prerequisites and validate the actual MTA build/runtime without assuming Node 22 can run every module. |

## Test-case ID reconciliation guide

This table identifies the baseline remapping by scenario; the lead should inspect every row when updating the actual CSV.

| Scenario | Baseline sheet ID | Relevant current matrix IDs |
|---|---|---|
| CAP compile | G-004 | G-004 |
| Persistent startup and server restart | G-005 | G-005, G-020 |
| Registration/name update | G-006 | G-006 |
| Invalid fields and generic lifecycle patch | G-006 | G-018, G-019 |
| Guarded deletion/history retirement | G-007 | G-007, G-014 |
| Allocation/history | G-008 | G-008 |
| Duplicate/ineligible allocation | G-009 | G-009 |
| Concurrent allocation | G-010 | G-010, G-039 |
| Return/history | G-011 | G-011 |
| Repeated/inconsistent return | G-011 | G-012 |
| Renewal and invalid renewal | G-012 | G-013, G-018 |
| Retirement/ineligible retired operations | G-013 | G-014 |
| Expiry boundaries/missing date | G-014 | G-015, G-038 |
| Hardware warranty | G-015 | G-016 |
| Idle thresholds/exclusions | G-016 | G-017, G-038 |
| Employee scoping/direct API denials | G-017 | G-021, G-022 |
| Compliance role | G-018 | G-023 |
| IT Admin and assignee validation | G-018 | G-024, G-018 |
| Authentication/unauthorized role | G-019 | G-025 |
| Search/filter/order/paging | G-020 | G-006, G-027 |
| Employee UI navigation | G-021 | G-028, G-029, G-040 |
| Admin UI lifecycle | G-021 | G-028, G-030, G-040 |
| Compliance UI | G-021 | G-031, G-040 |
| Build Code authentic prompts/contribution | G-022 | G-048, G-052 |
| BAS implementation/execution | G-023 | G-051 |
| CF packaging/deployment/roles | G-024 | G-054, G-055 |

IDs above reflect the reviewed matrix; if the lead revises the gates, use their final meaning as the authority. A missing field/date check is not automatically satisfied by a different rejected-input check.

## Deliverable coverage established by source inspection

The overview has objective, scope, role descriptions, architecture, assumptions, and a Mermaid flow. The sprint document uses three sprints, includes all four assessment phases, and maps a feasible five-day plan. Actual service CDS and usage notes are present and their operation names agree with the baseline handlers/UI. README exposes the real service path, persistent local setup, mock users, configuration, and test commands. The evidence index keeps historical failed logs and distinguishes local results from environment/deployment gaps.

The assigned work adds a full submission index, three-role demonstration procedure, and current official SAP source index. These artifacts improve discoverability and reproducibility. They do not close code, browser, environment, deployment, or independent review gates without actual execution evidence.

## Final integration audit and resolution record

Lead verification completed **2026-10-01 (Asia/Kolkata)** after the repairs and current environment inspection. The historical findings above reproduce the initial review; their current disposition follows. The lead reran the root CAP suite (19 passing), CAP compile, production build, and SAPUI5 packaging. The independent reviewer reran its repaired adversarial suite (19 passing), and router checks remain five passing on each of Node 22 and Node 24. Environment-specific facts are backed by the lead's current BAS/CF observations, not by the source-only reviewer.

| Finding | Final disposition | Repair/evidence |
|---|---|---|
| DOC-01 | RESOLVED | Test case IDs now map to the current matrix; traceability is G-059 PASS. See [test sheet](test-case-sheet.csv) and [matrix](requirement-evidence-matrix.csv). |
| DOC-02 | RESOLVED for recorded local scenarios | Root suite now has 19 passing tests and the independent HTTP harness has 19 passing groups, including missing/invalid fields, calendar dates, unknown IDs, unauthorized calls, race requests, and inconsistent return data. See [root log](../evidence/2026-10-01-backend-tests.log), [independent report](../evidence/independent-review-2026-10-01.md), and [harness result](../evidence/audit-security-after-repair.log). |
| DOC-03 | RESOLVED | The data-model document now includes an ER diagram showing Asset, AllocationHistory, Employee mapping, and the generated FK. |
| DOC-04 | RESOLVED AND VERIFIED | `AllocationHistory.assetID` is the real managed association, the generated key is `assetID_assetID`, and `npm run db:deploy` successfully migrated existing BAS SQLite data with a backup. Current compile/test evidence is linked above. |
| DOC-05 | RESOLVED | `employeeUserId` is documented as an immutable recipient identity snapshot for audit and return integrity. Only IT Admin reads allocation history. |
| DOC-06 | RESOLVED | Data-model and service documents describe the implemented contract and distinguish local behavior from unverified cloud behavior. |
| DOC-07 | RESOLVED BY DOCUMENTATION | Required purchaseDate gives valid application records an idle baseline. Imported/corrupt records with no valid baseline are omitted; the handler does not return a missing-baseline alert. The current model doc says this explicitly. |
| DOC-08 | RESOLVED | Current alert names match handler output: `Missing License Expiry` and `Missing Hardware Warranty`, with hardware warranty alerts separated from software license alerts. |
| DOC-09 | RESOLVED LOCALLY; CLOUD NOT VERIFIED | The IT Admin-only `provisionEmployee` action now creates a verified subject mapping with input validation and audit fields; root and independent tests verify its permissions and integrity. Real XSUAA role assignment and production subject onboarding remain unrun. |
| DOC-10 | RESOLVED | README, model notes, and [demonstration script](demonstration-script.md) state seed-once date behavior and use a controlled business date for boundaries. |
| DOC-11 | PARTIALLY RESOLVED; SCALE LIMIT REMAINS | CAP inventory queries were exercised with 1,200 rows across 24 ordered pages, combined filters/search, and employee scoping. UI page size is server-backed. Compliance aggregation still scans retained assets/history linearly, so larger production history volumes need target-specific profiling and possible database-side aggregation/paging. This is documented in the [independent review](../evidence/independent-review-2026-10-01.md). |
| DOC-12 | OPEN LIMITATION, DOCUMENTED | UI5 loads from an unpinned CDN runtime. Runtime pinning/reproducible CDN delivery was not changed. The actual runtime and remaining risk should be recorded before a release requiring exact UI5 version reproducibility. |
| DOC-13 | PARTIALLY RESOLVED; BUILDCODE BLOCKED | BAS source at `f7d5c44` was built, database-deployed, started, and exercised for the three roles; see [BAS verification](../evidence/bas-environment-verification-2026-10-01.md). The exact actual Joule prompt returned no result, current chat has no model configured, and generated contribution remains BLOCKED. Current BAS preview images were shown but not saved locally. |
| DOC-14 | BUILD REPAIRED; CLOUD RUNTIME UNVERIFIED | Root/BAS builds and the MTA archive succeeded with the current configuration; Node 24 is documented for generated HDI modules. The Cloud Foundry deployment clients timed out before registering a new operation, so target buildpack support, deployed staging, and runtime compatibility are not verified. See [attempt record](../evidence/cloud-deploy-attempt-2026-10-01.md). |

The final matrix is **55 PASS, 1 FAIL, 2 BLOCKED, 2 NOT RUN**. Those unresolved statuses include the failed Cloud Foundry deployment attempt, unavailable Build Code code generation, full Admin edit/maintenance/retirement UI, and complete manual accessibility review. Document consistency is checked and recorded as G-060 PASS because the deliverables accurately expose those limitations; this is not an overall assessment-readiness claim.

## Post-deployment status update — 2026-10-03

The dated review above reflects the 2026-10-01 environment state and remains as historical evidence. On 2026-10-03 the lead completed one bounded CF deployment from the repaired f7d5c44 BAS source, verified that the router and CAP service reported started routes, received HTTP 200 from the router root, and opened the deployed UI with the existing SAP BTP session as ComplianceManager. The authenticated Compliance page returned an empty dashboard. See the [deployment record](../evidence/cloud-deploy-success-2026-10-03.md).

The live HDI service parameters and application bindings were also inspected in BTP Cockpit. They match the Running loyalty-reward-db database ID and bind the CAP server and database deployer to the task's dedicated HDI service. The generated ITAdmin role collection has no users, groups, or attribute mappings. All-three-role verification is blocked pending a verified ITAdmin cloud session; no cloud lifecycle write occurred. The collection inspection does not rule out equivalent grants through other collections outside the tested session.

The current matrix therefore updates the actual deployment gate to PASS and records 56 PASS, 0 FAIL, 3 BLOCKED, and 2 NOT RUN. This does not close Build Code generation, IT Admin/Employee cloud role checks, HANA lifecycle/persistence verification, full Admin UI workflows, or manual accessibility review. The previous matrix counts and cloud timeout observations above are the earlier dated snapshot, not the current status.

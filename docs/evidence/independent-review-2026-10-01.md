# Independent post-repair security and integrity review

**Review date:** 2026-10-01 (Asia/Kolkata). **Reviewer:** independent `security_review` specialist agent. **Initial source snapshot:** `5a027959c5f3f39400a1bfb3241d70348d119acb`. **After-repair backend result: 19 passing, zero failing independent test groups.** Router runtime checks pass on Node 22 and 24. The router audit has zero high/critical findings and three remaining moderate aggregate findings for one decoder advisory; the mitigation and limits are documented below. This report reviews the local source; it does not certify a deployed HANA/XSUAA application or SAP assessment readiness.

The reviewer read and applied `ultrareview/SKILL.md` and `security-audit/SKILL.md`, inspected the service/model/UI/auth/deployment source and assessment evidence, then ran an independent adversarial HTTP harness. The harness explicitly starts `cds.test('serve', 'all', '--in-memory')`; it does not access the persistent development database or port 4004. Date-sensitive fixture setup fixes the business date to 2026-10-01 in Asia/Kolkata. During the initial audit, no application, backend, original tests, or deployment configuration was edited by this reviewer. On the lead's subsequent explicit assignment, this reviewer implemented the bounded router dependency/runtime mitigation described below; the backend fixes were implemented by a different specialist and independently retested here. The lead owns review/integration of the router changes.

## Initial verdict

**Initial independent harness result: 10 passing, 3 failing test groups.** The three failures were confirmed behavior defects. The initial separately resolved deployment router dependency tree contained two high and four moderate npm audit findings. These initial artifacts are retained unchanged; the after-repair outcomes are listed at the end of this report.

| ID | Severity | Verdict | Finding | Required correction |
|---|---|---|---|---|
| IR-01 | MEDIUM | Confirmed | `MyAssets(<foreign-or-nonexistent-id>)` returns an unrelated asset belonging to the caller with HTTP 200. The identity predicate prevents a foreign-data leak, but the requested resource identity is discarded. | Preserve key/infix predicates while mapping the query source; foreign and unknown keys must return 404. Also verify two different assets assigned to one employee return their exact requested IDs. |
| IR-02 | MEDIUM | Confirmed | `MyAssets/$count` returns `0` while Alex has one assignment. The handler replaces the aggregate count columns with ordinary asset columns. Paged `$count=true` returned the correct count of one in the initial fixture. | Preserve count/aggregate query semantics while enforcing the authenticated identity; verify count after multiple allocations and with filters. |
| IR-03 | MEDIUM | Confirmed | `returnAsset` closes one active history row whose employee identity differs from the asset's current assignment. The initial response is 200 and the asset becomes Available. This contradicts the requirement to reject inconsistent returns. | Before changing either row, compare the active history identity snapshot to the current assignment; reject conflicts and verify both asset and history remain unchanged. |
| IR-04 | HIGH | Confirmed dependency finding; exploitability not demonstrated | Root dependency audit is clean, but the separate approuter deployment module resolves vulnerable dependencies. Its audit reports two high and four moderate findings. | Resolve compatible patched router dependencies, make its dependency resolution reproducible, and rerun the router audit and runtime checks. Do not apply npm's suggested major downgrade without compatibility review. |

## Reproducible requests and observed responses

Run from the project root:

~~~powershell
npx mocha --timeout 30000 docs/evidence/audit-security.test.js
~~~

The named mock identities and passwords in the harness are local demo fixtures. They are not cloud credentials.

### IR-01: requested key is discarded

- Source before repair: `srv/asset-management-service.js:255-266`; in particular `select.from = { ref: [DbAsset.name] }` replaces the source including its key condition.
- As `employee.alex`, request `GET /odata/v4/asset-management/MyAssets(<Jamie asset UUID>)`.
- Expected: 404, because the requested resource is not assigned to Alex.
- Actual: 200 with `DEMO-Allocated-Laptop-Alex` and Alex's own asset UUID.
- A request for `00000000-0000-4000-8000-000000000001` also returns the same unrelated Alex asset with 200.
- Triage: a resource-selection defect, not confirmed cross-employee disclosure. The handler's identity filter remains effective in these requests.

### IR-02: count columns are discarded

- Source before repair: `srv/asset-management-service.js:264` unconditionally replaces `select.columns`.
- As `employee.alex`, request `GET /odata/v4/asset-management/MyAssets/$count` with one assigned fixture.
- Expected: HTTP 200 with count 1.
- Actual: HTTP 200 with count 0.
- Control request `MyAssets?$count=true&$top=1&$skip=0` returns `@odata.count: 1` and the one assigned asset. This distinction is retained in the observations JSON.

### IR-03: wrong active employee snapshot accepted

- Source before repair: `srv/asset-management-service.js:353-386` checks the count and date of active history but does not compare `history.employeeUserId` to `asset.allocatedToUserId`.
- Register a hardware fixture and allocate it to `employee.alex` through the API.
- In the isolated in-memory audit database only, mutate that one active history snapshot to `employeeUserId: employee.jamie`, `employeeName: Jamie Chen`. This simulates inconsistent imported/stored data; the public history API does not permit this mutation.
- As `it.admin`, request `POST /odata/v4/asset-management/returnAsset` with the fixture's `assetID`.
- Expected: 409 and no changes to the asset or active history.
- Actual: 200 with status Available and cleared current identity. The wrong employee's active history is closed by the normal return update.
- Triage: the normal API is protected against generic history mutation; the finding concerns the explicit inconsistent-data return acceptance gate.

### IR-04: router dependency audit is outside root audit scope

The root command `npm audit --json` reports zero vulnerabilities for 220 dependencies. Its normalized uncredentialed result is [audit-npm-root.json](audit-npm-root.json).

To avoid changing deployment source/configuration, the reviewer copied `.deploy/app-router/package.json` into `docs/evidence/audit-router/`, resolved a lock there with `npm install --package-lock-only --ignore-scripts --prefix docs/evidence/audit-router`, then ran `npm audit --json --prefix docs/evidence/audit-router`. The temporary lock is an audit fixture, not a production build change. Removal of that exact temporary directory was rejected by the automatic safety check with reason `blocked by policy`; the folder remains and should not be mistaken for application deployment source.

| Resolved package | Version | Audit relationship |
|---|---|---|
| `@sap/approuter` | 23.0.0 | Direct deployment dependency; aggregated high finding |
| `axios` | 1.18.0 | High advisories via approuter |
| `moment` | 2.30.1 | Moderate advisory via `@sap/logging` |
| `decode-uri-component` | 0.2.2 | Moderate denial-of-service advisory via query-string |
| `query-string` | 7.1.3 | Transitive aggregate finding |
| `@sap/logging` | 9.2.1 | Transitive aggregate finding |

The detailed advisory titles, affected ranges, and public advisory URLs are in [audit-router-npm.json](audit-router-npm.json). The report's six package findings include aggregate parents; they are not six demonstrated attacks. The reviewer did not run an exploit. Root `package-lock.json` does not cover this separate router module, whose source has no checked-in lock at the initial review snapshot.

## Passing adversarial checks

The 10 passing test groups establish the following against isolated SQLite and mocked identities:

- Alex's single initial own-key detail read returns his assigned laptop.
- Employee history `$expand=asset` and inventory navigation reads are denied with 403; an unsupported MyAssets association expand is rejected with 400. The public employee projection omits private subject/audit fields.
- All six lifecycle actions and asset create/update/delete are denied to both Employee and Compliance Manager with 403.
- PUT and PATCH to a nonexistent asset cannot create a partial row; a follow-up read remains 404. History upsert is rejected.
- Calendar-invalid purchase dates (`2026-02-30`, `2026-13-01`, `0000-00-00`, and a noncanonical `2026-9-1`) return 400. Unknown asset allocation returns 404 and an inactive employee returns 400.
- Missing assetName, blank assetName, and missing purchaseDate return clear 400 errors. Every lifecycle action with missing required assetID returns 400.
- Every lifecycle action with a valid but nonexistent UUID returns 404; unknown, inactive, and injection-like employee identifiers all return 400.
- Missing and invalid authentication receive 401 for session and inventory reads.
- Six simultaneous allocations yield one 200 and five 409 responses and exactly one active history row.
- Return with zero or two active history rows returns 409 and leaves the asset Allocated. IR-03 covers the remaining single-row identity inconsistency.

These checks extend the original backend suite. They do not establish HANA concurrency semantics, real XSUAA identity mapping, or browser workflow completion.

## Rejected attack hypotheses and deployment limitations

Parameterized CAP CQN and transactional database operations inside already-authorized lifecycle actions are appropriate here. The security-audit skill's generic RLS template is not evidence that this CAP model needs an unrelated RLS framework. API isolation was verified with real HTTP requests and CAP role annotations. Display names are not used to authorize employee reads.

The MyAssets projection has no exposed history association to expand. Compliance data is returned by an authorized function and omits employee subjects/history. An authenticated user's `sessionInfo` reveals only their own principal and configured roles. The reviewer found no cloud credential in reviewed source; the package mock passwords are explicitly documented local demo users.

Production configuration selects HANA and XSUAA; development seeding is disabled by its production guard. The MTA router enables CSRF protection and forwards the authenticated token. Real bindings, role collections, principal mapping, HANA action execution/concurrency, and cloud deployment were not exercised by this reviewer. The Employee mapping entity was read-only at the initial snapshot; the subsequent admin-only `provisionEmployee` action supplies a locally verified trusted creation path. Real cloud IAM role assignment and principal/mapping onboarding still require target verification.

The compliance function initially reads the inventory and all allocation histories before computing alerts. This is linear in the total retained history and has no database-side alert paging. It is a design/performance limitation to measure at realistic inventory and history sizes, not a demonstrated failure in this review.

## Evidence accuracy and acceptance implications

The 2026-09-28 execution index correctly distinguishes local passes from unavailable Build Code output/BAS implementation/cloud deployment. It does not claim hidden evaluator success. The original matrix rows G-012 and G-018 cited broad validation coverage that the original 10 tests did not fully assert; the independent harness now verifies those missing-field, invalid-calendar, nonexistent-ID, disabled-assignee, and zero/multiple-history cases. G-012 still needs the IR-03 identity-inconsistency repair. Employee access assertions should also cite IR-01/IR-02 repairs and reruns.

Browser, BAS, Build Code generation, HANA/XSUAA, final MTA packaging, and updated final submission-document checks belong to the lead's remaining verification. This reviewer used no browser and performed no deployment, commit, push, or assessment submission.

## Evidence files

- [Independent harness](audit-security.test.js)
- [Frozen initial failure output](audit-security-before-repair.log)
- [Frozen exact initial response observations](audit-security-observations-before-repair.json)
- [After-repair independent output](audit-security-after-repair.log)
- [After-repair exact response observations](audit-security-observations-after-repair.json)
- [Root audit result](audit-npm-root.json)
- [Router audit result](audit-router-npm.json)
- [Isolated router resolution log](audit-router-install.log)

Official SAP documentation consulted: [CAP authorization, including controlling association exposure](https://cap.cloud.sap/docs/guides/security/authorization) and [CAP JavaScript query API](https://cap.cloud.sap/docs/node.js/cds-ql). The live HTTP results above are the evidence for this Node.js implementation; Java-specific documentation behavior was not assumed for Node.js.

## Repair verification

The backend specialist preserved the MyAssets key predicate while mapping its source, preserved count columns, and added an identity/name consistency check before return mutations. The reviewer updated only the harness's association names to the required `assetID` association/generated `assetID_assetID` FK and added a second-assigned-asset detail/count check. The original failure expectations were retained.

**Independent final rerun: 19 passing, zero failing**, recorded in [audit-security-after-repair.log](audit-security-after-repair.log). Foreign and nonexistent MyAssets keys return 404, `$count` returns one and then two after a second own assignment, the second own asset's detail ID is exact, and the mismatched-history return returns 409 with the asset still Allocated. IR-01, IR-02, and IR-03 are **FIXED AND INDEPENDENTLY VERIFIED**. The required association attribute naming concern is also resolved by the schema's actual `assetID : Association to Asset` declaration; dependent harness queries now use `assetID_assetID`.

Five additional independent groups verify the newly added provisioning contract: Employee/Compliance Manager receive 403 and unauthenticated calls receive 401; generic Employee create/update/delete remain forbidden even for IT Admin; case-sensitive subject IDs are trimmed without case conversion; actor/date audit fields persist internally; duplicate calls return 409 without overwriting names; missing/blank/overlong/control-character input returns 400; simultaneous creation yields one 200 and one 409 with exactly one stored mapping. A provisioned subject and a separate unknown roleless principal both have an empty session role list and receive 403 for MyAssets, Assets, Employees, AllocationHistories, complianceAlerts, and provisioning. The local mocked-auth adapter recognizes these roleless identities for their own session information; provisioning grants no IAM role, password, or authentication credential.

### Router correction, compatibility, and residual advisory

The router remains `@sap/approuter` 23.0.0, whose published Node engines are `^22.0.0 || ^24.0.0`. Scoped overrides select compatible same-major `axios` 1.20.0 and `moment` 2.31.0. A real `.deploy/app-router/package-lock.json` now records the deployed module's complete resolution. Production `xs-app.json` authentication and CSRF settings were not changed.

The CommonJS query-string 7 parser expects `require('decode-uri-component')` to return a callable function. Patched decoder 0.5.0 is ESM and exports a module default, so blindly overriding to that version is not a compatible correction. Instead `startup.js` registers a native `decodeURIComponent` validation and an 8192-byte raw request URL limit in the supported approuter `first` extension slot. It validates and forwards the original URL without rewriting its query content. Malformed percent/UTF-8 input returns 400; oversized targets return 414. The package's npm `start` script uses this startup module.

The installed router's `lib/bootstrap.js` places the `first` extension before `pathRewritingMiddleware` and `loginMiddleware`; its earlier request-property parsing uses Node's built-in `querystring`. The vulnerable tolerant decoder is used by `lib/utils/url-utils.js` during `sap_idp` query rewriting. The runtime regression actually counts calls to that parser: valid `sap_idp` input reaches query-string; malformed and overlong targets do not. This is verified ordering for the checked-in standalone router mode. Future multitenant/dynamic-routing, WebSocket, or extension configuration must be reviewed separately before relying on the same guard.

**Router audit after correction: zero high, zero critical, three moderate package findings** (`decode-uri-component`, `query-string`, and aggregate `@sap/approuter`). These all remain attributable to [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), whose upstream advisory recommends a patched decoder or limiting input size. The raw malformed-target entry point tested here is mitigated. The old decoder is still installed and its advisory is **not suppressed or marked fully patched**. IR-04's high dependency findings are repaired; the moderate residual remains documented pending a compatible upstream decoder chain.

Actual router tests start approuter against an isolated temporary local destination with a test-only unauthenticated route. They verify normal OData/UTF-8/duplicate query forwarding, real `sap_idp` rewriting, five malformed patterns, an overlong target followed by a healthy request, and patched axios/moment API behavior. They do not prove real XSUAA sign-in or cloud bindings.

| Check | Actual result | Evidence |
|---|---|---|
| Node 24.16.0 router runtime | 5 passing, zero failing | [audit-router-startup-tests.log](audit-router-startup-tests.log), [verification metadata/source hashes](audit-verification-summary.json) |
| Node 22.23.3 router runtime | 5 passing, zero failing | [audit-router-node22-tests.log](audit-router-node22-tests.log) |
| Locked clean router installation | `npm ci --ignore-scripts` performed; follow-up runtime test/audit recorded | [audit-router-npm-ci.log](audit-router-npm-ci.log), [audit-router-startup-tests-after-ci.log](audit-router-startup-tests-after-ci.log) |
| Router high/critical audit threshold | `npm audit --audit-level=high` exited 0; residual moderate findings remain visible | [audit-router-high-threshold.log](audit-router-high-threshold.log), [audit-router-after-repair-npm.json](audit-router-after-repair-npm.json), [verification metadata](audit-verification-summary.json) |
| Resolved patched dependency versions | axios 1.20.0; moment 2.31.0; decoder 0.2.2 retained | [audit-router-resolved-versions.json](audit-router-resolved-versions.json) |

The backend independent review is complete for the exercised local scope. The separate `build_verification` specialist subsequently read the router/MTA code and recorded a read-only independent verdict to the lead: the bounded defense is accepted for the current standalone dedicated-XSUAA configuration; original URL forwarding and auth/CSRF settings are retained; parser-control tests and pinned patched versions support compatibility; the three moderate residual findings and future SaaS/WebSocket scope limitation remain accurate. This second review was a source/evidence review, not an additional claimed browser or cloud execution. Real HANA concurrency/identity/deployment and browser/environment evidence remain lead-owned acceptance gates.

The lead reran `npx mocha --timeout 30000 docs/evidence/audit-security.test.js` against the integrated source on 2026-10-01 after the root suite/build rerun; it again reported **19 passing** with exit code 0. See [current-source final run](audit-security-final-2026-10-01.log).

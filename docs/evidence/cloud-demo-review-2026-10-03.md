# Cloud demo data/profile review — 2026-10-03

## Scope and method

The lead integrated a one-off SQLite-to-HANA snapshot import, a dedicated XSUAA DemoOperator scope, request-scoped demo profiles, SAPUI5 switching, and trial deployment configuration. Specialists owned separate files. The environment's agent-thread limit prevented spawning another reviewer; specialists reviewed the other owners' code independently. The lead judged findings, applied integration/documentation repairs, and reran the full suite.

- UI implementer independently reviewed backend authentication, import integrity, and deployment packaging, excluding their own UI from independent coverage.
- Transfer implementer independently exercised the UI controller with an isolated Node VM harness, excluding their own transfer implementation from independent coverage.
- Authentication implementer independently inspected transfer guards and transaction behavior.

## Reproducible findings and repairs

| Finding | Resolution and evidence |
|---|---|
| Documented private export path was initially rejected by the writer | Allowed the dedicated ignored `demo-data-private` directory, created private parent directories, retained exclusive `wx` creation. Transfer tests pass. |
| Generated package predated source repairs | Rebuilt production output and copied UI/import CLI. Source and generated SHA-256 hashes matched for middleware and transfer module. |
| Initial profile integration harness had an incorrect rejection assertion and used trusted in-process contexts | Replaced it with isolated in-memory application execution and real signed fixture JWTs through standard CAP XSUAA middleware. Kept the failed run in `cloud-demo-tests-before-repair-2026-10-03.log`. |
| Repeat-import status spelling differed in the guide | Corrected to actual `already-imported` response. |
| Approved database ID could override an unrelated destination hostname | Required the exact approved database ID as the first DNS label and the SAP HANA Cloud domain suffix on every binding. Added malformed/unrelated host and CLI guard regressions. |
| Blanket dialog cleanup claim exceeded tracking of MessageBox confirmations | Documented form-dialog cleanup and generation-checked pending confirmation callbacks. No stale mutation reproduced; modal confirmations ordinarily block toolbar switching. |

## Actual local checks

- Lead `npm test`: **44 passing**, exit 0 (`cloud-demo-tests-2026-10-03.log`). Includes 19 lifecycle tests, 13 transfer tests, 11 middleware cases, and one signed-JWT HTTP integration case.
- Lead CAP compile and production build: exit 0 (`cloud-demo-compile-2026-10-03.log`, `cloud-demo-build-2026-10-03.log`).
- Lead UI/import packaging: exit 0 (`cloud-demo-package-2026-10-03.log`).
- JavaScript syntax and SAPUI5 XML parsing passed; `git diff --check` had no whitespace defects.
- Opposite-owner UI harness rejected delayed Admin inventory, employee mapping, and CSRF responses after switching profiles, captured the intended profile header, verified `/logout` for XSUAA, and verified that a server profile mismatch clears the business view.
- Opposite-owner backend review ran focused tests and an additional isolated SQLite concurrent import check; no unresolved confirmed security/integrity source defect was reported.

The first direct-server harness also attempted schema deployment against the configured workstation SQLite file. CAP rolled the failed transaction back. Subsequent read-only inspection found integrity `ok`, 18 assets / 4 histories / 3 employees and no attempted `cds_model` table. Closing the connection checkpointed an existing WAL, so file bytes/timestamp cannot be claimed unchanged without a prior snapshot. All subsequent harnesses explicitly use isolated memory storage. The BAS source database is a different file and has not been deployed or reset by these tests.

The HANA exclusive lock syntax and uppercase plain identifiers match official HANA SQL syntax and generated unquoted table names. This source check does not prove live HDI runtime lock privileges or HANA timestamp conversions.

## Limits

Live HANA import, hash comparison, visible cloud profiles, cloud lifecycle writes, and real SAP role assignment/logout must be recorded separately. This review is not evidence of those actions. The signed-JWT tests use generated fixture keys and an isolated JWKS response; they do not use or store real SAP tokens. No reviewer performed deployment, account permission changes, or assessment submission.

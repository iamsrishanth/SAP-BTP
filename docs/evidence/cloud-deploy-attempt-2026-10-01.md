# Cloud Foundry Deployment Attempt Record

**Date:** 2026-10-01 (Asia/Kolkata)
**Target:** Authorized non-production SAP BTP Cloud Foundry trial target, `dev` space, using the `mta.trial.mtaext` configuration for the running `loyalty-reward-db` HANA Cloud instance.
**Result:** **FAIL — deployment client timed out before a new MTA operation was registered.**

## What was attempted

1. An earlier MTA deployment operation failed because the generated CAP service package attempted to load the development seed by a path that was not present in the production build. The source repair in `f7d5c44` added the shared date-rules module and prevents the production handler from loading development seed code.
2. After the repair, `mbt build` in BAS completed successfully and produced the MTA archive.
3. A deployment of `mta_archives/sap-btp-it-asset-lifecycle_1.0.0.mtar` with `mta.trial.mtaext` remained at the MultiApps client's initial “Deploying multi-target app archive” message for roughly ten minutes. No new entry appeared in `cf mta-ops`; the waiting client was interrupted.
4. A bounded second attempt used a 300-second timeout. It again remained at the initial archive deployment message, timed out, and did not register a new MTA operation. `cf mta-ops` continued to show only the earlier failed deployment.

## Observed state and unverified work

- The target API/org/space and required HANA and XSUAA plans were available. The HANA Cloud instance was observed running.
- The task-specific service instances existed, but the task service, router, and deployer applications were stopped when inspected.
- No successful upload/deploy operation, running task app, verified Cloud Foundry route, role collection assignment, trusted production Employee mapping, cloud request, HANA lifecycle mutation, or cloud smoke test is claimed.
- This failure is separate from the successful BAS local preview, the successful local SQLite tests, and the successful MTA archive build.

## Evidence integrity

The BAS screenshot that showed the raw CLI output also exposed a personal email address and is intentionally excluded from this repository. The command result and current `cf mta-ops` state were observed directly in BAS; this sanitized record omits account email, SSO data, tokens, and raw shell output. It does not claim a successful Cloud Foundry deployment.

## Smallest next action

Retry only after the CF MultiApps archive upload/deploy path responds normally. Then inspect the newly registered MTA operation, `cf apps`, `cf services`, and `cf routes`; if deployment completes, exercise the authenticated router and HANA-backed lifecycle before marking deployment or cloud-role gates as passed.

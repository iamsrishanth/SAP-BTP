# Three-Role Application Demonstration

Prepared on **2026-10-01 (Asia/Kolkata)**. This is a procedure with expected observations, not a record that the steps have already been executed. Record actual outcomes and screenshots in the [test case sheet](test-case-sheet.csv), [evidence index](execution-evidence.md), and [requirement matrix](requirement-evidence-matrix.csv).

## Preparation and reproducible clock

Run in an authorized development workspace with Node.js 22 or newer. Use an empty development inventory for the complete seeded boundary demonstration, or preserve the existing inventory and create new walkthrough fixtures. Do not delete the current database just to repeat the demonstration. Relative-date seed records are created only when the inventory is empty; changing the clock does not rewrite existing seed dates.

For the walkthrough below, deliberately set the business date to **2026-09-28**, matching the automated test reference date. The calendar date of the demonstration may be later; screenshots must show the configured business date so this distinction is clear. The normal application should run without `ASSET_FIXED_TODAY` once the controlled demonstration is finished.

```powershell
$env:ASSET_FIXED_TODAY = '2026-09-28'
$env:ASSET_TIME_ZONE = 'Asia/Kolkata'
$env:ASSET_EXPIRY_WARNING_DAYS = '30'
$env:ASSET_IDLE_DAYS = '30'
npm ci
npm run db:deploy
npm run watch
```

Open `http://localhost:4004/`. If the port is already occupied by this application's development server, use the existing server only after checking its configured business date. Successful registration and lifecycle mutations use the actual persisted CAP service at `/odata/v4/asset-management/`.

| Local sign-in | Password | Intended view |
|---|---|---|
| `it.admin` | `demo-admin` | Inventory and lifecycle operations; Compliance tab. |
| `employee.alex` | `demo-employee` | Alex Morgan's currently assigned assets. |
| `employee.jamie` | `demo-employee` | Jamie Chen's currently assigned assets. |
| `compliance.manager` | `demo-compliance` | Compliance and idle alerts. |

These are local mock identities. For a deployed demonstration, use the authorized authenticated BTP session and provision trusted Employee mappings first. Do not reuse local passwords or mock user IDs as production onboarding data. Use the lead's current environment/evidence record for the actual BAS workspace, Build Code capability, and cloud deployment status. The procedure author has not independently exercised those browser sessions.

## IT Admin: purchase and first assignment

1. Sign in as `it.admin`. Confirm the Inventory list and lifecycle controls appear.
2. Use search and Type/Lifecycle status filters. Select a record to show master-detail navigation. Reset filters before creating fixtures.
3. Choose **Register asset**. Enter a unique session name such as `WALKTHROUGH-Laptop-20261001-A`, type `Hardware`, purchase date `2026-09-01`, and warranty date `2027-09-01`. Choose **Register**.
4. Select the created asset. Expect `Available`, no current assignee, and no allocation history. Copy its UUID into the execution record.
5. Choose **Edit name** and change the description to `WALKTHROUGH-Laptop-20261001-A-renamed`. Save and refresh. Expect the same UUID and changed name.
6. Choose **Allocate**, select **Alex Morgan · employee.alex**, and confirm. Expect status `Allocated`, Alex as assignee, and exactly one history row with assigned date `2026-09-28` and **Active assignment** instead of a return date.
7. Refresh the browser, sign in again if needed, and find the same UUID/name. Expect the stored assignment and history to remain.

Capture the detail/history screen after allocation and after refresh. Record API/runtime logs associated with the mutation. Duplicate and simultaneous requests require the automated/API checks; an absent second Allocate button is not evidence of backend concurrency protection.

## Employee: identity-filtered assignment

1. Sign out and sign in as `employee.alex`.
2. Open **My Assets** and find the walkthrough laptop. Expect Alex's assigned laptop and no Jamie assignment. Select it to show the required fields in the detail area.
3. Confirm inventory lifecycle controls are unavailable. Employee history is restricted to IT Admin by the current permission model; the Employee view does not grant allocation history access.
4. Refresh and reconnect. Expect Alex's current assignment to remain.
5. Sign out and sign in as `employee.jamie`. Expect the newly allocated Alex laptop to be absent. Jamie's seeded software assignment may appear if the seed is intact.

Capture both employee lists. Also run the direct API isolation and permission checks: UI visibility alone does not establish backend authorization. The service compares the authenticated CAP identity with `allocatedToUserId`; `allocatedTo` and `employeeName` are display strings.

## IT Admin: return, reassignment, maintenance, and disposal

1. Sign back in as `it.admin` and select the walkthrough laptop.
2. Choose **Return**, then confirm. Expect `Available`, cleared assignee, and a retained history row with assigned/returned date `2026-09-28`.
3. Allocate the same asset to **Jamie Chen · employee.jamie**. Expect a second history row; Alex's closed row remains unchanged, and exactly one row is active.
4. Optionally switch to Jamie briefly to show the newly assigned laptop. Return to Admin.
5. Return it again. Expect two closed history rows and no active assignment.
6. Choose **Maintenance**, enter `Scheduled inspection after return`, and confirm. Expect `In Maintenance`; allocation is unavailable. Choose **Release**. Expect `Available` again.
7. Choose **Retire**, enter `Assessment disposal demonstration`, and confirm. Expect terminal `Retired`, the retirement reason, and both preserved history rows.
8. Set the lifecycle filter to **Retired** and find the same asset. Refresh and verify its retirement/history remain.

An allocated asset must be returned before retirement. The API test should additionally attempt retirement while assigned and allocation after retirement, then verify the rejected operations leave state/history unchanged. A hidden action is not proof of either rejection.

For safe physical-delete behavior, register a second throwaway Hardware asset without assigning it. Select it, choose **Delete**, and confirm only for that fixture. Expect it to disappear. The historic laptop is retained as Retired; API checks must reject deletion of an asset with any allocation history.

## Compliance Manager: date, warranty, and idle categories

1. Sign in as `compliance.manager`. Expect **Compliance and idle assets** and the business date `2026-09-28`, timezone, and 30-day thresholds.
2. Inspect **Expired software licenses**. With an intact seed, `DEMO-Expired-Software-License` expires five days before the configured business date.
3. Inspect **Software licenses expiring within the warning window**. `DEMO-License-Expires-Today` remains valid today and shows zero days remaining; `DEMO-License-Warning-Day-30` is included. `DEMO-License-Warning-Day-31` is excluded from this category.
4. Inspect **Hardware warranty alerts**. `DEMO-Hardware-Warranty-Expiring` is a warranty alert, never an expired software license.
5. Inspect **Idle available assets**. `DEMO-Idle-Laptop` uses purchase date, and `DEMO-Returned-Idle-Monitor` uses its latest returned date. Allocated, maintenance, and retired assets are excluded.
6. Inspect **Data quality: missing expiry or warranty date**. Legacy missing software expiry and missing hardware warranty are separate text labels, not silently counted as expired licenses.
7. Confirm the Compliance Manager cannot perform inventory/lifecycle writes and does not receive employee identity fields in the alert response. Verify direct API denials in the security test output.

If existing seed records were renewed/retired in a previous run, record that actual state. Do not claim absent seed examples were observed. Use a preserved fresh development inventory or create controlled fixtures for the required categories and keep their IDs in the evidence record.

## IT Admin and Compliance Manager: software purchase and renewal

1. As Admin, register `WALKTHROUGH-License-20261001-A`, type `Software`, purchase date `2026-09-01`, expiry date `2026-10-13`. Expect `Available`.
2. Open Compliance as Admin or sign in as Compliance Manager. Refresh alerts and find this UUID under expiring software: 15 days remain relative to `2026-09-28`.
3. As Admin, select the software asset and choose **Renew license**. Set expiry to `2026-12-28` and choose **Renew**.
4. Expect the stored new expiry date. Refresh Compliance. Expect this UUID to disappear from the 30-day expiring group immediately; it is not expired.
5. Allocate this license to Alex, then confirm the current assignment remains after a permitted later renewal. Compliance and assignment are independent values. Return the license and retire it if disposal is part of the recorded walkthrough.
6. Verify rejected renewal dates through the UI/API: today, a date not extending the current expiry, a calendar-invalid date, and a Hardware license renewal request. The backend should reject them without changing the stored expiry or assignment.

Renewal requires a valid date strictly later than both the configured business date and existing expiry. A license expiring today is still valid through today; the renewal operation still requires a future extension.

## Evidence and completion record

Record source revision, server URL, runtime/database profile, configured business date/timezone/thresholds, demo fixture UUIDs, actual steps, actual result, evidence path, and any exception. Capture authentic screens for allocation, Employee views, closed history, maintenance/release, retirement, renewal, compliance boundaries, and post-refresh persistence. Preserve error responses for the direct API permission/concurrency/invalid-transition checks.

Run `npm run compile`, `npm test`, `npm run build`, and `npm run copy:ui` for the final source and retain their actual outputs. A successful local build/test/run is local evidence. BAS implementation, executed Build Code prompts/results/corrections, HANA behavior, Cloud Foundry deployment and role setup require their own actual records. Complete independent review and update the matrix before using a readiness statement.

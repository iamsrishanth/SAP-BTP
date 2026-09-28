# Build Code Prompt Log

## Evidence status

**Status: IN PROGRESS — an authenticated SAP Build Code/Joule workspace is available.** On 2026-09-28 the lead inspected the user's SAP Build lobby and BAS workspace and submitted one read-only Joule Code Search prompt. The prompt remains visibly in a `Thinking...` state at the latest check; no search result has been retrieved and no generated code or changed files are evidenced yet. Build Code use is therefore initiated but the required code generation/implementation contribution is still unverified.

The Build Code usage requirement remains unverified. This log separates actual execution evidence from prompt text prepared for a future authorized session. A locally stored proposed prompt is not evidence that Build Code was used.

## Actual prompt executions

The following row records the prompt exactly as submitted. Because Joule has not returned, output, changed files, corrections, and validation are recorded as pending rather than inferred.

| Sequence | Date/time | Purpose | Exact prompt actually submitted | Generated result | Files/features affected | Corrections after generation | Validation performed | Status |
|---|---|---|---|---|---|---|---|---|
| BC-01 | 2026-09-28 | Read-only discovery of the existing AssetMaintenance workspace and missing IT asset lifecycle requirements | `/code-search Search the current AssetMaintenance workspace for its CDS entities, service definition, handler/action files, authorization configuration, UI5 app paths, and local/build/deployment scripts. Summarize actual file names, service paths and actions, then list the required IT asset lifecycle fields, roles, and workflows that are missing. Do not edit files or generate code.` | Pending; Joule displayed `Thinking...` at the latest inspection; no result captured | None observed; prompt explicitly requested read-only search | Pending; no generated code to correct | Search result not yet returned; no code validation applicable | SUBMITTED / RESULT PENDING |

## Proposed prompts — prepared only, not executed

The exact prompt below is a proposed starting point for a future Build Code session. It is **not** an actual submission record. Before use, inspect the workspace and replace no service paths or filenames by guesswork; the prompt asks Build Code to discover existing project contracts.

### Proposed sequence P-01 — inspect project and build the SAPUI5 integration

- **Prepared:** 2026-09-28
- **Purpose:** Ask Build Code to inspect the real project and implement/refine SAPUI5 screens against the existing CAP service contract without replacing backend authorization with frontend-only controls.
- **Exact proposed prompt:**

~~~text
Inspect the current workspace before editing. This is an SAP CAP Node.js and SAPUI5 assessment project for IT Asset Lifecycle Management. Preserve existing code and project conventions. First report the discovered CAP OData V4 service name/base path, entity/action names, UI5 app path, run commands, and authorization roles from the source files. Then implement or complete the SAPUI5 master-detail asset list, asset detail with allocation history, Employee My Assets view, IT Admin lifecycle forms/actions, and Compliance Manager alerts using the real CAP service only; do not introduce mock UI data or another frontend framework. Respect the current authenticated-user flow and do not rely on hidden buttons for authorization. Add accessible labels, loading/empty/error/permission states, server-side search/filter/paging where the backend supports it, and clear non-color-only expiry and idle labels. Keep service paths in the existing configuration rather than duplicating them. Do not claim that Build Code, BAS, deployment, or browser testing succeeded unless this workspace records that evidence. After editing, list every changed file, explain any unresolved contract mismatch, and provide the exact validation commands available in this project. Do not alter the assessment submission state.
~~~

- **Generated result:** None; proposed prompt has not been submitted.
- **Files/features affected:** None; no Build Code edits are evidenced.
- **Corrections after generation:** Not applicable.
- **Validation performed:** Not applicable; prompt was only prepared.
- **Status:** PROPOSED / NOT RUN.

## Updating this log after an actual Build Code session

For every prompt actually submitted, append a row to the actual-execution table with the exact submitted text and date/time. Add a short execution record below the table with:

1. The Build Code workspace/project identifier (redact secrets and private tenant details).
2. The actual prompt text, copied from the session/activity view rather than reconstructed from memory.
3. A concise summary of the generated output and exact files/features changed.
4. Any manual corrections made after generation.
5. The validation commands or UI checks actually run and their observed results.
6. A reference to genuine screenshot/log evidence under docs/evidence/.

If Build Code produces no changes or an error, record that outcome as-is. Do not mark proposed text as executed or convert local work into Build Code evidence.

## BAS relationship

This file logs Build Code prompts only. The user-provided authenticated SAP Build lobby showed an existing `AssetMaintenance` full-stack Node.js project. Its BAS workspace was opened and inspected, including the project map, handler source, package configuration, and terminal history; the historical terminal output is not represented as a command run by this task. Task-specific BAS implementation/build/run evidence remains pending and must be captured separately. Local CAP/UI5 work is not BAS evidence.

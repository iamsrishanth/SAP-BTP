# Agile Sprint Plan

## Delivery shape

The assessment names four phases but asks for a 2-3 sprint plan. This plan uses exactly three sprints and maps all four phases: (1) entity/CAP model; (2) allocation/compliance handlers; (3) SAPUI5 master-detail/alerts; and (4) integration testing/deployment. Sprint 3 includes the UI phase and the integration/deployment phase. The five-day schedule assumes one small CAP/UI5 delivery team, daily integration, and access to SAP tooling; environment access delays are recorded as blockers rather than hidden.

## Sprint 1 - Entity and CAP model (Days 1-2)

**Assessment phase mapped:** Entity design and CAP model.

**User stories**

- As an IT Admin, I need a persisted Asset catalogue with the required fields so purchased assets can be registered and found.
- As an IT Admin, I need allocation history linked by a CDS association so each lifecycle change is traceable.
- As a developer, I need role-aware service projections and a local database so later workflows use a stable contract.

**Acceptance criteria**

- Asset and AllocationHistory preserve the required keys, fields, and semantics; CAP's generated foreign-key property is documented.
- Employee identity mapping and audit/lifecycle additions are justified and do not replace required string attributes.
- CAP service compiles and starts locally with persistent SQLite storage.
- Seed records include distinct users and representative lifecycle/type cases; date-sensitive fixtures can use a controlled clock.
- Service contract names, role boundaries, and status/date vocabulary are reviewed before workflow/UI work.

**Dependencies**

- Assessment requirements and assumptions/data-model decision record.
- Node.js/npm available; CAP dependencies installed through the project package manifest.
- Identity/role model selected before exposing service mutations.

## Sprint 2 - Allocation and compliance handlers (Days 2-3)

**Assessment phase mapped:** Allocation and compliance handlers.

**User stories**

- As an IT Admin, I need allocate and return actions that atomically maintain current state and immutable allocation history.
- As an IT Admin, I need renewal, maintenance, and retirement actions that enforce allowed transitions.
- As a Compliance Manager, I need current license/warranty alerts and a predictable idle-asset list.
- As an Employee, I need the backend to scope assigned assets to my authenticated identity.

**Acceptance criteria**

- Allocate sets Allocated and allocatedTo, inserts one active history record, rejects duplicate/ineligible assets, and validates enabled employees.
- Concurrent attempts for one asset result in one successful allocation and no partial state.
- Return closes exactly one active history record, sets returnedDate, clears current assignee, restores Available, and rejects repeated/inconsistent returns.
- Renewal accepts only a future extension, immediately changes computed compliance, and keeps compliance separate from lifecycle status.
- Expired/soon/today/missing-date/hardware-warranty and idle-threshold rules pass controlled-clock backend tests.
- Retired assets cannot be allocated; allocated assets must be returned before retirement; history remains preserved.
- Direct API calls enforce the same role and lifecycle rules as the UI.

**Dependencies**

- Sprint 1 schema and service contract.
- Defined canonical user identity mapping and role scopes.
- Local SQLite adapter and a concurrency-safe conditional state transition.

## Sprint 3 - SAPUI5 master-detail, alerts, integration testing, and deployment (Days 4-5)

**Assessment phases mapped:** SAPUI5 master-detail/alerts; integration testing/deployment.

**User stories**

- As an Employee, I need a My Assets view and asset details without access to another employee's records.
- As an IT Admin, I need an inventory list and forms/actions for registration, permitted edits, allocation, return, renewal, and retirement.
- As a Compliance Manager, I need clear license, warranty, and idle alerts.
- As a delivery reviewer, I need repeatable tests, authentic execution evidence, a deployment guide, and a truthful environment status.

**Acceptance criteria**

- SAPUI5 master list supports server-side search/filter/paging; selecting an asset opens details and preserved allocation history.
- Employee, IT Admin, and Compliance Manager screens call the live CAP service with role-appropriate data/actions.
- Success, loading, empty, validation, permission, and failure states are clear and accessible; alerts have text labels and do not rely on color.
- Backend and integration test suites pass for the completed behaviors, with a controlled date and concurrency test. Browser workflows demonstrate persistence after refresh.
- Independent reviewer records reproducible findings; required fixes are retested.
- README and all required submission documents link to current implementation/evidence. Cloud Foundry configuration is reviewed and deployment is attempted only when a target and authorization exist; local run and cloud result are reported separately.
- BAS and Build Code prompts/contributions are recorded only when actually used. No final assessment submission is performed.

**Dependencies**

- Sprint 2 service operations and response contracts.
- SAPUI5 tooling/runtime and browser access.
- BAS/Build Code and Cloud Foundry accounts/targets for those environment-specific gates.

## Five-day delivery map

| Day | Sprint / focus | Planned work and exit evidence |
|---|---|---|
| Day 1 | Sprint 1: model and contract | Finalize assumptions; implement required entities, managed association, employee mapping, status/date constraints; create initial seed data and service contract. Review generated FK naming. |
| Day 2 | Sprint 1 close; Sprint 2 start | Compile/start CAP on SQLite; verify read model and auth boundaries; integrate asset registration and guarded edits; begin transactional allocation/return handlers. Freeze contracts before UI integration. |
| Day 3 | Sprint 2: handlers and compliance | Complete allocation, return, renewal, maintenance, and retirement logic; implement compliance/idle queries; run validation, controlled-date, role, and concurrent allocation tests. |
| Day 4 | Sprint 3: UI integration | Build SAPUI5 master-detail navigation, employee view, admin forms/actions, compliance alerts; exercise CAP-backed flows; fix integration and accessibility defects. |
| Day 5 | Sprint 3: verification and delivery | Run full automated and browser workflows, refresh persistence checks, conduct independent review and repair; finalize documents/evidence; validate CF deployment configuration and deploy only if authorized SAP target is available. |

## Delivery coordination notes

The UI integrates against the service contract agreed in Sprint 1 and implemented in Sprint 2. Frontend controls may hide unavailable actions, but CAP remains the authorization boundary. If SAP BAS, Build Code, or Cloud Foundry access is absent, complete all local work and mark only the corresponding environment gates BLOCKED with the observed condition and smallest resumption action.

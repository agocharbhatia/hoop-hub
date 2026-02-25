# Task: Dark Mode Neo-Brutalism Prompt and Plan

## Goal
- [x] Convert the previously light-mode Neo-brutalist prompt and frontend plan into a dark-mode version for the web app.

## Acceptance Criteria
- [x] Dark-mode prompt artifact exists and is reusable.
- [x] Frontend plan token strategy reflects dark-mode colors, borders, and shadows.
- [x] Deliverable includes implementation-ready guidance for stack-aware integration.

## Plan
- [x] Inspect existing frontend planning artifacts.
- [x] Define dark-mode design tokens and interaction constraints.
- [x] Produce a reusable prompt file for future generation tasks.
- [x] Update frontend planning document to dark mode.

## Results
- Added [NEO_BRUTALISM_DARK_PROMPT.md](/Users/agocharbhatia/Desktop/code/hoop-hub/agent/NEO_BRUTALISM_DARK_PROMPT.md).
- Updated [FRONTEND_UI_PLAN.md](/Users/agocharbhatia/Desktop/code/hoop-hub/agent/FRONTEND_UI_PLAN.md) to dark-mode token and contrast strategy.

---

# Task: First Slice (Architect Mode)

## Goal
- [x] Define and approve first implementation slice using [PLAN.md](/Users/agocharbhatia/Desktop/code/hoop-hub/agent/PLAN.md) and [FRONTEND_UI_PLAN.md](/Users/agocharbhatia/Desktop/code/hoop-hub/agent/FRONTEND_UI_PLAN.md), then build only the approved slice.

## Acceptance Criteria
- [x] One of two architecture options is selected.
- [x] Mini design doc fields are approved in writing.
- [x] Milestone-1 scope is locked before coding.
- [x] Implementation and verification are completed for that one slice only.

## Plan
- [x] Re-read current system and frontend plans.
- [x] Propose two first-slice options with tradeoffs.
- [x] Get user choice and finalize mini design doc.
- [x] Implement approved slice.
- [x] Run verification and summarize outcomes.

## Results
- Chosen slice: Option A (`UI Foundation Slice`).
- Scaffolded SvelteKit app at `/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web` using Bun + TypeScript.
- Added dark neo-brutalist global token system and base styling in `/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/app.css`.
- Added UI primitives:
  - `/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/components/ui/NeoButton.svelte`
  - `/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/components/ui/NeoCard.svelte`
  - `/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/components/ui/NeoInput.svelte`
  - `/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/components/ui/NeoBadge.svelte`
  - `/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/components/ui/NeoPanel.svelte`
- Added responsive shell scaffold in `/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/routes/+page.svelte`.
- Added health endpoint in `/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/routes/api/health/+server.ts`.

## Verification
- `bun run check` (apps/web): pass (`0 errors, 0 warnings`).

---

# Task: GitHub Repo Publish Prep

## Goal
- [x] Prepare repository for GitHub with clear onboarding and roadmap visibility.
- [x] Publish the repo to GitHub.

## Acceptance Criteria
- [x] Root README describes project purpose, current state, active work, and TODO roadmap.
- [x] Repo hygiene files are in place (`.gitignore`, `.env.example`, app README refresh).
- [x] GitHub remote exists and repo is published.

## Results
- Added root [`README.md`](/Users/agocharbhatia/Desktop/code/hoop-hub/README.md) with:
  - current implementation state
  - active workstream summary
  - slice-by-slice TODO checklist
  - local setup + verification commands
- Updated [`.gitignore`](/Users/agocharbhatia/Desktop/code/hoop-hub/.gitignore) with Node/Svelte/build/env ignores.
- Added [`.env.example`](/Users/agocharbhatia/Desktop/code/hoop-hub/.env.example) with baseline config placeholder.
- Replaced template app README with project-specific docs in [`apps/web/README.md`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/README.md).
- Created GitHub repository: https://github.com/agocharbhatia/hoop-hub

## Verification
- `bun run check` (apps/web): pass (`0 errors, 0 warnings`).
- `gh repo view agocharbhatia/hoop-hub`: repository is available.

---

# Task: Add GitHub Actions CI Workflow

## Goal
- [x] Add GitHub Actions automation for core app verification.

## Acceptance Criteria
- [x] Workflow runs on `push` to `main` and `pull_request`.
- [x] Workflow validates `apps/web` with install + check + test + build.
- [x] README documents CI workflow behavior.

## Results
- Added [ci.yml](/Users/agocharbhatia/Desktop/code/hoop-hub/.github/workflows/ci.yml):
  - `actions/checkout@v4`
  - `actions/setup-node@v4` using `.nvmrc`
  - `oven-sh/setup-bun@v2`
  - `bun ci`, `bun run check`, `bun run test`, `bun run build` in `apps/web`
- Updated [README.md](/Users/agocharbhatia/Desktop/code/hoop-hub/README.md) with CI section and commands.

## Verification
- Local parity check: `bun run check`, `bun run test`, `bun run build` in `apps/web`.

---

# Task: M1 QueryPlan + Planner Foundation

## Goal
- [x] Build Milestone 1 foundation for typed query planning with deterministic planner logic and validation.

## Acceptance Criteria
- [x] `QueryPlan` contract exists and is reusable.
- [x] Metric contract + registry foundation exists with alias resolution and intent checks.
- [x] Planner module exists with `normalizeQuestion`, `buildQueryPlan`, and `validateQueryPlan`.
- [x] Planner/metrics tests cover supported and unsupported cases plus validator guardrails.
- [x] Full web app verification runs cleanly (check, test, build).

## Plan
- [x] Add query-planning contracts and metric registry foundation.
- [x] Add metric resolver + intent compatibility validator.
- [x] Implement deterministic planner heuristics and invariants.
- [x] Add unit tests for metric resolution and planner behavior.
- [x] Run verification commands and capture outcomes.

## Results
- Added QueryPlan contract:
  - [`query-plan.ts`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/contracts/query-plan.ts)
- Added metric contract:
  - [`metrics.ts`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/contracts/metrics.ts)
- Added metric registry pack and registry accessors:
  - [`core-boxscore.ts`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/server/metrics/registry/core-boxscore.ts)
  - [`index.ts`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/server/metrics/registry/index.ts)
- Added metric resolution + validation logic:
  - [`resolve-metrics.ts`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/server/metrics/resolve-metrics.ts)
- Added planner module:
  - [`query-plan.ts`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/server/planner/query-plan.ts)
- Added/updated tests:
  - [`resolve-metrics.test.ts`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/server/metrics/resolve-metrics.test.ts)
  - [`query-plan.test.ts`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/server/planner/query-plan.test.ts)
- Expanded test command target in:
  - [`package.json`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/package.json)

## Verification
- `bun run check` (apps/web): pass (`0 errors, 0 warnings`).
- `bun run test` (apps/web): pass (`16 passed, 0 failed`).
- `bun run build` (apps/web): pass.
  - Note: existing environment warning persists (`Node 20.17.0`; Vite expects `20.19+` or `22.12+`).

---

# Task: Vertical MVP Query Flow (Mocked Engine)

## Goal
- [x] Implement end-to-end typed query flow in UI with mock backend contracts:
  - `POST /api/chat/query`
  - `GET /api/query-trace/:traceId`
  - UI states for loading, success, unsupported, error, and trace view.

## Decision Lock
- [x] Unsupported query policy: HTTP `200` with body `status: "unsupported"`.

## Results
- Added typed contracts:
  - [`chat.ts`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/contracts/chat.ts)
- Added deterministic mock query engine + in-memory trace store:
  - [`query-engine.ts`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/server/mock/query-engine.ts)
- Added API routes:
  - [`POST /api/chat/query`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/routes/api/chat/query/+server.ts)
  - [`GET /api/query-trace/[traceId]`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/routes/api/query-trace/[traceId]/+server.ts)
- Wired UI to live API flow:
  - submit/search, show-steps, unsupported and error handling
  - follow-up chips and recent question quick-fill
  - trace panel rendering
  - updated files:
    - [`+page.svelte`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/routes/+page.svelte)
    - [`NeoButton.svelte`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/components/ui/NeoButton.svelte)
    - [`app.css`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/app.css)
- Added unit tests:
  - [`query-engine.test.ts`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/server/mock/query-engine.test.ts)
- Added app test command in [`package.json`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/package.json).
- Added Node type support for test type-checking in [`tsconfig.json`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/tsconfig.json).

## Verification
- `bun run check` (apps/web): pass.
- `bun test src/lib/server/mock/query-engine.test.ts`: 5 passing tests.
- `bun run build` (apps/web): pass (Node version warning from Vite remains).
- Live API smoke:
  - `POST /api/chat/query` (supported query) => `status: "ok"` with citations and `traceId`.
  - `GET /api/query-trace/:traceId` => returns trace payload.
  - `POST /api/chat/query` (unsupported query) => HTTP `200` with `status: "unsupported"`.

---

# Task: Downloaded SVG + Ask/Search Spacing

## Goal
- [x] Use the recently downloaded SVG for the header mark.
- [x] Fix the large gap between `Ask` sticker and search card.

## Results
- Copied downloaded SVG to:
  - [`brand-net.svg`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/lib/assets/brand-net.svg)
- Updated header to use the copied asset:
  - [`+page.svelte`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/routes/+page.svelte)
- Tightened layout behavior to avoid sticker-to-card vertical spacing artifacts:
  - [`app.css`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/app.css)
  - `.neo-stack` now uses `grid-auto-rows: min-content`
  - refined brand mark sizing for the imported SVG

## Verification
- `bun run check` (apps/web): pass (`0 errors, 0 warnings`).

---

# Task: Sticker Gap + Brand Icon Revision

## Goal
- [x] Fix large vertical gap between `Ask` sticker and search card.
- [x] Replace header mark with a cleaner minimal hoop/net icon.

## Results
- Updated [`app.css`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/app.css):
  - `.neo-grid` now uses `align-items: start` to prevent column stretch artifacts.
  - `.neo-stack` now uses `align-content: start` to avoid row distribution gaps.
- Updated [`+page.svelte`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/routes/+page.svelte):
  - replaced brand SVG paths with a cleaner minimal hoop/net drawing.

## Verification
- `bun run check` (apps/web): pass (`0 errors, 0 warnings`).

---

# Task: Sticker Padding + Brand Mark Icon

## Goal
- [x] Fix sticker vertical sizing/stretch and replace `HH` badge text with a minimal basketball hoop/net icon.

## Results
- Updated [`app.css`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/app.css):
  - sticker now uses `align-self: start` (proper non-stretched height in grid)
  - removed prior negative-margin spacing hack
  - brand mark styled as fixed square icon container
  - added `.neo-brand__icon` stroke styling
- Updated [`+page.svelte`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/routes/+page.svelte):
  - replaced `HH` text mark with inline minimal hoop/net SVG icon

## Verification
- `bun run check` (apps/web): pass (`0 errors, 0 warnings`).

---

# Task: Ask Label Sizing

## Goal
- [x] Reduce unnecessary empty space in yellow "Ask" label panel.

## Results
- Updated [`app.css`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/app.css) so `.neo-sticker` no longer stretches across the grid column.
- Added:
  - `justify-self: start`
  - `width: fit-content`

## Verification
- `bun run check` (apps/web): pass (`0 errors, 0 warnings`).
- `bun run build` (apps/web): pass (with Node version warning from Vite).
- Dev smoke:
  - Started dev server on `127.0.0.1:4173`
  - `GET /api/health` returned JSON with `status: "ok"`.

---

# Task: Unified Run Script

## Goal
- [x] Add a single script in `scripts/` to run all services from one command and make it easy to extend for future backend/workers.

## Acceptance Criteria
- [x] One root command starts the current app stack.
- [x] Script is easy to extend with additional services.
- [x] Graceful shutdown on Ctrl+C/termination.

## Results
- Added [`run-all.sh`](/Users/agocharbhatia/Desktop/code/hoop-hub/scripts/run-all.sh) with:
  - service list (`name|dir|command`) for easy expansion
  - startup logging per service
  - signal trapping and cleanup
- Marked script executable.

## Verification
- `./scripts/run-all.sh` launches `apps/web` successfully.
- `GET http://127.0.0.1:4173/api/health` returns healthy JSON while script is running.
- Stopping the script terminates child service processes cleanly.

---

# Task: UI Content Cleanup

## Goal
- [x] Remove planning-only/demo-fluff content from the app page and keep UI copy product-relevant.

## Results
- Updated [`+page.svelte`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/routes/+page.svelte) to show only app-facing content:
  - query input and actions
  - recent questions
  - response preview
  - citations
  - follow-up prompts
- Added small layout utility classes in [`app.css`](/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web/src/app.css).

## Verification
- `bun run check` (apps/web): pass (`0 errors, 0 warnings`).

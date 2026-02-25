# Lessons

## User Workflow Preferences
- 2026-02-24: Keep a running log in each project (`tasks/todo.md`, `tasks/lessons.md`) so decisions and improvements are easy to revisit.
- 2026-02-24: Confirm current collaboration mode before blocking file edits; if mode changed back to Default, execute requested repo updates immediately.
- 2026-02-24: When style direction changes (light to dark), update both token definitions and interaction contrast rules together to avoid partial-theme drift.
- 2026-02-24: In `apps/web`, Vite 7 warns on Node `<20.19`; prefer Node `20.19+` or `22.12+` to keep build output clean and avoid future incompatibilities.
- 2026-02-24: Keep dev orchestration in one root script (`scripts/run-all.sh`) with a simple service registry format to reduce command sprawl as new services are added.
- 2026-02-24: Keep in-app UI copy focused on real product behavior; move milestone/debug/planning text to docs or task logs instead of rendering it in the app.
- 2026-02-24: Decorative label components in CSS grid should explicitly set content width (`justify-self: start`, `width: fit-content`) to avoid stretched empty panels.
- 2026-02-24: For grid-based sticker labels, use `align-self: start` instead of margin hacks to fix vertical stretching cleanly.
- 2026-02-24: In two-column CSS grid layouts, set `align-items: start` on the parent and `align-content: start` on child grid stacks to prevent unexpected vertical whitespace.
- 2026-02-24: When user provides downloaded visual assets, copy them into project-controlled assets and reference them through imports (avoid linking directly to external local paths).
- 2026-02-24: For unsupported NL queries in early slices, returning HTTP 200 with explicit `status: "unsupported"` keeps client-state handling simple while avoiding ambiguous transport-level failures.

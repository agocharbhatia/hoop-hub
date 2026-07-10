# Slice Testing Standards

Use this as the testing contract for every AFK slice. The `Test Plan` field in `.sandcastle/tasks.yaml` is the minimum bar, not a suggestion.

## Required workflow

1. Before broad implementation, turn the slice acceptance criteria into a concrete test matrix.
2. Write or update the highest-risk failing test first.
3. Keep expanding coverage until every user-facing acceptance claim has a proving test at the right boundary.
4. Run the task-specific targeted tests first, then the repo verify commands.

## Concrete test matrix

For each slice, explicitly decide which of these boundaries changed:

- structured contract validation
- semantic execution
- nightly/bootstrap materialization
- dynamic-agent tool selection and argument validation
- `/api/query` route orchestration
- answer rendering
- query trace/provenance
- deterministic agent eval and optional live canary

If a boundary changed, there must be at least one behavior-first test for it.

## Query-facing slices

If the slice changes any of these surfaces, query-based tests are mandatory:

- supported query families
- agent prompt/tool schemas or structured capabilities
- `/api/query`
- answer rendering for query results
- trace output for query execution
- date grounding or relative-time behavior

For those slices, do both:

- deterministic fixture-backed tests at module and route boundaries
- data-defined dynamic-agent eval cases using the exact user phrasings the slice is meant to support

For query-facing slices, the spec should include both:

- `query_acceptance_examples`: exact natural-language questions the slice claims to support
- `answer_quality_expectations`: what good answers should sound like and what they must avoid

The answer-quality expectations should cover at least:

- natural phrasing instead of schema-dump wording
- supported-part answers for mixed supported/unsupported questions
- honest handling of partial, stale, or unsupported data
- no raw internal values when natural phrasing is expected, for example `W 3`

## What does not count as sufficient

- isolated model-adapter tests with mocked outputs
- `/api/query` route tests with injected fake planner decisions
- module tests that never start from a real user question

Those tests are still useful, but they do not prove that the real planner can turn supported user questions into correct grounded requests.

## Dynamic-agent eval policy

- Use fixture-backed endpoint data and keep deterministic eval free of OpenAI and NBA network calls.
- Add prompt variants and invariant assertions to the shared eval corpus; use focused tags/cases during development.
- Prefer explicit questions that are stable against the fixture clock unless the slice is specifically about relative-time semantics.
- When the slice changes `/api/query` behavior, update `apps/web/src/lib/server/eval/cases.ts` or the relevant domain eval with the exact questions being shipped.
- For answer-layer changes, include at least one assertion about answer quality, not just resolved query shape or status. Examples: avoids robotic fallback phrasing, answers supported sub-parts, avoids raw encoded values, mentions limitations naturally.

## Completion rule

Do not finish a slice just because `bun run test` is green. A slice is only complete when:

- the concrete test matrix is covered
- the changed query shapes are exercised through exact NL prompt variants when applicable
- the shipped answer examples are exercised for both factual grounding and answer quality when applicable
- the repo verify commands are green
- any new regression found during manual or smoke validation is captured by a permanent automated test
- the applicable commands in `.docs/RELEASE_CHECKLIST.md` are green

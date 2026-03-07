# Frontend UI Plan (Neo-Brutalist Dark Mode)

## 1) Goal

Integrate a dark-mode Neo-brutalist design system into the Hoop Hub frontend in a way that is visually consistent, reusable, and maintainable for a Bun + SvelteKit stack.

Primary outcomes:
- Consistent design tokens and styling primitives.
- Reusable UI components for the chat-first product flow.
- Responsive and accessible implementation across devices.
- Low duplication and clear naming conventions.

## 2) Current System Snapshot

Based on the existing project planning doc at [PLAN.md](/Users/agocharbhatia/Desktop/code/hoop-hub/agent/PLAN.md):
- Runtime/UI direction is Bun + SvelteKit.
- Product UI centers on chat with optional artifacts:
- answer panel
- visualization panel
- clip playlist panel (Phase 2)
- show-steps trace popup

Observed repo state now:
- No existing app code or design-token implementation yet.
- No existing component library yet.

Conclusion:
- This is a greenfield UI implementation with architecture constraints already defined by the product plan.

## 3) Design System Integration Strategy

### 3.1 Token Source of Truth

Create one canonical token layer as CSS custom properties and keep component styles token-driven.

Planned token groups:
- Color tokens:
- `--neo-bg: #121212`
- `--neo-surface: #1A1A1A`
- `--neo-fg: #F8F7F2`
- `--neo-accent: #FF6B6B`
- `--neo-secondary: #FFD93D`
- `--neo-muted: #BFA8FF`
- `--neo-ink-dark: #000000`
- `--neo-white: #FFFFFF`
- Border tokens:
- `--neo-border-width: 4px`
- `--neo-border-color: #F8F7F2`
- Shadow tokens:
- `--neo-shadow-sm: 4px 4px 0 0 #F8F7F2`
- `--neo-shadow-md: 8px 8px 0 0 #F8F7F2`
- `--neo-shadow-lg: 12px 12px 0 0 #F8F7F2`
- `--neo-shadow-xl: 16px 16px 0 0 #F8F7F2`
- Typography tokens:
- Font family: `Space Grotesk`
- Weights: 700 and 900 defaults
- Radius tokens:
- `--neo-radius-none: 0`
- `--neo-radius-pill: 9999px`
- Motion tokens:
- fast transition durations (100ms, 200ms, 300ms)
- easing rules (`linear`, `ease-out`)

### 3.2 Global Styling Rules

Enforce these globally:
- Light-ink borders and text by default on dark canvas.
- Sharp corners (`0px`) except intentional pill/circle elements.
- Hard offset shadows with zero blur.
- High-contrast palette with no washed-out gray drift.
- Pattern-capable backgrounds (halftone/grid/noise) as reusable utilities.

## 4) Component Architecture

Use reusable primitives first, then feature components.

Primitives:
- `NeoButton`
- `NeoInput`
- `NeoCard`
- `NeoBadge`
- `NeoPanel`
- `NeoIconBox`

Layout primitives:
- `PageShell`
- `SectionBlock`
- `Stack`
- `SplitPane` (60/40 and 70/30 variants)
- `StickerLabel`

Feature components:
- `ChatComposer`
- `AnswerPanel`
- `CitationList`
- `VisualizationPanel`
- `ShowStepsModal`
- `ClipPlaylistPanel` (Phase 2)

## 5) UX Composition for the Product

### 5.1 Page-Level Structure

Initial app shell:
- Top utility/header band with logo and session context.
- Main two-column workspace on desktop:
- Left: chat history + input
- Right: dynamic artifacts (table/chart/trace)
- Mobile:
- stacked layout with section toggles/tabs

### 5.2 Neo-Brutalist Signatures

Apply intentionally:
- Rotated sticker labels for section tags.
- Hard-shadow cards for result modules.
- Mechanical button press states.
- Controlled asymmetry in hero/intro and panel headings.
- Pattern overlays in large dark background areas to avoid flat visuals.

## 6) Accessibility and Responsiveness

Accessibility requirements:
- Semantic structure for landmark regions.
- Keyboard access for all controls and modal interactions.
- Visible focus states with high contrast.
- Motion reduction support via `prefers-reduced-motion`.
- Maintain WCAG AA contrast targets.

Responsive behavior:
- Mobile-first layout.
- Grid shifts from single column to split pane at tablet/desktop breakpoints.
- Shadow, spacing, and typography scale rules tuned per breakpoint.

## 7) Thin-Slice Milestones

Milestone 1: Token and base style foundation
- Implement token file, global typography, and pattern utilities.
- Add base mechanical interactions and reduced-motion fallbacks.
- Verify style consistency with a simple token playground page.

Milestone 2: Primitive component library
- Build and test buttons, cards, inputs, badges, and panels.
- Add Story-like local demo routes for each primitive state.
- Verify keyboard and focus behavior for all primitives.

Milestone 3: Chat workspace shell
- Build chat layout, composer, and answer panel using primitives.
- Add citation block and error/unsupported states.
- Verify responsive behavior on mobile and desktop breakpoints.

Milestone 4: Show-steps modal + artifact panel
- Implement trace modal and artifact panel shells.
- Add table/chart container states and fallback UX.
- Verify keyboard trap, scroll behavior, and close affordances.

Milestone 5: Visual polish and performance pass
- Add neo-brutalist signature details (rotations, stickers, texture zones) with restraint.
- Remove one-off styles and consolidate to tokens/utilities.
- Verify Lighthouse-style perf budget and interaction responsiveness.

Milestone 6: Phase 2 clip playlist panel
- Add clip list UI and interactions using existing primitives.
- Verify accessibility, touch target sizes, and loading/error states.

## 8) Verification Gates

Per milestone:
- Lint and type checks pass.
- Responsive checks across mobile, tablet, desktop.
- Keyboard-only navigation pass.
- Contrast checks for all new color combinations.
- No duplicate one-off token values introduced in component styles.

## 9) Risks and Mitigations

Risk: Style drift across components.
- Mitigation: ban raw color/spacing literals outside token files.

Risk: Neo-brutalism becomes noisy and harms readability.
- Mitigation: keep body copy clear, confine maximal effects to hierarchy accents.

Risk: Hard shadows and heavy borders hurt small-screen clarity.
- Mitigation: downscale shadow offsets on small viewports while preserving style.

Risk: Motion-heavy interactions impact accessibility.
- Mitigation: strict reduced-motion fallback and short mechanical transitions.

Risk: Dark surfaces reduce text contrast for secondary labels.
- Mitigation: use explicit semantic text tokens (`primary`, `secondary`, `muted`) with contrast checks.

## 10) Decision Needed Before Build

Choose the styling foundation:
1. Tailwind + CSS variables (recommended): fastest token propagation and utility composition.
2. CSS Modules + CSS variables: more explicit local scoping, slightly slower iteration.

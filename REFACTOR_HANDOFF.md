# Refactor Handoff Report

Generated: 2026-09-06. Documents the state of the refactor against `REFACTOR_PLAN.md`.
Phases 1–3 were completed by an earlier pass; Phases 4–6 were completed in this
one, along with corrections to two things the earlier pass recorded as done.

## Environment and verification

- **Local Node:** v26.8.1. `package.json` declares `engines.node >= 22.13.0`; CI
  runs Node 22.
- **Everything below was executed, not assumed:**

| Check | Result |
| --- | --- |
| `npm run build:lib` | passes |
| `npm run models:validate` | passes (24 models, 27 plans, 7 scenarios) |
| `npx tsc --noEmit` | passes |
| `npm run lint` | passes |
| `npm test` (lib build + Vinext build + 6 test files) | **158 tests, 0 failures** |
| `npm run build` (Vinext) | passes |
| `npm run build:pages` (Next static export) | passes; exports `/`, `/recommend/`, `/tier-list/`, `/404` |
| CI artifact allowlist, run locally against `out/` | passes |
| Browser journeys (headless Chrome against the real export) | see **Browser verification** |

The earlier report could not run `npm test` or `npm run build:pages` in its
sandbox. Both run here, and the webpack `extensionAlias` added in Phase 3.7 does
resolve the `lib/` `.js` imports in a full Next build.

## Phase 4 — Routes and feature boundaries

**Three routes, each owning its own state.** `app/page.tsx` (Rankings),
`app/recommend/page.tsx`, `app/tier-list/page.tsx`. Each route file only sets
metadata and mounts a feature; nothing computes a ranking in `app/`.
`next.config.ts` sets `trailingSlash: true`, so each route exports as its own
directory index and any static host serves a deep link without a rewrite rule.

**The 2,429-line `app/page.tsx` is gone.** It became:

| Module | Holds |
| --- | --- |
| `components/` | `site-header`, `site-footer`, `icon`, `modal`, `item-details`, `compare-dialog`, `catalog-inspector` |
| `features/rankings/` | `rankings-view`, `tier-board`, `price-book`, `methodology`, `columns` |
| `features/recommend/` | `recommend-view`, `best-path`, `comparison`, `workload-form`, `state` |
| `features/tier-list/` | `tier-list-view`, `storage` |
| `lib/domain/decision.ts` | The derivation the Recommend view renders: preferred path, frontier, captions, the settled announcement |
| `lib/domain/workload.ts` | The workload contract: limits, clamping, preset comparison |
| `lib/domain/url-state.ts` | Link parsing and serialisation (pure) |
| `lib/boards/` | Board payload codec and editor operations (pure) |
| `lib/browser/` | `storage`, `url`, `theme` — the only modules that touch `window` |

`lib/` stays free of React, the DOM, and the filesystem; a test asserts this
rather than trusting it.

**Legacy links keep working.** `/?view=recommendation`, `/?view=rank` and
`/?view=explore` are recognised at the root, which hands the complete query to
the route that owns it. Verified in a browser: `/?view=recommendation&calls=4242&budget=777`
lands on `/recommend/` with 4,242 calls and a $777 budget in the form, and
`/?view=rank&board=…` lands on `/tier-list/` showing the shared board as a
preview.

**Preferences are versioned and feature-scoped.** `tokentier.v1.workload`,
`tokentier.v1.columns`, `tokentier.v1.boards`, `tokentier.v1.board-recovery`.
The pre-refactor flat `tokentier-*` keys are migrated once and **left in place**,
so rolling back to the previous build still finds them. Theme and table columns
are kept apart from the workload numbers and from anything the reader authored.

**The migration does not invent a capability gate.** The old build saved the
recommendation numbers but never saved the work type, and the work type is what
sets the bar. The migrated record therefore carries no scenario: the page keeps
the saved numbers, shows "Choose a work type…", and explains why. Verified in a
browser with seeded legacy keys.

**Precedence is URL, then storage, then defaults**, and everything is parsed
before anything is written back, so opening a link never overwrites the
preferences it was about to replace. Editing replaces the history entry;
navigation between routes creates one.

**Presentation changes required by §6.2–6.4:**

- Rankings' first viewport now answers its own question: the profile dock shows
  the cheapest qualifying model and plan with monthly cost, above the board.
- Rankings' plan lane got its own "Not on the board" list, with the reason. No
  lane silently hides an item any more.
- The source list is generated from the catalog being displayed, so a link
  cannot outlive the row it documents.
- Recommend leads with the four questions that decide the answer (work type,
  access, volume, budget) and puts token sizes and cache share one disclosure
  away, open by default.
- Recommend separates **qualifying** plans from **conditional or unmeasurable**
  ones, and states what to relax when nothing qualifies.
- The frontier deduplicates: an objective that lands on the same model as
  another says so instead of repeating the card.
- The result panel no longer carries `aria-live`. A single settled sentence is
  announced ~700 ms after edits stop, so a screen reader is not flooded per
  keystroke.
- Copying a link reports failure visibly and always offers a selectable URL.

## Phase 5 — Personal boards

- **Versioned payload (v2).** Records ordered tiers *and* ordered card ids per
  tier. v1 payloads (`t`/`p`) are read and migrated by ordering each tier by the
  catalog's own order — deterministic, so the same old link always produces the
  same board. Original storage is preserved.
- **The editor cannot create data its decoder rejects.** Title (60), note (140),
  tier name (40), tier count (1–12) and single-tier membership are enforced in
  `lib/boards/actions.ts` and re-checked by the codec; a test drives the editor
  past every limit and round-trips the result.
- **Ordering without dragging.** Every card has a destination menu and up/down
  controls, and every tier has up/down/remove — WCAG 2.2's dragging-movements
  requirement, kept rather than replaced by drag-only controls.
- **Retired cards are visible.** Ids the catalog no longer contains render as
  dashed retired cards with an explicit "Remove retired cards" action, instead
  of disappearing. Verified in a browser against a seeded legacy board.
- **A share opens a preview.** Nothing saved is touched until "Use this board",
  and the board it replaces is kept as a one-step recovery snapshot that
  survives a reload. Reset does the same.
- **Fragment share links.** New links put the payload in `#board=…`, which
  browsers do not send to the server. This is not privacy — a shared board is
  shared — it only keeps the payload out of request logs. Legacy query-string
  links still import. Over the 12,000-character limit the page refuses to
  produce a link and offers a JSON export instead.
- **Honest save state.** "Saved in this browser" appears only after a write
  actually returned success; when storage is denied, editing continues in memory
  and export is offered.
- **Pool filtering** by search and provider, which never changes ranked cards.
- Board title and optional use-case note, both bounded and persisted.

## Phase 6 — Production verification and cleanup

- **CI now runs the checks.** `npm run lint`, `npx tsc --noEmit` and `npm test`
  run before the export in `.github/workflows/deploy.yml`.
- **Artifact allowlist updated** for the new routes: the workflow asserts
  `out/recommend/index.html` and `out/tier-list/index.html` exist, and permits
  the `recommend`, `tier-list` and `404` directories. It still rejects maps,
  logs, `.env*` and `.pem` files.
- **Canonical and sitemap URLs reflect real routes.** Each route sets its own
  relative canonical, which resolves under the `/TokenTier/` base path;
  `public/sitemap.xml` lists all three.
- **Dead CSS removed.** 20 rule groups for classes no components reference any
  more (`plans-section`, `plan-grid`, `cost-bar-*`, `budget-fallback-banner`,
  `info-tooltip`, `sort-field`, `tab-shortcut-kbd`, …). `app/globals.css` went
  from 4,858 to 4,655 lines including the new feature styles. A script check
  confirms the only remaining unreferenced class names are ones composed at
  runtime (`evidence-*`, `tier-*`).
- **README rewritten** for the routes, the code layout, the cost-ratio tier rule,
  the hard-constraint recommendation rules, and the personal-board guarantees.
- **Fixed a type-check hazard between the two build targets.** `next build` and
  the Vinext build both generate into `.next/types/`, with incompatible route
  type files, so whichever ran last left the other's stale — and `tsc --noEmit`
  then failed on generated code. `.next` is now excluded from the type check
  (`next build` runs its own), so lint, type-check, test and either build now
  pass in any order. Verified by running `tsc --noEmit` after each build.
  The related churn in `next-env.d.ts` is left alone: `next build` rewrites it
  without the `vinext/types/augmentations` import and a Vinext build leaves the
  committed form in place. Type-checking passes either way, so it is noise to
  discard rather than a change to commit.

## Corrections to earlier phases

Two things the previous report recorded as fixed were only nominally done.

1. **Plan access surfaces were assigned in bulk.** Every one of the 26
   subscriptions carried `access: ["chat-app"]`, including Cursor (an editor
   pool), OpenCode Go (`apiIncluded: "Yes"`) and the GLM Coding plans
   (`apiIncluded: "Coding endpoint"`). With the access requirement now a real
   input, selecting "coding client" returned nothing at all. Each plan is now
   classified from its own recorded evidence:
   - `coding-client` only: Cursor Pro / Pro Plus / Ultra (editor pool, not a chat product).
   - `coding-client` + `api`: OpenCode Go, GLM Coding Lite / Pro / Max.
   - `chat-app` + `coding-client`: Claude Pro / Max (Agent SDK usage bills against
     plan credits), Google AI Pro / Ultra (Antigravity), all four Kimi memberships
     (published Kimi Code credits).
   - `chat-app` only: ChatGPT, Google AI Plus, SuperGrok.
   - `api` only: OpenCode Zen.
   A test now asserts every surface has at least one plan and that the
   distinctive classifications hold.

2. **`tests/rendered-html.test.mjs` proved business behaviour with source
   regexes** against `app/page.tsx` and `app/rank-board.tsx` — roughly 90
   assertions that would have had to be deleted when those files moved. Per
   §8 of the plan they were rewritten as behaviour tests rather than dropped:
   the suite now renders all three routes and asserts on output, and the
   remaining source checks are ones where source structure *is* the contract
   (the local-only Sites plugin, the licence, stylesheet tokens, the engine's
   freedom from React/DOM/fs). The same was done for the `page.tsx` assertions
   in `tests/regression-fixes.test.mjs` and `tests/acceptance-regression.test.mjs`.

## Test evidence

| File | Covers |
| --- | --- |
| `tests/rendered-html.test.mjs` | All three routes rendered; per-route metadata; catalog as data; engine purity; ownership/licence/delivery; layout, density and touch targets; ink-on-fill and AA contrast |
| `tests/boards.test.mjs` *(new)* | Payload round trip, v1 migration determinism, malformed/empty/oversized/future payloads, tier ceiling, duplicate ids, placement and nudging, retired cards, pristine detection |
| `tests/workload-url.test.mjs` *(new)* | Number clamping and fallbacks, zero values, nonfinite and oversized input, complete link round trip, URL-over-storage precedence, legacy view mapping, route shape |
| `tests/decision.test.mjs` *(new)* | Cheapest-within-budget default, explicit no-match, budget-free capability objective, frontier deduplication, one evaluation per objective, plan hard constraints, access filtering, preset/custom agreement, caption honesty, announcement length |
| `tests/engine-parity.test.mjs` | Placement snapshots for all 7 scenarios; CLI/UI eligibility agreement |
| `tests/regression-fixes.test.mjs` | Findings F1–F7 |
| `tests/acceptance-regression.test.mjs` | Acceptance criteria AC1–AC7 |
| `tests/model-updater.test.mjs` | Catalog updater locking, atomicity, dry run, schema |

**158 tests, 0 failures.**

## Browser verification

Run against the real `npm run build:pages` export served over HTTP, in headless
Chrome. These exercise client hydration, not just server render.

| Journey | Result |
| --- | --- |
| Rankings at 1440px | Preset dock, cheapest-qualified leaders, gate banner, tier board, price book all render |
| Recommend at 1440px | Verdict above settings, best-path cards, frontier with over-budget marking |
| Tier list at 1440px | Board, tier controls, unranked pool with search and provider filter |
| Narrow layout (500px) | Header, dock, board and pool all reflow; no horizontal overflow |
| `?view=recommendation&calls=4242&budget=777` | Redirects to `/recommend/` with both values in the form |
| `?view=rank&board=…` (legacy query) | Redirects to `/tier-list/` and opens the board as a preview |
| `#board=…&subject=models` (new fragment) | Opens as a preview with title and note intact, "Use this board" offered |
| Seeded legacy `tokentier-rec-*` keys | Numbers preserved; work type asks to be re-chosen rather than assumed |
| Seeded legacy `tokentier-rank-boards` | Migrated to the right tiers in the right order; retired card shown; "Saved in this browser" only after a successful write |

## Known limitations and deferrals

- **Viewports below 500px were not visually verified.** Chrome on macOS clamps a
  headless window to roughly 500px wide, and no device-emulation tooling
  (Playwright/Puppeteer) is installed. The 360px/420px/560px breakpoints are
  unchanged from the verified baseline; the styles added in this pass fall back
  to a single column at ≤640px and were reviewed at 500px.
- **Dark mode was not visually verified** for the same reason — the headless
  runs report `prefers-color-scheme: light`. The theme mechanism is unchanged,
  and the token contrast tests still run.
- **`app/globals.css` was not split into feature stylesheets** (§6.6). The file's
  rule order interleaves shared primitives (`.button`, `.section`, `.book-switch`),
  feature rules, and roughly thirty later breakpoint and patch blocks that each
  mix several features. Splitting by feature therefore cannot be done without
  reordering the cascade, and reordering cannot be verified without visual
  regression tooling that is not available here. What was done instead: all dead
  rules removed, and the styles added in this pass grouped into commented,
  clearly-labelled feature sections. This is the one plan item deliberately left
  undone, and the reason is cascade risk, not scope.
- **Vinext classifies `/recommend` and `/tier-list` as "Unknown"** in its build
  summary and prerenders only `/`. This is a documented limitation of its static
  analysis, not a failure: the same routes prerender fine under `next build`,
  which is what GitHub Pages publishes, and all three render correctly through
  the Vinext worker in the test suite.

## Tier policy: curved, not banded

The board assigns S/A/B/C/D by curving the qualifying population — ordered by
cost, cut at `scenarios.tierCuts` (even quintiles). This replaced fixed
cost-ratio bands (1.25x / 2x / 4x against the cheapest).

The bands were the more principled rule in one respect: a letter meant the same
multiple of the cheapest price in every scenario and at any catalog size. But
they assumed a reasonably smooth price distribution, and this catalog does not
have one. GLM-5.3-Flash is roughly eight times cheaper than the next qualifying
model, which pushed everything else past the last band: medium coding rendered a
populated S, an empty A and B, and thirteen models in C.

What the curve gives up: a letter is a rank, so adding or removing an option can
move an unchanged one by a letter. What it keeps: equal costs still share a
letter, ordering is still deterministic by cost then id, and the curve is taken
over the whole qualifying population, so filtering the table never moves a
letter. `scenarios.costRatioBands` was removed rather than left as a dead knob,
and `tierAtRank` — a second, unused tiering implementation — was deleted.
`costTiers` in `recommend.ts` now delegates to the same `curveTiers`, so there is
one definition of a tier letter rather than two.

The board also prints only the letters it can fill: with fewer distinct prices
than letters, it uses them from S downward instead of leaving a gap.

## Catalog uncertainties still unresolved

The Intelligence Index v4.2 rebase and the GPT-6 Astra addition are recorded in
the README's "Catalog changes, September 6 2026" section. One open item from
that pass:

- **GPT-6 Astra above 272K input tokens.** Several third-party write-ups report
  that the whole request bills at 2× input and 1.5× output past that threshold.
  The claim is not in OpenAI's published model documentation and
  `openai.com/api/pricing` returns 403 to an unauthenticated fetch, so the
  catalog records the flat published rates with no rate band. Very large prompts
  are under-priced until an official page confirms the surcharge.

Carried over from the earlier pass, and still worth a second source check:

- `grok-4-5`: the note says rates are verified only below 200K input, so
  `unsupportedBeyond: 200000` (at or above 200K is unpriced).
- `gemini-3-1-pro`: the note says "up to 200K" inclusive, so
  `unsupportedBeyond: 200001`.
- `claude-max-5x` / `claude-max-20x`: `quotaDetail.kind` is `relative-limit`.
  `includedApiValue` is a legacy field and is not used as a fallback, so these
  stay unknown capacity rather than being promoted to verified credits.
- `opencode-go`: a monthly dollar allowance whose 5-hour ($12) and weekly ($30)
  caps bind before the monthly ceiling, recorded in `conditionalLimits`.
- GLM coding plans: weekly credit allowance with 5-hour caps in
  `conditionalLimits`.
- The new `access` classifications are derived from each plan's own recorded
  `apiIncluded` value, note and published quota. They are consistent with the
  evidence already in the catalog, but they were not re-checked against the
  providers' live pages in this pass.

## Storage and link compatibility

| Old | New | Behaviour |
| --- | --- | --- |
| `?view=explore\|recommendation\|rank` | `/`, `/recommend/`, `/tier-list/` | Recognised at the root and forwarded with the whole query |
| `?board=…&subject=…` | `#board=…&subject=…` | Legacy query still imports; new links use the fragment |
| `tokentier-rec-*` | `tokentier.v1.workload` | Migrated once; numbers kept, work type re-asked; old keys left in place |
| `tokentier-api-cols` / `-plan-cols` | `tokentier.v1.columns` | Migrated once; old keys left in place |
| `tokentier-rank-boards` / `-subject` | `tokentier.v1.boards` | Migrated once through the v1 codec path; old keys left in place |
| `tokentier-theme` | unchanged | Still read by the inline layout script before paint |

## Stop condition

Against §9 of the plan: one documented engine (`lib/domain/`) produces
cost-first, constraint-aware results for both Rankings and Recommend, and a
test asserts the two agree on the same workload; personal boards preserve,
recover and share the reader's choices with a versioned payload; feature
boundaries are readable without tracing a monolithic component; and the actual
production artifact plus the core browser journeys are verified above. The one
intentional deferral — the `globals.css` feature split — is stated with its
reason rather than quietly skipped.

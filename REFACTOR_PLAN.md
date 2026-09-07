# TokenTier review and implementation plan

Reviewed: 2026-09-06. Scope: frontend, calculation/domain logic, catalog maintenance, persistence, tests, and deployment configuration. This is an implementation handoff, not an implementation patch.

## 1. Recommended direction

Make TokenTier answer three questions clearly:

1. **Rankings:** What costs least for a particular use case while meeting its requirements?
2. **Recommend:** What should I use for my own workload, budget, and access needs?
3. **My tier list:** How would I personally rank these models or plans?

Keep those experiences connected, but keep personal opinion separate from calculated recommendations. Build one shared, deterministic decision engine behind Rankings and Recommend. Treat rankings as recommendations evaluated against preset workloads, rather than a second scoring system.

The highest-priority work is calculation correctness and evidence handling. Splitting the large component helps, but splitting it without correcting the decision rules would merely distribute the inconsistencies across more files.

### Assumptions and scope decisions

- Interpret “best cost” as **lowest estimated cost among options that meet the workload's requirements**, not maximum capability within the user's entire budget. Keep “Best within budget” and “Highest benchmark score” as explicit secondary objectives.
- Capability thresholds are editorial screening heuristics supported by published benchmarks, not proof that a model will perform a user's task successfully. Use that language throughout.
- Default to the current USD text-token workload model. Do not invent prices, capability measurements, plan entitlements, or success rates.
- Keep the current static-first deployment and JSON catalog. The three requested experiences do not require accounts, a database, a paid LLM recommendation service, or a new backend API.
- Personal boards remain device-local with explicit portable sharing. Cross-device accounts, public galleries, collaboration, and hosted short links are separate future features.
- Preserve existing useful interactions: API/plan lanes, source links, comparison, scenario presets, theme settings, keyboard/touch move menus, saved boards, and legacy share links.
- Do not change framework versions or switch hosting providers as part of this refactor. Make the existing production build the primary validation target while retaining the local Sites/Vinext path.
- Implement a single custom workload first. A mixed workload optimizer, model router, or automatic retry/success model is outside this pass.

## 2. What exists today

| Area | Current implementation | Assessment |
| --- | --- | --- |
| Application | `app/page.tsx`, 2,894 lines, client component | Types, catalog joins, pricing, ranking, recommendations, preferences, navigation, dialogs, tables, and three views are coupled. |
| Personal boards | `app/rank-board.tsx`, 365 lines | Already supports models/plans, editable tiers, drag/drop, move menus, local saves, query-string sharing. Improve this feature rather than rebuild it. |
| Styling | `app/globals.css`, 4,542 lines | Theme tokens and responsive rules exist; successive component and breakpoint additions make ownership hard to follow. |
| Catalog | `data/api-models.json`, `data/plans.json`, `data/scenarios.json` | 23 models, 27 plan/access entries, seven scenarios; 21 models carry capability scores. Sources, dates, anchors, and index versions are useful foundations. |
| Data maintenance | `scripts/update-models.mjs`, 845 lines | Strong validation, referential checks, dry runs, write locking, and atomic model-file replacement. Preserve these safeguards. |
| Runtime backend | `worker/index.ts` | Vinext page handler and image-optimization endpoint. No application-specific recommendation API, authentication, or board database. |
| Published target | `.github/workflows/deploy.yml`, `next.config.ts` | GitHub Pages static export; repository base path is supported. |
| Local alternative | `vite.config.ts`, ignored `.openai/hosting.json`, local Sites plugin | Separate Vinext/Cloudflare build and optional Sites packaging. Do not delete local configuration as cleanup. |
| Tests | Two test files; 30 tests | Good catalog/updater coverage and server-render checks, but substantial source-string/CSS assertions constrain implementation rather than verify behavior. |

### Review evidence and limits

Completed against this checkout:

- `npm run models:validate`: passed.
- `node --test tests/model-updater.test.mjs`: 26 passed.
- `npm run lint`: passed.
- `npx tsc --noEmit --incremental false`: passed.
- `npm test`: build and all 30 tests passed after allowing local loopback access for prerendering. The initial sandboxed attempt failed with `listen EPERM 127.0.0.1`; that was an environment restriction, not an application regression.
- `npm run build:pages`: attempted, but failed because `next/font` could not resolve `fonts.googleapis.com` to fetch Geist/Geist Mono (`ENOTFOUND`). The production export is therefore not verified in this review; retry in an environment with that access. If offline/reproducible builds become a requirement, consider locally bundled licensed fonts as a separate small change.
- Executed the existing calculation functions, transpiled in memory without editing source, to reproduce the long-context pricing and plan-tier inconsistencies below.

The local runtime is Node 26.8.1; CI declares Node 22. Repeat release checks on CI's Node version. Source review and server rendering do not establish browser interaction or visual correctness. No browser walkthrough, mobile screenshot audit, live deployment verification, or full provider-price/benchmark re-verification was performed. Treat catalog facts below as the repository's recorded claims, not newly verified provider facts.

## 3. Findings, ordered by impact

Source line numbers refer to the reviewed checkout; locate named functions after edits.

### P0 — Correct estimates and trustworthy recommendations

**F1. Long-context prices are described but not calculated.** `callCost` in `app/page.tsx:266` always uses one rate tuple. Some records in `data/api-models.json` describe threshold prices only in `note`. For `grok-4-6`, the recorded note says input of at least 200K costs $4 input/$1 cache/$12 output per million. The current function returns **$0.406** for 200,000 uncached input + 1,000 output, versus **$0.812** under the record's stated threshold rates. Custom inputs allow workloads that cross these thresholds. Store rate bands structurally, validate boundaries, and either compute the applicable price or report unsupported/unknown pricing; a footnote cannot repair an incorrect headline estimate.

**F2. A top plan tier does not mean the plan covers the preset.** `planPlacements` at `app/page.tsx:504` weights subscription price, capability headroom, and confidence; it does not use scenario call volume or quota coverage. Reproduced: `opencode-go` is **S tier** for `code-hard`, while its selected model and allowance yield **454.96 calls** for a **1,500-call** preset. Do not describe such a plan as best value for completing that workload. Separate sufficient, insufficient, and unknown coverage before ranking.

**F3. Monthly allowance arithmetic ignores rolling limits.** `planEstimate` at `app/page.tsx:298` uses included monthly dollar value or `weeklyCredits * 4.33`, then doubles credit capacity for a presumed off-peak case. The catalog also describes five-hour and weekly caps. A monthly total cannot guarantee that a burst workload fits. Record periods and conditional discounts explicitly, and mark short-window coverage unknown when the user has supplied only a monthly total.

**F4. Economic equivalence and usable capacity share one shape.** `planEstimate` returns the same calls/value structure for credits and price break-even. `planCoverageScore` treats the presence of `includedApiValue` as enough to infer coverage. Some records combine relative-limit descriptions, optional API access, and an included-value number; for example the Claude Max entries. This is a provenance/semantic ambiguity requiring source review, not evidence that the real provider grants those credits. Use distinct result types for verified allowance, break-even comparison, and unknown capacity. Validate that allowance values have applicable entitlement evidence.

**F5. There is no single definition of “best.”** Model tiers use a standardized cost/headroom blend; plan tiers use price/headroom/confidence; recommendations use capability/budget/coverage/confidence; `preferredPath` at `app/page.tsx:1326` then applies 0.65/1.25 price-ratio heuristics. The default API priority is `budget`. This does not implement a straightforward cheapest-qualified objective. Replace the decision chain with explicit filtering and ordering; explain secondary objectives separately.

**F6. Infeasible cases still manufacture candidates.** `apiFrontier` at `app/page.tsx:1206` substitutes a highest-scored fallback if nothing qualifies, and `rankedPlanOptions` falls back to all subscriptions. Warnings exist, but the rest of the UI still has “BEST PATH”/“BEST PLAN” structures and downstream logic does not consistently require `meetsBar`. Return an explicit no-match result. Show nearest alternatives separately, with their failed requirements, never as a qualified winner.

**F7. API access is not a hard eligibility condition.** `apiIncluded` is free text. The API/plan preference is a soft routing heuristic, not a requirement for production API access or a specific application surface. Model availability in a subscription does not establish production API access, identical context/output limits, or the same benchmark configuration. Add structured access requirements and evidenced plan/model restrictions.

### P1 — Consistency, maintainability, and user-owned state

**F8. Plan model selection optimizes the wrong meter for some plans.** `planWorkingModel` at `app/page.tsx:477` selects by direct API price even for credit-metered plans. API dollar prices and plan credit multipliers can have different orderings. Select eligible models using the plan's actual charging rule. Add a synthetic reversal case; do not assume the current catalog happens to expose it.

**F9. Validation and UI eligibility differ.** `eligibleModels` at `scripts/update-models.mjs:306` checks only the capability score, whereas `gateModel` at `app/page.tsx:416` also checks context. The CLI's qualifying counts and minimum-three rule can therefore disagree with the UI. Share eligibility code. Change “fewer than three eligible models” into a catalog-quality warning rather than forcing thresholds to admit a predetermined population; malformed data should still fail validation.

**F10. Workload identity is only partially persisted.** The home component saves recommendation tokens/calls/cache but not its scenario ID. Revisiting without a query string can restore a writing workload's numbers under the default medium-coding gate. URL/storage parsing and persistence are separate effects without a shared initialization guard, and navigation uses `replaceState` without `popstate` handling. Preserve an entire versioned workload and make initialization atomic. Treat possible hydration ordering problems as browser regression cases, not as proven symptoms from this review.

**F11. A board can exceed its own decoder's limits.** `boardFromParsed` at `app/rank-board.tsx:63` rejects more than 12 tiers, but `addTier` at line 212 has no corresponding limit. A user can build a board that cannot reload/share correctly. Enforce the same limits in editing, saving, and decoding, with a visible limit message.

**F12. Opening a shared board can replace local work.** The board hydration effect overwrites the restored subject with the shared board and then autosaves it. There is no preview/import boundary or recovery. Load shares into an unsaved preview; require an explicit “Use this board” action to replace the subject's saved board, retaining a recovery copy.

**F13. Board persistence loses information or hides failure.** The placement map preserves tier assignment but rendering follows catalog order, so card ordering cannot be represented. Removed catalog IDs are silently dropped during parsing. Storage write errors are swallowed; one subject preference read is outside the storage try/catch. Add ordered tier contents, a versioned codec, retired-item preservation, and honest saved/unsaved feedback. Keep the existing touch/keyboard move menu.

**F14. Freshness is a catalog maximum, not item freshness.** `latestPricingUpdate` at `app/page.tsx:1439` chooses the more recent catalog date. The model catalog contains price checks from August 16 while the aggregate date is September 3. The banner can imply more comprehensive freshness than warranted. Show “Catalog updated” separately from per-item price, quota, and capability verification dates; evaluate staleness using the current client date or explicit evaluation date, not just static-build time.

**F15. Preset and custom calculations are mixed in presentation.** The Explore comparison modal uses `exploreSettings` with recommendation `monthlyCalls` (`compareRows`, around `app/page.tsx:1580`). Changing Recommend can silently change an Explore comparison's monthly total. Pass a complete workload to every result/comparison; never combine fields from separate experiences.

### P2 — Frontend clarity and delivery quality

**F16. All three views mount within one page.** Hidden panels still include their components and effects; personal-board hydration runs even while exploring. All catalog data and page logic enter the root client component. Split routes or route-level features so unrelated state and effects do not run together.

**F17. The interface repeats information before the decision.** The source includes a hero, stats strip, scenario description/rationale, gate banner, tier board, price book, and methodology. Recommend includes multiple summary/path/frontier/cost presentations. Keep one primary result and progressive disclosure. This is a source-based information-architecture finding; actual pixel layout needs browser review.

**F18. Shared filters have surprising scope.** Search/provider filters affect the price book but not the board; selections persist across API/plan lanes. Either scope and label filters explicitly or apply them consistently. Prefer one filter state per lane, with full-catalog tier baselines unchanged by display filtering.

**F19. Accessibility foundations exist, but need behavioral verification.** Preserve focus handling, live announcements, reduced-motion CSS, move menus, and keyboard-accessible sorting. Review the hand-built modal for disabled/hidden focus targets, background interaction, nested modal handling, and stable close callbacks. Avoid overriding browser tab-selection shortcuts with Ctrl/Cmd+1/2/3. Make input editing possible without coercing an empty draft immediately to 1. Do not claim full accessibility compliance from regex tests.

**F20. Production build and tests are not aligned.** `npm test` builds Vinext; deployment builds Next static export. The deployment workflow runs validation/build but not the full test suite, lint, or explicit type checking. Its artifact allowlist currently expects a single root page, so adding routes requires an intentional allowlist update. Keep artifact safety checks while covering the actual published output.

## 4. Decision engine specification

### 4.1 One evaluation pipeline

Use the same pipeline for a preset and a customized workload:

```text
validated catalog + complete workload + objective + evaluation date
  -> eligibility checks
  -> applicable pricing / entitlement evaluation
  -> budget and coverage classification
  -> deterministic ordering
  -> result with reasons, assumptions, sources, and alternatives
```

Suggested narrow functions, with explicit arguments and no React/browser/filesystem dependencies:

- `evaluateEligibility(candidate, workload, catalog)`
- `estimateApiCost(model, workload, pricingContext)`
- `evaluatePlan(plan, workload, catalog)`
- `recommend(catalog, workload, objective, evaluationContext)`
- `deriveTiers(evaluations, policy)`

Keep shared types close to this engine. Do not add repositories, dependency injection, event buses, or a generic scoring plugin framework. A few pure modules are enough.

### 4.2 Workload contract

Persist and share a complete normalized value:

- Version, scenario ID, objective, and capability gate/metric version reference.
- Input/output tokens per call, calls per month, cache-hit fraction, and monthly USD budget.
- Required access: `api`, `chat-app`, `coding-client`, or `any`.
- Optional provider restriction only when selected by the user.
- Optional busiest-window call count, requested only when needed to evaluate a plan's rolling limit.

Separate **form drafts** (strings, including temporarily blank fields) from **validated workload values**. Validate finiteness, integer token/call counts, nonnegative budget, and bounds at the boundary. Accept zero budget as a meaningful “free options only” request; zero call volume should produce “No usage to estimate” rather than divide by zero or a recommended paid subscription. Use one set of limits for forms, links, and storage. Treat cache share as 0–1 when pricing supports it; do not retain the unexplained 95% UI cap automatically.

Changing a scenario applies its full preset atomically. Editing numeric fields marks the workload customized without silently changing the gate. Provide “Reset to preset.” The benchmark gate remains a transparent heuristic; advanced editing of arbitrary thresholds is not required for the first release.

### 4.3 API estimates

For one applicable rate band:

```text
uncached input = input tokens × (1 − cache fraction)
cached input   = input tokens × cache fraction
cost/call     = (uncached input × input rate
                + cached input × cached rate
                + output tokens × output rate) / 1,000,000
monthly cost  = cost/call × calls/month
```

- Preserve the current fallback to normal input price when a cached rate is unavailable, but disclose that no cache discount is assumed.
- Select bands by the provider's documented billing trigger, not automatically by input+output. Context eligibility and pricing-band selection are distinct rules.
- For unknown applicable rates, return an unknown estimate and exclude it from a confident cheapest claim.
- Compare full-precision values; round only for display. Preserve the existing budget-aware display behavior so a rounded number does not contradict “over budget.” Define deterministic ID tie-breaking after meaningful ties.
- Include reasoning tokens in billable output only according to verified billing rules/user-provided totals; do not equate a benchmark's high-reasoning configuration with a cheap ordinary call without disclosing the limitation.
- Keep excluded costs visible in a short assumptions disclosure: tool/search/image fees, retries, taxes, and unmodeled cache writes/storage. Do not call this total cost of ownership.
- Later pricing contexts can cover region, service tier, or timed discounts. Implement only rules supported by current records; do not build a generic tariff language.

### 4.4 Subscription estimates

Represent mutually different quota cases explicitly:

| Quota type | What may be computed | What must not be inferred |
| --- | --- | --- |
| Verified dollar allowance | Covered metered spend/calls for eligible models at the actual plan meter | That it is production API credit, or that monthly coverage proves burst coverage |
| Verified token/credit allowance | Capacity from the published per-model formula and reset window | An unrecorded multiplier or universal 2× off-peak capacity |
| Verified request limit | Coverage for the matching surface/model/request definition and window | That a chat message equals one API call or one agent task |
| Relative/dynamic limits | Subscription price and the published qualitative limit | Numeric monthly capacity |
| Price break-even | Equivalent API spend at the subscription price | Included capacity or quota coverage |

Return coverage as `sufficient`, `insufficient`, `conditional`, or `unknown`, with explicit reasons. “Sufficient” requires all modeled applicable limits; monthly-only input with a binding short-window cap is conditional/unknown for that window. Do not multiply the number of five-hour windows in a month to invent usable capacity.

Compute total monthly plan spend as subscription fee plus **verified** overage charges when applicable. If overage is unsupported or unknown, label an exceeded plan insufficient/unknown rather than pretending another subscription or API spillover is automatically available. Overage taxes and billing scope must be explicit.

For multi-model plans, evaluate each qualifying offered model using that plan's meter, then select the cheapest feasible total-cost option. If totals tie, prefer stronger coverage evidence, then the selected objective's capability tie-break, then stable ID. Return the actual working model. Do not perform multi-model allocation optimization in this pass.

### 4.5 Ordering and result states

Default cheapest-qualified ordering:

1. Remove known failures: required access, context/output capacity, capability gate, availability, and unsupported pricing conditions.
2. Evaluate cost, budget, and quota status.
3. Rank sufficiently supported options within budget by total estimated monthly cost ascending.
4. Apply capability as a tie-break only after equal cost; use ID for stability.
5. Show conditional/unknown plan options in a separate section. They can be worth considering but cannot displace a demonstrably feasible winner.
6. If only over-budget matches exist, return “No match within budget,” with the cheapest qualifying alternative and budget gap. If none qualify, return “No qualifying match,” with failures that the user can address.

Keep two secondary objectives: highest compatible benchmark score within budget, and highest compatible benchmark score regardless of budget. Use the same eligibility and estimate results for all three. Deduplicate cards when one option wins multiple objectives. Rename “Most capable” to avoid implying measured task success.

Cross-lane comparisons are allowed only when required access is `any` and the options are meaningful substitutes for the specified work. Otherwise recommend within the allowed access category. Remove arbitrary 0.65/1.25 switching thresholds. Unknown plan limits must remain visible even if that leaves API as the only confidently costed path; this is uncertainty, not a score penalty.

### 4.6 Automated tiers

Replace population percentiles and z-score blends with transparent cost bands among qualified options. Proposed initial product policy:

- S: up to 1.25× the cheapest qualified cost.
- A: above 1.25× and up to 2×.
- B: above 2× and up to 4×.
- C: above 4×.

These cutoffs are an editorial proposal, not empirical truths. Store them once with a policy version, explain them, and test exact boundaries. Empty tiers are valid; never fill every letter artificially. Equal costs always receive equal tiers. If the minimum is zero, put free qualified options in S and list paid options by absolute cost without pretending an infinite ratio yields meaningful tier distinctions. No qualified priced candidates means no calculated board.

Use a complete preset workload, including call volume. Keep API and plan lanes separate; state that their tier baselines differ. Within plans, only sufficiently evidenced feasible options enter the main cost tiers; display conditional/unknown plans underneath with monthly price and missing evidence. Filtering providers/search must not quietly change the full-catalog baseline. A changed catalog can change the cheapest baseline; record the catalog and policy version.

Do not derive tiers from personal boards. Offer “Start my list from these rankings” only as an explicit copy with recorded scenario/catalog provenance, never as a link that updates the user's opinion later.

## 5. Catalog and backend organization

### 5.1 Keep a static catalog, make its semantics stronger

Retain the three JSON files and stable IDs. Add a versioned migration rather than a wholesale data rewrite. In the first migration:

- Normalize context to numeric `contextTokens`; add an optional independently evidenced `maxOutputTokens`. Unknown output capacity must not become an invented value.
- Move actual threshold pricing from notes into typed rate bands. Keep prose notes for noncomputable context.
- Separate model identity, price evidence, and capability evidence. Match benchmark variant/version and avoid mixing incompatible index versions.
- Add structured access surfaces and plan-specific model restrictions where verified; distinguish unknown from unavailable.
- Replace ambiguous quota fields with a discriminated quota object containing unit, amount, reset window, model meter, scope, and source/date. Conditional discounts carry explicit conditions.
- Replace undocumented cache overrides with a sourced rule or a clearly marked user/modeling assumption. A more expensive plan must not receive a higher cache share merely because of its price.
- Keep price, quota, roster, and capability verification independently attributable. Minimal evidence records can remain embedded; do not create a source-management database.
- Preserve stable IDs across renames. Model retirement needs an explicit replacement/retirement record for board migration; do not automatically move a retired card to a successor model.

Strict validation should reject dangling references, duplicate IDs, invalid URLs/dates/numbers, mixed metric versions, overlapping/missing required rate bands, contradictory quota shapes, and unusable zero-credit formulas. A genuinely free API rate is valid, but arithmetic must handle it without Infinity. Catalog-age warnings and unusually generous entitlements should prompt verification rather than blanket rejection of every plan exceeding an arbitrary 25× ratio.

### 5.2 Maintenance workflow

Keep JSON review in version control. Separate validator library code from CLI argument parsing and filesystem writes. The CLI should print both structural errors and an impact summary: changed rates, eligibility changes, estimated cost changes, and moved preset tiers. Use the same pure functions as the site.

Preserve dry-run, lock ownership, and atomic single-file replacement tests. For edits spanning models/plans/scenarios, validate the complete proposed set before committing; publish one catalog revision through the normal build/deploy unit. Avoid implementing a multi-file transaction system unless the maintenance CLI truly needs to write all files automatically.

Audit provider claims before migrating ambiguous entitlement numbers. If an official page cannot support a number, retain its price/source but mark capacity unknown. Review the current plan rosters and broad benchmark-to-task assumptions. This audit is an implementation dependency for stronger recommendation claims, not a request to guess updated data.

### 5.3 Backend boundary

No new HTTP API is needed for the planned product. The domain engine is the reusable business layer; browser and build code consume it directly. Static export cannot provide arbitrary runtime writes or request-dependent backend logic; Next documents the distinction in its [static-export guide](https://nextjs.org/docs/app/guides/static-exports).

Keep `worker/index.ts` as deployment plumbing. Inspect whether image optimization is actually used before removing its handler/bindings; the Next config currently disables optimization, but verify the local Sites path too. Do not add ranking or catalog mutation logic to this entry point.

If accounts, durable hosted boards, short URLs, or private workloads become requirements later, make a separate hosting/storage decision. A runtime service would need server-side validation, ownership checks, migrations, limits, and the same engine. That is a feature expansion and must not be smuggled into cleanup.

## 6. Frontend structure and experience

### 6.1 Target file boundaries

Use feature boundaries, not a component for every fragment. This is an illustrative target; merge files that remain trivial.

```text
app/
  layout.tsx                    shared shell and metadata
  page.tsx                      Rankings route composition
  recommend/page.tsx            Recommend route composition
  tier-list/page.tsx            Personal board route composition
  globals.css                   reset, theme tokens, base typography
components/
  site-header.tsx
  item-details.tsx
  compare-dialog.tsx
features/
  rankings/                     workspace, board, price table, scoped styles
  recommend/                    workload form, results, scoped styles
  tier-list/                    editor, reducer, codec, storage, scoped styles
lib/
  catalog/                      types, validation, catalog assembly
  domain/                       eligibility, pricing, plans, recommendation, tiers
  browser/                      versioned URL/preferences adapters
  format.ts                     money, tokens, dates
data/                           existing catalogs, migrated in place
scripts/update-models.mjs        thin CLI after extraction
tests/                          domain, migration, rendering, browser coverage
```

Choose a single importable source of validation/domain logic for both Node CLI and application. Use the existing TypeScript toolchain with an explicit small runner/build step if needed; do not rely on Node 26-only type stripping when CI runs Node 22. Do not duplicate TypeScript logic into handwritten JavaScript copies.

Route files should compose features rather than compute rankings. Keep state with the owning feature; pass complete evaluation results into visual components. Avoid a global store unless actual cross-route behavior requires it. No new state-management package is needed for these flows.

### 6.2 Rankings

- Navigation label: “Rankings.” First viewport: use-case selector, API/plan lane switch, cheapest qualified option with monthly cost, and the start of the tier board.
- Show a compact workload summary: input/output per call, monthly calls, cache share. One “Customize” action carries that complete preset to Recommend.
- Keep price tables and compare-up-to-three as supporting tools. Default columns: name/provider, estimated monthly cost, eligibility/coverage, tier. Put raw rates, context, quota details, and source dates in optional columns/details.
- Show why an option is excluded, unknown, or conditional. Do not silently hide unscored models.
- Keep model prices and subscription costs distinctly labeled. Do not visually equate “API-cost parity” with plan capacity.
- Generate source listings from the displayed catalog where appropriate; remove unrelated hard-coded source links only after checking their usage.

### 6.3 Recommend

- Navigation label: “Recommend.” Start with use case, access requirement, workload volume, and budget. Keep token/cache controls under an immediately available advanced section with preset explanations.
- One main recommendation: option + access type + selected model for plans + estimated monthly spend + budget/coverage status + a brief reason.
- Below it: alternative objectives, qualifying options, and conditional/unknown options. Deduplicate repeated winners.
- Clearly show no-match, over-budget, unsupported-price, and unknown-quota states. Provide specific actions such as lowering volume or changing a requirement; never silently relax a hard constraint.
- Keep inputs and summary adjacent on desktop; form before result on narrow screens. Avoid announcing the entire result panel on every keystroke; announce concise settled updates.
- Share the full validated workload and objective. Make copied-link failure visible and provide a selectable URL fallback.

### 6.4 My tier list

- Navigation label: “My tier list,” covering both models and plans. Label it “Your opinion” so it cannot be confused with calculated rankings.
- Preserve separate saved model/plan boards. Add a title and optional use-case note, bounded in length.
- Represent ordered tiers and ordered card IDs. Allow moves within a tier and between tiers, with move-up/down or destination controls as well as drag gestures.
- Enforce one-to-12 tiers and the same title/name/payload limits everywhere. Unknown IDs become visible retired/unavailable cards rather than silent deletion; new catalog items enter the unranked pool.
- Add search/provider filtering to the unranked pool. Do not change ranked cards when changing pool filters.
- Show “Saved in this browser” only after a successful write. On failure, preserve in-memory editing and offer export; avoid a storage failure breaking initialization.
- Reset/remove actions must be recoverable through a one-step undo or recovery snapshot. Do not silently destroy a saved board when opening a share.
- Version the board payload. Read old `t`/`p` payloads, migrate their existing display order deterministically, and preserve the original storage until the replacement is validated.
- Prefer share payloads in the URL fragment for new links, with legacy query-string import retained. Fragments avoid sending the payload in the request URL but do not make a shared board private. Enforce an encoded-size limit; offer JSON export/import when a board is too large for a dependable link.
- A shared link opens a preview. “Use this board” creates/replaces a local board only on explicit action. Personal boards never automatically sync with catalog tier changes.

W3C's [dragging-movements guidance](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) requires a usable non-drag alternative for applicable dragging functionality; retain and test the existing move-menu approach rather than replacing it with drag-only controls.

### 6.5 URL, route, and preference migration

- Adopt `/`, `/recommend/`, and `/tier-list/` with ordinary links and route-specific titles. Verify base-path behavior under `/TokenTier/` before rollout.
- Recognize legacy `?view=recommendation` and `?view=rank` URLs at the root and transfer their full parameters to the corresponding route client-side. Static hosting cannot depend on a runtime redirect handler.
- URL state takes precedence over saved preferences, then defaults. Parse everything before writing storage or URL state. Do not let a stale saved subject determine a shared board's interpretation.
- Navigation creates history entries; transient edits replace the current entry. Back/Forward restores route and relevant state. Preserve intentional board/fragments during navigation.
- Migrate old `tokentier-*` keys once into versioned feature-specific records. For a legacy recommendation whose scenario was not saved, do not silently assign a gate: apply a clear preset reset or ask the user to reselect the scenario while preserving draft numbers.
- Keep theme and table-column preferences separate from recommendation inputs and personal content. Do not persist every ephemeral UI control automatically.

### 6.6 CSS and accessibility cleanup

Keep existing visual identity, theme tokens, and useful layouts. Move feature styles into CSS Modules or explicitly scoped feature stylesheets as components move; reserve global CSS for shared primitives and tokens. Consolidate repeated selector/breakpoint rules only after checking computed behavior. No broad redesign or replacement design system is required.

Verify 360px, 768px, and desktop widths; light/dark/system modes; 200% text zoom; keyboard-only operation; touch movement; and reduced motion. Check table overflow within its container, visible focus, descriptive buttons, truncation with accessible full names, dialog focus restoration, and live announcements. Preserve meaningful typography instead of shrinking every label to fit more data.

## 7. Implementation phases and acceptance criteria

Implement in reviewable changes. Do not combine extraction, data migration, policy changes, and CSS cleanup in one diff.

### Phase 0 — Establish baseline and regression fixtures

Scope: record current catalog/policy snapshot; add fixtures for pricing, eligibility, plan evaluation, URLs, and board payloads. Capture browser behavior before structural changes.

Acceptance:

- Existing validation/lint/type checks/tests run on the declared CI Node version.
- Both retained build targets are exercised and failures classified.
- F1/F2/F11 have small regression cases. Current broken behavior is recorded as baseline evidence, not permanently asserted as correct.
- Browser checks cover a scenario change, Recommend edit/share/reload, comparison, board save/reload, and a shared-board import with existing local work.

### Phase 1 — Extract the existing engine without policy changes

Scope: move types/catalog assembly/calculations into pure modules; separate CLI validation from IO. Update consumers with minimal markup changes.

Acceptance:

- For all seven scenarios, old/new calculated costs, placements, and selected working models agree on the frozen catalog, except separately documented bug fixes.
- UI and CLI invoke the same eligibility functions; the context mismatch is corrected with a dedicated regression.
- No React, browser, or filesystem dependency enters the pure engine.
- Rewrite source-regex assertions into behavior tests as the corresponding code moves; do not merely delete coverage to make the suite pass.

### Phase 2 — Fix catalog semantics and estimate correctness

Scope: migrate numeric limits, price bands, quota variants, access evidence, and dates. Verify ambiguous source claims. Fix threshold pricing, credit-meter choice, zero division, and quota/break-even separation.

Acceptance:

- Threshold tests below/at/above boundaries pass; unsupported rate conditions have no fabricated amount.
- Dollar, credit, request, relative, and unknown quotas have distinct testable outcomes.
- All migrated data validates, and every stronger capacity/access claim has applicable source evidence.
- Existing IDs and user boards remain readable; record a rollback catalog revision.

### Phase 3 — Unify cost-first recommendations and tiers

Scope: implement the shared evaluation pipeline, hard constraints, no-match states, explicit secondary objectives, and versioned tier bands.

Acceptance:

- Default winner is the cheapest eligible, sufficiently supported, within-budget option, or an explicit no-match result.
- An insufficient plan cannot receive a qualified top-tier placement; unknown coverage remains visible separately.
- Preset evaluation and an identical custom workload return identical costs and ordering under the same objective.
- Ties are deterministic, equal costs share tiers, and filtering does not alter the reference population.
- Publish a before/after impact report for all seven presets explaining each changed recommendation/tier by a rule or data correction.

### Phase 4 — Separate frontend features and simplify presentation

Scope: introduce routes, extract feature components/styles, simplify the primary flows, and fix complete-workload persistence.

Acceptance:

- Each route owns its state; visiting Rankings does not hydrate/save a personal board.
- Legacy links, direct navigation, refresh, and Back/Forward work under the repository base path.
- Primary task controls appear before long explanatory text. A user can understand the winning option, estimated cost, and constraints without opening methodology.
- Identical evaluations appear consistently in cards, tables, comparisons, and share restoration.
- Existing theme, comparison, provider search, and source access remain usable.

### Phase 5 — Make personal boards robust

Scope: versioned codec/storage, ordered cards, edit limits, safe imports, retired cards, recovery, and portable export.

Acceptance:

- A valid board round-trips with identical title, tiers, order, and assignments.
- The editor cannot create data its decoder rejects.
- Opening a share leaves the original saved board untouched until explicit import.
- Storage-denied, oversized, malformed, unknown-version, and retired-ID cases preserve usable state and explain what happened.
- Keyboard/touch controls can perform every required move and recovery action.

### Phase 6 — Production verification and cleanup

Scope: CI, artifact routing, README/methodology, remaining styles/imports made obsolete by the changes.

Acceptance:

- Validation, lint, explicit type checking, domain tests, browser flows, and production export pass in CI.
- GitHub Pages artifact checks accept intended route files and continue excluding secrets, maps/logs, and server intermediates.
- Every new route is directly reachable from exported output; canonical/sitemap URLs reflect real routes.
- Retained local Vinext/Sites build still works; local ignored hosting configuration is preserved.
- No unrequested accounts, services, model calls, dependency upgrades, or public deployment are introduced by the refactor.

## 8. Required test matrix

Use small synthetic catalogs for edge cases, plus a few real snapshot regressions. Business tests should import functions, not copy their implementation or assert their source strings.

| Layer | Required cases |
| --- | --- |
| API pricing | No cache, full cache, missing cache discount, zero rate, zero usage, rate boundary −1/exact/+1, unknown long-context rate, large workload, display rounding vs budget verdict |
| Eligibility | Below/exact threshold, unscored, incompatible metric version, context boundary, output limit, access mismatch/unknown, empty eligible set |
| Plans | Dollar/credit/request/relative quotas; each reset window; conditional off-peak; missing overage price; lowest API cost differs from lowest plan credits; break-even never means coverage |
| Recommendations | Lowest cost vs highest score; exact budget; nothing affordable; no feasible candidate; unavailable data; zero budget; same workload across both surfaces; no mixed access substitution |
| Tiers | Exact band boundaries; equal costs; empty/singleton/all-free population; insufficient/unknown plans separated; deterministic ties; filter invariance |
| Catalog updater | Existing locking/atomicity/dry-run cases, migrated schema, bad joins, invalid bands/formulas, stale evidence warning, consistent CLI/UI eligibility |
| URL/preferences | Legacy and new URLs; zero values; invalid/nonfinite/oversized inputs; complete scenario restore; URL precedence; no initial overwrite; Back/Forward; encoded fragment; base path |
| Boards | Legacy migration; order round-trip; 12-tier limit; malformed payload; oversized payload; storage failure; shared preview vs import; retired items; reset undo; clipboard fallback |
| Browser | All three journeys on desktop/mobile, keyboard movement, dialog focus, text zoom, light/dark, visible no-match states, reload/share after editing |
| Delivery | Actual Next export and route files; Vinext smoke test; metadata, artifact allowlist, no server-only material in public output |

Keep server-render and ownership/license checks, but decouple them from exact component names, prose, CSS pixel values, and assumptions that all views render at the root. Source checks may remain where source structure is itself the intended contract; they should not be the main proof of business behavior.

## 9. Practical stop condition for the implementing agent

The refactor is complete when one documented engine produces cost-first, constraint-aware results across Rankings and Recommend; personal boards safely preserve and share user choices; feature boundaries are understandable without tracing a monolithic component; and the actual production artifact and core browser journeys are verified.

The handoff report should list changed rules, catalog uncertainties still unresolved, test/build evidence, migrated storage/link compatibility, and any intentional feature deferrals. If evidence remains unavailable, ship an honest unknown state rather than block cleanup or fabricate a precise recommendation.

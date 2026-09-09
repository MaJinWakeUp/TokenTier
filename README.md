# TokenTier

TokenTier is a price-aware comparison of current AI models and consumer plans.
It combines scenario tier lists, standard API token rates, and transparent
subscription-to-API spend estimates.

## Ownership and independence

TokenTier is an independent project created and maintained by Jin Ma. It is not
affiliated with or endorsed by the AI providers listed on the site. Product
names and trademarks belong to their respective owners. The source code is
available under the MIT License.

## What it compares

- Daily use, easy/medium/hard coding, research, paper writing, and innovation
- Standard input, cached-input, and output prices in USD per 1M tokens
- Estimated per-call and monthly API spend from disclosed token profiles
- Consumer subscription prices and their theoretical API-cost equivalents

The equivalence figures are economic comparisons, not provider quotas or API
credits. Prices were checked against official provider sources on September 3,
2026; temporary, threshold, and volatile prices are labeled in the interface.

## Workload profiles

Each scenario in `data/scenarios.json` describes a typical month of one kind of
work with four numbers, and explains them in a `rationale` field the site shows:

| Profile | Tokens in / out | Calls / month | Input from cache |
| --- | --- | --- | --- |
| Daily use | 1,500 / 700 | 400 | 20% |
| Easy coding | 6,000 / 1,200 | 500 | 45% |
| Medium coding | 25,000 / 3,500 | 900 | 60% |
| Hard coding | 90,000 / 6,000 | 1,500 | 75% |
| Research | 60,000 / 4,000 | 200 | 25% |
| Writing | 4,000 / 3,000 | 300 | 25% |
| Innovation | 12,000 / 5,000 | 150 | 30% |

The cache share matters as much as the token counts and was previously ignored
by the cost model: an agent that resends a stable repo prefix pays the cached
rate for most of its input, so charging full input rates overstated the cost of
exactly the workloads the site is most used for. A plan that publishes its own
cache behaviour overrides the profile. Every number is an editable starting
point, and the Recommend view exposes all four.

## Which model a plan is judged on

A subscription is access to a set of models, not to one model, so judging every
plan by a single fixed reference misstates both what it can do and how far it
goes. Each plan lists every model it includes, and each scenario picks the
**cheapest model on the plan that clears that scenario's capability bar** and
holds the workload's tokens. That model then supplies the plan's capability
score, its capacity estimate and its tier, and the interface names it (`via
GLM-5.3-Flash`) wherever a plan number is shown.

The effect is largest where a plan spans a wide price range. OpenCode Go's $60
monthly allowance buys about 111,000 daily-use calls on GLM-5.3-Flash, but for
hard coding the 60 bar rules Flash out, forcing GLM-5.3 and leaving roughly 455
calls against a 1,500-call profile — so the same plan is generous for light work
and short for heavy work. Judging it on one model hid both facts.

A plan whose models all fall below a scenario's bar is off that board, and the
reason names its closest miss.

Rosters verified from each plan's own documentation: OpenCode Go, ChatGPT Plus
and Pro, the three GLM Coding plans, the four Google AI plans, and the three
Cursor plans. The remaining plans — Claude Pro and Max, the SuperGrok tiers, the
Kimi memberships, and OpenCode Zen — still carry a single model, because their
providers do not publish a per-plan model matrix on a page we could read. That
is the pre-existing behaviour, not a regression, and it is the next thing to
verify.

## What the recommendation reports

Capability is a gate, so cost-minimising alone always returns the cheapest model
that clears the bar — an answer that never changes with the workload. The view
therefore reports a frontier of three answers and lets the reader pick which one
is compared against the plans:

- **Lowest cost** — cheapest model that clears the bar.
- **Best in budget** — highest scored model whose monthly spend fits the budget.
- **Most capable** — highest scored model that clears the bar, budget aside.

Plans are not scored against models on a blended number. A plan is only ever
recommended when three things are true at once: a model it offers clears the
capability bar, its published allowance can be shown to cover the requested
volume for a whole month, and its price fits the budget. A plan that fails any
of the three is listed under **Conditional or unmeasurable plans** with the
reason, rather than promoted with a discount or hidden.

The access requirement — any surface, direct API, chat app, or coding client —
is a hard filter, not a preference. Asking for a coding client never returns a
chat-only plan, and asking for a direct API never returns a subscription that
does not expose one.

When nothing qualifies, the page says so and names the constraint to relax. It
never falls back to the nearest option that does not fit.

## How tiers are decided

Tiers are derived, never hand-graded. Two independent judgements are kept apart:

1. **Can it do the work?** Every scenario in `data/scenarios.json` declares a
   minimum score on an external capability index — currently the
   [Artificial Analysis Intelligence Index](https://artificialanalysis.ai/),
   a 0–100 composite of ten published evaluations. A model must clear that bar
   and hold the scenario's tokens in its context window to appear on the board.
   The bar is absolute, because "can it do this task" has a fixed answer.
2. **Is it worth the money?** Among the options that cleared the bar, S/A/B/C/D
   are assigned by curving: the qualifying population is ordered by cost and cut
   at the proportions in `data/scenarios.json` (`tierCuts`, currently even
   quintiles). Options that cost exactly the same always share a letter, and the
   curve is taken over every qualifying option, so filtering or searching the
   table never moves a letter.

   Models are ordered by per-call cost and plans by monthly price. A plan is
   ranked on price whether or not its published quota can be shown to cover the
   profile, so the whole market is visible rather than only the few plans whose
   quota converts; each card says when its capacity is under the volume, capped
   on a shorter window, or unproven. The recommendation is stricter and
   unchanged: it names a plan only when the allowance is verified, sufficient
   and within budget.

   Each scenario also declares a `planPriceCap` — the most a reader doing that
   kind of work would plausibly pay for a subscription. Plans above it are
   listed with that reason instead of being ranked, so a daily-use board is not
   dominated by $200 tiers bought for something else:

   | Scenario | Ceiling |
   | --- | --- |
   | Daily use, easy coding | $30 |
   | Medium coding, paper writing | $100 |
   | Hard coding, research, innovation | $200 |

   The ceiling bounds the board only. Recommend uses the budget the reader
   enters, so a plan above the board's ceiling is still priced there for someone
   who says they will spend that much.

   This replaced fixed cost-ratio bands (S within 1.25x of the cheapest, A within
   2x, B within 4x, else C). Those bands had a real advantage — a letter meant
   the same multiple of the cheapest price in every scenario — but one unusually
   cheap model was enough to push every other option past the last band. On
   medium coding that left a populated S, an empty A and B, and thirteen models
   in C, which tells a reader nothing. The curve trades the absolute reading for
   a board that always distinguishes: a letter is now a rank, so adding or
   removing an option can move an unchanged one by a letter.

Consequences worth knowing:

- Each threshold records an **anchor model** and a rationale. The anchor is what
  makes the number re-derivable: when Artificial Analysis rebases the index, read
  the anchor's new score and move the bar to match. A bare number could not be
  audited or re-derived.
- Every score records the **index version** it was read under. Scores from
  different versions are not comparable, and `models:validate` refuses a catalog
  that mixes them.
- The board prints only the letters it can fill. When a scenario qualifies fewer
  options than there are letters, the letters are used from S downward rather
  than leaving a gap in the middle.
- `capability: null` is a deliberate third state. The model is listed and priced,
  but it receives no tier and is shown as *not independently scored* rather than
  silently passing or silently disappearing.
- Capability scores are published by Artificial Analysis and reproduced with
  attribution and a per-model source link. They are not our measurements. Check
  their terms before reusing the column elsewhere.
- Artificial Analysis also publishes Coding Agent and Agentic indices as separate
  leaderboards, but not per model on the model pages. Every scenario therefore
  gates on the headline index today; each coding and agentic scenario records the
  `preferredMetric` it should switch to once per-model values are published.

## Data files

| File | Holds |
| --- | --- |
| `data/api-models.json` | API models: token rates, context window, capability score, sources |
| `data/plans.json` | Consumer plans: price, quota evidence, credit formulas, the models each plan includes |
| `data/scenarios.json` | Scenario token profiles, capability bars, anchors, plan price ceilings, tier curve cuts, ranking weights |

`npm run models:validate` validates all three together and prints how many
models clear each scenario bar. The files only make sense as a set, so the
validator enforces the joins between them:

- every id in a plan's `modelIds` must exist in the model catalog, so retiring a
  model cannot silently empty the plans that derive their numbers from it;
- a credit-metered plan must publish multipliers for every model it offers,
  because providers set them per model and a missing set makes that model's
  capacity uncomputable;
- every scenario anchor must be a catalog model that clears its own threshold;
- coding thresholds must not ask less of harder work;
- no scenario may admit fewer than three models — a bar that admits almost
  nothing is a data error, not a strict standard.

## Refresh the API model catalog

API models live in `data/api-models.json`. To add one later, create a JSON file
containing one complete model record (or an array of records), then preview and
apply it:

```bash
npm run models:update -- add ./new-model.json --dry-run
npm run models:update -- add ./new-model.json
```

Use `update` instead of `add` to replace an existing record. Each record must
include its official source, verification date, token rates, context window,
and a `capability` block (or an explicit `null`). The updater validates all
three data files and will not scrape or guess provider or index data — a human
reads the published number and pastes it in.

```bash
npm run models:update -- update ./updated-model.json
npm run models:validate
```

The page automatically picks up the refreshed model count, provider filters,
tier lists, recommendations, cost list, price book, source links, and update
date. Only one write runs at a time. If an updater is force-terminated and
leaves `data/api-models.json.lock`, confirm no update is still running, delete
that stale lock file, and retry.

## Catalog changes, September 9 2026

Artificial Analysis published **Intelligence Index v4.3** on September 7 2026,
two days after v4.2. It upgrades Terminal-Bench to v4.0 — a harder 66-task set
replacing v2.1 — and swaps AutomationBench-AA in for τ³-Banking. Category
weights are unchanged, and the index still aggregates ten evaluations.

Scores are not comparable across index versions, so all 22 scored models were
re-read together at the same effort variant each record already cited. Every
score fell again, by 1 to 8 points. Each scenario bar was re-derived from its
anchor, preserving the gap between the anchor's score and its own bar:

| Scenario | Anchor | Anchor 4.2 → 4.3 | Bar 4.2 → 4.3 |
| --- | --- | --- | --- |
| Daily use | Gemini 3.1 Pro | 37 → 30 | 34 → 27 |
| Easy coding | Gemini 3.1 Pro | 37 → 30 | 34 → 27 |
| Medium coding | Claude Sonnet 5 | 45 → 38 | 45 → 38 |
| Hard coding | GLM-5.3 | 49 → 45 | 49 → 45 |
| Research | GLM-5.3 | 49 → 45 | 49 → 45 |
| Paper writing | GPT-5.6 Luna | 43 → 38 | 41 → 36 |
| Innovation | GLM-5.3 | 49 → 45 | 49 → 45 |

The tier curve is unchanged: the board still runs S to D with no gaps, for
models in every scenario.

One visible consequence is on the plan side of hard coding. Twelve
subscriptions offer a model that clears the 45 bar — ChatGPT Plus and Pro
through GPT-5.6 Sol, Claude Max through Opus 5, Cursor through Sol and Fable
5.1, GLM Coding and OpenCode Go through GLM-5.3 — and all twelve are ranked on
the board. **None of them can any longer prove it covers the volume**, so every
card on that lane carries a capacity caveat:

- ChatGPT and Claude publish relative limits ("rolling 5-hour", "5x Pro
  allowance") that convert to no call count at all — `unproven`.
- The Cursor pools convert, but to 57, 200 and 1,197 calls against a
  1,500-call month at 90K input — `under volume`.
- GLM Coding and OpenCode Go cap on a weekly or 5-hour window, so a monthly
  total cannot follow — `capped`.

Cursor Ultra is the one that changed. Under v4.2 its working model was Grok 4.6,
whose $400 pool covered 2,576 calls — the only plan on that lane with proven
coverage. Grok 4.6 fell from 51 to 44, below the bar, so the working model
became the pricier GPT-5.6 Sol and the same pool now buys 1,197 calls. One score
moved the whole lane from "one plan proves it" to "none does".

**Roster correction:** GPT-6 Astra was added to the model catalog on September 6
but to no plan, so the ChatGPT subscriptions understated what they reach. Astra
is included for Plus, Pro, Business and Enterprise; it is now listed on ChatGPT
Plus, Pro (5x) and Pro (20x). On Plus it is reachable through Work and Codex
rather than the standard chat picker, which the plan note records. This does not
change any board: `planWorkingModel` picks the cheapest model on a plan that
clears the bar, and GPT-5.6 Sol is cheaper than Astra everywhere both qualify.

Claude Fable 5.1 and GPT-6 Astra now tie at 53 for the top score. Ties resolve
by cost and then by id, so the recommendation stays deterministic.

## Catalog changes, September 6 2026

Artificial Analysis published **Intelligence Index v4.2** on September 4 2026. It
adds AA-Briefcase and Surge's GDP.pdf, upgrades AA-LCR to v1.1, removes the
saturated GPQA Diamond, and raises private held-out evaluations to 40% of the
composite. Scores are not comparable across index versions, so all 21 scored
models were re-read together and `capabilityIndex.version` moved to `4.2`.

Every score fell, by 2 to 12 points. Each scenario bar was therefore re-derived
from its anchor, preserving the gap between the anchor's score and its own bar —
which is what the anchor field exists for:

| Scenario | Anchor | Anchor 4.1.1 → 4.2 | Bar 4.1.1 → 4.2 |
| --- | --- | --- | --- |
| Daily use | Gemini 3.1 Pro | 48 → 37 | 45 → 34 |
| Easy coding | Gemini 3.1 Pro | 48 → 37 | 45 → 34 |
| Medium coding | Claude Sonnet 5 | 55 → 45 | 55 → 45 |
| Hard coding | GLM-5.3 | 60 → 49 | 60 → 49 |
| Research | GLM-5.3 | 60 → 49 | 60 → 49 |
| Paper writing | GPT-5.6 Luna | 52 → 43 | 50 → 41 |
| Innovation | GLM-5.3 | 60 → 49 | 60 → 49 |

Effect on the board: **no scenario's cheapest qualified option changed.** Kimi
K2.7 Code newly clears the daily and easy-coding bars; nothing else moved tier.
Re-deriving from the anchors rather than keeping the old numbers is what kept
the board stable — holding the bars at their v4.1.1 values would have emptied
the frontier scenarios.

**Added: GPT-6 Astra** (OpenAI, released September 3 2026) at $10 input / $1
cached / $50 output per 1M, 1.05M context, 128K max output, Intelligence Index
55 at max effort. Several third-party write-ups report a surcharge above 272,000
input tokens (whole request billed at 2× input and 1.5× output). That claim is
not in OpenAI's published model documentation, so the catalog records the flat
published rates and no rate band. If the surcharge is confirmed from an official
page, add it as `rateBands` — very large prompts are under-priced until then.

Not added: K2 Horizon 375B A23B, which Artificial Analysis listed the same week.
Its token rates were not confirmed from a provider source.

## Catalog changes, September 3 2026

Added, with prices and capability scores read from the sources recorded in each
record:

| Model | Why |
| --- | --- |
| Claude Fable 5.1 | New flagship; supersedes Claude Fable 5 |
| Grok 4.3 | Current, cheaper than 4.5/4.6 with a 1M context window |
| GLM-5.3-Flash | New low-cost sibling of GLM-5.3 |
| Gemini 3.8 Flash | Google's current Flash model; carries the lane on its own |
| Muse Spark 1.3 | Meta's flagship on the Meta Model API; new provider |
| Qwen3.8-Max | Alibaba's flagship on Model Studio; new provider |

Removed as obsolete:

| Model | Why |
| --- | --- |
| o3 | OpenAI lists the `o3-2025-04-16` snapshot for shutdown on December 11 2026, replacement `gpt-5.6-sol` |
| Claude Fable 5 | Superseded by Fable 5.1 at the same base and output price, with 4x cheaper cache reads |
| GLM-5.2 | Same price as GLM-5.3 with a lower index score and a 200K rather than 1M context window |
| Gemini 3.6 Flash | Superseded by Gemini 3.8 Flash at the same standard rate |
| Gemini 3.5 Flash-Lite | Superseded by Gemini 3.8 Flash; the `daily` threshold was re-anchored to Grok 4.3 |

Repriced: GPT-5.6 Sol fell from $5 / $0.50 / $30 to $4 / $0.40 / $20 per 1M
tokens. Four plans that referenced GLM-5.2 were repointed to GLM-5.3.

Credit and quota conversions were re-derived from the provider docs, which
changed two plan families substantially:

- **OpenCode Go** is not a credit system at all. The plan grants dollar-denominated
  usage — $12 per 5 hours, $30 per week, $60 per month — metered at the same
  per-token rates the catalog already stores. It is now modelled as a $60 monthly
  allowance. The previous record carried a borrowed credit formula that overstated
  its capacity by roughly twenty times.
- **GLM Coding plans** do use credits, with the published formula
  `(input x 6.9 + cached x 1.7 + output x 24) / 10,000` for GLM-5.3. The catalog
  previously carried multipliers of `(1, 0.2, 3)`, overstating capacity by about
  eight times. The multipliers are published per model, so a plan's numbers are
  only valid for the model it references.

A regression test now rejects any plan implying more than 25x its subscription
price in metered usage, which is the shape both of those errors took.

Two records carry a price that depends on where or how you call the model, and
say so in their `note` rather than in the headline number:

- **Qwen3.8-Max** is recorded at the International (Singapore) rate of
  $2 / $0.25 / $6. The Beijing, US, Germany, Japan, and Hong Kong endpoints bill
  $1.65 / $0.206 / $4.951.
- **Muse Spark 1.3** is recorded at the standard tier. The contributor tier costs
  $0.10 / $0.002 / $0.20 in exchange for Meta training on prompts and outputs.

Gemini 3.8 Flash follows the existing Flash convention: the standard rate is the
headline and the introductory rate through December 31 2026 sits in the note, so
a temporary discount never moves a model up the board.

## Routes and code layout

The site is three routes, each owning its own state. Visiting one never reads or
writes another's saved data.

| Route | Question it answers |
| --- | --- |
| `/` | **Rankings** — what costs least for a preset kind of work, and how everything is tiered against it |
| `/recommend/` | **Recommend** — what to use for a specific workload, budget, and access requirement |
| `/tier-list/` | **My tier list** — how *you* would rank the models or plans, kept separate from the calculated rankings |

Links from the previous single-page build (`/?view=explore`, `?view=recommendation`,
`?view=rank`) still work: the root recognises them and hands the whole query to
the route that owns it.

| Directory | Holds |
| --- | --- |
| `lib/catalog/` | Catalog types, validation, and the assembled catalog |
| `lib/domain/` | The decision engine: eligibility, pricing, placement, recommendation, the derived decision, and the workload/link contracts |
| `lib/boards/` | The personal-board payload codec and editor operations |
| `lib/browser/` | Versioned storage, URL, and theme adapters — the only modules that touch `window` |
| `components/` | The shared shell, modal, item details, and comparison dialog |
| `features/` | One directory per route: its view, its own state, and its own controls |
| `app/` | Route composition and metadata only |

`lib/` is pure: no React, no DOM, no filesystem. That is what lets the
maintenance CLI (`scripts/update-models.mjs`) and the site share one definition
of eligibility, and lets the engine be tested without rendering anything.

## Personal tier lists

The board on `/tier-list/` is opinion, not calculation, and it is treated as the
reader's own work:

- The payload is versioned and records ordered tiers **and** ordered cards inside
  each tier. Boards saved by the previous build are read and migrated once, in a
  deterministic order, and the original keys are left in place.
- Opening a shared link shows a **preview**. Nothing saved is replaced until
  "Use this board" is pressed, and the board it replaces stays recoverable for
  one step.
- Cards the catalog no longer contains stay visible as retired cards until they
  are explicitly removed, rather than disappearing.
- Every move is available without dragging, as WCAG 2.2 requires: each card has a
  destination menu and up/down controls.
- New links put the payload in the URL fragment, which is not sent to the server.
  That is not privacy — a shared board is shared — it just keeps the payload out
  of request logs. Boards too large for a dependable link are exported as JSON.
- "Saved in this browser" appears only after a write actually succeeded. When
  storage is denied, editing continues in memory and export is offered.

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

`tsconfig.json` excludes `.next` on purpose. Both build targets generate route
types into `.next/types/`, with incompatible shapes, so whichever ran last leaves
the other's file stale and `tsc --noEmit` then fails on generated code. `next
build` re-adds `.next/types/**/*.ts` to `include` every time it runs; `exclude`
wins over `include`, so leaving both in place is stable. Do not remove the
`.next` exclude to "resolve" the contradiction.

Use `npm run build` for a deployment build, `npm run build:pages` for the static
export that GitHub Pages publishes, and `npm test` for the full suite: the engine
and board tests, the workload/link contract, and the server-rendered HTML of
every route. `npm run lint` and `npx tsc --noEmit` run in CI alongside it. The
site uses the bundled vinext and Sites hosting structure.

## Deployment targets

GitHub Pages is the published host, at
`https://majinwakeup.github.io/TokenTier/`. The `main` branch workflow runs
`npm run build:pages` and applies the `/TokenTier` repository base path. It is
the only deployment this repository configures.

A private ChatGPT Sites copy can also be built locally with `npm run build`.
Its packaging plugin (`build/sites-vite-plugin.ts`) and hosting config
(`.openai/hosting.json`) are deliberately kept out of the repository and are
ignored by Git, so a clone has no trace of them. `vite.config.ts` loads the
plugin only if it is present and builds without it otherwise, which means
`npm run build`, `npm run dev` and `npm test` all work from a fresh clone.
Canonical, sitemap, and social-preview metadata point at GitHub Pages either
way.

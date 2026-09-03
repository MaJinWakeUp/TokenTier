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

Plan scores weight capability, budget fit, quota coverage and evidence strength.
When a plan publishes no convertible quota, the coverage weight is renormalised
away rather than replaced with a low default, so a plan is never penalised for
publishing less than a competitor whose formula we happen to be able to read.

## How tiers are decided

Tiers are derived, never hand-graded. Two independent judgements are kept apart:

1. **Can it do the work?** Every scenario in `data/scenarios.json` declares a
   minimum score on an external capability index — currently the
   [Artificial Analysis Intelligence Index](https://artificialanalysis.ai/),
   a 0–100 composite of nine published evaluations. A model must clear that bar
   and hold the scenario's tokens in its context window to appear on the board.
   The bar is absolute, because "can it do this task" has a fixed answer.
2. **Is it worth the money?** Among the models that cleared the bar, S/A/B/C are
   cut at fixed percentiles of a score weighting per-call cost against capability
   headroom. Placement is relative, so the board keeps a readable spread as the
   catalog grows instead of collecting everything into one letter.

Consequences worth knowing:

- Each threshold records an **anchor model** and a rationale. The anchor is what
  makes the number re-derivable: when Artificial Analysis rebases the index, read
  the anchor's new score and move the bar to match. A bare number could not be
  audited or re-derived.
- Every score records the **index version** it was read under. Scores from
  different versions are not comparable, and `models:validate` refuses a catalog
  that mixes them.
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
| `data/scenarios.json` | Scenario token profiles, capability bars, anchors, tier cuts, ranking weights |

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

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Use `npm run build` for a deployment build and `npm test` for the rendered-page
checks. The site uses the bundled vinext and Sites hosting structure.

## Deployment targets

The same source supports two hosts:

- GitHub Pages is the public, indexable copy at
  `https://majinwakeup.github.io/TokenTier/`. The `main` branch workflow runs
  `npm run build:pages` and applies the `/TokenTier` repository base path.
- ChatGPT Sites is the private copy. It uses `npm run build`; public canonical,
  sitemap, and social-preview metadata intentionally point to GitHub Pages.

Run both build commands before merging deployment changes so root-hosted Sites
assets and repository-path GitHub Pages assets remain compatible.

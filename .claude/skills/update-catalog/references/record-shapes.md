# Record shapes

Authoritative rules live in `lib/catalog/validate.ts` and are enforced by
`npm run models:validate`. Unknown keys are rejected everywhere, so these lists
are exhaustive.

## Model record — `data/api-models.json`

Required: `id`, `provider`, `name`, `input`, `cached`, `output`, `context`,
`contextTokens`, `source`, `verifiedAt`, `capability`.
Optional: `note`, `rateBands`, `unsupportedBeyond`.

```json
{
  "id": "gpt-6-astra",
  "provider": "OpenAI",
  "name": "GPT-6 Astra",
  "input": 10,
  "cached": 1,
  "output": 50,
  "context": "1.05M",
  "contextTokens": 1050000,
  "source": "https://developers.openai.com/api/docs/models/compare",
  "verifiedAt": "2026-09-06",
  "note": "Released 3 September 2026. Maximum output is 128K tokens.",
  "capability": {
    "metrics": { "intelligence": 53 },
    "indexVersion": "4.3",
    "variant": "max",
    "source": "https://artificialanalysis.ai/models/gpt-6-astra",
    "verifiedAt": "2026-09-09"
  }
}
```

- `id` is a lowercase slug (`a-z0-9` joined by hyphens) and is the join key plans
  and scenario anchors use.
- `input` and `output` are USD per 1M tokens and must be positive. `cached` may be
  `null` when the provider publishes no cached rate.
- `context` matches `128K` / `1M` / `1.05M`, and `contextTokens` must be its exact
  numeric form — validation compares them.
- `source` must be HTTPS. `verifiedAt` is ISO `YYYY-MM-DD` and cannot be in the
  future; the catalog's `updatedAt` cannot be earlier than any `verifiedAt` in it
  (the CLI advances `updatedAt` for you).
- `capability` is the block above or literal `null`. Metric keys: `intelligence`
  (the only one published per model today), `codingAgent`, `agentic`,
  `longContext`. `indexVersion` must equal the catalog's
  `capabilityIndex.version` for every model — this is the rule that forces a
  whole-catalog rebase.
- `rateBands` is an ascending, unique-thresholded array of
  `{ threshold, input, cached, output }`; the top-level rates are the default
  band. Only add one from an official page.

## Plan record — `data/plans.json`

Required: `id`, `provider`, `name`, `kind`, `monthly`, `source`, `note`, `quota`,
`evidence`, `confidence`, `apiIncluded`, `verifiedAt`, `modelIds`.
Optional: `access`, `cacheRatio`, `conditionalLimits`, `creditMultipliers`,
`includedApiValue`, `overageInput`, `overageOutput`, `quotaDetail`,
`weeklyCredits`.

```json
{
  "id": "chatgpt-go",
  "provider": "OpenAI",
  "name": "ChatGPT Go",
  "kind": "Subscription",
  "monthly": 8,
  "source": "https://learn.chatgpt.com/docs/pricing",
  "note": "Entry tier with roughly 10x Free limits. API usage billed separately.",
  "quota": "About 10x Free-tier messages, uploads, and image creation",
  "evidence": "Official relative limit",
  "confidence": "Medium",
  "apiIncluded": "No",
  "cacheRatio": 0.25,
  "verifiedAt": "2026-08-21",
  "modelIds": ["gpt-5-6-luna"],
  "access": ["chat-app"],
  "quotaDetail": {
    "kind": "relative-limit",
    "description": "About 10x Free-tier messages, uploads, and image creation",
    "source": "https://learn.chatgpt.com/docs/pricing",
    "verifiedAt": "2026-08-21"
  }
}
```

Enumerations:

- `kind`: `Subscription` | `BYOK client` | `Pay as you go`
- `evidence`: `Official quota` | `Official credit` | `Official relative limit` |
  `Price break-even`
- `confidence`: `High` | `Medium` | `Low`
- `access`: any of `api`, `chat-app`, `coding-client` — a hard filter in
  Recommend, so list every surface the plan actually exposes and no others
- `quotaDetail.kind`: `dollar-allowance` | `credit-allowance` | `request-limit` |
  `relative-limit` | `unknown`
- `resetWindow` (on `quotaDetail` and each `conditionalLimits` entry): `5h` |
  `weekly` | `monthly`

Joins and pairings validation enforces:

- every id in `modelIds` must exist in the model catalog, and the list must be
  nonempty with no duplicates;
- `creditMultipliers` needs an entry — `[input, cached, output]`, all
  nonnegative — for **every** id in `modelIds`, and requires `weeklyCredits`;
  `weeklyCredits` likewise requires `creditMultipliers`;
- `dollar-allowance`, `credit-allowance` and `request-limit` need `amount` and
  `resetWindow`; `relative-limit` and `unknown` need `description`;
- `monthly` may be `null` (a plan with no fixed price) but not negative.

`modelIds` should list every model the plan's own documentation says it includes.
The engine picks the cheapest one clearing each scenario's bar — so adding a
pricier model to a roster is safe and usually changes no board.

## Scenario record — `data/scenarios.json`

Document keys: `schemaVersion`, `metric`, `metricNote`, `profileNote`,
`tierCuts`, `ranking`, `scenarios`.

```json
{
  "id": "daily",
  "label": "Daily use",
  "input": 1500,
  "output": 700,
  "calls": 400,
  "cacheRatio": 0.2,
  "description": "Questions, summaries, planning, and everyday writing.",
  "rationale": "About thirteen short exchanges a day...",
  "planPriceCap": 30,
  "gate": {
    "metric": "intelligence",
    "minIndex": 27,
    "anchor": "gemini-3-1-pro",
    "rationale": "Everyday questions still need a model that will not confidently invent an answer."
  }
}
```

- `input`/`output` are positive integer token counts; `calls` is 1–100,000;
  `cacheRatio` is 0–0.95.
- `planPriceCap` is the board's price ceiling for that kind of work (currently
  $30 daily and easy coding, $100 medium coding and writing, $200 hard coding,
  research and innovation). It bounds the board only — Recommend uses the
  reader's own budget.
- `gate.anchor` must be a catalog model that itself clears `gate.minIndex` and
  carries a score for `gate.metric`. `gate.rationale` must explain why the bar
  sits where it does.
- `gate.preferredMetric` records the metric a scenario should switch to once
  Artificial Analysis publishes it per model.
- Coding bars must be monotone: harder coding cannot demand less than easier.
- Every scenario must admit **at least 3** models. A bar that admits fewer is
  treated as a data error, not a strict standard.
- `tierCuts` (currently `[0.2, 0.4, 0.6, 0.8]`) cuts the qualifying population
  into S/A/B/C/D by cost rank. `ranking` holds the weight sets for models, plans,
  and recommendations.

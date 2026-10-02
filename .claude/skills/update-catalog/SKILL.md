---
name: update-catalog
description: Update the TokenTier data catalog — add, reprice, or retire an API model, edit a plan or scenario, or rebase the scenario bars onto a new Artificial Analysis Intelligence Index version — then validate, test, and ship to GitHub Pages. Use for any change to data/api-models.json, data/plans.json, or data/scenarios.json.
---

# Update the TokenTier catalog

The site is a pure function of three data files. Everything the page shows —
model count, provider filters, tier letters, recommendations, price book, source
links, update date — is derived, so a catalog edit *is* a site update. There is
nothing to hand-edit in the UI.

| File | Holds | Edited by |
| --- | --- | --- |
| `data/api-models.json` | Token rates, context window, capability score, sources | `npm run models:update` CLI only |
| `data/plans.json` | Plan price, quota evidence, credit formulas, `modelIds` | By hand |
| `data/scenarios.json` | Token profiles, capability bars + anchors, price caps, tier cuts | By hand |

## The rule that governs everything here

**Every number is traceable to an official page.** A price or capability score
comes from the provider's own published page or from Artificial Analysis, and
carries its `source` URL and `verifiedAt` date. Third-party write-ups are not
sources, and a number nobody can point at does not go in — record the
uncertainty in `note`, or leave the model out.

How the page gets read is a tradeoff, not a rule. The conservative default is a
human reading it and pasting the number. Fetching the page, and deriving a
figure the provider does not publish directly, are both ordinary options — offer
them, say plainly what each costs in traceability, and let the user choose
rather than refusing on principle. Precedent: on a full re-verification pass the
numbers were fetched rather than transcribed, and DeepSeek V4 Pro's cached rate
is a time-weighted blend of the published peak and off-peak rates, chosen over
the published peak figure after the arithmetic was laid out.

**A derived number must announce itself.** `models:validate` checks shape, not
provenance, and will pass a fabricated figure silently. Any number that is not
read verbatim off the source states in its `note` that it is derived and how it
was computed — as the DeepSeek V4 Pro record does.

## Two kinds of pass

**A targeted change** — one model repriced, one plan edited — runs the routine
below for that record and stops.

**A refresh pass** keeps the whole catalog honest, and is what to run when the
user asks to "update the site" without naming a record. It starts from the data
rather than from memory: the records nobody has thought about are exactly the
ones that rot. Begin at step 0, work the stale list, and finish the routine once
for everything the pass touched.

### 0. Ask the data what is out of date

```bash
npm run models:validate
```

The closing **Freshness** block lists every dated record past 30 days, worst
first, as `age · kind · id (verifiedAt)`. Model prices, capability scores and
plan records are all counted separately, because they age independently — a
model repriced last week can still carry a capability score from two rebases ago.

Work that list top-down. For each record, open its `source` URL, read the page,
and either:

- **confirm it** — the number is unchanged: bump `verifiedAt` to today and say so;
  an unchanged number that was re-read is not a no-op, it is the evidence;
- **correct it** — write the new number with the same `verifiedAt` bump; or
- **retire it** — the product is gone (see retiring, below).

Re-verifying a record you did not change is the point of the pass, not wasted
work. `verifiedAt` is a claim about when a human last looked, and the site shows
it: rows that lag the catalog's own update date are marked *verified <date>* in
the price book, and the header's freshness dot goes amber on the oldest record,
not the newest file.

Before shipping, confirm the pass actually closed the gap:

```bash
npm run models:validate -- --max-age=30
```

That exits non-zero while anything is still past the threshold, and prints what.
Plain `models:validate` only reports, so an ageing catalog never blocks an
unrelated build.

### What a refresh pass covers

Walk these in order; the first is the only one the stale list surfaces on its own.

1. **Stale records** — the freshness block above.
2. **New models from providers already in the catalog.** Check each provider's
   pricing page for models released since the last pass. A provider lane that
   has not gained a model in months usually means nobody looked.
3. **Retired models.** A model still listed whose provider page no longer
   mentions it, or marks it legacy with a shutdown date, should go — repoint
   every plan `modelIds` that referenced it first.
4. **Plan entitlements, not just plan prices.** `modelIds` is the field that
   rots quietly: plans gain and lose model access without a price change, and a
   wrong roster silently changes which model a plan is judged on.
5. **Index drift.** If Artificial Analysis has published a new index version,
   that is a rebase (see below), not a per-model edit.
6. **The $10 plan floor** still holds for anything added.

## Routine

### 1. Establish what changed and from where

Ask the user for the source URL if they have not given one. Read the current
record before changing it:

```bash
node -e "console.log(JSON.stringify(require('./data/api-models.json').models.find(m=>m.id==='<id>'),null,2))"
```

### 2. Make the edit

**Models** go through the CLI — it holds a lock, writes atomically, and
re-validates the other two files before it commits, so a model edit can never
silently break a scenario anchor or a plan reference. Write one complete record
(or an array of them) to a scratch file, then:

```bash
npm run models:update -- add ./new-model.json --dry-run   # preview
npm run models:update -- add ./new-model.json             # apply
```

`add` refuses an id that already exists; `update` refuses one that does not.
A record must be **complete** — `update` replaces the whole record, it does not
merge fields, so start from the existing record and change what moved. Shapes and
required fields: `references/record-shapes.md`.

The CLI has no `remove`. Retiring a model is a hand edit of `data/api-models.json`
plus repointing every plan whose `modelIds` referenced it; validation catches the
dangling reference if you forget.

**Plans and scenarios** are hand edits. Bump the file's own `updatedAt` when you
touch `plans.json`.

### 3. Validate

```bash
npm run models:validate
```

Prints the model, plan and scenario counts, how many models clear each scenario
bar, and the freshness block. Read the bar block — a bar that suddenly admits far
more or far fewer models than before is the signal that something moved, even
when validation passes. After a refresh pass, re-run with `--max-age=30` and
expect it to pass.

### 4. Test and type-check

```bash
npm run lint && npx tsc --noEmit && npm test
```

The same three CI runs. `npm test` includes the acceptance and regression suites
and the server-rendered HTML of every route.

### 5. Document the change in the README

A catalog change that moves a board gets a dated `## Catalog changes, <Month D YYYY>`
section at the top of the existing run of them in `README.md`, in the established
house style: what changed, **why**, and what it did to the board — including when
the answer is "nothing moved". The existing sections are the template; match
their level of specificity. Skip this only for a change with no visible effect,
like a corrected typo in a `note`.

### 6. Ship

```bash
git add -A && git commit && git push
```

Deployment is push-to-`main`: `.github/workflows/deploy.yml` re-runs lint,
types, tests, validate, `npm run build:pages`, audits the artifact, and publishes
to `https://majinwakeup.github.io/TokenTier/`. Work on `develop` and merge to
`main` when the change is ready to be public. Commit and push only when asked.

## Rebasing onto a new Intelligence Index version

Artificial Analysis rebases periodically, and scores are **not comparable across
versions** — `models:validate` rejects a catalog that mixes them. A rebase is
therefore all-or-nothing:

1. Re-read **every** scored model at the same effort `variant` its record already
   cites. Same variant, or the score is not comparable either.
2. Set `capabilityIndex.version` on the catalog document, and `indexVersion` on
   every model's `capability` block, to the new version.
3. **Re-derive each scenario bar from its anchor, preserving the gap.** Read the
   anchor model's new score; move `gate.minIndex` by the same amount the anchor
   moved. This is what the `anchor` field exists for. Do not hold the old numbers
   — on the v4.2 rebase that would have emptied the frontier scenarios — and do
   not hand-pick new ones.
4. Re-validate, and report what moved: which models changed tier, which plans
   changed working model, whether any lane lost its only plan with proven
   capacity. The README's v4.2 and v4.3 sections show the expected reporting.

A model with no published score gets `"capability": null` — a deliberate third
state meaning *listed and priced but not independently scored*. Never guess a
score to fill the gap.

## Judgment calls with standing precedents

These recur, and the project has already decided them. Follow the precedent
unless the user overrides it.

- **Subscriptions under $10 a month stay out.** The floor is *exclusive*: $10
  itself is kept, and it does not reach `monthly: null` pay-as-you-go entries.
  Every plan it removed metered access by a relative limit that converts to no
  call count, so each sorted to the top of a price-ordered board while unable to
  show it covered any of the workload. Check a new plan's price against the
  floor before writing the record, and say so rather than adding it and waiting
  to be told. It removed ChatGPT Go at $8, Google AI Plus at $9.99 (a
  `confidence: High` record) and Meta One Core at $7.99; OpenCode Go and
  SuperGrok Lite at exactly $10 were deliberately kept.
- **A temporary or introductory price** is not the headline number. The standard
  rate goes in `input`/`cached`/`output`; the discount goes in `note` with its
  end date. A promotion must never move a model up the board.
- **A price that depends on endpoint or tier** records one rate — the one the
  record's `note` names — and puts the alternatives in the `note`. Precedents:
  Qwen3.8-Max (International rate; five other endpoints cheaper), Muse Spark 1.3
  (standard tier, not the training-for-discount contributor tier).
- **An unconfirmed surcharge or rate band** stays out of the numbers. GPT-6
  Astra's reported large-prompt surcharge is in a `note` because it is not in
  OpenAI's own docs; it becomes `rateBands` only when an official page confirms it.
- **A quota that does not convert to a monthly call count** is honest about it.
  `evidence: "Official relative limit"` with `quotaDetail.kind: "relative-limit"`
  makes the card read *unproven* rather than inventing a number. A cap on a 5-hour
  or weekly window is `capped`. Both are correct outcomes, not failures.
- **Credit multipliers are per model and published.** A plan metering in credits
  needs `creditMultipliers` for every id in `modelIds`; borrowing another plan's
  formula overstated OpenCode Go by ~20x and GLM Coding by ~8x. A test now
  rejects any plan implying more than 25x its price in metered usage — if that
  test fires, the formula is wrong, not the threshold.
- **Tiers are never hand-graded.** S/A/B/C/D come from curving the qualifying
  population at `tierCuts`. If a board looks wrong, fix the input data or the
  bar, never the letter.

## Recovery

A force-terminated updater leaves `data/api-models.json.lock`. Confirm no updater
is running, delete it, retry:

```bash
ls data/api-models.json.lock && rm data/api-models.json.lock
```

`tsconfig.json` excludes `.next` deliberately — both build targets write route
types there with incompatible shapes. Do not remove the exclude to "fix" a
`tsc --noEmit` failure on generated code.

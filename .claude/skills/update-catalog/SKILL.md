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

**Never scrape, infer, or estimate a number.** Every price and every capability
score is read by a human from the provider's own published page or from
Artificial Analysis, and pasted in with its `source` URL and `verifiedAt` date.
If a number cannot be confirmed from an official page, the change does not go in
— record the uncertainty in `note` instead, or leave the model out. Third-party
write-ups are not sources. See "Judgment calls" below for the standing
precedents.

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

Prints the model, plan, and scenario counts and how many models clear each
scenario bar. Read that last block — a bar that suddenly admits far more or far
fewer models than before is the signal that something moved, even when validation
passes.

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

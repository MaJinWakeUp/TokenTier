import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  eligibleModels,
  mergeModels,
  updateCatalog,
  validateDataset,
  validateModel,
  validatePlans,
  validateScenarios,
} from "../scripts/update-models.mjs";

function localDateOffset(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const yesterday = localDateOffset(-1);
const today = localDateOffset(0);
const tomorrow = localDateOffset(1);

function capability(overrides = {}) {
  return {
    metrics: { intelligence: 60 },
    indexVersion: "4.1.1",
    source: "https://artificialanalysis.ai/models/example-model",
    verifiedAt: today,
    ...overrides,
  };
}

function model(overrides = {}) {
  return {
    id: "example-model",
    provider: "Example AI",
    name: "Example Model",
    input: 1,
    cached: 0.1,
    output: 5,
    context: "128K",
    source: "https://example.com/pricing",
    verifiedAt: today,
    note: "Official list price.",
    capability: capability(),
    ...overrides,
  };
}

function dataset(models = [model()], overrides = {}) {
  return {
    schemaVersion: 2,
    updatedAt: today,
    currency: "USD",
    unit: "per-million-tokens",
    capabilityIndex: {
      name: "Artificial Analysis Intelligence Index",
      version: "4.1.1",
      scale: "0-100 composite of nine published evaluations",
      source: "https://artificialanalysis.ai/",
      attribution: "Published by Artificial Analysis and reproduced with attribution.",
    },
    models,
    ...overrides,
  };
}

function scenario(overrides = {}) {
  return {
    id: "code-medium",
    label: "Medium coding",
    input: 25000,
    output: 3500,
    calls: 900,
    cacheRatio: 0.6,
    description: "Feature development.",
    rationale: "A feature spanning several files at about thirty agent turns a day.",
    gate: {
      metric: "intelligence",
      minIndex: 50,
      anchor: "example-model",
      rationale: "The weakest model we would ship a feature with.",
    },
    ...overrides,
  };
}

function scenarioDocument(scenarios = [scenario()], overrides = {}) {
  return {
    schemaVersion: 2,
    metric: "intelligence",
    metricNote: "Sub-index values are not published per model yet.",
    profileNote: "Each profile is a typical month of one kind of work.",
    tierCuts: [0.15, 0.5, 0.85],
    ranking: {
      models: { cost: 0.65, headroom: 0.35 },
      plans: { price: 0.5, headroom: 0.3, confidence: 0.2 },
      recommendation: { capability: 0.48, budget: 0.22, coverage: 0.2, confidence: 0.1 },
    },
    scenarios,
    ...overrides,
  };
}

function plan(overrides = {}) {
  return {
    id: "example-plan",
    provider: "Example AI",
    name: "Example Plan",
    kind: "Subscription",
    monthly: 20,
    modelIds: ["example-model"],
    source: "https://example.com/plans",
    note: "Consumer subscription.",
    quota: "Published rolling limit",
    evidence: "Official relative limit",
    confidence: "Medium",
    apiIncluded: "No",
    verifiedAt: today,
    ...overrides,
  };
}

function planDocument(plans = [plan()], overrides = {}) {
  return {
    schemaVersion: 1,
    updatedAt: today,
    currency: "USD",
    plans,
    ...overrides,
  };
}

// Three models clearing the bar is the minimum a scenario may admit.
function gatedDataset(minIndexClearing = 3) {
  const models = Array.from({ length: minIndexClearing }, (unused, index) => model({
    id: `example-model-${index}`,
    name: `Example Model ${index}`,
    input: index + 1,
  }));
  models[0].id = "example-model";
  models[0].name = "Example Model";
  return dataset(models);
}

async function temporaryFiles(catalog, input, companions = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tokentier-models-"));
  const catalogPath = path.join(directory, "api-models.json");
  const inputPath = path.join(directory, "input.json");
  const writes = [
    writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`),
    writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`),
  ];
  // The updater looks for these beside the catalog, as they sit in `data/`.
  for (const [name, document] of Object.entries(companions)) {
    writes.push(writeFile(path.join(directory, `${name}.json`), `${JSON.stringify(document, null, 2)}\n`));
  }
  await Promise.all(writes);
  return { catalogPath, directory, inputPath };
}

test("validates the complete catalog schema", () => {
  const catalog = dataset();
  assert.equal(validateDataset(catalog), catalog);
  assert.equal(validateModel(catalog.models[0]), catalog.models[0]);
});

test("rejects malformed model data and malformed capability blocks", () => {
  const invalid = model({
    input: -1,
    source: "http://example.com/pricing",
    verifiedAt: "2026-02-30",
    capability: { metrics: { vibes: 500 }, indexVersion: "four", source: "ftp://x", verifiedAt: "nope", typo: 1 },
    typo: true,
  });
  assert.throws(
    () => validateModel(invalid),
    (error) => {
      assert.match(error.message, /unknown keys: typo/);
      assert.match(error.message, /input must be a positive finite number/);
      assert.match(error.message, /valid HTTPS URL/);
      assert.match(error.message, /ISO date/);
      assert.match(error.message, /capability\.metrics has unknown metric: vibes/);
      assert.match(error.message, /capability\.metrics\.vibes must be a finite number/);
      assert.match(error.message, /capability\.indexVersion must look like/);
      return true;
    },
  );
});

test("accepts an unscored model as a deliberate third state", () => {
  const unscored = model({ capability: null });
  assert.equal(validateModel(unscored), unscored);
  const catalog = dataset([unscored]);
  assert.equal(validateDataset(catalog), catalog);
});

test("rejects model and catalog dates later than the current local date", () => {
  assert.throws(
    () => validateModel(model({ verifiedAt: tomorrow })),
    /verifiedAt cannot be later than the current local date/,
  );
  assert.throws(
    () => validateDataset(dataset(undefined, { updatedAt: tomorrow })),
    /updatedAt cannot be later than the current local date/,
  );
});

test("rejects duplicate identities", () => {
  const first = model();
  const duplicate = model({ id: "example-model-two" });
  assert.throws(() => validateDataset(dataset([first, duplicate])), /Duplicate provider\/model name/);
});

test("rejects scores read under a different index version", () => {
  const stale = model({ capability: capability({ indexVersion: "4.0" }) });
  assert.throws(
    () => validateDataset(dataset([stale])),
    /was scored under index version 4\.0.*capabilityIndex\.version is 4\.1\.1/s,
  );
});

test("adds models at the end and updates models in place", () => {
  const original = model({ verifiedAt: yesterday, capability: capability({ verifiedAt: yesterday }) });
  const added = model({
    id: "new-model",
    name: "New Model",
    verifiedAt: today,
  });
  const afterAdd = mergeModels(
    dataset([original], { updatedAt: yesterday }),
    added,
    "add",
  );
  assert.deepEqual(afterAdd.models.map((item) => item.id), ["example-model", "new-model"]);
  assert.equal(afterAdd.updatedAt, today);

  const replacement = model({ name: "Example Model Revised", output: 6 });
  const afterUpdate = mergeModels(afterAdd, replacement, "update");
  assert.deepEqual(afterUpdate.models.map((item) => item.id), ["example-model", "new-model"]);
  assert.equal(afterUpdate.models[0].name, "Example Model Revised");
  assert.equal(afterUpdate.models[0].output, 6);
});

test("requires explicit add or update semantics", () => {
  const catalog = dataset();
  assert.throws(
    () => mergeModels(catalog, model(), "add"),
    /Cannot add existing model id/,
  );
  assert.throws(
    () => mergeModels(catalog, model({ id: "missing-model", name: "Missing Model" }), "update"),
    /Cannot update unknown model id/,
  );
});

test("dry-run validates the result without changing the catalog", async (t) => {
  const incoming = model({ id: "new-model", name: "New Model" });
  const files = await temporaryFiles(dataset(), incoming);
  t.after(() => rm(files.directory, { recursive: true, force: true }));
  const before = await readFile(files.catalogPath, "utf8");

  const result = await updateCatalog({
    mode: "add",
    inputPath: files.inputPath,
    catalogPath: files.catalogPath,
    dryRun: true,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.dataset.models.length, 2);
  assert.equal(await readFile(files.catalogPath, "utf8"), before);
});

test("writes a validated catalog atomically", async (t) => {
  const incoming = model({ id: "new-model", name: "New Model" });
  const files = await temporaryFiles(dataset(), incoming);
  t.after(() => rm(files.directory, { recursive: true, force: true }));

  const result = await updateCatalog({
    mode: "add",
    inputPath: files.inputPath,
    catalogPath: files.catalogPath,
  });
  const written = JSON.parse(await readFile(files.catalogPath, "utf8"));

  assert.equal(result.dryRun, false);
  assert.deepEqual(written, result.dataset);
  assert.deepEqual(written.models.map((item) => item.id), ["example-model", "new-model"]);
  await assert.rejects(access(`${files.catalogPath}.lock`), { code: "ENOENT" });
});

test("an active lock blocks a concurrent write without being removed", async (t) => {
  const incoming = model({ id: "new-model", name: "New Model" });
  const files = await temporaryFiles(dataset(), incoming);
  const lockPath = `${files.catalogPath}.lock`;
  t.after(() => rm(files.directory, { recursive: true, force: true }));
  await writeFile(lockPath, "another-process\n", { flag: "wx" });
  const before = await readFile(files.catalogPath, "utf8");

  await assert.rejects(
    updateCatalog({
      mode: "add",
      inputPath: files.inputPath,
      catalogPath: files.catalogPath,
    }),
    /locked by another update/,
  );

  assert.equal(await readFile(files.catalogPath, "utf8"), before);
  assert.equal(await readFile(lockPath, "utf8"), "another-process\n");
});

test("releases its lock when validation fails", async (t) => {
  const invalid = model({ input: -1 });
  const files = await temporaryFiles(dataset(), invalid);
  const lockPath = `${files.catalogPath}.lock`;
  t.after(() => rm(files.directory, { recursive: true, force: true }));

  await assert.rejects(
    updateCatalog({
      mode: "add",
      inputPath: files.inputPath,
      catalogPath: files.catalogPath,
    }),
    /positive finite number/,
  );
  await assert.rejects(access(lockPath), { code: "ENOENT" });
});

test("validates the scenario document and counts qualifying models", () => {
  const catalog = gatedDataset();
  const scenarios = scenarioDocument();
  assert.equal(validateScenarios(scenarios, catalog), scenarios);
  assert.equal(eligibleModels(catalog, scenarios.scenarios[0]).length, 3);
});

test("requires an anchor that exists and clears its own threshold", () => {
  const catalog = gatedDataset();
  assert.throws(
    () => validateScenarios(scenarioDocument([scenario({ gate: { ...scenario().gate, anchor: "ghost-model" } })]), catalog),
    /anchor must be a model id present in the catalog/,
  );
  assert.throws(
    () => validateScenarios(scenarioDocument([scenario({ gate: { ...scenario().gate, minIndex: 99 } })]), catalog),
    /scores 60, below its own threshold of 99/,
  );
});

test("rejects a gate that admits almost nothing", () => {
  const catalog = dataset([model(), model({ id: "second-model", name: "Second Model" })]);
  assert.throws(
    () => validateScenarios(scenarioDocument(), catalog),
    /admits only 2 model\(s\) at index >= 50; at least 3 are required/,
  );
});

test("rejects a coding ladder that asks less of harder work", () => {
  const catalog = gatedDataset();
  const ladder = [
    scenario({ id: "code-easy", label: "Easy coding", gate: { ...scenario().gate, minIndex: 55 } }),
    scenario({ id: "code-medium", label: "Medium coding", gate: { ...scenario().gate, minIndex: 50 } }),
  ];
  assert.throws(
    () => validateScenarios(scenarioDocument(ladder), catalog),
    /code-medium sets a lower bar \(50\) than code-easy \(55\)/,
  );
});

test("rejects an unusable call count or cache share", () => {
  const catalog = gatedDataset();
  assert.throws(
    () => validateScenarios(scenarioDocument([scenario({ calls: 0 })]), catalog),
    /calls must be a positive integer/,
  );
  assert.throws(
    () => validateScenarios(scenarioDocument([scenario({ cacheRatio: 1 })]), catalog),
    /cacheRatio must be a fraction between 0 and 0\.95/,
  );
});

test("rejects malformed tier cuts and ranking weights", () => {
  const catalog = gatedDataset();
  assert.throws(
    () => validateScenarios(scenarioDocument(undefined, { tierCuts: [0.5, 0.2, 0.9] }), catalog),
    /tierCuts must be strictly increasing fractions/,
  );
  assert.throws(
    () => validateScenarios(
      scenarioDocument(undefined, {
        ranking: { models: { cost: 0.9, headroom: 0.9 }, plans: { price: 0.5, headroom: 0.3, confidence: 0.2 } },
      }),
      catalog,
    ),
    /ranking\.models weights must be finite and sum to 1/,
  );
});

test("validates plans and rejects a reference to a model that is not listed", () => {
  const catalog = gatedDataset();
  const plans = planDocument();
  assert.equal(validatePlans(plans, catalog), plans);

  assert.throws(
    () => validatePlans(planDocument([plan({ modelIds: ["retired-model"] })]), catalog),
    /modelIds contains "retired-model", which is not in the model catalog/,
  );
  assert.throws(
    () => validatePlans(planDocument([plan({ modelIds: [] })]), catalog),
    /modelIds must be a nonempty array/,
  );
  assert.throws(
    () => validatePlans(planDocument([plan({ modelIds: ["example-model", "example-model"] })]), catalog),
    /modelIds contains duplicates/,
  );
});

test("requires credit multipliers for every model a credit plan offers", () => {
  const catalog = gatedDataset();
  const twoModels = ["example-model", "example-model-1"];
  assert.throws(
    () => validatePlans(
      planDocument([plan({
        modelIds: twoModels,
        weeklyCredits: 10000,
        creditMultipliers: { "example-model": [6.9, 1.7, 24] },
      })]),
      catalog,
    ),
    /creditMultipliers is missing multipliers for example-model-1/,
  );
  assert.throws(
    () => validatePlans(
      planDocument([plan({
        modelIds: ["example-model"],
        weeklyCredits: 10000,
        creditMultipliers: { "not-on-plan": [1, 1, 1] },
      })]),
      catalog,
    ),
    /creditMultipliers has "not-on-plan", which the plan does not offer/,
  );
});

test("rejects half-specified credit formulas and unknown plan enums", () => {
  const catalog = gatedDataset();
  assert.throws(
    () => validatePlans(planDocument([plan({ weeklyCredits: 20000 })]), catalog),
    /weeklyCredits requires creditMultipliers/,
  );
  assert.throws(
    () => validatePlans(planDocument([plan({ creditMultipliers: { "example-model": [1, 0.2, 3] } })]), catalog),
    /creditMultipliers requires weeklyCredits/,
  );
  assert.throws(
    () => validatePlans(planDocument([plan({ evidence: "Vibes", confidence: "Certain" })]), catalog),
    /evidence must be one of/,
  );
});

test("keeps the shipped data files mutually consistent", async () => {
  const [catalogSource, scenarioSource, planSource] = await Promise.all([
    readFile(new URL("../data/api-models.json", import.meta.url), "utf8"),
    readFile(new URL("../data/scenarios.json", import.meta.url), "utf8"),
    readFile(new URL("../data/plans.json", import.meta.url), "utf8"),
  ]);
  const catalog = JSON.parse(catalogSource);
  const scenarios = JSON.parse(scenarioSource);
  const plans = JSON.parse(planSource);

  validateDataset(catalog);
  validateScenarios(scenarios, catalog);
  validatePlans(plans, catalog);

  // The gate has to actually discriminate: no scenario may admit everything.
  for (const item of scenarios.scenarios) {
    const qualifying = eligibleModels(catalog, item).length;
    assert.ok(
      qualifying >= 3 && qualifying < catalog.models.length,
      `${item.id} admits ${qualifying} of ${catalog.models.length} models`,
    );
  }
});

// Regression guard for the credit-unit class of bug: a mis-scaled multiplier or
// divisor silently inflates a plan's apparent capacity by orders of magnitude,
// and the number still looks like a number. No provider gives away 25x its
// subscription price in metered usage.
test("no plan claims implausible leverage over its own price", async () => {
  const [catalogSource, scenarioSource, planSource] = await Promise.all([
    readFile(new URL("../data/api-models.json", import.meta.url), "utf8"),
    readFile(new URL("../data/scenarios.json", import.meta.url), "utf8"),
    readFile(new URL("../data/plans.json", import.meta.url), "utf8"),
  ]);
  const models = new Map(JSON.parse(catalogSource).models.map((model) => [model.id, model]));
  const { scenarios } = JSON.parse(scenarioSource);
  const { plans } = JSON.parse(planSource);
  const maxLeverage = 25;

  const contextTokens = (context) => {
    const normalized = context.trim().toUpperCase();
    if (normalized.endsWith("M")) return parseFloat(normalized) * 1_000_000;
    if (normalized.endsWith("K")) return parseFloat(normalized) * 1_000;
    return parseFloat(normalized) || 0;
  };

  for (const scenario of scenarios) {
    const { input, output, cacheRatio: profileCache } = scenario;
    for (const plan of plans) {
      const cacheRatio = plan.cacheRatio ?? profileCache;
      const perCall = (model) => (
        input * (1 - cacheRatio) * model.input
        + input * cacheRatio * (model.cached ?? model.input)
        + output * model.output
      ) / 1_000_000;

      // Same rule as the site: cheapest model on the plan that clears the bar.
      const model = plan.modelIds
        .map((id) => models.get(id))
        .filter((candidate) => {
          const index = candidate.capability?.metrics?.[scenario.gate.metric];
          return typeof index === "number"
            && index >= scenario.gate.minIndex
            && contextTokens(candidate.context) >= input + output
            && (!plan.weeklyCredits || Boolean(plan.creditMultipliers?.[candidate.id]));
        })
        .sort((a, b) => perCall(a) - perCall(b))[0];
      if (!model) continue;

      let calls = null;
      if (plan.weeklyCredits && plan.creditMultipliers?.[model.id]) {
        const [im, cm, om] = plan.creditMultipliers[model.id];
        const perCallCredits = (input * (1 - cacheRatio) * im + input * cacheRatio * cm + output * om) / 10_000;
        calls = (plan.weeklyCredits * 4.33) / perCallCredits;
      } else if (plan.includedApiValue !== undefined) {
        calls = plan.includedApiValue / perCall(model);
      }
      if (calls === null || !plan.monthly) continue;

      // The upper end of the published range is what the site actually shows.
      const impliedValue = calls * 2 * perCall(model);
      const leverage = impliedValue / plan.monthly;
      assert.ok(
        leverage <= maxLeverage,
        `${plan.id} implies $${impliedValue.toFixed(0)} of ${scenario.id} usage on a `
        + `$${plan.monthly} plan via ${model.id} (${leverage.toFixed(0)}x). `
        + "Re-check the credit unit or dollar cap.",
      );
    }
  }
});

// A model edit can invalidate a scenario anchor or a plan reference, so the
// updater has to check the whole set before it writes anything. Otherwise a bad
// record lands on disk and only the next prebuild notices.
test("refuses a model update that breaks a scenario anchor", async (t) => {
  const catalog = gatedDataset();
  const demoted = model({ capability: capability({ metrics: { intelligence: 40 } }) });
  const files = await temporaryFiles(catalog, demoted, {
    scenarios: scenarioDocument(),
    plans: planDocument(),
  });
  t.after(() => rm(files.directory, { recursive: true, force: true }));
  const before = await readFile(files.catalogPath, "utf8");

  // A dry run must fail for the same reason a real write would.
  await assert.rejects(
    updateCatalog({
      mode: "update",
      inputPath: files.inputPath,
      catalogPath: files.catalogPath,
      dryRun: true,
    }),
    /anchor example-model scores 40, below its own threshold of 50/,
  );

  await assert.rejects(
    updateCatalog({
      mode: "update",
      inputPath: files.inputPath,
      catalogPath: files.catalogPath,
    }),
    /anchor example-model scores 40, below its own threshold of 50/,
  );

  assert.equal(await readFile(files.catalogPath, "utf8"), before, "leaves the catalog untouched");
  await assert.rejects(access(`${files.catalogPath}.lock`), { code: "ENOENT" });
});

// mergeModels only adds or replaces by id, so it cannot strand a plan reference
// on its own. It can still be asked to write on top of a data directory that is
// already inconsistent, and it should refuse rather than compound the problem.
test("refuses to write over an already broken plan catalog", async (t) => {
  const catalog = gatedDataset();
  const added = model({ id: "brand-new-model", name: "Brand New Model" });
  const files = await temporaryFiles(catalog, added, {
    scenarios: scenarioDocument(),
    plans: planDocument([plan({ modelIds: ["ghost-model"] })]),
  });
  t.after(() => rm(files.directory, { recursive: true, force: true }));
  const before = await readFile(files.catalogPath, "utf8");

  await assert.rejects(
    updateCatalog({
      mode: "add",
      inputPath: files.inputPath,
      catalogPath: files.catalogPath,
    }),
    /modelIds contains "ghost-model", which is not in the model catalog/,
  );

  assert.equal(await readFile(files.catalogPath, "utf8"), before, "leaves the catalog untouched");
  await assert.rejects(access(`${files.catalogPath}.lock`), { code: "ENOENT" });
});

test("still updates when the companion files are absent", async (t) => {
  const files = await temporaryFiles(dataset(), model({ id: "new-model", name: "New Model" }));
  t.after(() => rm(files.directory, { recursive: true, force: true }));

  const result = await updateCatalog({
    mode: "add",
    inputPath: files.inputPath,
    catalogPath: files.catalogPath,
  });
  assert.deepEqual(result.dataset.models.map((item) => item.id), ["example-model", "new-model"]);
});

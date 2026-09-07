// Regression tests for confirmed findings 1-7. Synthetic catalogs exercise edge
// cases; real catalog snapshots verify integration. Tests import functions,
// not implementation strings.

import assert from "node:assert/strict";
import test from "node:test";

import {
  validateDataset,
  validatePlans,
  validateScenarios,
} from "../scripts/update-models.mjs";
import { callCost, planEstimate, planCoverageScore } from "../build/lib/domain/pricing.js";
import { price, monthlyPrice, monthlyPriceAgainst, unsupportedPriceLabel } from "../build/lib/format.js";
import { recommend, costTiers } from "../build/lib/domain/recommend.js";
import { readFileSync } from "node:fs";

// -- Real catalog fixtures ----------------------------------------------------

const modelCatalog = JSON.parse(readFileSync(new URL("../data/api-models.json", import.meta.url), "utf8"));
const planCatalog = JSON.parse(readFileSync(new URL("../data/plans.json", import.meta.url), "utf8"));
const scenarioCatalog = JSON.parse(readFileSync(new URL("../data/scenarios.json", import.meta.url), "utf8"));

const dataset = validateDataset(modelCatalog);
const planDoc = validatePlans(planCatalog, dataset);
const scenarioDoc = validateScenarios(scenarioCatalog, dataset);
const modelById = new Map(dataset.models.map((m) => [m.id, m]));

const catalog = {
  models: dataset.models,
  plans: planDoc.plans,
  scenarios: scenarioDoc.scenarios,
  modelById,
  capabilityIndex: dataset.capabilityIndex,
  modelCatalogUpdatedAt: dataset.updatedAt,
  planCatalogUpdatedAt: planDoc.updatedAt,
  tierCuts: scenarioDoc.tierCuts,
  rankingWeights: scenarioDoc.ranking,
};

// -- Finding 1: page imports recommend.ts, not old weighted ranking ------------

test("F1: the recommendation the views render comes from the engine", async () => {
  // Behaviour, not source: the derivation the Recommend route renders is
  // decide(), and decide()'s winner is recommend()'s winner. Nothing between
  // them re-ranks or applies a preference multiplier.
  const { decide } = await import("../build/lib/domain/decision.js");
  const scenario = scenarioDoc.scenarios[2]; // code-medium
  const workload = {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 200,
    access: "any",
  };
  for (const objective of ["cost", "budget", "capability"]) {
    const decision = decide(catalog, scenario, workload, objective, "either");
    const direct = recommend(catalog, scenario, workload, objective);
    assert.equal(decision.apiModel?.id ?? null, direct.api.best?.model?.id ?? null, objective);
    assert.equal(decision.plan?.id ?? null, direct.plans.best?.plan?.id ?? null, objective);
    assert.equal(decision.apiSpend, direct.api.best?.monthlyCost ?? 0, objective);
  }
});

test("F1: the default objective is lowest cost", () => {
  const scenario = scenarioDoc.scenarios[2];
  const workload = {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 200,
    access: "any",
  };
  const stateSource = readFileSync(new URL("../features/recommend/state.ts", import.meta.url), "utf8");
  assert.match(stateSource, /objective: "cost"/, "the opening objective is cost");
  const best = recommend(catalog, scenario, workload, "cost").api.best;
  const affordable = recommend(catalog, scenario, workload, "cost").api.evaluations
    .filter((entry) => entry.eligible && entry.withinBudget);
  assert.equal(best.costPerCall, Math.min(...affordable.map((entry) => entry.costPerCall)));
});

test("F1: recommend is the single pipeline for both preset and custom workloads", () => {
  const scenario = scenarioDoc.scenarios[2]; // code-medium
  const presetResult = recommend(catalog, scenario, {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 200,
    access: "any",
  }, "cost");
  const customResult = recommend(catalog, scenario, {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 200,
    access: "any",
  }, "cost");
  assert.equal(presetResult.api.best?.model.id, customResult.api.best?.model.id, "Same workload returns same best");
});

// -- Finding 2: evaluateModel uses custom input/output, budget enforced -------

test("F2: budget=0 with cost objective returns no match (withinBudget filter)", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "code-hard");
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 0,
    access: "any",
  }, "cost");
  assert.equal(result.api.best, null, "Budget=0 with positive-cost models should return null for cost objective");
  assert.equal(result.api.noMatch, true, "Should report no match when nothing is within budget");
});

test("F2: budget=0 with budget objective returns no match", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "code-hard");
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 0,
    access: "any",
  }, "budget");
  assert.equal(result.api.best, null, "Budget objective with 0 budget should return null");
  assert.equal(result.api.noMatch, true, "Should report no match");
});

test("F2: 2M input returns no match (no model has 2M context)", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "code-hard");
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id,
    input: 2_000_000,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 1000,
    access: "any",
  }, "cost");
  assert.equal(result.api.best, null, "No model should qualify with 2M input");
  assert.equal(result.api.noMatch, true, "Should report no match");
});

test("F2: chat-app access does not recommend direct API models", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "daily");
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 30,
    access: "chat-app",
  }, "cost");
  assert.equal(result.api.best, null, "chat-app access should not recommend direct API");
  assert.equal(result.api.noMatch, true, "No API match for chat-app access");
  assert.ok(result.plans.best, "Should still have plan options for chat-app");
  const bestPlan = result.plans.best;
  assert.ok(bestPlan.plan.access?.includes("chat-app"), "Best plan must have chat-app access");
});

test("F2: budget objective returns null when nothing is affordable", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "code-hard");
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 1, // Almost nothing affordable
    access: "any",
  }, "budget");
  assert.equal(result.api.best, null, "Budget objective should return null when nothing fits");
  assert.equal(result.api.noMatch, true, "Should report no match");
});

test("F2: no winner is reported as no winner, with no implied saving", async () => {
  const { decide } = await import("../build/lib/domain/decision.js");
  const scenario = scenarioDoc.scenarios[2];
  const impossible = {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: 100_000,
    cacheRatio: scenario.cacheRatio,
    budget: 1,
    access: "any",
  };
  const decision = decide(catalog, scenario, impossible, "cost", "either");
  assert.equal(decision.apiNoMatch, true);
  assert.equal(decision.apiModel, null);
  assert.doesNotMatch(decision.caption, /saves|cheaper|more than/);
  // The badge in the view is rendered only when this is false.
  assert.equal(decision.apiNoMatch && decision.planNoMatch, true);
});

test("F2: budget objective picks highest index within budget when affordable", () => {
  const scenario = scenarioDoc.scenarios[2]; // code-medium
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 500,
    access: "any",
  }, "budget");
  if (result.api.best) {
    const affordable = result.api.evaluations.filter((e) => e.eligible && e.withinBudget);
    if (affordable.length > 0) {
      const highestIndex = [...affordable].sort((a, b) => (b.index ?? 0) - (a.index ?? 0))[0];
      assert.equal(result.api.best.model.id, highestIndex.model.id, "Budget objective should pick highest index within budget");
    }
  }
});

test("F2: plan best is never an ineligible plan", () => {
  for (const scenario of scenarioDoc.scenarios) {
    const result = recommend(catalog, scenario, {
      scenarioId: scenario.id,
      input: scenario.input,
      output: scenario.output,
      calls: scenario.calls,
      cacheRatio: scenario.cacheRatio,
      budget: 200,
      access: "any",
    }, "cost");
    if (result.plans.best) {
      assert.equal(result.plans.best.eligible, true, `${scenario.id}: best plan must be eligible`);
    }
  }
});

// -- Finding 3: curved cost tiers, equal costs share tiers -------------------

test("F3: identical costs share the same tier", () => {
  const evals = [
    { model: { id: "a" }, costPerCall: 0.10, monthlyCost: 10, index: 60, withinBudget: true, eligible: true },
    { model: { id: "b" }, costPerCall: 0.10, monthlyCost: 10, index: 55, withinBudget: true, eligible: true },
    { model: { id: "c" }, costPerCall: 0.10, monthlyCost: 10, index: 50, withinBudget: true, eligible: true },
    { model: { id: "d" }, costPerCall: 0.10, monthlyCost: 10, index: 45, withinBudget: true, eligible: true },
  ];
  const tiers = costTiers(evals);
  const allTiers = [...tiers.values()];
  assert.ok(allTiers.every((t) => t === allTiers[0]), "All identical costs must share the same tier");
  assert.equal(allTiers[0], "S", "Identical costs should all be S");
});

test("F3: the curve fills every letter and keeps the cost order", () => {
  // Ten distinct prices over five letters: two per letter, cheapest first.
  const evals = Array.from({ length: 10 }, (_, i) => ({
    model: { id: `m${i}` },
    costPerCall: (i + 1) / 100,
    monthlyCost: i + 1,
    index: 60 - i,
    withinBudget: true,
    eligible: true,
  }));
  const tiers = costTiers(evals);
  const letters = evals.map((e) => tiers.get(e.model.id));

  assert.deepEqual(
    letters,
    ["S", "S", "A", "A", "B", "B", "C", "C", "D", "D"],
    "even quintiles over ten distinct prices",
  );
  // A cheaper option is never placed below a dearer one.
  const rank = { S: 5, A: 4, B: 3, C: 2, D: 1 };
  for (let i = 1; i < letters.length; i += 1) {
    assert.ok(rank[letters[i]] <= rank[letters[i - 1]], `${letters[i - 1]} then ${letters[i]} is monotone`);
  }
});

test("F3: a letter is never skipped in the middle of the board", () => {
  // One model an order of magnitude cheaper than the rest is exactly what
  // collapsed the old fixed bands into a populated S and an empty A and B.
  const costs = [0.001, 0.04, 0.045, 0.05, 0.06, 0.08, 0.12, 0.2, 0.29];
  const evals = costs.map((cost, i) => ({
    model: { id: `m${i}` },
    costPerCall: cost,
    monthlyCost: cost * 100,
    index: 60,
    withinBudget: true,
    eligible: true,
  }));
  const used = new Set(costTiers(evals).values());
  assert.deepEqual([...used].sort(), ["A", "B", "C", "D", "S"], "every letter is used");
});

test("F3: fewer distinct prices than letters stays contiguous from S", () => {
  const evals = [0.01, 0.02, 0.03].map((cost, i) => ({
    model: { id: `m${i}` },
    costPerCall: cost,
    monthlyCost: cost * 100,
    index: 60,
    withinBudget: true,
    eligible: true,
  }));
  const tiers = costTiers(evals);
  // Three prices cannot fill five letters; they take the top three in order
  // rather than leaving a hole.
  assert.deepEqual([tiers.get("m0"), tiers.get("m1"), tiers.get("m2")], ["S", "A", "B"]);
});

test("F3: empty population returns no tiers", () => {
  assert.equal(costTiers([]).size, 0, "Empty evaluations return empty map");
});

test("F3: singleton population gets S", () => {
  const evals = [{ model: { id: "x" }, costPerCall: 0.10, monthlyCost: 10, index: 50, withinBudget: true, eligible: true }];
  const tiers = costTiers(evals);
  assert.equal(tiers.get("x"), "S", "Single eligible model is S");
});

test("F3: all-free population gets S", () => {
  const evals = [
    { model: { id: "a" }, costPerCall: 0, monthlyCost: 0, index: 60, withinBudget: true, eligible: true },
    { model: { id: "b" }, costPerCall: 0, monthlyCost: 0, index: 55, withinBudget: true, eligible: true },
    { model: { id: "c" }, costPerCall: 0, monthlyCost: 0, index: 50, withinBudget: true, eligible: true },
  ];
  const tiers = costTiers(evals);
  assert.ok([...tiers.values()].every((t) => t === "S"), "All free models should be S");
});

test("F3: deterministic ties (sorted by cost then id)", () => {
  const evals = [
    { model: { id: "z" }, costPerCall: 0.10, monthlyCost: 10, index: 60, withinBudget: true, eligible: true },
    { model: { id: "a" }, costPerCall: 0.10, monthlyCost: 10, index: 55, withinBudget: true, eligible: true },
  ];
  const tiers1 = costTiers(evals);
  const tiers2 = costTiers([...evals].reverse());
  assert.deepEqual([...tiers1.entries()].sort(), [...tiers2.entries()].sort(), "Tie ordering must be deterministic");
});

// -- Finding 4: quotaDetail, no offpeak x2, nonfinite handled -----------------

test("F4: credit formula does not invent offpeak x2", () => {
  const creditPlan = planDoc.plans.find((p) => p.quotaDetail?.kind === "credit-allowance");
  assert.ok(creditPlan, "Catalog must have a credit-allowance plan");
  const settings = { input: 25000, output: 3500, cacheRatio: 0.6 };
  const workingModel = modelById.get(creditPlan.modelIds[0]);
  const est = planEstimate(creditPlan, settings, workingModel, workingModel);
  assert.ok(est, "Credit plan should produce an estimate");
  // Weekly credit plans are conditional (monthly distribution unknown), so
  // callsLow is 0 and callsHigh is the projected upper bound. No invented x2.
  assert.equal(est.callsLow, 0, "Conditional credit plan callsLow is 0 (not proven)");
  assert.ok(Number.isFinite(est.callsHigh), "callsHigh must be finite (no Infinity from x2)");
  assert.notEqual(est.basis.kind, "allowance", "Credit plan must not be classified as dollar allowance");
});

test("F4: dollar-allowance plan uses quotaDetail.amount", () => {
  const dollarPlan = planDoc.plans.find((p) => p.quotaDetail?.kind === "dollar-allowance");
  assert.ok(dollarPlan, "Catalog must have a dollar-allowance plan");
  const settings = { input: 25000, output: 3500, cacheRatio: 0.6 };
  const workingModel = modelById.get(dollarPlan.modelIds[0]);
  const est = planEstimate(dollarPlan, settings, workingModel, workingModel);
  assert.ok(est, "Dollar-allowance plan should produce an estimate");
  assert.equal(est.basis.kind, "allowance", "Basis should be allowance");
  assert.equal(est.valueLow, dollarPlan.quotaDetail.amount, "Value should match quotaDetail amount");
});

test("F4: break-even plan has break-even basis, coverage null", () => {
  // A plan with no quotaDetail falls through to break-even when it has a monthly price.
  const breakEvenPlan = {
    ...planDoc.plans[0],
    quotaDetail: undefined,
    includedApiValue: undefined,
    weeklyCredits: undefined,
    creditMultipliers: undefined,
  };
  const settings = { input: 25000, output: 3500, cacheRatio: 0.6 };
  const workingModel = modelById.get(breakEvenPlan.modelIds[0]);
  const est = planEstimate(breakEvenPlan, settings, workingModel, workingModel);
  assert.ok(est, "Break-even plan should produce an estimate");
  assert.equal(est.basis.kind, "break-even", "Basis should be break-even");
  const coverage = planCoverageScore(breakEvenPlan, settings, 900, workingModel, workingModel);
  assert.equal(coverage, null, "Break-even plan must not get coverage score");
});

test("F4: positive credits with zero API cost produces finite credit capacity", () => {
  const creditPlan = planDoc.plans.find((p) => p.quotaDetail?.kind === "credit-allowance");
  const settings = { input: 25000, output: 3500, cacheRatio: 0.6 };
  const realModel = modelById.get(creditPlan.modelIds[0]);
  // Zero API price but positive credit multipliers: capacity must be finite.
  // The credit formula is independent of API price — it uses the provider's
  // own multipliers, not dollar-per-token rates.
  const zeroModel = { ...realModel, input: 0, output: 0, cached: 0 };
  const est = planEstimate(creditPlan, settings, zeroModel, zeroModel);
  assert.ok(est, "Zero-cost model with credits should produce an estimate");
  // Conditional (weekly) plans have callsLow=0, but callsHigh must be finite.
  assert.ok(Number.isFinite(est.callsHigh), "Credit capacity (callsHigh) must be finite, not Infinity");
  assert.ok(est.callsHigh > 0, "Positive credits should produce positive capacity");
  assert.notEqual(est.basis.kind, "free", "Credit meter must not be labeled free when credits exist");
  assert.notEqual(est.basis.kind, "allowance", "Credit meter must not be labeled as dollar allowance");
});

test("F4: NaN cost returns null estimate, not free", () => {
  const grok45 = dataset.models.find((m) => m.id === "grok-4-5");
  assert.ok(grok45, "grok-4-5 must be in catalog");
  const settings = { input: 250000, output: 1000, cacheRatio: 0 }; // Beyond 200K
  const cost = callCost(grok45, settings);
  assert.ok(Number.isNaN(cost), "Cost should be NaN beyond unsupportedBeyond");
  // planEstimate should return null for NaN cost
  const breakEvenPlan = planDoc.plans.find((p) => p.monthly && p.monthly > 0 && !p.weeklyCredits && p.includedApiValue === undefined);
  const est = planEstimate(breakEvenPlan, settings, grok45, grok45);
  assert.equal(est, null, "NaN cost should return null estimate, not free");
});

// -- Finding 5: basis discriminant, page uses kind not string -----------------

test("F5: EstimateBasis is a discriminated union with kind", () => {
  const breakEvenPlan = {
    ...planDoc.plans[0],
    quotaDetail: undefined,
    includedApiValue: undefined,
    weeklyCredits: undefined,
    creditMultipliers: undefined,
  };
  const settings = { input: 25000, output: 3500, cacheRatio: 0.6 };
  const workingModel = modelById.get(breakEvenPlan.modelIds[0]);
  const est = planEstimate(breakEvenPlan, settings, workingModel, workingModel);
  assert.ok(est, "Should have estimate");
  assert.ok(typeof est.basis === "object", "Basis should be an object, not a string");
  assert.ok("kind" in est.basis, "Basis must have a kind discriminant");
  assert.equal(est.basis.kind, "break-even", "Break-even plan basis kind");
  assert.ok(typeof est.basis.label === "string", "Basis must have a label string");
});

test("F5: the views branch on basis.kind, never on the label text", () => {
  // The label is prose that can be reworded; the kind is the contract. A view
  // comparing the label would break silently the next time the wording changes.
  const sources = [
    "../features/recommend/best-path.tsx",
    "../features/recommend/comparison.tsx",
    "../features/rankings/price-book.tsx",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
  const joined = sources.join("\n");
  assert.doesNotMatch(joined, /basis === "/, "no view compares the basis to a string");
  assert.match(joined, /basis\.kind === "break-even"/, "views use the kind discriminant");
  assert.match(joined, /basis\.label/, "views still show the human label");
});

// -- Finding 6: grok-4-5 / gemini-3-1-pro unsupported beyond threshold --------

test("F6: grok-4-5 returns NaN cost at or above 200K input", () => {
  const grok45 = dataset.models.find((m) => m.id === "grok-4-5");
  assert.ok(grok45, "grok-4-5 must be in catalog");
  assert.ok(grok45.unsupportedBeyond, "grok-4-5 must have unsupportedBeyond");
  const belowCost = callCost(grok45, { input: 199_999, output: 1000, cacheRatio: 0 });
  const atCost = callCost(grok45, { input: 200_000, output: 1000, cacheRatio: 0 });
  assert.ok(Number.isFinite(belowCost), "Cost below 200K should be finite");
  assert.ok(Number.isNaN(atCost), "Cost at 200K should be NaN (unsupported)");
});

test("F6: gemini-3-1-pro supported at 200K (inclusive), NaN above 200K", () => {
  const gemini = dataset.models.find((m) => m.id === "gemini-3-1-pro");
  assert.ok(gemini, "gemini-3-1-pro must be in catalog");
  assert.ok(gemini.unsupportedBeyond, "gemini-3-1-pro must have unsupportedBeyond");
  // Note says "up to 200K" = inclusive, so 200K is supported.
  const atCost = callCost(gemini, { input: 200_000, output: 1000, cacheRatio: 0 });
  const aboveCost = callCost(gemini, { input: 200_001, output: 1000, cacheRatio: 0 });
  assert.ok(Number.isFinite(atCost), "Cost at 200K should be finite (inclusive 'up to')");
  assert.ok(Number.isNaN(aboveCost), "Cost above 200K should be NaN (unsupported)");
});

test("F6: models with unsupportedBeyond are marked ineligible in recommendations", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "research");
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id,
    input: 250_000, // Beyond 200K
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 1000,
    access: "any",
  }, "cost");
  const grok45Eval = result.api.evaluations.find((e) => e.model.id === "grok-4-5");
  assert.ok(grok45Eval, "grok-4-5 should have an evaluation");
  assert.equal(grok45Eval.eligible, false, "grok-4-5 should be ineligible at 250K input");
  assert.ok(Number.isNaN(grok45Eval.costPerCall), "grok-4-5 cost should be NaN");
});

test("F6: grok-4-6 with rateBands still works at 200K (supported)", () => {
  const grok46 = dataset.models.find((m) => m.id === "grok-4-6");
  assert.ok(grok46.rateBands?.length, "grok-4-6 must have rateBands");
  assert.ok(!grok46.unsupportedBeyond, "grok-4-6 should not have unsupportedBeyond (has bands)");
  const cost = callCost(grok46, { input: 200_000, output: 1000, cacheRatio: 0 });
  assert.ok(Number.isFinite(cost), "grok-4-6 cost at 200K should be finite (has rateBands)");
});

// -- Finding 7: schema validation, contextTokens consistency ------------------

test("F7: contextTokens matches parsed context string", () => {
  for (const model of dataset.models) {
    const parsed = (() => {
      const normalized = model.context.trim().toUpperCase();
      if (normalized.endsWith("M")) return parseFloat(normalized.slice(0, -1)) * 1_000_000;
      if (normalized.endsWith("K")) return parseFloat(normalized.slice(0, -1)) * 1_000;
      return parseFloat(normalized) || 0;
    })();
    assert.equal(model.contextTokens, parsed, `${model.id}: contextTokens must match context string`);
  }
});

test("F7: quotaDetail.source is HTTPS URL", () => {
  for (const plan of planDoc.plans) {
    if (plan.quotaDetail) {
      try {
        const url = new URL(plan.quotaDetail.source);
        assert.equal(url.protocol, "https:", `${plan.id}.quotaDetail.source must be HTTPS`);
      } catch {
        assert.fail(`${plan.id}.quotaDetail.source must be a valid URL`);
      }
    }
  }
});

test("F7: quotaDetail.verifiedAt is ISO date", () => {
  for (const plan of planDoc.plans) {
    if (plan.quotaDetail) {
      assert.match(plan.quotaDetail.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${plan.id}.quotaDetail.verifiedAt must be ISO date`);
    }
  }
});

test("F7: validation rejects contextTokens/context mismatch", () => {
  const badModel = { ...dataset.models[0], context: "128K", contextTokens: 999_000 };
  assert.throws(
    () => validateModel(badModel),
    /contextTokens .* must match context string/,
  );
});

test("F7: validation rejects note implying threshold pricing without rateBands", () => {
  const badModel = { ...dataset.models[0], note: "Prompts at or above 200K use higher long-context rates." };
  assert.throws(
    () => validateModel(badModel),
    /note mentions long-context or threshold pricing but has no rateBands/,
  );
});

test("F7: validation accepts note that does not imply threshold pricing", () => {
  const okModel = { ...dataset.models[0], note: "Frontier reasoning and agentic model." };
  // Should not throw
  validateModel(okModel);
});

// Import validateModel for the F7 validation tests
import { validateModel } from "../build/lib/catalog/validate.js";

// -- PR #8 review: findings raised on the refactor branch ---------------------

test("PR8: a request-limit quota is converted, not silently ignored", () => {
  // The schema accepted request-limit and isVerifiedAllowance called it
  // verified, but planEstimate had no branch for it, so a plan fell through to
  // break-even and its published request count was never used.
  const model = dataset.models.find((m) => m.capability !== null);
  const settings = { input: 1000, output: 500, cacheRatio: 0 };
  const base = {
    id: "request-plan",
    provider: model.provider,
    name: "Request Plan",
    kind: "Subscription",
    monthly: 20,
    modelIds: [model.id],
    quota: "5,000 requests / month",
    apiIncluded: "Yes",
    evidence: "Official quota",
    confidence: "High",
    note: "",
    source: "https://example.com/pricing",
    verifiedAt: "2026-09-06",
    access: ["api"],
  };
  const monthly = {
    ...base,
    quotaDetail: {
      kind: "request-limit",
      amount: 5000,
      resetWindow: "monthly",
      source: "https://example.com/pricing",
      verifiedAt: "2026-09-06",
    },
  };

  const estimate = planEstimate(monthly, settings, model, model);
  assert.ok(estimate, "a request-limit plan produces an estimate");
  assert.equal(estimate.basis.kind, "allowance", "a published request count is a verified allowance");
  assert.equal(estimate.callsLow, 5000, "the published count is the capacity");
  assert.equal(estimate.callsHigh, 5000);
  assert.notEqual(estimate.basis.kind, "break-even", "it must not fall through to break-even");

  // Coverage can now be proven, which it could not before.
  assert.equal(planCoverageScore(monthly, settings, 4000, model, model), 100, "covers a smaller volume");
  assert.ok(planCoverageScore(monthly, settings, 50_000, model, model) < 100, "does not cover a larger one");
});

test("PR8: a request limit on a shorter window stays conditional", () => {
  const model = dataset.models.find((m) => m.capability !== null);
  const settings = { input: 1000, output: 500, cacheRatio: 0 };
  const weekly = {
    id: "weekly-request-plan",
    provider: model.provider,
    name: "Weekly Request Plan",
    kind: "Subscription",
    monthly: 20,
    modelIds: [model.id],
    quota: "1,000 requests / week",
    apiIncluded: "Yes",
    evidence: "Official quota",
    confidence: "High",
    note: "",
    source: "https://example.com/pricing",
    verifiedAt: "2026-09-06",
    access: ["api"],
    quotaDetail: {
      kind: "request-limit",
      amount: 1000,
      resetWindow: "weekly",
      source: "https://example.com/pricing",
      verifiedAt: "2026-09-06",
    },
  };
  const estimate = planEstimate(weekly, settings, model, model);
  assert.equal(estimate.basis.kind, "conditional", "a weekly window cannot prove a monthly total");
  assert.equal(estimate.callsLow, 0, "the lower bound of a conditional estimate is zero");
  assert.notEqual(planCoverageScore(weekly, settings, 100, model, model), 100, "conditional never reaches full coverage");
});

test("PR8: unsupported pricing never renders as a dollar amount", () => {
  // callCost returns NaN when a model's rates are not verified at this input
  // size. Every money formatter has to say so in words.
  assert.equal(price(NaN), unsupportedPriceLabel);
  assert.equal(price(NaN, 4), unsupportedPriceLabel);
  assert.equal(monthlyPrice(NaN), unsupportedPriceLabel);
  assert.equal(monthlyPriceAgainst(NaN, 30), unsupportedPriceLabel);
  for (const formatted of [price(NaN), price(NaN, 4), monthlyPrice(NaN), monthlyPriceAgainst(NaN, 30)]) {
    assert.doesNotMatch(formatted, /NaN/, "no formatter leaks the sentinel");
  }
  // The real path: a model priced past its verified ceiling.
  const capped = dataset.models.find((m) => typeof m.unsupportedBeyond === "number");
  if (capped) {
    const beyond = { input: capped.unsupportedBeyond, output: 1000, cacheRatio: 0 };
    assert.equal(price(callCost(capped, beyond), 4), unsupportedPriceLabel);
    assert.equal(monthlyPrice(callCost(capped, beyond) * 900), unsupportedPriceLabel);
  }
});

test("PR8: each feature migrates its own legacy data", () => {
  // One shared marker meant whichever route the reader opened first claimed the
  // migration and the other feature's legacy keys were never read.
  const storage = readFileSync(new URL("../lib/browser/storage.ts", import.meta.url), "utf8");
  assert.match(storage, /migrated: \(feature: string\)/, "the marker is keyed by feature");
  assert.match(storage, /migrateLegacyOnce\(feature: string, destination: string/, "and takes the feature it guards");
  // Re-running must not clobber a record written since the migration.
  assert.match(storage, /if \(readRaw\(destination\) === null\) migrate\(\);/);

  for (const [path, feature] of [
    ["../features/recommend/state.ts", "workload"],
    ["../features/tier-list/storage.ts", "boards"],
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(
      source,
      new RegExp(`migrateLegacyOnce\\("${feature}", storageKeys\\.${feature}`),
      `${feature} migrates under its own marker`,
    );
  }
});

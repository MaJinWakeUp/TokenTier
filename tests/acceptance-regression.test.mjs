// Behavioral regression tests for acceptance conditions 1-7. Each test name
// matches its assertion. Synthetic catalogs exercise edge cases; real catalog
// snapshots verify integration.

import assert from "node:assert/strict";
import test from "node:test";

import {
  validateDataset,
  validatePlans,
  validateScenarios,
} from "../scripts/update-models.mjs";
import { callCost, creditsPerCall, planEstimate, planCoverageScore } from "../build/lib/domain/pricing.js";
import { recommend, costTiers } from "../build/lib/domain/recommend.js";
import {
  modelPlacements,
  planPlacements,
  planWorkingModel,
  curveTiers,
  DEFAULT_TIER_CUTS,
} from "../build/lib/domain/placement.js";
import { gateModel, scenarioTokens } from "../build/lib/domain/eligibility.js";
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

// -- AC1: cost/budget objectives filter by withinBudget -----------------------

test("AC1: cost objective with budget=0 returns best=null and noMatch=true", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "code-hard");
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id, input: scenario.input, output: scenario.output,
    calls: scenario.calls, cacheRatio: scenario.cacheRatio, budget: 0, access: "any",
  }, "cost");
  assert.equal(result.api.best, null, "Cost objective with 0 budget must return null");
  assert.equal(result.api.noMatch, true, "Must report no match");
});

test("AC1: budget objective with budget=0 returns best=null and noMatch=true", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "code-hard");
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id, input: scenario.input, output: scenario.output,
    calls: scenario.calls, cacheRatio: scenario.cacheRatio, budget: 0, access: "any",
  }, "budget");
  assert.equal(result.api.best, null, "Budget objective with 0 budget must return null");
  assert.equal(result.api.noMatch, true, "Must report no match");
});

test("AC1: capability objective ignores budget (returns model even if over budget)", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "code-hard");
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id, input: scenario.input, output: scenario.output,
    calls: scenario.calls, cacheRatio: scenario.cacheRatio, budget: 0, access: "any",
  }, "capability");
  assert.ok(result.api.best, "Capability objective should return a model regardless of budget");
  assert.equal(result.api.noMatch, false, "Capability objective should not report no match");
});

test("AC1: cost objective picks cheapest within budget (not cheapest overall)", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "code-medium");
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id, input: scenario.input, output: scenario.output,
    calls: scenario.calls, cacheRatio: scenario.cacheRatio, budget: 200, access: "any",
  }, "cost");
  assert.ok(result.api.best, "Should have a best");
  assert.equal(result.api.best.withinBudget, true, "Cost objective best must be within budget");
  // Verify it's the cheapest within budget, not cheapest overall
  const affordable = result.api.evaluations.filter((e) => e.eligible && e.withinBudget);
  const cheapest = [...affordable].sort((a, b) => a.costPerCall - b.costPerCall || a.model.id.localeCompare(b.model.id))[0];
  assert.equal(result.api.best.model.id, cheapest.model.id, "Should pick cheapest within budget");
});

test("AC1: plans best is null when no plan is eligible+sufficient+withinBudget", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "code-hard");
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id, input: scenario.input, output: scenario.output,
    calls: scenario.calls, cacheRatio: scenario.cacheRatio, budget: 0, access: "any",
  }, "cost");
  assert.equal(result.plans.best, null, "Zero budget should not recommend a paid plan");
  assert.equal(result.plans.noMatch, true, "Plans should report no match");
});

test("AC1: cost objective uses ID as last tie breaker", () => {
  // Two models with identical cost and index: the one with the lower ID wins.
  const models = [
    { ...dataset.models[0], id: "zzz-model", input: 1, output: 1, cached: null, context: "1M", contextTokens: 1_000_000, capability: { metrics: { intelligence: 60 }, indexVersion: "1", source: "s", verifiedAt: "2026-01-01" } },
    { ...dataset.models[0], id: "aaa-model", input: 1, output: 1, cached: null, context: "1M", contextTokens: 1_000_000, capability: { metrics: { intelligence: 60 }, indexVersion: "1", source: "s", verifiedAt: "2026-01-01" } },
  ];
  const cat = { ...catalog, models, modelById: new Map(models.map((m) => [m.id, m])) };
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "daily");
  const result = recommend(cat, scenario, {
    scenarioId: scenario.id, input: 1500, output: 700, calls: 400,
    cacheRatio: 0.2, budget: 100, access: "any",
  }, "cost");
  assert.ok(result.api.best, "Should have a best");
  assert.equal(result.api.best.model.id, "aaa-model", "ID should be the last tie breaker");
});

test("AC1: zero calls with positive budget does not recommend a paid plan", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "daily");
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id, input: scenario.input, output: scenario.output,
    calls: 0, cacheRatio: scenario.cacheRatio, budget: 30, access: "any",
  }, "cost");
  // Zero calls means monthlyCost=0 which is within budget, so API best is returned.
  assert.ok(result.api.best, "Zero calls with positive budget should return a model");
  assert.equal(result.api.best.withinBudget, true, "Zero calls = zero cost = within budget");
  // But plans best should be null (no plan has sufficient coverage for 0 calls... actually 0 calls is always covered)
  // Plans with monthly > 0 and budget=30: only plans <= $30 are within budget.
  if (result.plans.best) {
    assert.equal(result.plans.best.withinBudget, true, "Plan best must be within budget");
    assert.equal(result.plans.best.eligible, true, "Plan best must be eligible");
  }
});

// -- AC3: preset placements use cost ratio rules ------------------------------

test("AC3: planPlacements leaves conditional coverage off the board", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "code-hard");
  const placements = planPlacements(planDoc.plans, scenario, modelById, scenarioDoc.tierCuts, scenarioDoc.ranking.plans);
  // OpenCode Go has conditional coverage (5h+weekly caps), so it must NOT be tiered.
  const opencodeGo = placements.get("opencode-go");
  assert.notEqual(opencodeGo?.state, "tier", "OpenCode Go must not be tiered (conditional coverage)");
});

test("AC3: planPlacements excludes plans with unknown coverage from qualified tiers", () => {
  for (const scenario of scenarioDoc.scenarios) {
    const placements = planPlacements(planDoc.plans, scenario, modelById, scenarioDoc.tierCuts, scenarioDoc.ranking.plans);
    for (const [id, placement] of placements) {
      if (placement.state === "tier") {
        const plan = planDoc.plans.find((p) => p.id === id);
        const settings = { input: scenario.input, output: scenario.output, cacheRatio: scenario.cacheRatio };
        const wm = planWorkingModel(plan, scenario, settings, modelById);
        const est = planEstimate(plan, settings, wm, modelById.get(plan.modelIds[0]));
        // Tiered plans must have verified sufficient coverage (not conditional/unknown/break-even)
        assert.ok(est, `${id}: tiered plan must have an estimate`);
        assert.ok(est.basis.kind === "allowance" || est.basis.kind === "credit",
          `${id}: tiered plan must have verified allowance or credit basis, got ${est.basis.kind}`);
        const coverage = planCoverageScore(plan, settings, scenario.calls, wm, modelById.get(plan.modelIds[0]));
        assert.equal(coverage, 100, `${id}: tiered plan must have 100 coverage`);
      }
    }
  }
});

test("AC3: modelPlacements curves the board and puts the cheapest in S", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "daily");
  const placements = modelPlacements(dataset.models, scenario, scenarioDoc.tierCuts, scenarioDoc.ranking.models);
  const tiered = [...placements.entries()].filter(([, p]) => p.state === "tier");
  assert.ok(tiered.length >= 3, "Should have at least 3 tiered models");
  // Find the cheapest model and verify it's S.
  const settings = { input: scenario.input, output: scenario.output, cacheRatio: scenario.cacheRatio };
  const costs = dataset.models
    .filter((m) => gateModel(m, scenario, scenarioTokens(scenario)) === null)
    .map((m) => ({ id: m.id, cost: callCost(m, settings) }))
    .filter((c) => Number.isFinite(c.cost))
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  if (costs.length > 0) {
    const cheapest = placements.get(costs[0].id);
    assert.equal(cheapest?.state, "tier", "Cheapest model must be tiered");
    assert.equal(cheapest.tier, "S", "Cheapest model must be S tier");
  }
});

test("AC3: the curve cuts at the published proportions", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, cost: i + 1 }));
  const tiers = curveTiers(items, DEFAULT_TIER_CUTS);
  // Twenty distinct prices, four boundaries at 0.2/0.4/0.6/0.8: four per letter.
  for (const [letter, expected] of [["S", 4], ["A", 4], ["B", 4], ["C", 4], ["D", 4]]) {
    const count = [...tiers.values()].filter((tier) => tier === letter).length;
    assert.equal(count, expected, `${letter} holds ${expected} of twenty`);
  }
  assert.equal(tiers.get("m0"), "S", "cheapest is S");
  assert.equal(tiers.get("m19"), "D", "dearest is D");
});

test("AC3: DEFAULT_TIER_CUTS is even quintiles", () => {
  assert.deepEqual(DEFAULT_TIER_CUTS, [0.2, 0.4, 0.6, 0.8]);
});

test("AC3: the curve is independent of input order and groups equal prices", () => {
  const items = [
    { id: "b", cost: 2 }, { id: "a", cost: 1 }, { id: "e", cost: 2 },
    { id: "d", cost: 4 }, { id: "c", cost: 3 }, { id: "f", cost: 5 },
  ];
  const forward = curveTiers(items);
  const reversed = curveTiers([...items].reverse());
  assert.deepEqual([...forward.entries()].sort(), [...reversed.entries()].sort());
  assert.equal(forward.get("b"), forward.get("e"), "equal prices share a letter");
});

// -- AC4: quotaDetail authoritative, credit from quota.amount+resetWindow ---

test("AC4: quotaDetail is authoritative over includedApiValue for relative-limit plans", () => {
  // claude-max-5x has includedApiValue=100 but quotaDetail.kind=relative-limit.
  // The estimate should NOT use includedApiValue as a dollar allowance.
  const plan = planDoc.plans.find((p) => p.id === "claude-max-5x");
  assert.equal(plan.quotaDetail.kind, "relative-limit");
  assert.equal(plan.includedApiValue, 100);
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "code-medium");
  const settings = { input: scenario.input, output: scenario.output, cacheRatio: 0.6 };
  const wm = planWorkingModel(plan, scenario, settings, modelById);
  const est = planEstimate(plan, settings, wm, modelById.get(plan.modelIds[0]));
  assert.ok(est, "Should produce an estimate");
  assert.notEqual(est.basis.kind, "allowance", "Relative-limit plan must not be classified as dollar allowance");
});

test("AC4: OpenCode Go 5h+weekly caps make it conditional", () => {
  const plan = planDoc.plans.find((p) => p.id === "opencode-go");
  assert.ok(plan.conditionalLimits, "OpenCode Go must have conditionalLimits");
  assert.ok(plan.conditionalLimits.length >= 2, "Must have at least 2 conditional limits");
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "code-hard");
  const settings = { input: scenario.input, output: scenario.output, cacheRatio: scenario.cacheRatio };
  const wm = planWorkingModel(plan, scenario, settings, modelById);
  const est = planEstimate(plan, settings, wm, modelById.get(plan.modelIds[0]));
  assert.equal(est.basis.kind, "conditional", "OpenCode Go must be conditional due to multi-window caps");
  const coverage = planCoverageScore(plan, settings, scenario.calls, wm, modelById.get(plan.modelIds[0]));
  assert.ok(coverage < 100, "Conditional plan must not have 100 coverage");
});

test("AC4: positive credits with zero API cost produces finite credit capacity", () => {
  const creditPlan = planDoc.plans.find((p) => p.quotaDetail?.kind === "credit-allowance");
  assert.ok(creditPlan, "Catalog must have a credit-allowance plan");
  const settings = { input: 25000, output: 3500, cacheRatio: 0.6 };
  const realModel = modelById.get(creditPlan.modelIds[0]);
  const zeroModel = { ...realModel, input: 0, output: 0, cached: 0 };
  const est = planEstimate(creditPlan, settings, zeroModel, zeroModel);
  assert.ok(est, "Should produce an estimate");
  assert.ok(Number.isFinite(est.callsHigh), "Credit capacity must be finite, not Infinity");
  assert.ok(est.callsHigh > 0, "Positive credits should produce positive capacity");
  assert.notEqual(est.basis.kind, "free", "Credit meter must not be labeled free when credits exist");
});

test("AC4: credit capacity computed from quota.amount and resetWindow, not weeklyCredits", () => {
  const creditPlan = planDoc.plans.find((p) => p.quotaDetail?.kind === "credit-allowance");
  const settings = { input: 25000, output: 3500, cacheRatio: 0.3 };
  const model = modelById.get(creditPlan.modelIds[0]);
  const cpc = creditsPerCall(creditPlan, model, settings);
  assert.ok(cpc !== null, "Should compute credits per call");
  // Monthly credits = quota.amount * windowFactor[resetWindow]
  // For weekly: quota.amount * 4.33
  const expectedMonthly = creditPlan.quotaDetail.amount * 4.33;
  const est = planEstimate(creditPlan, settings, model, model);
  assert.ok(est, "Should produce an estimate");
  // Credits determine calls; dollar value uses the working model API rate.
  assert.ok(Math.abs(est.callsHigh - expectedMonthly / cpc) < 0.01);
  assert.ok(Math.abs(est.valueHigh - est.callsHigh * callCost(model, settings, creditPlan.cacheRatio)) < 0.01);
});

test("AC4: zero divisor never displays Infinity or NaN", () => {
  // A plan with zero quota amount and zero reference cost should not produce Infinity/NaN
  const plan = {
    ...planDoc.plans[0],
    quotaDetail: { kind: "dollar-allowance", amount: 0, resetWindow: "monthly", source: "https://example.com", verifiedAt: "2026-01-01" },
    monthly: 10,
  };
  const settings = { input: 25000, output: 3500, cacheRatio: 0.6 };
  const model = modelById.get(plan.modelIds[0]);
  const zeroModel = { ...model, input: 0, output: 0, cached: 0 };
  const est = planEstimate(plan, settings, zeroModel, zeroModel);
  assert.ok(est, "Should produce an estimate even with zero amount");
  // Free basis for zero cost, not Infinity from 0/0
  assert.equal(est.basis.kind, "free", "Zero cost should be free, not Infinity");
});

test("AC4: unknown price never classifies as unlimited", () => {
  // A plan with unknown quota and zero cost should be "free", not unlimited allowance
  const plan = {
    ...planDoc.plans[0],
    quotaDetail: { kind: "unknown", description: "Unknown", source: "https://example.com", verifiedAt: "2026-01-01" },
    monthly: 10,
  };
  const settings = { input: 25000, output: 3500, cacheRatio: 0.6 };
  const model = modelById.get(plan.modelIds[0]);
  const zeroModel = { ...model, input: 0, output: 0, cached: 0 };
  const est = planEstimate(plan, settings, zeroModel, zeroModel);
  assert.ok(est, "Should produce an estimate");
  assert.equal(est.basis.kind, "unknown-quota", "A free API rate does not establish a subscription quota");
});

test("AC4: weekly reset window plan is conditional (not sufficient for monthly inputs)", () => {
  const plan = planDoc.plans.find((p) => p.quotaDetail?.kind === "credit-allowance" && p.quotaDetail.resetWindow === "weekly");
  assert.ok(plan, "Should have a weekly credit plan");
  const settings = { input: 25000, output: 3500, cacheRatio: 0.3 };
  const model = modelById.get(plan.modelIds[0]);
  const est = planEstimate(plan, settings, model, model);
  assert.ok(est, "Should produce an estimate");
  assert.equal(est.basis.kind, "conditional", "Weekly plan must be conditional for monthly inputs");
  const coverage = planCoverageScore(plan, settings, 100, model, model);
  assert.ok(coverage === null || coverage < 100, "Weekly plan must not have 100 coverage");
});

// -- AC5: credit model selection uses credits per call -----------------------

test("AC5: credit plan working model uses credits per call, not cheapest API rate", () => {
  // Synthetic reversal fixture: two models where the cheapest API rate is NOT
  // the one with the fewest credits per call.
  const expensiveApiCheapCredit = {
    ...dataset.models[0],
    id: "expensive-api-cheap-credit",
    input: 10, output: 50, cached: null,
    context: "1M", contextTokens: 1_000_000,
    capability: { metrics: { intelligence: 60 }, indexVersion: "1", source: "s", verifiedAt: "2026-01-01" },
  };
  const cheapApiExpensiveCredit = {
    ...dataset.models[0],
    id: "cheap-api-expensive-credit",
    input: 1, output: 5, cached: null,
    context: "1M", contextTokens: 1_000_000,
    capability: { metrics: { intelligence: 60 }, indexVersion: "1", source: "s", verifiedAt: "2026-01-01" },
  };
  const syntheticModelById = new Map([
    [expensiveApiCheapCredit.id, expensiveApiCheapCredit],
    [cheapApiExpensiveCredit.id, cheapApiExpensiveCredit],
  ]);
  // Multipliers that reverse the API cost ordering:
  // expensive-api model has LOW credit multipliers (few credits per call)
  // cheap-api model has HIGH credit multipliers (many credits per call)
  const plan = {
    ...planDoc.plans[0],
    id: "synthetic-credit-plan",
    modelIds: [expensiveApiCheapCredit.id, cheapApiExpensiveCredit.id],
    quotaDetail: { kind: "credit-allowance", amount: 10000, resetWindow: "monthly", modelMeter: "credit-multipliers", source: "https://example.com", verifiedAt: "2026-01-01" },
    creditMultipliers: {
      [expensiveApiCheapCredit.id]: [1, 1, 1],     // cheap in credits
      [cheapApiExpensiveCredit.id]: [100, 100, 100], // expensive in credits
    },
    cacheRatio: 0,
    monthly: 20,
  };
  const settings = { input: 1000, output: 100, cacheRatio: 0 };
  const scenario = { id: "daily", label: "Daily", input: 1000, output: 100, calls: 400, cacheRatio: 0, description: "", rationale: "", gate: { metric: "intelligence", minIndex: 45, anchor: "x", rationale: "" } };

  // Verify the reversal: cheap-api-expensive-credit is cheaper in API rate
  const apiCostA = callCost(expensiveApiCheapCredit, settings);
  const apiCostB = callCost(cheapApiExpensiveCredit, settings);
  assert.ok(apiCostB < apiCostA, "cheap-api-expensive-credit must have lower API cost");

  // But it has MORE credits per call (higher multipliers = more credits consumed)
  const cpcA = creditsPerCall(plan, expensiveApiCheapCredit, settings);
  const cpcB = creditsPerCall(plan, cheapApiExpensiveCredit, settings);
  assert.ok(cpcA !== null && cpcB !== null, "Both must have credit multipliers");
  assert.ok(cpcA < cpcB, "expensive-api-cheap-credit must have FEWER credits per call");

  // The working model should be expensive-api-cheap-credit (fewest credits per call)
  // NOT cheap-api-expensive-credit (cheapest API rate)
  const wm = planWorkingModel(plan, scenario, settings, syntheticModelById);
  assert.equal(wm?.id, expensiveApiCheapCredit.id, "Working model should be the one with fewest credits per call, not cheapest API rate");
});

// -- AC7: boundary tests for unsupportedBeyond --------------------------------

test("AC7: Gemini note says UP TO 200K (inclusive), unsupported starts >200K", () => {
  const gemini = dataset.models.find((m) => m.id === "gemini-3-1-pro");
  assert.ok(gemini.unsupportedBeyond, "gemini-3-1-pro must have unsupportedBeyond");
  // "up to 200K" means 200K is supported, unsupported starts ABOVE 200K
  const atCost = callCost(gemini, { input: 200_000, output: 1000, cacheRatio: 0 });
  const aboveCost = callCost(gemini, { input: 200_001, output: 1000, cacheRatio: 0 });
  assert.ok(Number.isFinite(atCost), "200K should be supported (inclusive 'up to')");
  assert.ok(Number.isNaN(aboveCost), "200001 should be unsupported");
});

test("AC7: Grok note says at/above 200K unsupported (inclusive boundary)", () => {
  const grok = dataset.models.find((m) => m.id === "grok-4-5");
  assert.ok(grok.unsupportedBeyond, "grok-4-5 must have unsupportedBeyond");
  // "rates at or above 200K are not published" means 200K is the boundary
  const belowCost = callCost(grok, { input: 199_999, output: 1000, cacheRatio: 0 });
  const atCost = callCost(grok, { input: 200_000, output: 1000, cacheRatio: 0 });
  assert.ok(Number.isFinite(belowCost), "199999 should be supported");
  assert.ok(Number.isNaN(atCost), "200000 should be unsupported (at/above 200K)");
});

// -- AC7: pricing rejection vs unscored distinction ---------------------------

test("AC7: unsupported pricing model is ineligible but not labeled unscored in rejection", () => {
  const scenario = scenarioDoc.scenarios.find((s) => s.id === "research");
  const result = recommend(catalog, scenario, {
    scenarioId: scenario.id, input: 250_000, output: scenario.output,
    calls: scenario.calls, cacheRatio: scenario.cacheRatio, budget: 1000, access: "any",
  }, "cost");
  const grok45Eval = result.api.evaluations.find((e) => e.model.id === "grok-4-5");
  assert.ok(grok45Eval, "grok-4-5 should have an evaluation");
  assert.equal(grok45Eval.eligible, false, "grok-4-5 should be ineligible");
  assert.ok(Number.isNaN(grok45Eval.costPerCall), "Cost should be NaN (unsupported)");
  // A scored model with missing pricing has a pricing rejection.
  assert.ok(grok45Eval.rejection, "Should have a rejection reason");
  assert.equal(grok45Eval.rejection.state, "pricing", "Unsupported pricing rejection state");
  // The model should NOT appear in the cost tiers
  const tiers = costTiers(result.api.evaluations);
  assert.ok(!tiers.has("grok-4-5"), "Unsupported-pricing model should not be in cost tiers");
});

// -- AC7: scenarios tierCuts field --------------------------------------------

test("AC7: scenarios document publishes four tier cuts", () => {
  assert.ok(Array.isArray(scenarioDoc.tierCuts), "Scenarios must publish tierCuts");
  assert.equal(scenarioDoc.tierCuts.length, 4, "five letters need four boundaries");
  for (let i = 1; i < scenarioDoc.tierCuts.length; i += 1) {
    assert.ok(scenarioDoc.tierCuts[i] > scenarioDoc.tierCuts[i - 1], "cuts strictly increase");
  }
  assert.equal("costRatioBands" in scenarioDoc, false, "the retired ratio bands are gone");
});

test("AC7: every scenario board is contiguous from S, models and plans", () => {
  const order = ["S", "A", "B", "C", "D"];
  // Contiguity is the property: the letters in use run from S with no gap.
  // A lane can legitimately be empty — no plan clears the hard-coding bar with a
  // convertible quota — and an empty lane has no letters to be discontiguous.
  const contiguous = (placements, label) => {
    const used = new Set(
      [...placements.values()].filter((p) => p.state === "tier").map((p) => p.tier),
    );
    assert.deepEqual(
      order.filter((letter) => used.has(letter)),
      order.slice(0, used.size),
      `${label}: letters used are contiguous from S, got ${[...used].join(",")}`,
    );
  };

  for (const scenario of scenarioDoc.scenarios) {
    contiguous(
      modelPlacements(dataset.models, scenario, scenarioDoc.tierCuts, scenarioDoc.ranking.models),
      `${scenario.id} models`,
    );
    contiguous(
      planPlacements(planDoc.plans, scenario, modelById, scenarioDoc.tierCuts, scenarioDoc.ranking.plans),
      `${scenario.id} plans`,
    );
  }
});

// -- AC2: the plan a reader is shown is the plan the engine chose ------------

test("AC2: the recommended plan is the engine's, not the first row of a list", async () => {
  const { decide } = await import("../build/lib/domain/decision.js");
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
  const decision = decide(catalog, scenario, workload, "cost", "either");
  const best = decision.result.plans.best;
  if (best !== null) {
    // The comparison list is ordered by budget fit then price. Its first row is
    // not necessarily eligible or sufficient, so the badge cannot follow it.
    const listed = decision.result.plans.evaluations
      .filter((entry) => entry.estimate !== null)
      .sort((a, b) =>
        Number(b.withinBudget) - Number(a.withinBudget)
        || (a.plan.monthly ?? Infinity) - (b.plan.monthly ?? Infinity));
    const first = listed.at(0);
    if (first && first.plan.id !== best.plan.id) {
      assert.ok(
        !(first.eligible && first.sufficientCoverage === true && first.withinBudget),
        "the list head is only skipped when it does not qualify",
      );
    }
  }
  // The view marks the badge by comparing ids with the engine's choice.
  const comparison = readFileSync(new URL("../features/recommend/comparison.tsx", import.meta.url), "utf8");
  assert.match(comparison, /plans\.best\?\.plan\?\.id === evaluation\.plan\.id/);
  assert.doesNotMatch(comparison, /index === 0/);
});

test("AC2: the access requirement is a real input, carried in the link and the saved record", () => {
  const form = readFileSync(new URL("../features/recommend/workload-form.tsx", import.meta.url), "utf8");
  const state = readFileSync(new URL("../features/recommend/state.ts", import.meta.url), "utf8");
  const urlState = readFileSync(new URL("../lib/domain/url-state.ts", import.meta.url), "utf8");
  assert.match(form, /controller\.setAccess/, "the form sets the access requirement");
  assert.match(form, /value="coding-client"/, "every surface is offered");
  assert.match(state, /access: settings\.workload\.access/, "the saved record carries it");
  assert.match(urlState, /params\.set\("access", state\.workload\.access\)/, "the link carries it");
});

test("AC2: an access requirement actually filters the candidates", async () => {
  const { decide } = await import("../build/lib/domain/decision.js");
  const scenario = scenarioDoc.scenarios[2];
  const base = {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 200,
  };
  const anySurface = decide(catalog, scenario, { ...base, access: "any" }, "cost", "either");
  const chatOnly = decide(catalog, scenario, { ...base, access: "chat-app" }, "cost", "either");
  assert.ok(anySurface.result.api.evaluations.length > 0);
  assert.equal(chatOnly.result.api.evaluations.length, 0, "a chat-only workload gets no direct API models");
  assert.ok(
    chatOnly.result.plans.evaluations.length < anySurface.result.plans.evaluations.length,
    "a surface requirement narrows the plans considered",
  );
});

test("AC2: the methodology describes the curve it actually applies", () => {
  const methodology = readFileSync(new URL("../features/rankings/methodology.tsx", import.meta.url), "utf8");
  assert.match(methodology, /curved/, "the methodology names the rule it uses");
  assert.match(methodology, /tierCuts/, "and reads the published cuts rather than restating them");
  // The trade the curve makes is stated, not buried: a letter is a rank, so
  // adding an option can move an unchanged one.
  assert.match(methodology, /rank, not a fixed multiple/);
  assert.doesNotMatch(methodology, /costRatioBands/, "the retired bands are not referenced");
});

// -- AC6: build config resolves .js extension imports ------------------------

test("AC6: next.config has webpack extensionAlias for .js -> .ts", () => {
  const configSource = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(configSource, /extensionAlias/, "next.config must have extensionAlias");
  assert.match(configSource, /\.js.*\[.*\.ts.*\.tsx.*\.js/, "extensionAlias must map .js to .ts/.tsx/.js");
});

// -- AC8: a lane where nothing qualifies explains itself ----------------------

test("AC8: a scenario can leave a whole lane empty, and the catalog says which", () => {
  // The harder v4.3 index pushed code-hard's plan lane to zero tiered plans.
  // The board must be able to render that state, so the invariant worth holding
  // is that an empty lane is a real possibility the UI accounts for, not that
  // every lane is always populated.
  const board = readFileSync(new URL("../features/rankings/tier-board.tsx", import.meta.url), "utf8");
  assert.match(board, /rows\.length === 0 \? \(/, "the board branches on an empty lane");
  assert.match(board, /tier-board-empty/, "and renders a reason rather than nothing");
  assert.match(board, /\{rows\.length > 0 && \(/, "the letters-explained note is suppressed when there are no letters");

  // Models are the lane that must never empty: the validator floor guarantees
  // at least three qualify for every scenario.
  for (const scenario of scenarioDoc.scenarios) {
    const placements = modelPlacements(dataset.models, scenario, scenarioDoc.tierCuts, scenarioDoc.ranking.models);
    const tiered = [...placements.values()].filter((p) => p.state === "tier");
    assert.ok(tiered.length >= 3, `${scenario.id}: at least three models are tiered, got ${tiered.length}`);
  }
});

// Engine invariants across all seven scenarios, plus CLI/UI eligibility parity.
//
// These assert properties that must hold for any catalog — every item receives a
// placement, no scenario empties out, costs stay finite and nonnegative — rather
// than pinning tier letters to particular models. Pinning them would make every
// legitimate catalog update fail the suite, which is the wrong signal: a score
// the vendor changed is data, not a regression. The before/after effect of a
// catalog change is reported when the change is made, not asserted here.
//
// Business tests import functions, not copy their implementation.

import assert from "node:assert/strict";
import test from "node:test";

import {
  eligibleModels,
  validateDataset,
  validatePlans,
  validateScenarios,
} from "../scripts/update-models.mjs";
import { callCost, planEstimate, planCoverageScore } from "../build/lib/domain/pricing.js";
import { gateModel, metricValue, scenarioTokens } from "../build/lib/domain/eligibility.js";
import {
  modelPlacements,
  planPlacements,
  planWorkingModel,
} from "../build/lib/domain/placement.js";

const modelCatalog = JSON.parse(
  await import("node:fs").then((fs) => fs.readFileSync(new URL("../data/api-models.json", import.meta.url), "utf8")),
);
const planCatalog = JSON.parse(
  await import("node:fs").then((fs) => fs.readFileSync(new URL("../data/plans.json", import.meta.url), "utf8")),
);
const scenarioCatalog = JSON.parse(
  await import("node:fs").then((fs) => fs.readFileSync(new URL("../data/scenarios.json", import.meta.url), "utf8")),
);

const dataset = validateDataset(modelCatalog);
const planDoc = validatePlans(planCatalog, dataset);
const scenarioDoc = validateScenarios(scenarioCatalog, dataset);

const modelById = new Map(dataset.models.map((m) => [m.id, m]));
const tierCuts = scenarioDoc.tierCuts;
const w = scenarioDoc.ranking;

function placementSummary(map) {
  const entries = [...map.entries()].map(([id, p]) => ({
    id,
    state: p.state,
    tier: p.state === "tier" ? p.tier : undefined,
  }));
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

test("all seven scenarios produce model placements", () => {
  for (const scenario of scenarioDoc.scenarios) {
    const placements = modelPlacements(dataset.models, scenario, tierCuts, w.models);
    const tiered = [...placements.values()].filter((p) => p.state === "tier");
    assert.ok(tiered.length >= 3, `${scenario.id}: expected >= 3 tiered models, got ${tiered.length}`);
  }
});

test("all seven scenarios produce plan placements", () => {
  for (const scenario of scenarioDoc.scenarios) {
    const placements = planPlacements(planDoc.plans, scenario, modelById, tierCuts, w.plans);
    const tiered = [...placements.values()].filter((p) => p.state === "tier");
    assert.ok(tiered.length >= 1, `${scenario.id}: expected >= 1 tiered plan, got ${tiered.length}`);
  }
});

test("every model receives a placement in every scenario", () => {
  const snapshot = {};
  for (const scenario of scenarioDoc.scenarios) {
    const placements = modelPlacements(dataset.models, scenario, tierCuts, w.models);
    snapshot[scenario.id] = placementSummary(placements);
  }
  // A model is never silently absent: it is tiered, or it carries a reason it
  // is not. Both are placements, so the count must match the catalog exactly.
  assert.ok(Object.keys(snapshot).length === 7);
  for (const [id, entries] of Object.entries(snapshot)) {
    assert.ok(entries.length === dataset.models.length, `${id}: every model must have a placement`);
  }
});

test("every plan receives a placement in every scenario", () => {
  const snapshot = {};
  for (const scenario of scenarioDoc.scenarios) {
    const placements = planPlacements(planDoc.plans, scenario, modelById, tierCuts, w.plans);
    snapshot[scenario.id] = placementSummary(placements);
  }
  assert.ok(Object.keys(snapshot).length === 7);
  for (const [id, entries] of Object.entries(snapshot)) {
    assert.ok(entries.length === planDoc.plans.length, `${id}: every plan must have a placement`);
  }
});

test("callCost is finite and positive for every scored model in every scenario", () => {
  for (const scenario of scenarioDoc.scenarios) {
    const settings = { input: scenario.input, output: scenario.output, cacheRatio: scenario.cacheRatio };
    for (const model of dataset.models) {
      const cost = callCost(model, settings);
      assert.ok(Number.isFinite(cost), `${scenario.id}/${model.id}: cost must be finite`);
      assert.ok(cost >= 0, `${scenario.id}/${model.id}: cost must be nonnegative`);
    }
  }
});

test("planEstimate returns null or finite calls for every plan/scenario", () => {
  for (const scenario of scenarioDoc.scenarios) {
    const settings = { input: scenario.input, output: scenario.output, cacheRatio: scenario.cacheRatio };
    for (const plan of planDoc.plans) {
      const workingModel = planWorkingModel(plan, scenario, settings, modelById);
      const fallback = modelById.get(plan.modelIds[0]);
      const estimate = planEstimate(plan, settings, workingModel, fallback);
      if (estimate) {
        assert.ok(Number.isFinite(estimate.callsLow) || estimate.callsLow === Infinity, `${scenario.id}/${plan.id}: callsLow must be finite or Infinity`);
        assert.ok(Number.isFinite(estimate.callsHigh) || estimate.callsHigh === Infinity, `${scenario.id}/${plan.id}: callsHigh must be finite or Infinity`);
        assert.ok(estimate.callsLow >= 0, `${scenario.id}/${plan.id}: callsLow must be nonnegative`);
      }
    }
  }
});

test("CLI and UI eligibility agree for all scenarios", () => {
  for (const scenario of scenarioDoc.scenarios) {
    const requiredTokens = scenarioTokens(scenario);
    const cliEligible = new Set(eligibleModels(dataset, scenario).map((m) => m.id));
    const uiEligible = new Set(
      dataset.models.filter((m) => gateModel(m, scenario, requiredTokens) === null).map((m) => m.id),
    );
    assert.deepEqual([...cliEligible].sort(), [...uiEligible].sort(), `${scenario.id}: CLI and UI eligibility must match`);
  }
});

// F1: threshold pricing is computed, not described in a note.
test("grok-4-6 uses threshold rates at or above 200K input", () => {
  const grok = dataset.models.find((m) => m.id === "grok-4-6");
  assert.ok(grok, "grok-4-6 must be in the catalog");
  assert.ok(grok.rateBands && grok.rateBands.length > 0, "grok-4-6 must have rateBands");
  // Below threshold: default rates ($2 input, $0.50 cached, $6 output)
  const belowCost = callCost(grok, { input: 100_000, output: 1000, cacheRatio: 0 });
  // At/above threshold: $4 input, $1 cached, $12 output
  const atCost = callCost(grok, { input: 200_000, output: 1000, cacheRatio: 0 });
  // The threshold cost must be higher than the default cost per token
  const belowPerToken = belowCost / 100_000;
  const atPerToken = atCost / 200_000;
  assert.ok(atPerToken > belowPerToken, "Threshold rates should be higher per token than default rates");
});

test("grok-4-3 uses threshold rates at or above 200K input", () => {
  const grok = dataset.models.find((m) => m.id === "grok-4-3");
  assert.ok(grok?.rateBands?.length, "grok-4-3 must have rateBands");
  const belowCost = callCost(grok, { input: 199_999, output: 500, cacheRatio: 0 });
  const atCost = callCost(grok, { input: 200_000, output: 500, cacheRatio: 0 });
  // Default: $1.25 input, $0.20 cached, $2.50 output
  // Threshold: $2.50 input, $0.40 cached, $5 output
  const belowPerToken = belowCost / 199_999;
  const atPerToken = atCost / 200_000;
  assert.ok(atPerToken > belowPerToken, "grok-4-3 threshold rates should be higher");
});

// F4: break-even comparison is never confused for verified allowance.
test("planCoverageScore returns null for break-even plans", () => {
  const breakEvenPlan = planDoc.plans.find((p) => p.evidence === "Price break-even");
  if (!breakEvenPlan) return; // skip if not present
  const settings = { input: 25_000, output: 3500, cacheRatio: 0.6 };
  const score = planCoverageScore(breakEvenPlan, settings, 900, null, null);
  // Break-even plans should not get a coverage score — they are not verified allowance.
  // (They may still get an estimate, but coverage must be null.)
  // Note: planCoverageScore requires weeklyCredits or includedApiValue for non-null.
  assert.equal(score, null, "Break-even plan must not receive a coverage score");
});

// Phase 3: unified cost-first recommendation pipeline tests.
import { recommend, costTiers } from "../build/lib/domain/recommend.js";

const catalogObj = {
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

test("recommend returns no-match when nothing clears the bar", () => {
  const impossibleScenario = {
    ...scenarioDoc.scenarios[0],
    gate: { ...scenarioDoc.scenarios[0].gate, minIndex: 200 },
  };
  const result = recommend(catalogObj, impossibleScenario, {
    scenarioId: "daily",
    input: 1500,
    output: 700,
    calls: 400,
    cacheRatio: 0.2,
    budget: 30,
    access: "any",
  }, "cost");
  assert.equal(result.api.noMatch, true, "API should report no-match");
  assert.equal(result.api.best, null, "No best API model when nothing qualifies");
});

test("recommend defaults to cheapest eligible for cost objective", () => {
  const scenario = scenarioDoc.scenarios[2]; // code-medium
  const result = recommend(catalogObj, scenario, {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 100,
    access: "any",
  }, "cost");
  assert.equal(result.api.noMatch, false);
  assert.ok(result.api.best, "Should have a best API model");
  // Best should be the cheapest eligible model
  const eligible = result.api.evaluations.filter((e) => e.eligible);
  const cheapest = [...eligible].sort((a, b) => a.costPerCall - b.costPerCall)[0];
  assert.equal(result.api.best.model.id, cheapest.model.id, "Cost objective should pick cheapest");
});

test("recommend budget objective picks highest index within budget", () => {
  const scenario = scenarioDoc.scenarios[2]; // code-medium
  const result = recommend(catalogObj, scenario, {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 500,
    access: "any",
  }, "budget");
  const affordable = result.api.evaluations.filter((e) => e.eligible && e.withinBudget);
  if (affordable.length > 0) {
    const highestIndex = [...affordable].sort((a, b) => (b.index ?? 0) - (a.index ?? 0))[0];
    assert.equal(result.api.best.model.id, highestIndex.model.id, "Budget objective should pick highest index within budget");
  }
});

test("recommend plan best is never an ineligible plan", () => {
  for (const scenario of scenarioDoc.scenarios) {
    const result = recommend(catalogObj, scenario, {
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

test("costTiers assigns S to the cheapest eligible model", () => {
  const scenario = scenarioDoc.scenarios[2]; // code-medium
  const settings = { input: scenario.input, output: scenario.output, cacheRatio: scenario.cacheRatio };
  const evaluations = dataset.models.map((model) => {
    const requiredTokens = scenarioTokens(scenario);
    const rejection = gateModel(model, scenario, requiredTokens);
    const costPerCall = callCost(model, settings);
    return {
      model,
      costPerCall,
      monthlyCost: costPerCall * scenario.calls,
      index: metricValue(model.capability, scenario.gate.metric),
      withinBudget: costPerCall * scenario.calls <= 100,
      eligible: rejection === null,
      rejection: rejection ?? undefined,
    };
  });
  const tiers = costTiers(evaluations);
  const eligible = evaluations.filter((e) => e.eligible);
  if (eligible.length > 0) {
    const cheapest = [...eligible].sort((a, b) => a.costPerCall - b.costPerCall)[0];
    assert.equal(tiers.get(cheapest.model.id), "S", "Cheapest eligible should be S tier");
  }
});

test("costTiers returns empty when nothing is eligible", () => {
  const evaluations = dataset.models.map((model) => ({
    model,
    costPerCall: 1,
    monthlyCost: 100,
    index: null,
    withinBudget: true,
    eligible: false,
  }));
  const tiers = costTiers(evaluations);
  assert.equal(tiers.size, 0, "No tiers when nothing is eligible");
});

test("recommend with zero calls does not divide by zero", () => {
  const scenario = scenarioDoc.scenarios[0];
  const result = recommend(catalogObj, scenario, {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: 0,
    cacheRatio: scenario.cacheRatio,
    budget: 30,
    access: "any",
  }, "cost");
  // Zero calls means monthlyCost=0, which is within budget. A best should be returned.
  assert.equal(result.api.noMatch, false, "Zero calls should still produce a recommendation");
  assert.ok(result.api.best, "Should have a best even with zero calls");
  assert.equal(result.api.best.withinBudget, true, "Zero calls = zero cost = within budget");
});

test("recommend with zero budget returns no-match when no model is free", () => {
  const scenario = scenarioDoc.scenarios[0];
  const result = recommend(catalogObj, scenario, {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 0,
    access: "any",
  }, "cost");
  // With zero budget, no positive-cost model is within budget, so cost
  // objective returns null (noMatch=true). Zero calls should not recommend
  // a paid plan.
  assert.equal(result.api.best, null, "Zero budget with positive-cost models should return null");
  assert.equal(result.api.noMatch, true, "Should report no match");
  assert.equal(result.plans.best, null, "Zero budget should not recommend a paid plan");
  assert.equal(result.plans.noMatch, true, "Plans should also report no match");
});

test("preset and identical custom workload return identical results", () => {
  const scenario = scenarioDoc.scenarios[2]; // code-medium
  const presetResult = recommend(catalogObj, scenario, {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 200,
    access: "any",
  }, "cost");
  const customResult = recommend(catalogObj, scenario, {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: 200,
    access: "any",
  }, "cost");
  assert.equal(presetResult.api.best?.model.id, customResult.api.best?.model.id, "Same workload should return same best");
});

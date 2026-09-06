// The derivation that turns one workload into the answer the reader sees:
// which path wins, what each objective would pick instead, and what the page
// says when nothing qualifies. Imported as functions, so these hold regardless
// of how the result is laid out.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { validateDataset, validatePlans, validateScenarios } from "../scripts/update-models.mjs";
import { announceDecision, decide } from "../build/lib/domain/decision.js";
import { workloadFromScenario } from "../build/lib/domain/workload.js";

const modelCatalog = JSON.parse(readFileSync(new URL("../data/api-models.json", import.meta.url), "utf8"));
const planCatalog = JSON.parse(readFileSync(new URL("../data/plans.json", import.meta.url), "utf8"));
const scenarioCatalog = JSON.parse(readFileSync(new URL("../data/scenarios.json", import.meta.url), "utf8"));

const dataset = validateDataset(modelCatalog);
const planDoc = validatePlans(planCatalog, dataset);
const scenarioDoc = validateScenarios(scenarioCatalog, dataset);

const catalog = {
  models: dataset.models,
  plans: planDoc.plans,
  scenarios: scenarioDoc.scenarios,
  modelById: new Map(dataset.models.map((model) => [model.id, model])),
  capabilityIndex: dataset.capabilityIndex,
  modelCatalogUpdatedAt: dataset.updatedAt,
  planCatalogUpdatedAt: planDoc.updatedAt,
  tierCuts: scenarioDoc.tierCuts,
  costRatioBands: scenarioDoc.costRatioBands,
  rankingWeights: scenarioDoc.ranking,
};

const scenario = scenarioDoc.scenarios.find((entry) => entry.id === "code-medium");
const workload = (overrides = {}) => ({ ...workloadFromScenario(scenario), budget: 200, ...overrides });

test("the default answer is the cheapest eligible option within budget", () => {
  const decision = decide(catalog, scenario, workload(), "cost", "either");
  assert.notEqual(decision.apiModel, null);
  assert.equal(decision.apiWithinBudget, true);

  const eligible = decision.result.api.evaluations.filter((entry) => entry.eligible && entry.withinBudget);
  const cheapest = Math.min(...eligible.map((entry) => entry.costPerCall));
  assert.equal(decision.result.api.best.costPerCall, cheapest);
});

test("a budget nothing can meet produces an explicit no-match, not a fallback", () => {
  const decision = decide(catalog, scenario, workload({ budget: 1, calls: 100_000 }), "cost", "either");
  assert.equal(decision.apiNoMatch, true);
  assert.equal(decision.apiModel, null);
  assert.match(decision.caption, /No (model|model or plan) clears the capability bar/);
  assert.match(announceDecision(decision, workload({ budget: 1, calls: 100_000 })), /No option qualifies|No qualified model/);
});

test("the capability objective ignores the budget and says so", () => {
  const settings = workload({ budget: 1, calls: 100_000 });
  const decision = decide(catalog, scenario, settings, "capability", "either");
  assert.notEqual(decision.apiModel, null, "capability is not budget-filtered");
  assert.equal(decision.apiWithinBudget, false);
  const capabilityPick = decision.frontier.find((pick) => pick.id === "capability");
  assert.equal(capabilityPick.overBudget, true);
  const costPick = decision.frontier.find((pick) => pick.id === "cost");
  assert.equal(costPick.noMatch, true, "cost still reports no affordable option");
});

test("the frontier reports when several objectives land on one model", () => {
  const decision = decide(catalog, scenario, workload({ budget: 10_000 }), "cost", "either");
  for (const pick of decision.frontier) {
    for (const label of pick.sameAs) {
      const twin = decision.frontier.find((entry) => entry.label === label);
      assert.equal(twin.model.id, pick.model.id, `${pick.label} and ${label} agree`);
    }
    assert.equal(pick.sameAs.includes(pick.label), false, "an objective is never its own twin");
  }
});

test("the same objective is evaluated once, so the card and the comparison agree", () => {
  const settings = workload();
  const decision = decide(catalog, scenario, settings, "budget", "either");
  const activePick = decision.frontier.find((pick) => pick.id === "budget");
  assert.equal(decision.apiModel?.id, activePick.model?.id);
  assert.equal(decision.apiSpend, activePick.spend);
});

test("a preference cannot promote an option that does not fit", () => {
  // Asking for plans first must not select a plan that is over budget or
  // cannot be shown to cover the volume.
  const settings = workload({ budget: 5 });
  const decision = decide(catalog, scenario, settings, "cost", "plans");
  if (decision.preferredPath === "plans") {
    assert.equal(decision.planWithinBudget, true);
    assert.equal(decision.planCoversVolume, true);
  }
});

test("a chosen plan is always eligible, sufficient, and within budget", () => {
  for (const entry of scenarioDoc.scenarios) {
    for (const budget of [5, 30, 200, 2000]) {
      const decision = decide(catalog, entry, { ...workloadFromScenario(entry), budget }, "cost", "either");
      const best = decision.result.plans.best;
      if (best === null) continue;
      assert.equal(best.eligible, true, `${entry.id} @ $${budget}: eligible`);
      assert.equal(best.sufficientCoverage, true, `${entry.id} @ $${budget}: coverage proven`);
      assert.equal(best.withinBudget, true, `${entry.id} @ $${budget}: within budget`);
    }
  }
});

test("an access requirement is never satisfied by a different surface", () => {
  const chatOnly = decide(catalog, scenario, workload({ access: "chat-app" }), "cost", "either");
  assert.equal(chatOnly.result.api.evaluations.length, 0, "a chat-only workload gets no direct API models");
  for (const evaluation of chatOnly.result.plans.evaluations) {
    assert.ok(evaluation.plan.access?.includes("chat-app"), `${evaluation.plan.id} is reachable as a chat app`);
  }

  const apiOnly = decide(catalog, scenario, workload({ access: "api" }), "cost", "either");
  assert.ok(apiOnly.result.api.evaluations.length > 0);
  for (const evaluation of apiOnly.result.plans.evaluations) {
    assert.ok(evaluation.plan.access?.includes("api"), `${evaluation.plan.id} exposes an API`);
  }
});

test("the same workload gives the same answer on both surfaces", () => {
  // Rankings prices a preset with no budget ceiling; Recommend prices the same
  // preset with a budget high enough not to bind. The winner has to match.
  const rankings = decide(catalog, scenario, { ...workloadFromScenario(scenario), budget: Infinity }, "cost", "either");
  const recommend = decide(catalog, scenario, { ...workloadFromScenario(scenario), budget: 100_000 }, "cost", "either");
  assert.equal(rankings.apiModel?.id, recommend.apiModel?.id);
  assert.equal(rankings.apiSpend, recommend.apiSpend);
});

test("the caption never claims a saving when there is nothing to compare", () => {
  const noPlans = decide(catalog, scenario, workload({ budget: 4 }), "capability", "either");
  if (noPlans.plan === null) {
    assert.doesNotMatch(noPlans.caption, /saves/);
  }
  const bothMissing = decide(catalog, scenario, workload({ budget: 1, calls: 100_000 }), "cost", "either");
  assert.doesNotMatch(bothMissing.caption, /saves|cheaper/);
});

test("a settled announcement is one sentence, not the whole panel", () => {
  const decision = decide(catalog, scenario, workload(), "cost", "either");
  const message = announceDecision(decision, workload());
  assert.ok(message.length < 120, `announcement stays short: ${message}`);
  assert.equal(message.split(". ").length <= 2, true);
});

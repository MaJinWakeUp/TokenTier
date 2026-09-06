// The workload contract and the link that carries it. A shared link is the only
// way one reader hands a workload to another, so every field has to survive the
// round trip and every bad value has to fall back rather than be coerced into a
// plausible-looking number.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  clamp,
  defaultBudget,
  isAccessRequirement,
  isObjective,
  isPreference,
  matchesScenarioPreset,
  normalizeWorkload,
  readNumber,
  sameWorkload,
  workloadFromScenario,
  workloadLimits,
} from "../build/lib/domain/workload.js";
import {
  legacyRouteFor,
  parseRankingsScenario,
  parseRecommendState,
  recommendParams,
  routes,
} from "../build/lib/domain/url-state.js";

const scenarioCatalog = JSON.parse(readFileSync(new URL("../data/scenarios.json", import.meta.url), "utf8"));
const scenarios = scenarioCatalog.scenarios;
const preset = scenarios.find((scenario) => scenario.id === "code-medium");
const other = scenarios.find((scenario) => scenario.id !== preset.id);

const baseState = {
  workload: workloadFromScenario(preset),
  objective: "cost",
  preference: "either",
};

// -- Number handling ----------------------------------------------------------

test("out-of-range numbers clamp and unusable ones fall back", () => {
  assert.equal(readNumber("500", workloadLimits.calls, 1), 500);
  assert.equal(readNumber("0", workloadLimits.calls, 42), workloadLimits.calls.min, "zero clamps to the floor");
  assert.equal(readNumber("999999999", workloadLimits.calls, 42), workloadLimits.calls.max);
  for (const unusable of ["", null, undefined, "abc", "NaN", "Infinity", "1e400", {}]) {
    assert.equal(readNumber(unusable, workloadLimits.calls, 42), 42, `${String(unusable)} falls back`);
  }
});

test("a zero cache share is a real value, not a missing one", () => {
  assert.equal(readNumber("0", workloadLimits.cacheRatio, 0.6), 0);
  assert.equal(readNumber(0, workloadLimits.cacheRatio, 0.6), 0);
  assert.equal(clamp(0.99, workloadLimits.cacheRatio), workloadLimits.cacheRatio.max);
});

test("normalising keeps a known scenario and rejects an unknown one", () => {
  const fallback = workloadFromScenario(preset);
  assert.equal(
    normalizeWorkload({ scenarioId: other.id }, fallback, scenarios.map((s) => s.id)).scenarioId,
    other.id,
  );
  assert.equal(
    normalizeWorkload({ scenarioId: "not-a-scenario" }, fallback, scenarios.map((s) => s.id)).scenarioId,
    preset.id,
  );
});

test("the guards accept only their own vocabulary", () => {
  assert.equal(isObjective("capability"), true);
  assert.equal(isObjective("cheapest"), false);
  assert.equal(isAccessRequirement("coding-client"), true);
  assert.equal(isAccessRequirement("cli"), false);
  assert.equal(isPreference("plans"), true);
  assert.equal(isPreference("plan"), false);
});

// -- Link round trip ----------------------------------------------------------

test("a complete workload survives serialisation and parsing", () => {
  const state = {
    workload: {
      scenarioId: other.id,
      input: 12_345,
      output: 4_321,
      calls: 777,
      cacheRatio: 0.42,
      budget: 250,
      access: "coding-client",
    },
    objective: "capability",
    preference: "plans",
  };
  const restored = parseRecommendState(recommendParams(state), baseState, scenarios);
  assert.deepEqual(restored.workload, state.workload);
  assert.equal(restored.objective, state.objective);
  assert.equal(restored.preference, state.preference);
  assert.equal(sameWorkload(restored.workload, state.workload), true);
});

test("naming a scenario without numbers restores that preset's whole typical month", () => {
  const restored = parseRecommendState(
    new URLSearchParams({ scenario: other.id }),
    baseState,
    scenarios,
  );
  assert.equal(matchesScenarioPreset(restored.workload, other), true);
  // The reader's own budget is theirs, not the preset's, so it carries over.
  assert.equal(restored.workload.budget, baseState.workload.budget);
});

test("a link's numbers win over the preset it names", () => {
  const restored = parseRecommendState(
    new URLSearchParams({ scenario: other.id, calls: "999", input: "1000" }),
    baseState,
    scenarios,
  );
  assert.equal(restored.workload.calls, 999);
  assert.equal(restored.workload.input, 1000);
  assert.equal(restored.workload.output, other.output, "unnamed fields still come from the preset");
});

test("saved preferences fill in what the link does not carry", () => {
  const saved = {
    workload: { ...workloadFromScenario(preset), budget: 500, access: "chat-app" },
    objective: "budget",
    preference: "api",
  };
  const restored = parseRecommendState(new URLSearchParams({ calls: "10" }), saved, scenarios);
  assert.equal(restored.workload.calls, 10);
  assert.equal(restored.workload.budget, 500);
  assert.equal(restored.workload.access, "chat-app");
  assert.equal(restored.objective, "budget");
  assert.equal(restored.preference, "api");
});

test("invalid, nonfinite and oversized link values fall back instead of poisoning the workload", () => {
  const restored = parseRecommendState(
    new URLSearchParams({
      scenario: "nonsense",
      calls: "not-a-number",
      budget: "Infinity",
      input: "1e400",
      output: "-5",
      cache: "9",
      access: "carrier-pigeon",
      priority: "vibes",
      preference: "whatever",
    }),
    baseState,
    scenarios,
  );
  assert.equal(restored.workload.scenarioId, baseState.workload.scenarioId);
  assert.equal(restored.workload.calls, baseState.workload.calls);
  assert.equal(restored.workload.budget, baseState.workload.budget);
  assert.equal(restored.workload.input, baseState.workload.input);
  assert.equal(restored.workload.output, workloadLimits.output.min, "a negative count clamps to the floor");
  assert.equal(restored.workload.cacheRatio, workloadLimits.cacheRatio.max);
  assert.equal(restored.workload.access, baseState.workload.access);
  assert.equal(restored.objective, baseState.objective);
  assert.equal(restored.preference, baseState.preference);
});

test("the default workload opens on a real preset with the published default budget", () => {
  const workload = workloadFromScenario(preset);
  assert.equal(workload.budget, defaultBudget);
  assert.equal(matchesScenarioPreset(workload, preset), true);
  assert.equal(workload.access, "any");
});

// -- Routes -------------------------------------------------------------------

test("legacy view links name the route their parameters belong to", () => {
  assert.equal(legacyRouteFor(new URLSearchParams("view=recommendation")), "recommend");
  assert.equal(legacyRouteFor(new URLSearchParams("view=rank")), "tierList");
  assert.equal(legacyRouteFor(new URLSearchParams("view=explore")), "rankings");
  assert.equal(legacyRouteFor(new URLSearchParams("view=nonsense")), null);
  assert.equal(legacyRouteFor(new URLSearchParams("")), null);
});

test("every route is a directory path, so a static host can serve it", () => {
  for (const path of Object.values(routes)) {
    assert.match(path, /^\/([a-z-]+\/)?$/, `${path} ends in a slash`);
  }
});

test("rankings keeps its own scenario parameter and ignores an unknown one", () => {
  assert.equal(parseRankingsScenario(new URLSearchParams({ scenario: other.id }), preset.id, scenarios), other.id);
  assert.equal(parseRankingsScenario(new URLSearchParams({ scenario: "nope" }), preset.id, scenarios), preset.id);
  assert.equal(parseRankingsScenario(new URLSearchParams(), preset.id, scenarios), preset.id);
});

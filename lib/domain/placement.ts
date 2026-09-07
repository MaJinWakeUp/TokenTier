// Derived tier placements. Tiers rank value among the models that already
// cleared the capability bar, so the letters describe price-for-capability,
// not raw capability. Nothing here is hand-graded.
//
// Placement is curved: the qualified population is ordered by cost and cut at
// the published proportions, so the board reads as a spread from S to D rather
// than collapsing into one letter. Fixed cost-ratio bands used to do this, and
// they had a real advantage — a letter meant the same multiple of the cheapest
// price in every scenario. But one unusually cheap model is enough to push
// every other option past the last band, which is how a board ended up with a
// populated S, an empty A and B, and everything else in C. A curve trades the
// absolute reading for a board that always distinguishes.

import type { Confidence, Model, Plan, Scenario, Tier, UsageSettings } from "../catalog/types.js";
import { gateModel, metricValue, scenarioTokens, unscored, type Rejection } from "./eligibility.js";
import { callCost, creditsPerCall, planEstimate, planCoverageScore } from "./pricing.js";

export type Placement =
  | { state: "tier"; tier: Tier; index: number; minIndex: number; headroom: number }
  | { state: "below"; index: number; minIndex: number }
  | { state: "context"; index: number; minIndex: number }
  | { state: "unpriced" }
  | { state: "unscored" };

export const noPlacement: Placement = unscored as Placement;

export const tierRank: Record<Tier, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };

export const tierLetters: Tier[] = ["S", "A", "B", "C", "D"];

// The proportions the curve cuts at, used when the catalog is big enough to
// fill every letter. Overridden by scenarios.tierCuts.
export const DEFAULT_TIER_CUTS: [number, number, number, number] = [0.2, 0.4, 0.6, 0.8];

export type Priced = { id: string; cost: number };

// Curve a priced population onto the tier letters.
//
// Equal costs are grouped first and placed together, so two options that cost
// the same can never be separated by a letter — the group, not the item, is
// what gets a position. Ordering is by cost then id, so the result is
// deterministic and independent of the order the caller passed items in.
//
// When there are fewer distinct prices than letters, the letters are used from
// S downward, one per group. That keeps the board contiguous instead of
// printing empty rows at the bottom.
export function curveTiers(
  items: Priced[],
  cuts: [number, number, number, number] = DEFAULT_TIER_CUTS,
): Map<string, Tier> {
  const placed = new Map<string, Tier>();
  if (items.length === 0) return placed;

  const sorted = [...items].sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  const groups: Array<{ cost: number; ids: string[] }> = [];
  for (const item of sorted) {
    const last = groups.at(-1);
    if (last && last.cost === item.cost) last.ids.push(item.id);
    else groups.push({ cost: item.cost, ids: [item.id] });
  }

  // Not enough distinct prices to fill the board: one letter per price.
  if (groups.length < tierLetters.length) {
    groups.forEach((group, index) => {
      for (const id of group.ids) placed.set(id, tierLetters[index]);
    });
    return placed;
  }

  groups.forEach((group, index) => {
    const position = index / groups.length;
    const cut = cuts.findIndex((boundary) => position < boundary);
    const tier = tierLetters[cut === -1 ? tierLetters.length - 1 : cut];
    for (const id of group.ids) placed.set(id, tier);
  });
  return placed;
}

export const confidenceScore: Record<Confidence, number> = {
  High: 30,
  Medium: 20,
  Low: 10,
};

export function standardScore(values: number[]) {
  if (values.length === 0) return () => 0;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  const deviation = Math.sqrt(variance);
  if (!Number.isFinite(deviation) || deviation === 0) return () => 0;
  return (value: number) => (value - mean) / deviation;
}

// Cheaper is better, on a log scale: a model half the price of another is a
// fixed step better whether the prices are cents or dollars.
export function costStrength(cost: number) {
  return -Math.log(Math.max(cost, 1e-9));
}

export function modelPlacements(
  models: Model[],
  scenario: Scenario,
  tierCuts: [number, number, number, number],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  rankingWeights: { cost: number; headroom: number },
): Map<string, Placement> {
  const placed = new Map<string, Placement>();
  const requiredTokens = scenarioTokens(scenario);
  const settings: UsageSettings = {
    input: scenario.input,
    output: scenario.output,
    cacheRatio: scenario.cacheRatio,
  };
  const eligible: Array<{ id: string; index: number; cost: number }> = [];

  for (const model of models) {
    const rejection = gateModel(model, scenario, requiredTokens);
    if (rejection) {
      placed.set(model.id, rejection as Placement);
      continue;
    }
    const cost = callCost(model, settings);
    // A model with unsupported pricing (NaN cost, F6) is not placed — it
    // passes the capability gate but its cost cannot be compared.
    if (Number.isNaN(cost)) {
      placed.set(model.id, { state: "unscored" });
      continue;
    }
    eligible.push({
      id: model.id,
      index: metricValue(model.capability, scenario.gate.metric) as number,
      cost,
    });
  }

  const minIndex = scenario.gate.minIndex;
  // The curve is taken over every eligible model, not the filtered view, so a
  // provider filter or a search never changes the letters on the board.
  const curved = curveTiers(eligible, tierCuts);

  for (const item of eligible) {
    placed.set(item.id, {
      state: "tier",
      tier: curved.get(item.id) as Tier,
      index: item.index,
      minIndex,
      headroom: item.index - minIndex,
    });
  }

  return placed;
}

// A plan is judged on the model a sensible user would reach for: the cheapest
// one it offers that clears the scenario's bar and holds the work. Judging every
// plan by one fixed model misstates both its capability and its capacity.
//
// For credit-allowance plans, the model selection uses credits per call (most
// calls per credit budget), NOT the cheapest API rate. The credit formula is
// independent of API price (F5).
export function planWorkingModel(
  plan: Plan,
  scenario: Scenario,
  settings: UsageSettings,
  modelById: Map<string, Model>,
) {
  const requiredTokens = settings.input + settings.output;
  const eligible = plan.modelIds
    .map((id) => modelById.get(id))
    .filter((model): model is Model => Boolean(model))
    .filter((model) => gateModel(model, scenario, requiredTokens) === null)
    // A credit-metered plan can only be costed on models it publishes multipliers for.
    .filter((model) => !plan.weeklyCredits || Boolean(plan.creditMultipliers?.[model.id]))
    // A model with unsupported pricing (NaN cost, F6) cannot be a working model.
    .filter((model) => !Number.isNaN(callCost(model, settings, plan.cacheRatio)));
  if (eligible.length === 0) return null;

  // Credit-allowance plans: select the model with the most credits per call
  // (cheapest in credit terms), not the cheapest API rate (F5).
  if (plan.quotaDetail?.kind === "credit-allowance") {
    const withCredits = eligible
      .map((model) => ({ model, cpc: creditsPerCall(plan, model, settings) }))
      .filter((entry): entry is { model: Model; cpc: number } => entry.cpc !== null);
    if (withCredits.length > 0) {
      return [...withCredits]
        .sort((a, b) => a.cpc - b.cpc || a.model.id.localeCompare(b.model.id))[0]
        .model;
    }
    return null;
  }

  return [...eligible].sort(
    (a, b) => callCost(a, settings, plan.cacheRatio) - callCost(b, settings, plan.cacheRatio)
      || a.id.localeCompare(b.id),
  )[0];
}

// Why a plan is off the board, when none of its models qualifies.
export function planRejection(
  plan: Plan,
  scenario: Scenario,
  settings: UsageSettings,
  modelById: Map<string, Model>,
): Placement {
  const requiredTokens = settings.input + settings.output;
  const offered = plan.modelIds
    .map((id) => modelById.get(id))
    .filter((model): model is Model => Boolean(model));
  if (offered.length === 0) return noPlacement;
  // Report the closest miss, so the reason names the plan's best model.
  return offered
    .map((model) => (gateModel(model, scenario, requiredTokens) ?? unscored) as Placement)
    .sort((a, b) => placementSort(b, a))[0];
}

export function planPlacements(
  plans: Plan[],
  scenario: Scenario,
  modelById: Map<string, Model>,
  tierCuts: [number, number, number, number],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  rankingWeights: { price: number; headroom: number; confidence: number },
): Map<string, Placement> {
  const placed = new Map<string, Placement>();
  const settings: UsageSettings = {
    input: scenario.input,
    output: scenario.output,
    cacheRatio: scenario.cacheRatio,
  };
  const eligible: Array<{ id: string; index: number; monthly: number }> = [];

  for (const plan of plans) {
    const model = planWorkingModel(plan, scenario, settings, modelById);
    if (!model) {
      placed.set(plan.id, planRejection(plan, scenario, settings, modelById));
      continue;
    }
    if (plan.monthly === null || plan.monthly <= 0) {
      placed.set(plan.id, { state: "unpriced" });
      continue;
    }

    // Exclude plans with insufficient, unknown, or conditional coverage from
    // qualified tiers. Only plans with verified, sufficient coverage get tiered.
    const estimate = planEstimate(plan, settings, model, modelById.get(plan.modelIds[0]));
    if (!estimate) {
      placed.set(plan.id, { state: "unscored" });
      continue;
    }
    if (estimate.basis.kind === "break-even") {
      // Break-even: not a verified allowance, so not a qualified tier.
      placed.set(plan.id, { state: "unpriced" });
      continue;
    }
    if (estimate.basis.kind === "unknown-quota" || estimate.basis.kind === "conditional") {
      // Unknown or conditional coverage: cannot prove sufficient monthly capacity.
      placed.set(plan.id, { state: "unscored" });
      continue;
    }

    // Check coverage against the scenario's call volume.
    const coverage = planCoverageScore(plan, settings, scenario.calls, model, modelById.get(plan.modelIds[0]));
    if (coverage === null || coverage < 100) {
      // Insufficient coverage: not a qualified tier.
      placed.set(plan.id, { state: "unscored" });
      continue;
    }

    eligible.push({
      id: plan.id,
      index: metricValue(model.capability, scenario.gate.metric) as number,
      monthly: plan.monthly,
    });
  }

  const minIndex = scenario.gate.minIndex;
  const curved = curveTiers(
    eligible.map((item) => ({ id: item.id, cost: item.monthly })),
    tierCuts,
  );

  for (const item of eligible) {
    placed.set(item.id, {
      state: "tier",
      tier: curved.get(item.id) as Tier,
      index: item.index,
      minIndex,
      headroom: item.index - minIndex,
    });
  }

  return placed;
}

export function placementSort(a: Placement, b: Placement) {
  const rank = (placement: Placement) => (placement.state === "tier" ? tierRank[placement.tier] : 0);
  const index = (placement: Placement) => ("index" in placement ? placement.index : -Infinity);
  return rank(a) - rank(b) || index(a) - index(b);
}

export function gateSummary(models: Model[], placements: Map<string, Placement>) {
  const values = [...placements.values()];
  return {
    qualifying: values.filter((placement) => placement.state === "tier").length,
    below: values.filter((placement) => placement.state === "below").length,
    context: values.filter((placement) => placement.state === "context").length,
    unscored: values.filter((placement) => placement.state === "unscored").length,
    total: models.length,
  };
}

export type { Rejection };

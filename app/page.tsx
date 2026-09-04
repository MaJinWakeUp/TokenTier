"use client";

import modelCatalog from "@/data/api-models.json";
import planCatalog from "@/data/plans.json";
import scenarioCatalog from "@/data/scenarios.json";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import RankBoard from "./rank-board";

type ScenarioId = string;
type MetricKey = "intelligence" | "codingAgent" | "agentic" | "longContext";
type Tier = "S" | "A" | "B" | "C";
type Confidence = "High" | "Medium" | "Low";
type Lane = "api" | "plans";
type Preference = "either" | "api" | "plans";
type View = "explore" | "recommendation" | "rank";
// Where on the value frontier the API recommendation should sit. Cost-minimising
// alone always returns the floor, which never varies by workload.
type ApiPriority = "cost" | "budget" | "capability";
type ApiColumnKey = "input" | "cached" | "output" | "context" | "index" | "fit" | "cost";
type PlanColumnKey = "type" | "price" | "quota" | "apiIncluded" | "equivalent" | "fit" | "evidence";

const apiColumnLabels: Record<ApiColumnKey, string> = {
  input: "Input / 1M",
  cached: "Cached input",
  output: "Output / 1M",
  context: "Context",
  index: "Index",
  fit: "Fit",
  cost: "Est. / call",
};

const planColumnLabels: Record<PlanColumnKey, string> = {
  type: "Type",
  price: "Price",
  quota: "Published quota",
  apiIncluded: "API included?",
  equivalent: "API-cost equivalent",
  fit: "Fit",
  evidence: "Evidence",
};

const viewTitles: Record<View, string> = {
  explore: "Explore AI prices and tiers — TokenTier",
  recommendation: "Personal AI recommendation — TokenTier",
  rank: "Rank AI models and plans — TokenTier",
};

const defaultApiColumns: Record<ApiColumnKey, boolean> = {
  input: true,
  cached: true,
  output: true,
  context: true,
  index: true,
  fit: true,
  cost: true,
};

const defaultPlanColumns: Record<PlanColumnKey, boolean> = {
  type: true,
  price: true,
  quota: true,
  apiIncluded: true,
  equivalent: true,
  fit: true,
  evidence: true,
};

function parseColumnPreferences<Key extends string>(
  raw: string | null,
  defaults: Record<Key, boolean>,
): Record<Key, boolean> | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const entries = Object.keys(defaults).map((key) => [key, (parsed as Record<string, unknown>)[key]] as const);
    if (entries.some(([, value]) => typeof value !== "boolean")) return null;

    return Object.fromEntries(entries) as Record<Key, boolean>;
  } catch {
    return null;
  }
}

type UsageSettings = {
  input: number;
  output: number;
  // Share of input billed at the cached rate. A profile that resends a stable
  // prefix pays the cached rate for most of its input, which changes the
  // ranking, not just the totals.
  cacheRatio: number;
};

// Published capability scores. `null` is a deliberate third state: the model is
// listed and priced, but no independent score exists, so it never gets a tier.
type Capability = {
  metrics: Partial<Record<MetricKey, number>>;
  indexVersion: string;
  variant?: string;
  source: string;
  verifiedAt: string;
};

type Model = {
  id: string;
  provider: string;
  name: string;
  input: number;
  cached: number | null;
  output: number;
  context: string;
  source: string;
  verifiedAt: string;
  note?: string;
  capability: Capability | null;
};

type Plan = {
  id: string;
  provider: string;
  name: string;
  kind: "Subscription" | "BYOK client" | "Pay as you go";
  monthly: number | null;
  // Every model the plan gives access to. Which one a scenario uses is chosen
  // per workload, because a $60 allowance goes much further on a small model.
  modelIds: string[];
  source: string;
  note: string;
  quota: string;
  evidence: "Official quota" | "Official credit" | "Official relative limit" | "Price break-even";
  confidence: Confidence;
  apiIncluded: string;
  verifiedAt: string;
  includedApiValue?: number;
  weeklyCredits?: number;
  // Keyed by model id: providers publish credit multipliers per model.
  creditMultipliers?: Record<string, [number, number, number]>;
  cacheRatio?: number;
};

// The capability bar a scenario demands, plus the anchor model that makes the
// number re-derivable when the index is rebased.
type Gate = {
  metric: MetricKey;
  minIndex: number;
  anchor: string;
  rationale: string;
  preferredMetric?: MetricKey;
};

type CompareRow = {
  label: string;
  render: (item: Model | Plan) => React.ReactNode;
  // Present only on rows where one value is objectively better.
  score?: (item: Model | Plan) => number | null;
  better?: "higher" | "lower";
};

type Scenario = {
  id: ScenarioId;
  label: string;
  input: number;
  output: number;
  calls: number;
  cacheRatio: number;
  description: string;
  rationale: string;
  gate: Gate;
};

const capabilityIndex = modelCatalog.capabilityIndex;
const models = modelCatalog.models as Model[];
const modelById = new Map(models.map((model) => [model.id, model]));
const plans = planCatalog.plans as Plan[];
const planCatalogUpdatedAt = planCatalog.updatedAt;
const scenarios = scenarioCatalog.scenarios as Scenario[];
const tierCuts = scenarioCatalog.tierCuts as [number, number, number];
const rankingWeights = scenarioCatalog.ranking;

const metricLabels: Record<MetricKey, string> = {
  intelligence: "Intelligence Index",
  codingAgent: "Coding Agent Index",
  agentic: "Agentic Index",
  longContext: "Long-context Index",
};

const tierOrder: Tier[] = ["S", "A", "B", "C"];

// Tiers rank value among the models that already cleared the capability bar,
// so the letters describe price-for-capability, not raw capability.
const tierDescriptions: Record<Tier, string> = {
  S: "Best value above the bar",
  A: "Strong value",
  B: "Fair value",
  C: "Weakest value above the bar",
};

const tierRank: Record<Tier, number> = { S: 4, A: 3, B: 2, C: 1 };

const confidenceScore: Record<Confidence, number> = {
  High: 30,
  Medium: 20,
  Low: 10,
};

const providerPriority = ["OpenAI", "Anthropic", "xAI", "Google"];

function byProviderPriority(a: string, b: string) {
  const aIdx = providerPriority.indexOf(a);
  const bIdx = providerPriority.indexOf(b);
  if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
  if (aIdx !== -1) return -1;
  if (bIdx !== -1) return 1;
  return a.localeCompare(b);
}

function providerFilterNames(providers: string[]) {
  return ["All", ...Array.from(new Set(providers)).sort(byProviderPriority)];
}

const providerNames = providerFilterNames(models.map((model) => model.provider));
const planProviderNames = providerFilterNames(plans.map((plan) => plan.provider));

function price(value: number, digits = 2) {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(digits > 2 ? digits : 4)}`;
  return `$${value.toFixed(digits)}`;
}

function monthlyPrice(value: number) {
  if (value === 0) return "$0";
  if (value < 1) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString()}`;
}

// Whole-dollar rounding can land a figure on the wrong side of the budget it is
// being judged against: $3.33 renders as "$3" beside an "over budget" tag on a
// $3 budget. Keep cents whenever the rounded value would contradict the verdict.
function monthlyPriceAgainst(value: number, reference: number) {
  const rounded = Math.round(value);
  const contradicts = (value > reference && rounded <= reference)
    || (value < reference && rounded > reference);
  return contradicts ? `$${value.toFixed(2)}` : monthlyPrice(value);
}

function contextSize(context: string): number {
  const normalized = context.trim().toUpperCase();
  if (normalized.endsWith("M")) {
    return parseFloat(normalized.slice(0, -1)) * 1_000_000;
  }
  if (normalized.endsWith("K")) {
    return parseFloat(normalized.slice(0, -1)) * 1_000;
  }
  return parseFloat(normalized) || 0;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.round(value));
}

function callCost(model: Model, settings: UsageSettings, cacheRatioOverride?: number) {
  // A plan's own cache behaviour wins when it publishes one; otherwise the
  // workload's reuse share applies.
  const cacheRatio = cacheRatioOverride ?? settings.cacheRatio;
  const cachedRate = model.cached ?? model.input;
  const inputCost = (settings.input * (1 - cacheRatio) * model.input + settings.input * cacheRatio * cachedRate) / 1_000_000;
  const outputCost = (settings.output * model.output) / 1_000_000;
  return inputCost + outputCost;
}

function planPrice(plan: Plan) {
  if (plan.monthly === null) return "Pay as you go";
  return `$${plan.monthly}`;
}

function planQuota(plan: Plan, scenarioId: ScenarioId) {
  if (plan.id === "chatgpt-go") return plan.quota;
  if (!plan.id.startsWith("chatgpt-")) return plan.quota;
  const modelClass = ["daily", "code-easy"].includes(scenarioId)
    ? "Luna"
    : ["code-medium", "innovation"].includes(scenarioId)
      ? "Terra"
      : "Sol";
  const ranges = {
    "chatgpt-plus": { Luna: "250–2,000", Terra: "25–200", Sol: "10–100" },
    "chatgpt-pro-5x": { Luna: "1,250–10,000", Terra: "125–1,000", Sol: "50–500" },
    "chatgpt-pro-20x": { Luna: "5,000–40,000", Terra: "500–4,000", Sol: "200–2,000" },
  } as const;
  const range = ranges[plan.id as keyof typeof ranges]?.[modelClass];
  return range ? `${range} ${modelClass} local messages / 5h` : plan.quota;
}

function planEstimate(plan: Plan, settings: UsageSettings, workingModel?: Model | null) {
  const model = workingModel ?? modelById.get(plan.modelIds[0]);
  if (!model) return null;
  const referenceCost = callCost(model, settings, plan.cacheRatio);
  const multipliers = plan.creditMultipliers?.[model.id];

  if (plan.weeklyCredits && multipliers) {
    const [inputMultiplier, cachedMultiplier, outputMultiplier] = multipliers;
    const cacheRatio = plan.cacheRatio ?? settings.cacheRatio;
    const creditsPerCall = (
      settings.input * (1 - cacheRatio) * inputMultiplier
      + settings.input * cacheRatio * cachedMultiplier
      + settings.output * outputMultiplier
    ) / 10_000;
    const callsLow = (plan.weeklyCredits * 4.33) / creditsPerCall;
    const callsHigh = callsLow * 2;
    return {
      callsLow,
      callsHigh,
      valueLow: callsLow * referenceCost,
      valueHigh: callsHigh * referenceCost,
      basis: "Official credit formula · peak–off-peak",
    };
  }

  if (plan.includedApiValue !== undefined) {
    const calls = plan.includedApiValue / referenceCost;
    return {
      callsLow: calls,
      callsHigh: calls,
      valueLow: plan.includedApiValue,
      valueHigh: plan.includedApiValue,
      basis: plan.evidence === "Official credit" ? "Included API credit" : "Official capped value",
    };
  }

  if (plan.monthly !== null && plan.monthly > 0) {
    const calls = plan.monthly / referenceCost;
    return {
      callsLow: calls,
      callsHigh: calls,
      valueLow: plan.monthly,
      valueHigh: plan.monthly,
      basis: "Price break-even only",
    };
  }

  return null;
}

function formatEstimateRange(low: number, high: number) {
  if (Math.abs(high - low) < 1) return compactNumber(low);
  return `${compactNumber(low)}–${compactNumber(high)}`;
}

function formatMoneyRange(low: number, high: number) {
  if (Math.abs(high - low) < 0.01) return price(low, 0);
  return `${price(low, 0)}–${price(high, 0)}`;
}

function planCoverageScore(plan: Plan, settings: UsageSettings, calls: number, workingModel?: Model | null) {
  const estimate = planEstimate(plan, settings, workingModel);
  if (estimate && (plan.weeklyCredits || plan.includedApiValue !== undefined)) {
    if (estimate.callsLow >= calls) return 100;
    if (estimate.callsHigh >= calls) return 70;
    return Math.max(10, Math.round(20 * (estimate.callsHigh / calls)));
  }
  return null;
}

/* --- Capability gate and derived tiers ------------------------------------
   Eligibility is absolute: a published capability score must clear the bar the
   scenario declares, and the context window must hold the work. Placement among
   the models that cleared it is relative, cut at fixed percentiles, so the board
   keeps a readable spread however the catalog grows. Nothing here is hand-graded.
   -------------------------------------------------------------------------- */

type Placement =
  | { state: "tier"; tier: Tier; index: number; minIndex: number; headroom: number }
  | { state: "below"; index: number; minIndex: number }
  | { state: "context"; index: number; minIndex: number }
  | { state: "unpriced" }
  | { state: "unscored" };

const unscored: Placement = { state: "unscored" };

function metricValue(capability: Capability | null, metric: MetricKey): number | null {
  const value = capability?.metrics?.[metric];
  return typeof value === "number" ? value : null;
}

function standardScore(values: number[]) {
  if (values.length === 0) return () => 0;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  const deviation = Math.sqrt(variance);
  if (!Number.isFinite(deviation) || deviation === 0) return () => 0;
  return (value: number) => (value - mean) / deviation;
}

function tierAtRank(rank: number, total: number): Tier {
  const position = total <= 1 ? 0 : rank / total;
  if (position < tierCuts[0]) return "S";
  if (position < tierCuts[1]) return "A";
  if (position < tierCuts[2]) return "B";
  return "C";
}

function scenarioTokens(scenario: Scenario) {
  return scenario.input + scenario.output;
}

// Cheaper is better, on a log scale: a model half the price of another is a
// fixed step better whether the prices are cents or dollars.
function costStrength(cost: number) {
  return -Math.log(Math.max(cost, 1e-9));
}

function gateModel(model: Model, scenario: Scenario, requiredTokens: number): Placement | null {
  const { metric, minIndex } = scenario.gate;
  const index = metricValue(model.capability, metric);
  if (index === null) return unscored;
  if (index < minIndex) return { state: "below", index, minIndex };
  if (contextSize(model.context) < requiredTokens) return { state: "context", index, minIndex };
  return null;
}

function modelPlacements(scenario: Scenario): Map<string, Placement> {
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
      placed.set(model.id, rejection);
      continue;
    }
    eligible.push({
      id: model.id,
      index: metricValue(model.capability, scenario.gate.metric) as number,
      cost: callCost(model, settings),
    });
  }

  const minIndex = scenario.gate.minIndex;
  const cost = standardScore(eligible.map((item) => costStrength(item.cost)));
  const headroom = standardScore(eligible.map((item) => item.index - minIndex));
  const weights = rankingWeights.models;

  eligible
    .map((item) => ({
      ...item,
      score: weights.cost * cost(costStrength(item.cost)) + weights.headroom * headroom(item.index - minIndex),
    }))
    .sort((a, b) => b.score - a.score || a.cost - b.cost)
    .forEach((item, rank, ranked) => {
      placed.set(item.id, {
        state: "tier",
        tier: tierAtRank(rank, ranked.length),
        index: item.index,
        minIndex,
        headroom: item.index - minIndex,
      });
    });

  return placed;
}

// A plan inherits the capability of the model it routes to, then ranks on what
// a plan actually competes on: price, headroom, and how solid its quota evidence is.
// A plan is judged on the model a sensible user would reach for: the cheapest
// one it offers that clears the scenario's bar and holds the work. Judging every
// plan by one fixed model misstates both its capability and its capacity.
function planWorkingModel(plan: Plan, scenario: Scenario, settings: UsageSettings) {
  const requiredTokens = settings.input + settings.output;
  const eligible = plan.modelIds
    .map((id) => modelById.get(id))
    .filter((model): model is Model => Boolean(model))
    .filter((model) => gateModel(model, scenario, requiredTokens) === null)
    // A credit-metered plan can only be costed on models it publishes multipliers for.
    .filter((model) => !plan.weeklyCredits || Boolean(plan.creditMultipliers?.[model.id]));
  if (eligible.length === 0) return null;
  return [...eligible].sort(
    (a, b) => callCost(a, settings, plan.cacheRatio) - callCost(b, settings, plan.cacheRatio),
  )[0];
}

// Why a plan is off the board, when none of its models qualifies.
function planRejection(plan: Plan, scenario: Scenario, settings: UsageSettings): Placement {
  const requiredTokens = settings.input + settings.output;
  const offered = plan.modelIds
    .map((id) => modelById.get(id))
    .filter((model): model is Model => Boolean(model));
  if (offered.length === 0) return unscored;
  // Report the closest miss, so the reason names the plan's best model.
  return offered
    .map((model) => gateModel(model, scenario, requiredTokens) ?? unscored)
    .sort((a, b) => placementSort(b, a))[0];
}

function planPlacements(scenario: Scenario): Map<string, Placement> {
  const placed = new Map<string, Placement>();
  const settings: UsageSettings = {
    input: scenario.input,
    output: scenario.output,
    cacheRatio: scenario.cacheRatio,
  };
  const eligible: Array<{ id: string; index: number; monthly: number; confidence: Confidence }> = [];

  for (const plan of plans) {
    const model = planWorkingModel(plan, scenario, settings);
    if (!model) {
      placed.set(plan.id, planRejection(plan, scenario, settings));
      continue;
    }
    if (plan.monthly === null || plan.monthly <= 0) {
      placed.set(plan.id, { state: "unpriced" });
      continue;
    }
    eligible.push({
      id: plan.id,
      index: metricValue(model.capability, scenario.gate.metric) as number,
      monthly: plan.monthly,
      confidence: plan.confidence,
    });
  }

  const minIndex = scenario.gate.minIndex;
  const price = standardScore(eligible.map((item) => costStrength(item.monthly)));
  const headroom = standardScore(eligible.map((item) => item.index - minIndex));
  const confidence = standardScore(eligible.map((item) => confidenceScore[item.confidence]));
  const weights = rankingWeights.plans;

  eligible
    .map((item) => ({
      ...item,
      score: weights.price * price(costStrength(item.monthly))
        + weights.headroom * headroom(item.index - minIndex)
        + weights.confidence * confidence(confidenceScore[item.confidence]),
    }))
    .sort((a, b) => b.score - a.score || a.monthly - b.monthly)
    .forEach((item, rank, ranked) => {
      placed.set(item.id, {
        state: "tier",
        tier: tierAtRank(rank, ranked.length),
        index: item.index,
        minIndex,
        headroom: item.index - minIndex,
      });
    });

  return placed;
}

// Every input is static data, so the whole board is derived once at module load.
const placementsByScenario = new Map(
  scenarios.map((scenario) => [
    scenario.id,
    { models: modelPlacements(scenario), plans: planPlacements(scenario) },
  ]),
);

const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

function scenarioFor(scenarioId: ScenarioId): Scenario {
  return scenarioById.get(scenarioId) ?? scenarios[0];
}

function settingsFor(scenarioId: ScenarioId): UsageSettings {
  const scenario = scenarioFor(scenarioId);
  return { input: scenario.input, output: scenario.output, cacheRatio: scenario.cacheRatio };
}

// The profile the app opens on. Every initial value is read from this one
// scenario, so the work-type selector can never disagree with the token counts,
// call volume and cache share shown underneath it.
const defaultScenario = scenarioFor("code-medium");
const defaultScenarioId = defaultScenario.id;

function modelPlacement(id: string, scenarioId: ScenarioId): Placement {
  return placementsByScenario.get(scenarioId)?.models.get(id) ?? unscored;
}

function planPlacement(id: string, scenarioId: ScenarioId): Placement {
  return placementsByScenario.get(scenarioId)?.plans.get(id) ?? unscored;
}

function itemPlacement(item: Model | Plan, scenarioId: ScenarioId): Placement {
  return "kind" in item ? planPlacement(item.id, scenarioId) : modelPlacement(item.id, scenarioId);
}

function placementLabel(placement: Placement) {
  return placement.state === "tier" ? placement.tier : "—";
}

function placementClass(placement: Placement) {
  return placement.state === "tier" ? `tier-${placement.tier.toLowerCase()}` : "tier-na";
}

function placementReason(placement: Placement, scenario: Scenario, metric: MetricKey) {
  const label = metricLabels[metric];
  switch (placement.state) {
    case "tier":
      return `${label} ${placement.index} clears the ${placement.minIndex} bar for ${scenario.label} with ${placement.headroom} to spare. Tier ${placement.tier}: ${tierDescriptions[placement.tier].toLowerCase()}.`;
    case "below":
      return `${label} ${placement.index} is below the ${placement.minIndex} bar for ${scenario.label}.`;
    case "context":
      return `Context window is smaller than the ${scenarioTokens(scenario).toLocaleString()} tokens this profile needs.`;
    case "unpriced":
      return "No fixed monthly price to rank against.";
    default:
      return `Not scored on the ${label}, so no tier is assigned.`;
  }
}

function placementSort(a: Placement, b: Placement) {
  const rank = (placement: Placement) => (placement.state === "tier" ? tierRank[placement.tier] : 0);
  const index = (placement: Placement) => ("index" in placement ? placement.index : -Infinity);
  return rank(a) - rank(b) || index(a) - index(b);
}

function gateSummary(scenario: Scenario) {
  const placed = placementsByScenario.get(scenario.id);
  const values = [...(placed?.models.values() ?? [])];
  return {
    qualifying: values.filter((placement) => placement.state === "tier").length,
    below: values.filter((placement) => placement.state === "below").length,
    context: values.filter((placement) => placement.state === "context").length,
    unscored: values.filter((placement) => placement.state === "unscored").length,
    total: models.length,
  };
}

// Eligibility for the recommendation view, where the token profile is the user's
// own rather than the scenario preset.
function eligibleModelsFor(scenario: Scenario, settings: UsageSettings) {
  const requiredTokens = settings.input + settings.output;
  return models.filter((model) => gateModel(model, scenario, requiredTokens) === null);
}

function eligiblePlansFor(scenario: Scenario, settings: UsageSettings) {
  return plans.filter((plan) => planWorkingModel(plan, scenario, settings) !== null);
}

function capabilityOf(model: Model | undefined, metric: MetricKey) {
  return model ? metricValue(model.capability, metric) : null;
}

const rankablePlans = plans
  .filter((plan) => plan.kind === "Subscription")
  .map((plan) => ({
    id: plan.id,
    provider: plan.provider,
    name: plan.name,
    detail: plan.monthly === null ? "pay as you go" : `$${plan.monthly}/mo`,
  }));

const rankableModels = models.map((model) => {
  const index = metricValue(model.capability, "intelligence");
  return {
    id: model.id,
    provider: model.provider,
    name: model.name,
    detail: index === null ? "not scored" : `index ${index}`,
  };
});

type IconName =
  | "warning"
  | "check"
  | "copy"
  | "close"
  | "arrow-up"
  | "arrow-down"
  | "arrow-right"
  | "external"
  | "search"
  | "chevron-down";

function Icon({ name, className, size = 16 }: { name: IconName; className?: string; size?: number }) {
  switch (name) {
    case "warning":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" x2="12" y1="9" y2="13" />
          <line x1="12" x2="12.01" y1="17" y2="17" />
        </svg>
      );
    case "check":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case "copy":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <rect height="14" rx="2" ry="2" width="14" x="8" y="8" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      );
    case "close":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
    case "arrow-up":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="m5 12 7-7 7 7" />
          <path d="M12 19V5" />
        </svg>
      );
    case "arrow-down":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="m19 12-7 7-7-7" />
          <path d="M12 5v14" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      );
    case "external":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
      );
    case "search":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
  }
}

function Modal({
  isOpen,
  onClose,
  title,
  titleId,
  children,
  maxWidth = "640px",
}: {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  titleId: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    triggerRef.current = document.activeElement;
    document.body.style.overflow = "hidden";
    const closeBtn = modalRef.current?.querySelector<HTMLButtonElement>(".modal-close-btn");
    closeBtn?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") {
        const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <button aria-label="Close modal overlay" className="modal-backdrop-dismiss" onClick={onClose} type="button" />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="detail-modal"
        ref={modalRef}
        role="dialog"
        style={{ maxWidth }}
      >
        <header className="detail-modal-header">
          <div className="detail-modal-title-wrap">
            {title}
          </div>
          <button aria-label="Close modal" className="modal-close-btn" onClick={onClose} type="button">
            <Icon name="close" size={16} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

type ThemeMode = "system" | "light" | "dark";

function getThemeSnapshot(): string {
  if (typeof window === "undefined") return "system:dark";
  const system = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  try {
    const saved = localStorage.getItem("tokentier-theme");
    if (saved === "light" || saved === "dark") return `${saved}:${saved}`;
    if (saved === "system") return `system:${system}`;
  } catch {
    // ignore
  }
  return `system:${system}`;
}

function getServerThemeSnapshot(): string {
  return "system:dark";
}

function subscribeTheme(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", callback);
  window.addEventListener("storage", callback);
  return () => {
    media.removeEventListener("change", callback);
    window.removeEventListener("storage", callback);
  };
}

export default function Home() {
  const [activeView, setActiveView] = useState<View>("explore");
  const [exploreScenarioId, setExploreScenarioId] = useState<ScenarioId>(defaultScenarioId);
  const [recommendationScenarioId, setRecommendationScenarioId] = useState<ScenarioId>(defaultScenarioId);
  const [recommendationInputTokens, setRecommendationInputTokens] = useState(defaultScenario.input);
  const [recommendationOutputTokens, setRecommendationOutputTokens] = useState(defaultScenario.output);
  const [recommendationCacheRatio, setRecommendationCacheRatio] = useState(defaultScenario.cacheRatio);
  const [apiPriority, setApiPriority] = useState<ApiPriority>("budget");
  const [exploreLane, setExploreLane] = useState<Lane>("api");
  const [recComparisonTab, setRecComparisonTab] = useState<Lane>("api");
  const [monthlyCalls, setMonthlyCalls] = useState(defaultScenario.calls);
  const [monthlyBudget, setMonthlyBudget] = useState(30);
  const [preference, setPreference] = useState<Preference>("either");
  const [showAllPlans, setShowAllPlans] = useState(false);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("cost");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeDetailItem, setActiveDetailItem] = useState<Model | Plan | null>(null);
  const [compareList, setCompareList] = useState<Array<Model | Plan>>([]);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  const searchInputRef = useRef<HTMLInputElement>(null);
  const columnsSelectorRef = useRef<HTMLDetailsElement>(null);

  const [visibleApiColumns, setVisibleApiColumns] = useState<Record<ApiColumnKey, boolean>>({ ...defaultApiColumns });
  const [visiblePlanColumns, setVisiblePlanColumns] = useState<Record<PlanColumnKey, boolean>>({ ...defaultPlanColumns });

  const switchView = (view: View) => {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => {
      if (view === "explore") {
        document.getElementById("explore-top-heading")?.focus();
      } else if (view === "recommendation") {
        document.getElementById("recommendation-top-heading")?.focus();
      } else {
        document.getElementById("rank-top-heading")?.focus();
      }
    }, 50);
  };

  const handleFooterNav = (e: React.MouseEvent<HTMLAnchorElement>, targetId: string) => {
    if (activeView !== "explore") {
      e.preventDefault();
      switchView("explore");
      setTimeout(() => {
        const el = document.getElementById(targetId);
        el?.scrollIntoView({ behavior: "smooth" });
      }, 60);
    }
  };

  const themeSnapshot = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const [themeMode, activeTheme] = themeSnapshot.split(":") as [ThemeMode, "light" | "dark"];

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    document.title = viewTitles[activeView];
  }, [activeView]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time client state hydration from localStorage and URL params */
    try {
      const savedView = localStorage.getItem("tokentier-view");
      if (savedView === "explore" || savedView === "recommendation" || savedView === "rank") {
        setActiveView(savedView);
      }
      const savedCalls = localStorage.getItem("tokentier-rec-calls");
      if (savedCalls) setMonthlyCalls(Math.min(100_000, Math.max(1, Number(savedCalls) || 500)));
      const savedBudget = localStorage.getItem("tokentier-rec-budget");
      if (savedBudget) setMonthlyBudget(Math.min(10_000, Math.max(1, Number(savedBudget) || 30)));
      const savedInput = localStorage.getItem("tokentier-rec-input");
      if (savedInput) setRecommendationInputTokens(Math.min(1_000_000, Math.max(1, Number(savedInput) || defaultScenario.input)));
      const savedOutput = localStorage.getItem("tokentier-rec-output");
      if (savedOutput) setRecommendationOutputTokens(Math.min(500_000, Math.max(1, Number(savedOutput) || defaultScenario.output)));
      const savedCache = localStorage.getItem("tokentier-rec-cache");
      if (savedCache !== null && savedCache !== "") {
        const parsed = Number(savedCache);
        if (!Number.isNaN(parsed)) setRecommendationCacheRatio(Math.min(0.95, Math.max(0, parsed)));
      }
      const savedPriority = localStorage.getItem("tokentier-rec-priority");
      if (savedPriority === "cost" || savedPriority === "budget" || savedPriority === "capability") {
        setApiPriority(savedPriority);
      }
      const savedPref = localStorage.getItem("tokentier-rec-pref");
      if (savedPref === "either" || savedPref === "api" || savedPref === "plans") setPreference(savedPref);
      const savedApiCols = parseColumnPreferences(localStorage.getItem("tokentier-api-cols"), defaultApiColumns);
      if (savedApiCols) setVisibleApiColumns(savedApiCols);
      const savedPlanCols = parseColumnPreferences(localStorage.getItem("tokentier-plan-cols"), defaultPlanColumns);
      if (savedPlanCols) setVisiblePlanColumns(savedPlanCols);
    } catch {
      // ignore
    }

    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");
    const scenarioParam = params.get("scenario");
    const callsParam = params.get("calls");
    const budgetParam = params.get("budget");
    const inputParam = params.get("input");
    const outputParam = params.get("output");
    const prefParam = params.get("preference");

    if (viewParam === "explore" || viewParam === "recommendation" || viewParam === "rank") setActiveView(viewParam);
    const selectedScenario = scenarios.find((scenario) => scenario.id === scenarioParam);
    if (selectedScenario) {
      setExploreScenarioId(selectedScenario.id);
      setRecommendationScenarioId(selectedScenario.id);
      setRecommendationInputTokens(selectedScenario.input);
      setRecommendationOutputTokens(selectedScenario.output);
      setRecommendationCacheRatio(selectedScenario.cacheRatio);
      setMonthlyCalls(selectedScenario.calls);
    }
    if (callsParam) {
      const c = Number(callsParam);
      if (!Number.isNaN(c) && c >= 1 && c <= 100_000) setMonthlyCalls(c);
    }
    if (budgetParam) {
      const b = Number(budgetParam);
      if (!Number.isNaN(b) && b >= 1 && b <= 10_000) setMonthlyBudget(b);
    }
    if (inputParam) {
      const i = Number(inputParam);
      if (!Number.isNaN(i) && i >= 1 && i <= 1_000_000) setRecommendationInputTokens(i);
    }
    if (outputParam) {
      const o = Number(outputParam);
      if (!Number.isNaN(o) && o >= 1 && o <= 500_000) setRecommendationOutputTokens(o);
    }
    if (prefParam === "either" || prefParam === "api" || prefParam === "plans") {
      setPreference(prefParam);
    }
    const cacheParam = params.get("cache");
    if (cacheParam) {
      const parsed = Number(cacheParam);
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 0.95) setRecommendationCacheRatio(parsed);
    }
    const priorityParam = params.get("priority");
    if (priorityParam === "cost" || priorityParam === "budget" || priorityParam === "capability") {
      setApiPriority(priorityParam);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", activeView);
    if (activeView === "rank") params.delete("scenario");
    else params.set("scenario", activeView === "recommendation" ? recommendationScenarioId : exploreScenarioId);
    if (activeView === "recommendation") {
      params.set("calls", monthlyCalls.toString());
      params.set("budget", monthlyBudget.toString());
      params.set("input", recommendationInputTokens.toString());
      params.set("output", recommendationOutputTokens.toString());
      params.set("cache", recommendationCacheRatio.toString());
      params.set("preference", preference);
      params.set("priority", apiPriority);
    } else {
      for (const key of ["calls", "budget", "input", "output", "cache", "preference", "priority"]) {
        params.delete(key);
      }
    }
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", newUrl);

    try {
      localStorage.setItem("tokentier-view", activeView);
      localStorage.setItem("tokentier-rec-calls", monthlyCalls.toString());
      localStorage.setItem("tokentier-rec-budget", monthlyBudget.toString());
      localStorage.setItem("tokentier-rec-input", recommendationInputTokens.toString());
      localStorage.setItem("tokentier-rec-output", recommendationOutputTokens.toString());
      localStorage.setItem("tokentier-rec-cache", recommendationCacheRatio.toString());
      localStorage.setItem("tokentier-rec-priority", apiPriority);
      localStorage.setItem("tokentier-rec-pref", preference);
      localStorage.setItem("tokentier-api-cols", JSON.stringify(visibleApiColumns));
      localStorage.setItem("tokentier-plan-cols", JSON.stringify(visiblePlanColumns));
    } catch {
      // ignore
    }
  }, [
    activeView,
    apiPriority,
    exploreScenarioId,
    recommendationScenarioId,
    monthlyCalls,
    monthlyBudget,
    recommendationInputTokens,
    recommendationOutputTokens,
    recommendationCacheRatio,
    preference,
    visibleApiColumns,
    visiblePlanColumns,
  ]);

  useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || "").toLowerCase();
      const isInput = activeTag === "input" || activeTag === "textarea" || activeTag === "select";

      if ((event.metaKey || event.ctrlKey) && event.key === "1") {
        event.preventDefault();
        switchView("explore");
      } else if ((event.metaKey || event.ctrlKey) && event.key === "2") {
        event.preventDefault();
        switchView("recommendation");
      } else if ((event.metaKey || event.ctrlKey) && event.key === "3") {
        event.preventDefault();
        switchView("rank");
      } else if (event.key === "/" && !isInput && activeView === "explore") {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === "Escape") {
        if (columnsSelectorRef.current?.open) {
          columnsSelectorRef.current.open = false;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeView]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (columnsSelectorRef.current?.open && !columnsSelectorRef.current.contains(event.target as Node)) {
        columnsSelectorRef.current.open = false;
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const setThemeMode = (mode: ThemeMode) => {
    try {
      if (mode === "system") {
        localStorage.removeItem("tokentier-theme");
      } else {
        localStorage.setItem("tokentier-theme", mode);
      }
      const system = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      const effective = mode === "system" ? system : mode;
      document.documentElement.setAttribute("data-theme", effective);
      window.dispatchEvent(new Event("storage"));
    } catch {
      // ignore
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // ignore
    }
  };

  const toggleProvider = (name: string) => {
    if (name === "All") {
      setSelectedProviders([]);
      setLiveAnnouncement("Showing all providers");
      return;
    }
    setSelectedProviders((prev) => {
      const next = prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name];
      setLiveAnnouncement(next.length === 0 ? "Showing all providers" : `Filtered by ${next.join(", ")}`);
      return next;
    });
  };

  const toggleCompare = (item: Model | Plan) => {
    setCompareList((prev) => {
      const isPlan = "kind" in item;
      const prevIsPlan = prev.length > 0 && "kind" in prev[0];
      if (prev.length > 0 && isPlan !== prevIsPlan) {
        setLiveAnnouncement(`Switched comparison to ${isPlan ? "plans" : "models"}. ${item.name} added (1/3).`);
        return [item];
      }
      const exists = prev.some((p) => p.id === item.id);
      if (exists) {
        const next = prev.filter((p) => p.id !== item.id);
        setLiveAnnouncement(`${item.name} removed from comparison, ${next.length} of 3.`);
        return next;
      }
      if (prev.length >= 3) {
        const next = [...prev.slice(1), item];
        setLiveAnnouncement(`${item.name} added to comparison, 3 of 3.`);
        return next;
      }
      const next = [...prev, item];
      setLiveAnnouncement(`${item.name} added to comparison, ${next.length} of 3.`);
      return next;
    });
  };

  const handleHeaderSort = (columnKey: string) => {
    if (sortBy === columnKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      setLiveAnnouncement(`Sorted by ${columnKey} ${sortDirection === "asc" ? "descending" : "ascending"}`);
    } else {
      setSortBy(columnKey);
      setSortDirection("asc");
      setLiveAnnouncement(`Sorted by ${columnKey} ascending`);
    }
  };

  const exploreScenario = scenarioFor(exploreScenarioId);
  const exploreMetric = exploreScenario.gate.metric;
  const exploreGate = gateSummary(exploreScenario);
  const exploreSettings = useMemo<UsageSettings>(() => settingsFor(exploreScenarioId), [exploreScenarioId]);
  const recommendationSettings = useMemo<UsageSettings>(() => ({
    input: recommendationInputTokens,
    output: recommendationOutputTokens,
    cacheRatio: recommendationCacheRatio,
  }), [recommendationCacheRatio, recommendationInputTokens, recommendationOutputTokens]);

  const recommendationScenario = scenarioFor(recommendationScenarioId);
  const recommendationMetric = recommendationScenario.gate.metric;

  // Cost-minimising under a binary gate always returns the floor, so a single
  // "best" never varies by workload. Report the frontier instead and let the
  // reader choose where on it to sit.
  const apiFrontier = useMemo(() => {
    const scenario = scenarioFor(recommendationScenarioId);
    const metric = scenario.gate.metric;
    const eligible = eligibleModelsFor(scenario, recommendationSettings);
    const spend = (model: Model) => callCost(model, recommendationSettings);
    const index = (model: Model) => capabilityOf(model, metric) ?? 0;

    if (eligible.length === 0) {
      const scored = models.filter((model) => metricValue(model.capability, metric) !== null);
      const fallback = [...(scored.length > 0 ? scored : models)].sort(
        (a, b) => index(b) - index(a) || spend(a) - spend(b),
      )[0];
      return { meetsBar: false, budgetFits: false, cost: fallback, budget: fallback, capability: fallback };
    }

    const cheapest = [...eligible].sort((a, b) => spend(a) - spend(b) || index(b) - index(a))[0];
    const strongest = [...eligible].sort((a, b) => index(b) - index(a) || spend(a) - spend(b))[0];

    // The middle axis answers "what is the best I can get for my budget?".
    // A cost-and-headroom blend would not: one model is such a price outlier
    // that it wins any weighted score, making the axis a duplicate of cheapest.
    const affordable = eligible.filter((model) => spend(model) * monthlyCalls <= monthlyBudget);
    const bestAffordable = affordable.length > 0
      ? [...affordable].sort((a, b) => index(b) - index(a) || spend(a) - spend(b))[0]
      : cheapest;

    return {
      meetsBar: true,
      budgetFits: affordable.length > 0,
      cost: cheapest,
      budget: bestAffordable,
      capability: strongest,
    };
  }, [monthlyBudget, monthlyCalls, recommendationScenarioId, recommendationSettings]);

  const apiRecommendationModel = apiFrontier[apiPriority];
  const apiRecommendationIndex = capabilityOf(apiRecommendationModel, recommendationMetric);
  const frontierPicks = useMemo(() => {
    const labels: Array<{ id: ApiPriority; label: string; hint: string }> = [
      { id: "cost", label: "Lowest cost", hint: "Cheapest model that clears the bar" },
      {
        id: "budget",
        label: "Best in budget",
        hint: apiFrontier.budgetFits
          ? "Highest scored model whose monthly spend fits the budget"
          : "Nothing clears the bar inside the budget, so this falls back to the cheapest",
      },
      { id: "capability", label: "Most capable", hint: "Highest scored model that clears the bar, budget aside" },
    ];
    return labels.map((entry) => {
      const model = apiFrontier[entry.id];
      const spend = callCost(model, recommendationSettings) * monthlyCalls;
      const sameAs = labels
        .filter((other) => other.id !== entry.id && apiFrontier[other.id].id === model.id)
        .map((other) => other.label);
      return { ...entry, model, spend, sameAs, overBudget: spend > monthlyBudget };
    });
  }, [apiFrontier, monthlyBudget, monthlyCalls, recommendationSettings]);

  const activePick = frontierPicks.find((pick) => pick.id === apiPriority) ?? frontierPicks[0];
  const budgetPick = frontierPicks.find((pick) => pick.id === "budget") ?? frontierPicks[0];
  const costPick = frontierPicks.find((pick) => pick.id === "cost") ?? frontierPicks[0];

  const rankedPlanOptions = useMemo(() => {
    const scenario = scenarioFor(recommendationScenarioId);
    const gated = eligiblePlansFor(scenario, recommendationSettings)
      .filter((plan) => plan.kind === "Subscription");
    const subscriptions = plans.filter((plan) => plan.kind === "Subscription");
    // Keep a non-empty list even when nothing clears the bar; each option says
    // whether it did, so the view never renders an empty recommendation.
    const meetsBar = gated.length > 0;
    const candidates = meetsBar ? gated : subscriptions;

    const options = candidates
      .map((plan) => {
        // Everything about a plan is read through the model this workload uses.
        const workingModel = planWorkingModel(plan, scenario, recommendationSettings)
          ?? modelById.get(plan.modelIds[0])
          ?? null;
        const estimate = planEstimate(plan, recommendationSettings, workingModel);
        if (!estimate) return null;
        const index = capabilityOf(workingModel ?? undefined, scenario.gate.metric);
        const coverage = planCoverageScore(plan, recommendationSettings, monthlyCalls, workingModel);
        const withinBudget = (plan.monthly ?? Infinity) <= monthlyBudget;

        // A plan whose quota cannot be converted is not a worse plan, it is an
        // unmeasured one. Renormalise the known weights instead of substituting
        // a penalty, which would reward whoever published a formula we can read.
        const weights = rankingWeights.recommendation;
        const terms: Array<[number, number]> = [
          [weights.capability, index ?? 0],
          [weights.budget, withinBudget ? 100 : 0],
          [weights.confidence, (confidenceScore[plan.confidence] / 30) * 100],
        ];
        if (coverage !== null) terms.push([weights.coverage, coverage]);
        const totalWeight = terms.reduce((total, [weight]) => total + weight, 0);
        const score = terms.reduce((total, [weight, value]) => total + weight * value, 0) / totalWeight;

        return { plan, estimate, coverage, withinBudget, score, index, meetsBar, workingModel };
      })
      .filter((option): option is NonNullable<typeof option> => option !== null);

    return options.sort((a, b) =>
      Number(b.withinBudget) - Number(a.withinBudget)
      || b.score - a.score
      || (a.plan.monthly ?? Infinity) - (b.plan.monthly ?? Infinity)
    );
  }, [monthlyBudget, monthlyCalls, recommendationScenarioId, recommendationSettings]);

  const recommendedPlanOption = rankedPlanOptions.at(0) ?? null;
  const planRecommendation = recommendedPlanOption?.plan ?? null;
  const recommendedPlanEstimate = recommendedPlanOption?.estimate ?? null;
  const recommendedPlanCoverage = recommendedPlanOption?.coverage ?? null;
  const recommendedApiSpend = callCost(apiRecommendationModel, recommendationSettings) * monthlyCalls;
  const planCoversVolume = recommendedPlanCoverage === 100;
  const planWithinBudget = recommendedPlanOption?.withinBudget ?? false;
  const apiWithinBudget = recommendedApiSpend <= monthlyBudget;

  const planMonthly = planRecommendation?.monthly ?? null;

  const preferredPath: Lane = planRecommendation === null
    ? "api"
    : preference === "api"
      ? apiWithinBudget || !planWithinBudget || !planCoversVolume ? "api" : "plans"
      : preference === "plans"
        ? planWithinBudget && planCoversVolume ? "plans" : "api"
        : recommendedApiSpend <= (planMonthly ?? Infinity) * 0.65
          ? "api"
          : recommendedApiSpend >= (planMonthly ?? Infinity) * 1.25 && planWithinBudget && planCoversVolume
            ? "plans"
            : planWithinBudget && planCoversVolume && !apiWithinBudget
              ? "plans"
              : "api";

  const recommendedPlanPrice = planMonthly ?? 0;
  const recommendedPlanCalls = recommendedPlanEstimate
    ? formatEstimateRange(recommendedPlanEstimate.callsLow, recommendedPlanEstimate.callsHigh)
    : "—";
  const apiPlanDifference = recommendedApiSpend - recommendedPlanPrice;
  const sameMonthlyPrice = Math.abs(apiPlanDifference) < 0.005;

  const diffFactCaption = planRecommendation === null
    ? `No subscription plan can be compared for this workload. ${apiRecommendationModel.name} API is estimated at ${monthlyPrice(recommendedApiSpend)}/mo.`
    : sameMonthlyPrice
      ? "Both options cost the same monthly for this workload."
      : apiPlanDifference < 0
        ? preferredPath === "api"
          ? `API saves ${monthlyPrice(Math.abs(apiPlanDifference))}/mo compared to ${planRecommendation.name}`
          : `${apiRecommendationModel.name} API is ${monthlyPrice(Math.abs(apiPlanDifference))}/mo cheaper than ${planRecommendation.name}`
        : preferredPath === "plans"
          ? `${planRecommendation.name} saves ${monthlyPrice(Math.abs(apiPlanDifference))}/mo compared to API spend (~${recommendedPlanCalls} calls)`
          : `API costs ${monthlyPrice(Math.abs(apiPlanDifference))}/mo more than ${planRecommendation.name} (~${recommendedPlanCalls} calls)`;

  const rankedModelCosts = useMemo(() => {
    const requiredTokens = recommendationSettings.input + recommendationSettings.output;
    const candidates = models.filter((model) => contextSize(model.context) >= requiredTokens);
    const displayModels = candidates.length > 0 ? candidates : models;
    return displayModels
      .map((model) => {
        const perCall = callCost(model, recommendationSettings);
        return { model, perCall, monthly: perCall * monthlyCalls };
      })
      .sort((a, b) => a.monthly - b.monthly);
  }, [monthlyCalls, recommendationSettings]);

  const maxRankedMonthly = useMemo(() => {
    return Math.max(...rankedModelCosts.map((r) => r.monthly), 1);
  }, [rankedModelCosts]);

  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = models
      .filter((model) => {
        const matchesProvider = selectedProviders.length === 0 || selectedProviders.includes(model.provider);
        const matchesQuery = !normalizedQuery || `${model.provider} ${model.name}`.toLowerCase().includes(normalizedQuery);
        return matchesProvider && matchesQuery;
      });

    return filtered.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "name") comparison = a.name.localeCompare(b.name);
      else if (sortBy === "input") comparison = a.input - b.input;
      else if (sortBy === "cached") comparison = (a.cached ?? a.input) - (b.cached ?? b.input);
      else if (sortBy === "output") comparison = a.output - b.output;
      else if (sortBy === "context") comparison = contextSize(a.context) - contextSize(b.context);
      else if (sortBy === "index") comparison = (metricValue(a.capability, scenarioFor(exploreScenarioId).gate.metric) ?? -Infinity) - (metricValue(b.capability, scenarioFor(exploreScenarioId).gate.metric) ?? -Infinity);
      else if (sortBy === "fit") comparison = placementSort(modelPlacement(a.id, exploreScenarioId), modelPlacement(b.id, exploreScenarioId));
      else comparison = callCost(a, exploreSettings) - callCost(b, exploreSettings);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [exploreScenarioId, exploreSettings, selectedProviders, query, sortBy, sortDirection]);

  const visiblePlans = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = plans
      .filter((plan) => {
        const matchesProvider = selectedProviders.length === 0 || selectedProviders.includes(plan.provider);
        const matchesQuery = !normalizedQuery || `${plan.provider} ${plan.name} ${plan.kind}`.toLowerCase().includes(normalizedQuery);
        return matchesProvider && matchesQuery;
      });

    return filtered.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "name") comparison = a.name.localeCompare(b.name);
      else if (sortBy === "type") comparison = a.kind.localeCompare(b.kind);
      else if (sortBy === "confidence") comparison = confidenceScore[a.confidence] - confidenceScore[b.confidence];
      else if (sortBy === "fit") comparison = placementSort(planPlacement(a.id, exploreScenarioId), planPlacement(b.id, exploreScenarioId));
      else comparison = (a.monthly ?? Infinity) - (b.monthly ?? Infinity);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [exploreScenarioId, selectedProviders, query, sortBy, sortDirection]);

  const updateRecommendationProfile = (id: ScenarioId) => {
    const selected = scenarioFor(id);
    setRecommendationScenarioId(id);
    setRecommendationInputTokens(selected.input);
    setRecommendationOutputTokens(selected.output);
    setRecommendationCacheRatio(selected.cacheRatio);
    setMonthlyCalls(selected.calls);
  };

  const useExploreProfile = () => {
    updateRecommendationProfile(exploreScenarioId);
    switchView("recommendation");
  };

  const switchExploreLane = (lane: Lane) => {
    setExploreLane(lane);
    setSortBy(lane === "api" ? "cost" : "price");
    setSortDirection("asc");
    if (columnsSelectorRef.current) columnsSelectorRef.current.open = false;
  };

  const latestPricingUpdate = modelCatalog.updatedAt > planCatalogUpdatedAt ? modelCatalog.updatedAt : planCatalogUpdatedAt;
  const pricingUpdatedAt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${latestPricingUpdate}T00:00:00Z`));

  const daysSinceUpdate = useMemo(() => {
    try {
      const updateDate = new Date(`${latestPricingUpdate}T00:00:00Z`);
      const now = new Date();
      return Math.floor((now.getTime() - updateDate.getTime()) / (1000 * 60 * 60 * 24));
    } catch {
      return 0;
    }
  }, [latestPricingUpdate]);

  const isComparingPlans = compareList.length > 0 && "kind" in compareList[0];

  // One descriptor per row, so every row knows how to render itself and which
  // direction counts as better. Without that a comparison table makes the
  // reader do the comparing.
  const compareRows = useMemo<CompareRow[]>(() => {
    const tierBadge = (placement: Placement) => (
      <span className={`mini-tier ${placementClass(placement)}`} title={placementReason(placement, exploreScenario, exploreMetric)}>
        {placementLabel(placement)}
      </span>
    );
    const sourceRow: CompareRow = {
      label: "Official source",
      render: (item) => (
        <a className="button button-ghost" href={item.source} rel="noreferrer" target="_blank">
          <span>Source</span>
          <Icon name="external" size={13} />
        </a>
      ),
    };

    if (isComparingPlans) {
      const working = (item: Model | Plan) => planWorkingModel(item as Plan, exploreScenario, exploreSettings);
      return [
        { label: "Plan type", render: (item) => <span className="kind-pill">{(item as Plan).kind}</span> },
        {
          label: "Monthly price",
          render: (item) => <strong>{planPrice(item as Plan)}</strong>,
          score: (item) => (item as Plan).monthly,
          better: "lower",
        },
        {
          label: capabilityIndex.name,
          render: (item) => {
            const index = metricValue(working(item)?.capability ?? null, exploreMetric);
            return index === null ? <span className="muted-dash">Not scored</span> : <strong>{index}</strong>;
          },
          score: (item) => metricValue(working(item)?.capability ?? null, exploreMetric),
          better: "higher",
        },
        {
          label: `Model used (${exploreScenario.label.toLowerCase()})`,
          render: (item) => working(item)?.name ?? <span className="muted-dash">None clears the bar</span>,
        },
        { label: "Published quota", render: (item) => planQuota(item as Plan, exploreScenarioId) },
        { label: "API included?", render: (item) => (item as Plan).apiIncluded },
        {
          label: `Equivalent calls (${exploreScenario.label.toLowerCase()})`,
          render: (item) => {
            const estimate = planEstimate(item as Plan, exploreSettings, working(item));
            return estimate
              ? <strong>{formatEstimateRange(estimate.callsLow, estimate.callsHigh)} calls</strong>
              : <span className="muted-dash">—</span>;
          },
          score: (item) => planEstimate(item as Plan, exploreSettings, working(item))?.callsLow ?? null,
          better: "higher",
        },
        {
          label: "Quota evidence",
          render: (item) => (
            <>
              <span className={`evidence-badge evidence-${(item as Plan).confidence.toLowerCase()}`}>{(item as Plan).confidence}</span>
              <small className="estimate-detail">{(item as Plan).evidence}</small>
            </>
          ),
          score: (item) => confidenceScore[(item as Plan).confidence],
          better: "higher",
        },
        {
          label: `Derived tier (${exploreScenario.label.toLowerCase()})`,
          render: (item) => tierBadge(itemPlacement(item, exploreScenarioId)),
          score: (item) => {
            const placement = itemPlacement(item, exploreScenarioId);
            return placement.state === "tier" ? tierRank[placement.tier] : 0;
          },
          better: "higher",
        },
        sourceRow,
      ];
    }

    return [
      {
        label: capabilityIndex.name,
        render: (item) => {
          const index = metricValue((item as Model).capability, exploreMetric);
          return index === null ? <span className="muted-dash">Not scored</span> : <strong>{index}</strong>;
        },
        score: (item) => metricValue((item as Model).capability, exploreMetric),
        better: "higher",
      },
      {
        label: "Input / 1M",
        render: (item) => <strong>{price((item as Model).input)}</strong>,
        score: (item) => (item as Model).input,
        better: "lower",
      },
      {
        label: "Cached input / 1M",
        render: (item) => ((item as Model).cached === null ? "—" : price((item as Model).cached as number, 4)),
        score: (item) => (item as Model).cached ?? (item as Model).input,
        better: "lower",
      },
      {
        label: "Output / 1M",
        render: (item) => <strong>{price((item as Model).output)}</strong>,
        score: (item) => (item as Model).output,
        better: "lower",
      },
      {
        label: "Context window",
        render: (item) => (item as Model).context,
        score: (item) => contextSize((item as Model).context),
        better: "higher",
      },
      {
        label: `Est. cost / call (${exploreScenario.label.toLowerCase()})`,
        render: (item) => <strong>{price(callCost(item as Model, exploreSettings), 4)}</strong>,
        score: (item) => callCost(item as Model, exploreSettings),
        better: "lower",
      },
      {
        label: `${monthlyCalls.toLocaleString()} calls / month`,
        render: (item) => <strong>{monthlyPrice(callCost(item as Model, exploreSettings) * monthlyCalls)}</strong>,
        score: (item) => callCost(item as Model, exploreSettings),
        better: "lower",
      },
      {
        label: `Derived tier (${exploreScenario.label.toLowerCase()})`,
        render: (item) => tierBadge(itemPlacement(item, exploreScenarioId)),
        score: (item) => {
          const placement = itemPlacement(item, exploreScenarioId);
          return placement.state === "tier" ? tierRank[placement.tier] : 0;
        },
        better: "higher",
      },
      sourceRow,
    ];
  }, [exploreMetric, exploreScenario, exploreScenarioId, exploreSettings, isComparingPlans, monthlyCalls]);

  return (
    <main>
      <a className="skip-link" href={activeView === "explore" ? "#tier-board" : activeView === "recommendation" ? "#recommendation-settings" : "#rank-top"}>Skip to comparison</a>

      <div aria-live="polite" className="visually-hidden">{liveAnnouncement}</div>

      <header className="site-header">
        <a
          className="brand"
          href="#explore-top"
          aria-label="TokenTier home"
          onClick={(event) => {
            event.preventDefault();
            switchView("explore");
          }}
        >
          <span className="brand-mark">T/T</span>
          <span>TokenTier</span>
        </a>
        <nav className="workspace-tabs" aria-label="Comparison mode">
          <button
            aria-label="Explore profiles"
            aria-pressed={activeView === "explore"}
            className={activeView === "explore" ? "active" : ""}
            id="explore-tab"
            onClick={() => switchView("explore")}
            title="Explore profiles"
            type="button"
          >
            <span aria-hidden="true" className="workspace-tab-long">Explore profiles</span>
            <span aria-hidden="true" className="workspace-tab-short">Explore</span>
          </button>
          <button
            aria-label="Recommendation"
            aria-pressed={activeView === "recommendation"}
            className={activeView === "recommendation" ? "active" : ""}
            id="recommendation-tab"
            onClick={() => switchView("recommendation")}
            title="Recommendation"
            type="button"
          >
            <span aria-hidden="true" className="workspace-tab-long">Recommendation</span>
            <span aria-hidden="true" className="workspace-tab-short">Advice</span>
          </button>
          <button
            aria-label="Rank plans"
            aria-pressed={activeView === "rank"}
            className={activeView === "rank" ? "active" : ""}
            id="rank-tab"
            onClick={() => switchView("rank")}
            title="Rank plans"
            type="button"
          >
            <span aria-hidden="true" className="workspace-tab-long">Rank plans</span>
            <span aria-hidden="true" className="workspace-tab-short">Rank</span>
          </button>
        </nav>
        <div className="header-actions">
          <span className={`freshness ${daysSinceUpdate > 30 ? "stale" : ""}`} title={`Data updated ${pricingUpdatedAt}`}>
            <i /> Updated {pricingUpdatedAt}
          </span>
          <div className="theme-switcher" role="group" aria-label="Theme">
            <button aria-label="Auto theme (follow system)" aria-pressed={themeMode === "system"} className={themeMode === "system" ? "active" : ""} onClick={() => setThemeMode("system")} title="Auto (system)" type="button">
              <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16"><rect height="14" rx="2" ry="2" width="20" x="2" y="3"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
            </button>
            <button aria-label="Light theme" aria-pressed={themeMode === "light"} className={themeMode === "light" ? "active" : ""} onClick={() => setThemeMode("light")} title="Light" type="button">
              <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16"><circle cx="12" cy="12" r="5"/><line x1="12" x2="12" y1="1" y2="3"/><line x1="12" x2="12" y1="21" y2="23"/><line x1="4.22" x2="5.64" y1="4.22" y2="5.64"/><line x1="18.36" x2="19.78" y1="18.36" y2="19.78"/><line x1="1" x2="3" y1="12" y2="12"/><line x1="21" x2="23" y1="12" y2="12"/><line x1="4.22" x2="5.64" y1="19.78" y2="18.36"/><line x1="18.36" x2="19.78" y1="5.64" y2="4.22"/></svg>
            </button>
            <button aria-label="Dark theme" aria-pressed={themeMode === "dark"} className={themeMode === "dark" ? "active" : ""} onClick={() => setThemeMode("dark")} title="Dark" type="button">
              <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            </button>
          </div>
        </div>
      </header>

      <div aria-labelledby="explore-tab" className="view-panel explore-panel" hidden={activeView !== "explore"} id="explore-panel" role="region">
        <section className="explore-hero" id="explore-top">
          <div className="explore-hero-main">
            <h1 id="explore-top-heading" tabIndex={-1}>Compare AI APIs and plans.</h1>
            <p className="explore-hero-sub">Independent pricing calculator, tier lists, and break-even limits across leading foundation models.</p>
            <div className="hero-stats-strip">
              <span><strong>{models.length}</strong> API models</span>
              <span className="dot-sep">·</span>
              <span><strong>{plans.filter((p) => p.kind === "Subscription").length}</strong> subscriptions</span>
              <span className="dot-sep">·</span>
              <span><strong>{scenarios.length}</strong> workload presets</span>
              <span className="dot-sep">·</span>
              <span>tiers derived from <strong>{capabilityIndex.name}</strong> v{capabilityIndex.version}</span>
            </div>
          </div>
          <button className="button button-ghost hero-cta" onClick={useExploreProfile} type="button">
            Get a recommendation <span>→</span>
          </button>
        </section>

        <div className="explore-workspace">
          <aside aria-labelledby="profile-preset-title" className="scenario-dock">
            <header className="scenario-dock-heading">
              <span>Profile preset</span>
              <h2 id="profile-preset-title">{exploreScenario.label}</h2>
            </header>
            <label className="scenario-dock-select" htmlFor="explore-scenario">
              <span>Use case</span>
              <select id="explore-scenario" value={exploreScenarioId} onChange={(event) => setExploreScenarioId(event.target.value as ScenarioId)}>
                {scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <p className="scenario-dock-description">{exploreScenario.description}</p>
            <div className="preset-call" aria-label={`${exploreScenario.input.toLocaleString()} input and ${exploreScenario.output.toLocaleString()} output tokens per call, ${exploreScenario.calls.toLocaleString()} calls a month, ${Math.round(exploreScenario.cacheRatio * 100)} percent of input from cache`}>
              <span>Typical month</span>
              <strong>{exploreScenario.input.toLocaleString()} in + {exploreScenario.output.toLocaleString()} out</strong>
              <dl className="preset-call-facts">
                <div><dt>Calls</dt><dd>{exploreScenario.calls.toLocaleString()} / mo</dd></div>
                <div><dt>From cache</dt><dd>{Math.round(exploreScenario.cacheRatio * 100)}% of input</dd></div>
              </dl>
            </div>
            <p className="scenario-dock-rationale">{exploreScenario.rationale}</p>
            <p className="scenario-dock-note">Used for the tier list and price estimates. Excludes tools, search, images, storage, taxes, and retries.</p>
            <button className="scenario-dock-action" onClick={() => { updateRecommendationProfile(exploreScenarioId); switchView("recommendation"); }} type="button">
              Customize in Recommend <span>→</span>
            </button>
          </aside>

          <div className="explore-content">
            <section className="section tier-section" id="tier-board">
              <div className="section-heading explore-section-heading">
                <div>
                  <span className="section-kicker">{exploreScenario.label}</span>
                  <h2>Tier list</h2>
                  <p>{exploreScenario.description}</p>
                </div>
                <div className="book-switch explore-lane-switch" role="group" aria-label="Tier list lane">
                  <button aria-pressed={exploreLane === "api"} className={exploreLane === "api" ? "active" : ""} onClick={() => switchExploreLane("api")} type="button">API models <span>{models.length}</span></button>
                  <button aria-pressed={exploreLane === "plans"} className={exploreLane === "plans" ? "active" : ""} onClick={() => switchExploreLane("plans")} type="button">Plans <span>{plans.filter((plan) => plan.kind === "Subscription").length}</span></button>
                </div>
              </div>

              <div className="gate-banner">
                <div className="gate-banner-rule">
                  <strong>{metricLabels[exploreMetric]} &ge; {exploreScenario.gate.minIndex}</strong>
                  <span>
                    {exploreGate.qualifying} of {exploreGate.total} models qualify for {exploreScenario.label}
                  </span>
                </div>
                <p>
                  {exploreScenario.gate.rationale}{" "}
                  Anchored to {models.find((model) => model.id === exploreScenario.gate.anchor)?.name ?? exploreScenario.gate.anchor}
                  {" "}on {capabilityIndex.name} v{capabilityIndex.version}.
                </p>
              </div>

              <div className="tier-board">
                {tierOrder.map((tier) => (
                  <div className={`tier-row tier-${tier.toLowerCase()}`} key={tier}>
                    <div className="tier-label"><strong>{tier}</strong><span>{tierDescriptions[tier]}</span></div>
                    <div className="tier-models" role="group" aria-label={`${tier} tier items`}>
                      {(() => {
                        if (exploreLane === "api") {
                          const items = models
                            .filter((model) => {
                              const placement = modelPlacement(model.id, exploreScenarioId);
                              return placement.state === "tier" && placement.tier === tier;
                            })
                            .sort((a, b) => callCost(a, exploreSettings) - callCost(b, exploreSettings));
                          if (items.length === 0) {
                            return <p className="tier-empty">No models ranked in this tier for this scenario.</p>;
                          }
                          return items.map((item) => (
                            <button
                              aria-label={`${item.name}, ${item.provider}, ${price(callCost(item, exploreSettings), 3)} per call`}
                              className={`tier-model ${compareList.some((c) => c.id === item.id) ? "selected" : ""}`}
                              key={item.id}
                              onClick={() => setActiveDetailItem(item)}
                              type="button"
                            >
                              <span className="provider-orb" data-provider={item.provider} />
                              <span><strong title={item.name}>{item.name}</strong><small>{item.provider}</small></span>
                              <b>{price(callCost(item, exploreSettings), 3)}<small>/ call</small></b>
                            </button>
                          ));
                        }
                        const items = plans
                          .filter((plan) => {
                            if (plan.kind !== "Subscription") return false;
                            const placement = planPlacement(plan.id, exploreScenarioId);
                            return placement.state === "tier" && placement.tier === tier;
                          })
                          .sort((a, b) => (a.monthly ?? Infinity) - (b.monthly ?? Infinity));
                        if (items.length === 0) {
                          return <p className="tier-empty">No plans ranked in this tier for this scenario.</p>;
                        }
                        return items.map((item) => (
                          <button
                            aria-label={`${item.name}, ${item.provider}, $${item.monthly} per month`}
                            className={`tier-model ${compareList.some((c) => c.id === item.id) ? "selected" : ""}`}
                            key={item.id}
                            onClick={() => setActiveDetailItem(item)}
                            type="button"
                          >
                            <span className="provider-orb" data-provider={item.provider} />
                            <span>
                              <strong title={item.name}>{item.name}</strong>
                              <small>via {planWorkingModel(item, exploreScenario, exploreSettings)?.name ?? item.provider}</small>
                            </span>
                            <b>${item.monthly}<small>/ month</small></b>
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
                ))}
              </div>
              <p className="tier-note">
                Everything on the board already clears the {exploreScenario.label.toLowerCase()} capability bar, so the
                letters rank value: models by per-call cost, plans by price and quota evidence. Select a card to view specs or compare.
              </p>

              {exploreLane === "api" && exploreGate.qualifying < exploreGate.total && (
                <details className="gate-excluded">
                  <summary>
                    Not on the board ({exploreGate.total - exploreGate.qualifying})
                  </summary>
                  <ul>
                    {models
                      .map((model) => ({ model, placement: modelPlacement(model.id, exploreScenarioId) }))
                      .filter(({ placement }) => placement.state !== "tier")
                      .sort((a, b) => placementSort(b.placement, a.placement))
                      .map(({ model, placement }) => (
                        <li key={model.id}>
                          <span className="provider-orb" data-provider={model.provider} />
                          <button className="table-item-name-btn" onClick={() => setActiveDetailItem(model)} type="button">
                            <strong>{model.name}</strong>
                          </button>
                          <span className="gate-excluded-reason">
                            {placement.state === "below"
                              ? `${metricLabels[exploreMetric]} ${placement.index} · below the ${placement.minIndex} bar`
                              : placement.state === "context"
                                ? `Context window too small for ${scenarioTokens(exploreScenario).toLocaleString()} tokens`
                                : "Not independently scored"}
                          </span>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </section>

            <section className="section prices-section" id="prices">
              <div className="section-heading explore-section-heading">
                <div>
                  <span className="section-kicker">{exploreScenario.label}</span>
                  <h2>Price book</h2>
                  <p>Token rates, plan prices, credits, and published limits for this preset.</p>
                </div>
                <div className="book-switch explore-lane-switch" role="group" aria-label="Price book lane">
                  <button aria-pressed={exploreLane === "api"} className={exploreLane === "api" ? "active" : ""} onClick={() => switchExploreLane("api")} type="button">API rates <span>{models.length}</span></button>
                  <button aria-pressed={exploreLane === "plans"} className={exploreLane === "plans" ? "active" : ""} onClick={() => switchExploreLane("plans")} type="button">Plans &amp; access <span>{plans.length}</span></button>
                </div>
              </div>

              <div className="table-tools">
                <div className="table-tools-top">
                  <label className="search-field">
                    <Icon className="search-icon" name="search" size={15} />
                    <input
                      aria-label={`Search ${exploreLane}`}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={exploreLane === "api" ? "Search model or provider" : "Search plan, client, or provider"}
                      ref={searchInputRef}
                      type="search"
                      value={query}
                    />
                    <kbd className="search-shortcut-kbd">/</kbd>
                  </label>
                  <details className="columns-selector" ref={columnsSelectorRef}>
                    <summary className="columns-trigger">
                      <span>Columns ({exploreLane === "api" ? Object.values(visibleApiColumns).filter(Boolean).length + 1 : Object.values(visiblePlanColumns).filter(Boolean).length + 1})</span>
                      <Icon name="chevron-down" size={13} />
                    </summary>
                    <div className="columns-menu">
                      <div className="columns-menu-header">
                        <span>Show columns</span>
                        <button
                          className="columns-reset-btn"
                          onClick={() => {
                            if (exploreLane === "api") {
                              setVisibleApiColumns({ ...defaultApiColumns });
                            } else {
                              setVisiblePlanColumns({ ...defaultPlanColumns });
                            }
                          }}
                          type="button"
                        >
                          Reset
                        </button>
                      </div>
                      {exploreLane === "api"
                        ? (Object.keys(apiColumnLabels) as ApiColumnKey[]).map((col) => (
                            <label className="column-option" key={col}>
                              <input
                                checked={visibleApiColumns[col]}
                                onChange={(e) => setVisibleApiColumns((prev) => ({ ...prev, [col]: e.target.checked }))}
                                type="checkbox"
                              />
                              <span>{apiColumnLabels[col]}</span>
                            </label>
                          ))
                        : (Object.keys(planColumnLabels) as PlanColumnKey[]).map((col) => (
                            <label className="column-option" key={col}>
                              <input
                                checked={visiblePlanColumns[col]}
                                onChange={(e) => setVisiblePlanColumns((prev) => ({ ...prev, [col]: e.target.checked }))}
                                type="checkbox"
                              />
                              <span>{planColumnLabels[col]}</span>
                            </label>
                          ))}
                    </div>
                  </details>
                </div>

                <div className="provider-filters" role="group" aria-label="Filter by provider">
                  {(exploreLane === "api" ? providerNames : planProviderNames).map((name) => {
                    const isSelected = name === "All" ? selectedProviders.length === 0 : selectedProviders.includes(name);
                    return (
                      <button
                        aria-pressed={isSelected}
                        className={isSelected ? "active" : ""}
                        key={name}
                        onClick={() => toggleProvider(name)}
                        type="button"
                      >
                        {name}
                      </button>
                    );
                  })}
                  {selectedProviders.length > 0 && (
                    <button aria-label="Clear provider filters" className="provider-clear" onClick={() => setSelectedProviders([])} type="button">Clear</button>
                  )}
                </div>
              </div>

              <p className="table-scroll-hint">Scroll sideways to see all columns.</p>
              <div className="table-wrap">
                {exploreLane === "api" ? (
                  <table>
                    <caption className="visually-hidden">API rates and fit for {exploreScenario.label}</caption>
                    <thead>
                      <tr>
                        <th
                          aria-sort={sortBy === "name" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                          className="sortable-header"
                        >
                          <button onClick={() => handleHeaderSort("name")} title="Sort by model name" type="button">
                            <span className="th-content">API model {sortBy === "name" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                          </button>
                        </th>
                        {visibleApiColumns.input && (
                          <th
                            aria-sort={sortBy === "input" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                          >
                            <button onClick={() => handleHeaderSort("input")} title="Sort by input token rate" type="button">
                              <span className="th-content">Input / 1M {sortBy === "input" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                            </button>
                          </th>
                        )}
                        {visibleApiColumns.cached && (
                          <th
                            aria-sort={sortBy === "cached" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                          >
                            <button onClick={() => handleHeaderSort("cached")} title="Sort by cached input rate" type="button">
                              <span className="th-content">Cached input {sortBy === "cached" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                            </button>
                          </th>
                        )}
                        {visibleApiColumns.output && (
                          <th
                            aria-sort={sortBy === "output" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                          >
                            <button onClick={() => handleHeaderSort("output")} title="Sort by output token rate" type="button">
                              <span className="th-content">Output / 1M {sortBy === "output" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                            </button>
                          </th>
                        )}
                        {visibleApiColumns.context && (
                          <th
                            aria-sort={sortBy === "context" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                          >
                            <button onClick={() => handleHeaderSort("context")} title="Sort by context window size" type="button">
                              <span className="th-content">Context {sortBy === "context" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                            </button>
                          </th>
                        )}
                        {visibleApiColumns.index && (
                          <th
                            aria-sort={sortBy === "index" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                          >
                            <button onClick={() => handleHeaderSort("index")} title={`Sort by ${metricLabels[exploreMetric]}`} type="button">
                              <span className="th-content">Index {sortBy === "index" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                            </button>
                          </th>
                        )}
                        {visibleApiColumns.fit && (
                          <th
                            aria-sort={sortBy === "fit" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                          >
                            <button onClick={() => handleHeaderSort("fit")} title="Sort by scenario fit" type="button">
                              <span className="th-content">Fit {sortBy === "fit" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                            </button>
                          </th>
                        )}
                        {visibleApiColumns.cost && (
                          <th
                            aria-sort={sortBy === "cost" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                          >
                            <button onClick={() => handleHeaderSort("cost")} title="Sort by estimated per-call cost" type="button">
                              <span className="th-content">Est. / call {sortBy === "cost" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                            </button>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleModels.map((model) => {
                        const callCostValue = callCost(model, exploreSettings);
                        const placement = modelPlacement(model.id, exploreScenarioId);
                        const modelIndex = metricValue(model.capability, exploreMetric);
                        return (
                          <tr key={model.id}>
                            <td className="sticky-col">
                              <div className="table-item-cell">
                                <span className="provider-orb" data-provider={model.provider} />
                                <div className="model-cell">
                                  <div className="model-cell-header">
                                    <button className="table-item-name-btn" onClick={() => setActiveDetailItem(model)} type="button"><strong>{model.name}</strong></button>
                                  </div>
                                  <div className="model-cell-sub">
                                    <small>{model.provider}</small>
                                    {model.note && <details className="row-note"><summary>Note</summary><p>{model.note}</p></details>}
                                  </div>
                                </div>
                                <a aria-label={`Official pricing source for ${model.name}`} className="source-link" href={model.source} rel="noreferrer" target="_blank" title="Open official pricing source">
                                  <Icon name="external" size={13} />
                                </a>
                              </div>
                            </td>
                            {visibleApiColumns.input && <td>{price(model.input)}</td>}
                            {visibleApiColumns.cached && <td>{model.cached === null ? "—" : price(model.cached, 4)}</td>}
                            {visibleApiColumns.output && <td>{price(model.output)}</td>}
                            {visibleApiColumns.context && <td>{model.context}</td>}
                            {visibleApiColumns.index && (
                              <td>
                                {modelIndex === null
                                  ? <span className="muted-dash" title={`Not scored on the ${metricLabels[exploreMetric]}`}>—</span>
                                  : <a className="index-value" href={model.capability?.source} rel="noreferrer" target="_blank" title={`${metricLabels[exploreMetric]} ${modelIndex} (v${model.capability?.indexVersion}${model.capability?.variant ? `, ${model.capability.variant}` : ""}) · verified ${model.capability?.verifiedAt}`}>{modelIndex}</a>}
                              </td>
                            )}
                            {visibleApiColumns.fit && (
                              <td>
                                <span className={`mini-tier ${placementClass(placement)}`} title={placementReason(placement, exploreScenario, exploreMetric)}>
                                  {placementLabel(placement)}
                                </span>
                              </td>
                            )}
                            {visibleApiColumns.cost && <td><strong>{price(callCostValue, 3)}</strong></td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <table className="plan-table">
                    <caption className="visually-hidden">Plan prices, quotas, and fit for {exploreScenario.label}</caption>
                    <thead>
                      <tr>
                        <th
                          aria-sort={sortBy === "name" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                          className="sortable-header"
                        >
                          <button onClick={() => handleHeaderSort("name")} title="Sort by plan name" type="button">
                            <span className="th-content">Plan or access path {sortBy === "name" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                          </button>
                        </th>
                        {visiblePlanColumns.type && (
                          <th
                            aria-sort={sortBy === "type" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                          >
                            <button onClick={() => handleHeaderSort("type")} title="Sort by plan type" type="button">
                              <span className="th-content">Type {sortBy === "type" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                            </button>
                          </th>
                        )}
                        {visiblePlanColumns.price && (
                          <th
                            aria-sort={sortBy === "price" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                          >
                            <button onClick={() => handleHeaderSort("price")} title="Sort by monthly price" type="button">
                              <span className="th-content">Price {sortBy === "price" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                            </button>
                          </th>
                        )}
                        {visiblePlanColumns.quota && <th>Published quota</th>}
                        {visiblePlanColumns.apiIncluded && <th>API included?</th>}
                        {visiblePlanColumns.equivalent && <th>API-cost equivalent</th>}
                        {visiblePlanColumns.fit && (
                          <th
                            aria-sort={sortBy === "fit" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                          >
                            <button onClick={() => handleHeaderSort("fit")} title="Sort by scenario fit" type="button">
                              <span className="th-content">Fit {sortBy === "fit" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                            </button>
                          </th>
                        )}
                        {visiblePlanColumns.evidence && (
                          <th
                            aria-sort={sortBy === "confidence" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                          >
                            <button onClick={() => handleHeaderSort("confidence")} title="Sort by quota confidence" type="button">
                              <span className="th-content">Evidence {sortBy === "confidence" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                            </button>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePlans.map((plan) => {
                        const workingModel = planWorkingModel(plan, exploreScenario, exploreSettings);
                        const estimate = planEstimate(plan, exploreSettings, workingModel);
                        const placement = planPlacement(plan.id, exploreScenarioId);
                        return (
                          <tr key={plan.id}>
                            <td className="sticky-col">
                              <div className="table-item-cell">
                                <span className="provider-orb" data-provider={plan.provider} />
                                <div className="model-cell">
                                  <div className="model-cell-header">
                                    <button className="table-item-name-btn" onClick={() => setActiveDetailItem(plan)} type="button"><strong>{plan.name}</strong></button>
                                  </div>
                                  <div className="model-cell-sub">
                                    <small>{plan.provider}</small>
                                    <details className="row-note"><summary>Note</summary><p>{plan.note}</p></details>
                                  </div>
                                </div>
                                <a aria-label={`Official source for ${plan.name}`} className="source-link" href={plan.source} rel="noreferrer" target="_blank" title="Open official plan source">
                                  <Icon name="external" size={13} />
                                </a>
                              </div>
                            </td>
                            {visiblePlanColumns.type && <td><span className="kind-pill">{plan.kind}</span></td>}
                            {visiblePlanColumns.price && <td><strong>{planPrice(plan)}</strong>{plan.kind === "Subscription" && <small className="per-month"> / mo</small>}</td>}
                            {visiblePlanColumns.quota && <td className="wrap-cell">{planQuota(plan, exploreScenarioId)}</td>}
                            {visiblePlanColumns.apiIncluded && <td>{plan.apiIncluded}</td>}
                            {visiblePlanColumns.equivalent && (
                              <td>
                                {estimate ? (
                                  <>
                                    <strong>{formatEstimateRange(estimate.callsLow, estimate.callsHigh)} calls</strong>
                                    <small className="estimate-detail">
                                      {formatMoneyRange(estimate.valueLow, estimate.valueHigh)} · {estimate.basis}
                                    </small>
                                    {workingModel && (
                                      <small className="estimate-detail" title={`Cheapest model on this plan that clears the ${exploreScenario.label} bar`}>
                                        via {workingModel.name}
                                      </small>
                                    )}
                                  </>
                                ) : <span className="muted-dash">Your API bill</span>}
                              </td>
                            )}
                            {visiblePlanColumns.fit && (
                              <td>
                                <span className={`mini-tier ${placementClass(placement)}`} title={placementReason(placement, exploreScenario, exploreMetric)}>
                                  {placementLabel(placement)}
                                </span>
                              </td>
                            )}
                            {visiblePlanColumns.evidence && <td><span className={`evidence-badge evidence-${plan.confidence.toLowerCase()}`}>{plan.confidence}</span><small className="estimate-detail">{plan.evidence}</small></td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {(exploreLane === "api" ? visibleModels.length : visiblePlans.length) === 0 && (
                  <div className="empty-state">
                    <p>No entries match that search or provider filter.</p>
                    <button className="button button-ghost" onClick={() => { setQuery(""); setSelectedProviders([]); }} type="button">Clear search and filters</button>
                  </div>
                )}
              </div>
              <p className="book-note"><strong>Subscription access is not production API credit.</strong> An API-cost equivalent is not a usage quota unless the provider publishes credits or limits.</p>

              <details className="methodology-accordion" id="methodology">
                <summary>How estimates and equivalents work</summary>
                <div className="methodology-grid">
                  <div className="methodology-card">
                    <strong>1. Capability Gate</strong>
                    <p>
                      Each scenario declares a minimum {capabilityIndex.name} score (v{capabilityIndex.version}, {capabilityIndex.scale}),
                      anchored to a named model so the number can be re-derived when the index is rebased. Scores are published by
                      Artificial Analysis, not by us. A model with no published score is listed and priced but never given a tier.
                    </p>
                  </div>
                  <div className="methodology-card">
                    <strong>2. Derived Tiers</strong>
                    <p>
                      Tiers are computed, never hand-graded. Among the models that clear the bar and whose context window holds the
                      work, S/A/B/C are cut at fixed percentiles ({Math.round(tierCuts[0] * 100)}%, {Math.round(tierCuts[1] * 100)}%,{" "}
                      {Math.round(tierCuts[2] * 100)}%) of a score that weights per-call cost {Math.round(rankingWeights.models.cost * 100)}%
                      and capability headroom {Math.round(rankingWeights.models.headroom * 100)}%.
                    </p>
                  </div>
                  <div className="methodology-card">
                    <strong>3. Token Cost Math</strong>
                    <p>Per-call costs calculate exact published input, cached input, and output token rates divided by 1,000,000.</p>
                  </div>
                  <div className="methodology-card">
                    <strong>4. Cache Share</strong>
                    <p>
                      Every workload profile carries the share of input billed at the cached rate, and it applies to
                      API costs as well as plan estimates. A plan that publishes its own cache behaviour overrides the
                      profile. Ignoring this overstates the cost of agent work, where most of a large prompt is a cache read.
                    </p>
                  </div>
                  <div className="methodology-card">
                    <strong>5. Quota Conversions</strong>
                    <p>
                      Credit formulas use each provider&rsquo;s published multipliers and divisor; dollar-denominated caps convert
                      at the same list rates the catalog stores. Weekly allowances are normalised to 4.33 weeks, and the range
                      spans peak to off-peak rates. Where no quota converts, capacity is left unscored rather than guessed.
                    </p>
                  </div>
                  <div className="methodology-card">
                    <strong>6. Price Break-Even Caveat</strong>
                    <p>Where hard limits are not published, break-even indicates where API spend matches subscription price, not guaranteed throughput.</p>
                  </div>
                </div>
              </details>

              <details className="sources price-sources" id="price-sources">
                <summary>Primary pricing and quota sources</summary>
                <div>
                  <a href={capabilityIndex.source} target="_blank" rel="noreferrer">Artificial Analysis capability index ↗</a>
                  <a href="https://developers.openai.com/api/docs/models/compare" target="_blank" rel="noreferrer">OpenAI API ↗</a>
                  <a href="https://learn.chatgpt.com/docs/pricing" target="_blank" rel="noreferrer">ChatGPT plans ↗</a>
                  <a href="https://claude.com/pricing" target="_blank" rel="noreferrer">Claude API ↗</a>
                  <a href="https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan" target="_blank" rel="noreferrer">Claude plan credit ↗</a>
                  <a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">Gemini API ↗</a>
                  <a href="https://developers.google.com/profile/help/benefits" target="_blank" rel="noreferrer">Google plan credits ↗</a>
                  <a href="https://cursor.com/docs/models-and-pricing" target="_blank" rel="noreferrer">Cursor pools ↗</a>
                  <a href="https://opencode.ai/docs/go/" target="_blank" rel="noreferrer">OpenCode Go ↗</a>
                  <a href="https://opencode.ai/docs/zen/" target="_blank" rel="noreferrer">OpenCode Zen ↗</a>
                  <a href="https://docs.z.ai/guides/overview/pricing" target="_blank" rel="noreferrer">GLM API ↗</a>
                  <a href="https://docs.z.ai/devpack/overview" target="_blank" rel="noreferrer">GLM Coding plans ↗</a>
                  <a href="https://www.kimi.com/help/membership/membership-pricing" target="_blank" rel="noreferrer">Kimi membership ↗</a>
                  <a href="https://www.kimi.com/en/resources/kimi-k2-7-code" target="_blank" rel="noreferrer">Kimi API ↗</a>
                  <a href="https://api-docs.deepseek.com/quick_start/pricing/" target="_blank" rel="noreferrer">DeepSeek API ↗</a>
                  <a href="https://docs.x.ai/developers/pricing" target="_blank" rel="noreferrer">xAI API ↗</a>
                  <a href="https://x.ai/pricing" target="_blank" rel="noreferrer">Grok plans ↗</a>
                  <a href="https://mistral.ai/pricing/" target="_blank" rel="noreferrer">Mistral plans ↗</a>
                  <a href="https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you" target="_blank" rel="noreferrer">Perplexity plans ↗</a>
                </div>
              </details>
            </section>
          </div>
        </div>
      </div>

      <div aria-labelledby="recommendation-tab" className="view-panel recommendation-panel" hidden={activeView !== "recommendation"} id="recommendation-panel" role="region">
        <section className="recommendation-view" id="recommendation-top">
          <header className="recommendation-header">
            <div>
              <span>Custom comparison</span>
              <h1 id="recommendation-top-heading" tabIndex={-1}>Your recommendation</h1>
            </div>
            <p>Set your workload, calls, and budget. The best API and plan update immediately.</p>
          </header>

          <div className={`decision-banner recommendation-summary decision-${preferredPath}`} aria-live="polite">
            <div className="decision-banner-header">
              <div className="decision-banner-badge-group">
                <span className="best-path-badge">BEST PATH</span>
                {!apiWithinBudget && (
                  <div className="decision-fallback-note">
                    <Icon name="warning" size={13} />
                    {apiFrontier.budgetFits ? (
                      <span>
                        You are viewing <strong>{activePick.label.toLowerCase()}</strong>, which is{" "}
                        {monthlyPriceAgainst(recommendedApiSpend, monthlyBudget)}/mo and over your{" "}
                        ${monthlyBudget.toLocaleString()}/mo budget.{" "}
                        <button className="inline-link" onClick={() => setApiPriority("budget")} type="button">
                          Best in budget
                        </button>{" "}
                        is {budgetPick.model.name} at {monthlyPriceAgainst(budgetPick.spend, monthlyBudget)}/mo.
                      </span>
                    ) : (
                      <span>
                        No model clears the {recommendationScenario.label.toLowerCase()} bar within{" "}
                        ${monthlyBudget.toLocaleString()}/mo. You are viewing{" "}
                        <strong>{activePick.label.toLowerCase()}</strong> at{" "}
                        {monthlyPriceAgainst(recommendedApiSpend, monthlyBudget)}/mo
                        {costPick.model.id !== activePick.model.id && (
                          <>, and the cheapest is {costPick.model.name} at{" "}
                            {monthlyPriceAgainst(costPick.spend, monthlyBudget)}/mo</>
                        )}.
                      </span>
                    )}
                  </div>
                )}
              </div>
              <button
                className="copy-link-btn"
                onClick={handleCopyLink}
                title="Copy shareable link to this recommendation"
                type="button"
              >
                <Icon name={copiedLink ? "check" : "copy"} size={14} />
                <span>{copiedLink ? "Link copied" : "Copy link"}</span>
              </button>
            </div>

            <div className="decision-facts-strip">
              <div className="decision-fact">
                <small>Monthly API Spend</small>
                <strong>{monthlyPriceAgainst(recommendedApiSpend, monthlyBudget)}</strong>
                <span>{apiRecommendationModel.name}</span>
              </div>
              <div className="decision-fact">
                <small>Plan Cost &amp; Quota</small>
                <strong>{planRecommendation === null ? "None" : `$${recommendedPlanPrice}/mo`}</strong>
                <span>{planRecommendation === null ? "No comparable plan" : `${planRecommendation.name} (~${recommendedPlanCalls} calls)`}</span>
              </div>
              <div className="decision-fact">
                <small>Difference</small>
                <strong>{planRecommendation === null ? "—" : sameMonthlyPrice ? "Same price" : `${monthlyPrice(Math.abs(apiPlanDifference))}/mo`}</strong>
                <span>{planRecommendation === null ? "API only" : sameMonthlyPrice ? "Same monthly cost" : apiPlanDifference < 0 ? "API is more cost-effective" : "Plan is more cost-effective"}</span>
              </div>
            </div>
            <p className="decision-verdict-caption">{diffFactCaption}</p>
          </div>

          <div className="recommendation-workspace">
            <section className="settings-card" id="recommendation-settings" aria-labelledby="settings-title">
              <div className="settings-heading"><h2 id="settings-title">Your settings</h2></div>
              <div className="settings-body">
                <fieldset>
                  <legend>Workload</legend>
                  <div className="custom-settings-grid">
                    <label>
                      <span>Work type</span>
                      <select id="recommendation-profile" value={recommendationScenarioId} onChange={(event) => updateRecommendationProfile(event.target.value as ScenarioId)}>
                        {scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Input tokens / call</span>
                      <input inputMode="numeric" min="1" max="1000000" type="number" value={recommendationInputTokens} onChange={(event) => setRecommendationInputTokens(Math.min(1_000_000, Math.max(1, Number(event.target.value) || 1)))} />
                      <div className="preset-chips" role="group" aria-label="Input token presets">
                        {[2000, 18000, 50000, 100000].map((val) => (
                          <button key={val} type="button" className={`preset-chip ${recommendationInputTokens === val ? "active" : ""}`} onClick={() => setRecommendationInputTokens(val)}>
                            {val >= 1000 ? `${val / 1000}K` : val}
                          </button>
                        ))}
                      </div>
                    </label>
                    <label>
                      <span>Output tokens / call</span>
                      <input inputMode="numeric" min="1" max="500000" type="number" value={recommendationOutputTokens} onChange={(event) => setRecommendationOutputTokens(Math.min(500_000, Math.max(1, Number(event.target.value) || 1)))} />
                      <div className="preset-chips" role="group" aria-label="Output token presets">
                        {[500, 2000, 6000, 15000].map((val) => (
                          <button key={val} type="button" className={`preset-chip ${recommendationOutputTokens === val ? "active" : ""}`} onClick={() => setRecommendationOutputTokens(val)}>
                            {val >= 1000 ? `${val / 1000}K` : val}
                          </button>
                        ))}
                      </div>
                    </label>
                    <label>
                      <span>Input from cache</span>
                      <span className="input-affix">
                        <input
                          aria-describedby="cache-unit"
                          inputMode="numeric"
                          max="95"
                          min="0"
                          onChange={(event) => setRecommendationCacheRatio(Math.min(0.95, Math.max(0, (Number(event.target.value) || 0) / 100)))}
                          type="number"
                          value={Math.round(recommendationCacheRatio * 100)}
                        />
                        <span id="cache-unit">% of input</span>
                      </span>
                      <div className="preset-chips" role="group" aria-label="Cache share presets">
                        {[0, 25, 60, 90].map((val) => (
                          <button key={val} type="button" className={`preset-chip ${Math.round(recommendationCacheRatio * 100) === val ? "active" : ""}`} onClick={() => setRecommendationCacheRatio(val / 100)}>
                            {val}%
                          </button>
                        ))}
                      </div>
                    </label>
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Monthly needs</legend>
                  <div className="custom-settings-grid">
                    <label>
                      <span>Calls / month</span>
                      <input inputMode="numeric" min="1" max="100000" type="number" value={monthlyCalls} onChange={(event) => setMonthlyCalls(Math.min(100_000, Math.max(1, Number(event.target.value) || 1)))} />
                    </label>
                    <label>
                      <span>Budget / month</span>
                      <input inputMode="numeric" min="1" max="10000" type="number" value={monthlyBudget} onChange={(event) => setMonthlyBudget(Math.min(10_000, Math.max(1, Number(event.target.value) || 1)))} />
                    </label>
                    <label>
                      <span>Preference</span>
                      <select value={preference} onChange={(event) => setPreference(event.target.value as Preference)}>
                        <option value="either">Compare both</option>
                        <option value="api">API first</option>
                        <option value="plans">Plan first</option>
                      </select>
                    </label>
                  </div>
                </fieldset>
                <p className="settings-note">
                  <span><strong>Work type</strong> sets the capability bar and replaces all four numbers below with that profile&rsquo;s typical month.</span>
                  <br />
                  <span><strong>Input from cache</strong> is the share of input billed at the cached rate. Agent sessions that resend a stable prefix sit high; one-off document analysis sits low.</span>
                </p>
              </div>
            </section>

            <section className="recommendation-card recommendation-output" aria-labelledby="recommendation-title">
              <div className="settings-heading"><h2 id="recommendation-title">Best path</h2></div>
              <div className="recommendation-grid">
                <article className={preferredPath === "api" ? "path-card primary" : "path-card"}>
                  <div className="path-card-label">
                    <span>BEST API</span>
                    <span className={`gate-pill ${apiFrontier.meetsBar ? "gate-pass" : "gate-fail"}`}>
                      {apiRecommendationIndex === null ? "Not scored" : `Index ${apiRecommendationIndex}`}
                    </span>
                  </div>
                  <div className="path-title">
                    <span className="provider-orb" data-provider={apiRecommendationModel.provider} />
                    <div><strong>{apiRecommendationModel.name}</strong><small>{apiRecommendationModel.provider} · direct API</small></div>
                    {preferredPath === "api" && <span className="recommendation-badge">Best</span>}
                  </div>
                  <p className="path-price" title={`${price(recommendedApiSpend)} per month`}>{monthlyPriceAgainst(recommendedApiSpend, monthlyBudget)}<span>/ month</span></p>
                  <dl><div><dt>Per call</dt><dd>{price(callCost(apiRecommendationModel, recommendationSettings), 3)}</dd></div><div><dt>Budget</dt><dd>{apiWithinBudget ? "Fits" : `Over by ${monthlyPrice(recommendedApiSpend - monthlyBudget)}`}</dd></div><div><dt>Capability bar</dt><dd>{metricLabels[recommendationMetric]} &ge; {recommendationScenario.gate.minIndex}</dd></div></dl>
                  <div className="path-card-verdict">
                    <p>
                      {apiFrontier.meetsBar
                        ? `${activePick.hint}, at ${monthlyPriceAgainst(recommendedApiSpend, monthlyBudget)}/mo for ${monthlyCalls.toLocaleString()} calls.`
                        : `No model clears the ${recommendationScenario.label.toLowerCase()} bar at this context size. Showing the highest scored model.`}
                    </p>
                  </div>

                  {apiFrontier.meetsBar && (
                    <div className="frontier" role="group" aria-label="API priority">
                      <p className="frontier-caption">
                        {frontierPicks.every((pick) => pick.model.id === frontierPicks[0].model.id)
                          ? "One model leads on every axis for this workload and budget."
                          : "These are three different answers. Pick which one to compare against the plan."}
                      </p>
                      {frontierPicks.map((pick) => (
                        <button
                          aria-pressed={apiPriority === pick.id}
                          className={`frontier-option ${apiPriority === pick.id ? "active" : ""}`}
                          key={pick.id}
                          onClick={() => setApiPriority(pick.id)}
                          title={pick.hint}
                          type="button"
                        >
                          <span className="frontier-option-label">{pick.label}</span>
                          <span className="frontier-option-model">
                            <span className="provider-orb" data-provider={pick.model.provider} />
                            <strong>{pick.model.name}</strong>
                          </span>
                          <span className="frontier-option-cost">
                            {monthlyPriceAgainst(pick.spend, monthlyBudget)}<small>/ mo</small>
                            {pick.overBudget && <small className="frontier-over">over budget</small>}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </article>

                {planRecommendation === null || recommendedPlanEstimate === null ? (
                  <article className="path-card path-card-empty">
                    <div className="path-card-label"><span>BEST PLAN</span></div>
                    <p>No subscription plan can be converted to this workload, so this comparison is API-only.</p>
                  </article>
                ) : (
                  <article className={preferredPath === "plans" ? "path-card primary" : "path-card"}>
                    <div className="path-card-label">
                      <span>BEST PLAN</span>
                      <span className={`gate-pill ${recommendedPlanOption?.meetsBar ? "gate-pass" : "gate-fail"}`}>
                        {recommendedPlanOption?.index === null || recommendedPlanOption?.index === undefined
                          ? "Not scored"
                          : `Index ${recommendedPlanOption.index}`}
                      </span>
                    </div>
                    <div className="path-title">
                      <span className="provider-orb" data-provider={planRecommendation.provider} />
                      <div><strong>{planRecommendation.name}</strong><small>{planRecommendation.provider} · subscription</small></div>
                      {preferredPath === "plans" && <span className="recommendation-badge">Best</span>}
                    </div>
                    <p className="path-price">${planRecommendation.monthly}<span>/ month</span></p>
                    <dl>
                      <div>
                        <dt>{recommendedPlanEstimate.basis === "Price break-even only" ? "API-cost parity" : "Est. capacity"}</dt>
                        <dd>{formatEstimateRange(recommendedPlanEstimate.callsLow, recommendedPlanEstimate.callsHigh)} calls</dd>
                      </div>
                      <div>
                        <dt>Model used</dt>
                        <dd>{recommendedPlanOption?.workingModel?.name ?? "None that clears the bar"}</dd>
                      </div>
                      <div><dt>Published quota</dt><dd>{planQuota(planRecommendation, recommendationScenarioId)}</dd></div>
                      <div><dt>Confidence</dt><dd>{planRecommendation.confidence} · {recommendedPlanEstimate.basis}</dd></div>
                    </dl>
                    {(planRecommendation.confidence === "Low" || recommendedPlanEstimate.basis === "Price break-even only") && (
                      <div className="confidence-caveat-badge">
                        <Icon name="warning" size={13} />
                        <span>Low confidence quota</span>
                      </div>
                    )}
                    <div className="path-card-verdict"><p>{planRecommendation.name}: ${planRecommendation.monthly}/month · {recommendedPlanCoverage === null ? "published quota cannot be converted to this profile" : `estimated ${recommendedPlanCalls} calls for this profile`}.</p></div>
                  </article>
                )}
              </div>
            </section>
          </div>

          <section className="unified-comparison-card" aria-labelledby="unified-comparison-title">
            <div className="unified-comparison-header">
              <div className="unified-comparison-heading">
                <span>Detailed Comparison</span>
                <h2 id="unified-comparison-title">
                  {recComparisonTab === "api" ? "Monthly cost by model" : "Plan cost and quota comparison"}
                </h2>
                <p className="unified-comparison-meta">
                  {monthlyCalls.toLocaleString()} calls · {recommendationInputTokens.toLocaleString()} in + {recommendationOutputTokens.toLocaleString()} out · ${monthlyBudget.toLocaleString()} budget
                </p>
              </div>
              <div className="book-switch comparison-lane-switch" role="group" aria-label="Detailed comparison lane">
                <button aria-pressed={recComparisonTab === "api"} className={recComparisonTab === "api" ? "active" : ""} onClick={() => setRecComparisonTab("api")} type="button">API <span>{rankedModelCosts.length}</span></button>
                <button aria-pressed={recComparisonTab === "plans"} className={recComparisonTab === "plans" ? "active" : ""} onClick={() => setRecComparisonTab("plans")} type="button">Plans <span>{rankedPlanOptions.length}</span></button>
              </div>
            </div>

            {recComparisonTab === "api" ? (
              <div className="model-cost-columns">
                {rankedModelCosts.map(({ model, perCall, monthly }) => {
                  const recommended = model.id === apiRecommendationModel.id;
                  const modelIndex = capabilityOf(model, recommendationMetric);
                  const clearsBar = modelIndex !== null && modelIndex >= recommendationScenario.gate.minIndex;
                  const ratio = Math.min(1, monthly / maxRankedMonthly);
                  return (
                    <article className={`model-cost-row ${recommended ? "recommended" : ""}`} key={model.id}>
                      <div className="cost-row-bar" style={{ width: `${Math.max(3, Math.round(ratio * 100))}%` }} />
                      <div className="cost-model">
                        <span className="provider-orb" data-provider={model.provider} />
                        <div>
                          <button className="table-item-name-btn" onClick={() => setActiveDetailItem(model)} type="button"><strong>{model.name}</strong></button>
                          <small>
                            {model.provider} · {modelIndex === null
                              ? "not scored"
                              : clearsBar
                                ? `index ${modelIndex}, clears the bar`
                                : `index ${modelIndex}, below the ${recommendationScenario.gate.minIndex} bar`}
                          </small>
                        </div>
                        {recommended && <span className="recommendation-badge">Best API</span>}
                      </div>
                      <div className="cost-total">
                        <strong title={price(monthly)}>{monthlyPrice(monthly)}</strong>
                        <span>{price(perCall, 4)} / call</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="plan-match-grid">
                  {rankedPlanOptions.slice(0, showAllPlans ? rankedPlanOptions.length : 6).map(({ plan, estimate, coverage, withinBudget, workingModel }, index) => (
                    <article className={`plan-match-card ${index === 0 ? "recommended" : ""}`} key={plan.id}>
                      <div className="plan-match-title">
                        <span className="provider-orb" data-provider={plan.provider} />
                        <div>
                          <button className="table-item-name-btn" onClick={() => setActiveDetailItem(plan)} type="button"><strong>{plan.name}</strong></button>
                          <small>{plan.provider} · via {workingModel?.name ?? "no qualifying model"}</small>
                        </div>
                        {index === 0 && <span className="recommendation-badge">Best plan</span>}
                      </div>
                      <p className="plan-match-price">${plan.monthly}<span>/ month</span></p>
                      <dl>
                        <div><dt>Budget</dt><dd>{withinBudget ? "Fits" : "Over budget"}</dd></div>
                        <div><dt>{estimate.basis === "Price break-even only" ? "API-cost parity" : "Est. capacity"}</dt><dd>{formatEstimateRange(estimate.callsLow, estimate.callsHigh)} calls</dd></div>
                        <div>
                          <dt>Your {monthlyCalls.toLocaleString()}-call target</dt>
                          <dd>
                            {coverage === null
                              ? <span title="No convertible quota was published, so capacity is left out of this plan's score rather than counted against it.">Not measurable</span>
                              : coverage === 100 ? "Estimated to cover" : coverage >= 70 ? "May cover at upper estimate" : "Below target"}
                          </dd>
                        </div>
                        <div><dt>Evidence</dt><dd>{plan.confidence} · {plan.evidence}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
                {rankedPlanOptions.length > 6 && (
                  <button className="show-more-btn" onClick={() => setShowAllPlans((prev) => !prev)} type="button">
                    {showAllPlans ? "Show fewer plans" : `Show all ${rankedPlanOptions.length} plans`}
                  </button>
                )}
                <p className="plan-match-note">Price break-even shows economic parity only. It is not a promised quota unless the provider publishes credits or limits.</p>
              </>
            )}
          </section>
        </section>
      </div>

      <div aria-labelledby="rank-tab" className="view-panel rank-panel" hidden={activeView !== "rank"} id="rank-panel" role="region">
        <RankBoard models={rankableModels} plans={rankablePlans} />
      </div>

      <Modal
        isOpen={activeDetailItem !== null}
        maxWidth="640px"
        onClose={() => setActiveDetailItem(null)}
        title={
          activeDetailItem && (
            <>
              <span className="provider-orb" data-provider={activeDetailItem.provider} />
              <div>
                <h3 id="detail-modal-title">{activeDetailItem.name}</h3>
                <small>{activeDetailItem.provider} · {"kind" in activeDetailItem ? activeDetailItem.kind : "Foundation Model"}</small>
              </div>
            </>
          )
        }
        titleId="detail-modal-title"
      >
        {activeDetailItem && (
          <>
            <div className="detail-modal-body">
              {"input" in activeDetailItem ? (
                <div className="detail-specs-grid">
                  <div className="spec-box"><small>Input Rate</small><strong>{price(activeDetailItem.input)} / 1M</strong></div>
                  <div className="spec-box"><small>Cached Input</small><strong>{activeDetailItem.cached !== null ? `${price(activeDetailItem.cached, 4)} / 1M` : "—"}</strong></div>
                  <div className="spec-box"><small>Output Rate</small><strong>{price(activeDetailItem.output)} / 1M</strong></div>
                  <div className="spec-box"><small>Context Window</small><strong>{activeDetailItem.context}</strong></div>
                  <div className="spec-box"><small>Est. Call Cost ({exploreScenario.label})</small><strong>{price(callCost(activeDetailItem, exploreSettings), 4)}</strong></div>
                  <div className="spec-box"><small>{monthlyCalls.toLocaleString()} Calls / Month</small><strong>{monthlyPrice(callCost(activeDetailItem, exploreSettings) * monthlyCalls)}</strong></div>
                  <div className="spec-box full-span">
                    <small>{capabilityIndex.name}</small>
                    {activeDetailItem.capability === null ? (
                      <strong>Not independently scored</strong>
                    ) : (
                      <>
                        <strong>
                          {metricValue(activeDetailItem.capability, exploreMetric) ?? "—"}
                          <span className="spec-box-qualifier">
                            {" "}/ 100 · bar for {exploreScenario.label.toLowerCase()} is {exploreScenario.gate.minIndex}
                          </span>
                        </strong>
                        <small className="spec-box-note">
                          v{activeDetailItem.capability.indexVersion}
                          {activeDetailItem.capability.variant ? ` · ${activeDetailItem.capability.variant} effort` : ""}
                          {" · verified "}{activeDetailItem.capability.verifiedAt}{" · "}
                          <a href={activeDetailItem.capability.source} rel="noreferrer" target="_blank">source</a>
                        </small>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="detail-specs-grid">
                  <div className="spec-box"><small>Monthly Price</small><strong>{planPrice(activeDetailItem)}</strong></div>
                  <div className="spec-box"><small>Quota Evidence</small><strong>{activeDetailItem.confidence} ({activeDetailItem.evidence})</strong></div>
                  <div className="spec-box">
                    <small>Model used for {exploreScenario.label}</small>
                    {(() => {
                      const working = planWorkingModel(activeDetailItem, exploreScenario, exploreSettings);
                      if (!working) return <strong>None that clears the bar</strong>;
                      const index = metricValue(working.capability, exploreMetric);
                      return (
                        <strong>
                          {working.name}
                          {index !== null && (
                            <span className="spec-box-qualifier"> · index {index}</span>
                          )}
                        </strong>
                      );
                    })()}
                  </div>
                  <div className="spec-box full-span">
                    <small>Models on this plan ({activeDetailItem.modelIds.length})</small>
                    <strong>
                      {activeDetailItem.modelIds
                        .map((id) => modelById.get(id)?.name ?? id)
                        .join(", ")}
                    </strong>
                  </div>
                  <div className="spec-box"><small>API Included?</small><strong>{activeDetailItem.apiIncluded}</strong></div>
                  <div className="spec-box full-span"><small>Published Quota / Rule</small><strong>{planQuota(activeDetailItem, exploreScenarioId)}</strong></div>
                </div>
              )}

              {activeDetailItem.note && (
                <div className="modal-note-box">
                  <strong>Notes &amp; Limitations:</strong>
                  <p>{activeDetailItem.note}</p>
                </div>
              )}

              <div className="modal-scenario-fits">
                <strong>Derived tier by scenario:</strong>
                <div className="scenario-fits-list">
                  {scenarios.map((sc) => {
                    const placement = itemPlacement(activeDetailItem, sc.id);
                    return (
                      <div className="scenario-fit-item" key={sc.id}>
                        <span>{sc.label}</span>
                        <span className={`mini-tier ${placementClass(placement)}`} title={placementReason(placement, sc, sc.gate.metric)}>
                          {placementLabel(placement)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="modal-scenario-fits-note">
                  Tiers are derived from {capabilityIndex.name} v{capabilityIndex.version} scores against each scenario&rsquo;s
                  capability bar, then ranked on cost. Hover a letter for the reason.
                </p>
              </div>
            </div>
            <footer className="detail-modal-footer">
              <button
                className={`button ${compareList.some((c) => c.id === activeDetailItem.id) ? "button-primary" : "button-ghost"}`}
                onClick={() => toggleCompare(activeDetailItem)}
                type="button"
              >
                {compareList.some((c) => c.id === activeDetailItem.id) ? "In compare tray" : "+ Add to compare"}
              </button>
              <a className="button button-ghost" href={activeDetailItem.source} rel="noreferrer" target="_blank">
                <span>Official source</span>
                <Icon name="external" size={14} />
              </a>
            </footer>
          </>
        )}
      </Modal>

      {compareList.length > 0 && (
        <aside aria-label="Item comparison tray" className="compare-floating-tray">
          <div className="compare-tray-content">
            <div className="compare-tray-items">
              <span className="compare-tray-label">Compare {isComparingPlans ? "plans" : "models"} ({compareList.length}/3):</span>
              {compareList.map((item) => (
                <span className="compare-item-tag" key={item.id}>
                  <span className="provider-orb" data-provider={item.provider} />
                  <strong>{item.name}</strong>
                  <button aria-label={`Remove ${item.name} from comparison`} onClick={() => toggleCompare(item)} type="button">
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="compare-tray-actions">
              <button className="button button-primary" onClick={() => setShowCompareModal(true)} type="button">
                Compare side-by-side
              </button>
              <button className="button button-ghost" onClick={() => setCompareList([])} type="button">
                Clear
              </button>
            </div>
          </div>
        </aside>
      )}

      <Modal
        isOpen={showCompareModal}
        maxWidth="900px"
        onClose={() => setShowCompareModal(false)}
        title={
          <div>
            <h3 id="compare-modal-title">Side-by-side comparison ({isComparingPlans ? "Plans" : "Models"} · {exploreScenario.label})</h3>
          </div>
        }
        titleId="compare-modal-title"
      >
        <div className="compare-modal-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Attribute</th>
                {compareList.map((item) => (
                  <th key={item.id}>
                    <div className="compare-th-item">
                      <span className="provider-orb" data-provider={item.provider} />
                      <strong>{item.name}</strong>
                      <small>{item.provider}</small>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compareRows.map((row) => {
                // Mark the best cell so a comparison reads as a comparison. Ties
                // mark every tied cell; a single item is never a "winner".
                const scores = row.score ? compareList.map(row.score) : [];
                const usable = scores.filter((value): value is number => value !== null);
                const best = row.score && compareList.length > 1 && usable.length > 1
                  ? (row.better === "higher" ? Math.max(...usable) : Math.min(...usable))
                  : null;
                const allEqual = best !== null && usable.every((value) => value === best);
                return (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    {compareList.map((item, index) => {
                      const isBest = best !== null && !allEqual && scores[index] === best;
                      return (
                        <td className={isBest ? "compare-best" : undefined} key={item.id}>
                          {isBest && <span className="visually-hidden">Best: </span>}
                          {row.render(item)}
                          {isBest && <Icon className="compare-best-mark" name="check" size={13} />}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="compare-note">
            A tick marks the better value in a row. {isComparingPlans
              ? "Plan capacity and capability come from the cheapest model each plan offers that clears the bar."
              : `Costs use the ${exploreScenario.label.toLowerCase()} profile.`}
          </p>
        </div>
      </Modal>

      {showBackToTop && compareList.length === 0 && (
        <button
          aria-label="Back to top"
          className="back-to-top-btn"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          type="button"
        >
          <Icon name="arrow-up" size={14} />
          <span>Top</span>
        </button>
      )}

      <footer className="site-footer">
        <div className="footer-top">
          <a className="brand" href={activeView === "explore" ? "#explore-top" : activeView === "recommendation" ? "#recommendation-top" : "#rank-top"} onClick={(e) => { e.preventDefault(); switchView(activeView); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            <span className="brand-mark">T/T</span>
            <span>TokenTier</span>
          </a>
          <nav className="footer-nav" aria-label="Footer navigation">
            <a href="#methodology" onClick={(e) => handleFooterNav(e, "methodology")}>Methodology</a>
            <a href="#prices" onClick={(e) => handleFooterNav(e, "prices")}>Price book</a>
            <a href="#price-sources" onClick={(e) => handleFooterNav(e, "price-sources")}>Sources</a>
            <a href="https://github.com/majinwakeup/tokentier" rel="noreferrer" target="_blank">
              <span>GitHub</span>
              <Icon name="external" size={13} />
            </a>
            <a href="https://github.com/majinwakeup/tokentier/issues" rel="noreferrer" target="_blank">
              <span>Report correction</span>
              <Icon name="external" size={13} />
            </a>
          </nav>
        </div>
        <div className="footer-bottom">
          <p className="footer-identity">
            © 2026 Jin Ma · Open-source code under MIT · Independent project · Capability scores by{" "}
            <a href={capabilityIndex.source} rel="noreferrer" target="_blank">Artificial Analysis</a>
          </p>
          <span className="footer-freshness">Data updated {pricingUpdatedAt}</span>
        </div>
      </footer>
    </main>
  );
}

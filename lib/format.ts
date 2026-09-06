// Money, token, and label formatting shared by every view. Pure functions.

import type { MetricKey, Plan, Scenario, ScenarioId, Tier } from "./catalog/types.js";
import type { Placement } from "./domain/placement.js";
import { scenarioTokens } from "./domain/eligibility.js";

export const metricLabels: Record<MetricKey, string> = {
  intelligence: "Intelligence Index",
  codingAgent: "Coding Agent Index",
  agentic: "Agentic Index",
  longContext: "Long-context Index",
};

export const tierOrder: Tier[] = ["S", "A", "B", "C"];

// Tiers rank value among the models that already cleared the capability bar,
// so the letters describe price-for-capability, not raw capability.
export const tierDescriptions: Record<Tier, string> = {
  S: "Best value above the bar",
  A: "Strong value",
  B: "Fair value",
  C: "Weakest value above the bar",
};

const providerPriority = ["OpenAI", "Anthropic", "xAI", "Google"];

export function byProviderPriority(a: string, b: string) {
  const aIdx = providerPriority.indexOf(a);
  const bIdx = providerPriority.indexOf(b);
  if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
  if (aIdx !== -1) return -1;
  if (bIdx !== -1) return 1;
  return a.localeCompare(b);
}

export function providerFilterNames(providers: string[]) {
  return ["All", ...Array.from(new Set(providers)).sort(byProviderPriority)];
}

export function price(value: number, digits = 2) {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(digits > 2 ? digits : 4)}`;
  return `$${value.toFixed(digits)}`;
}

export function monthlyPrice(value: number) {
  if (value === 0) return "$0";
  if (value < 1) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString()}`;
}

// Whole-dollar rounding can land a figure on the wrong side of the budget it is
// being judged against: $3.33 renders as "$3" beside an "over budget" tag on a
// $3 budget. Keep cents whenever the rounded value would contradict the verdict.
export function monthlyPriceAgainst(value: number, reference: number) {
  const rounded = Math.round(value);
  const contradicts = (value > reference && rounded <= reference)
    || (value < reference && rounded > reference);
  return contradicts ? `$${value.toFixed(2)}` : monthlyPrice(value);
}

export function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.round(value));
}

export function formatEstimateRange(low: number, high: number) {
  if (Math.abs(high - low) < 1) return compactNumber(low);
  return `${compactNumber(low)}–${compactNumber(high)}`;
}

export function formatMoneyRange(low: number, high: number) {
  if (Math.abs(high - low) < 0.01) return price(low, 0);
  return `${price(low, 0)}–${price(high, 0)}`;
}

export function planPrice(plan: Plan) {
  if (plan.monthly === null) return "Pay as you go";
  return `$${plan.monthly}`;
}

export function planQuota(plan: Plan, scenarioId: ScenarioId) {
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

export function placementLabel(placement: Placement) {
  return placement.state === "tier" ? placement.tier : "—";
}

export function placementClass(placement: Placement) {
  return placement.state === "tier" ? `tier-${placement.tier.toLowerCase()}` : "tier-na";
}

export function placementReason(placement: Placement, scenario: Scenario, metric: MetricKey) {
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

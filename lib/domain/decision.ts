// Turns one workload into the complete answer a reader is owed: which path
// wins, what each objective would pick instead, what it costs, and why. Pure,
// so the same derivation can be asserted in tests without rendering anything.
//
// Nothing here relaxes a constraint. When no option qualifies the result says
// so; it never falls back to the nearest thing that does not fit.

import type { Catalog, Model, Plan, Scenario } from "../catalog/types.js";
import { monthlyPrice } from "../format.js";
import { recommend, type Objective, type RecommendationResult, type Workload } from "./recommend.js";
import type { Preference } from "./workload.js";

export type Lane = "api" | "plans";

export type FrontierPick = {
  id: Objective;
  label: string;
  hint: string;
  model: Model | null;
  spend: number;
  // Other objectives that land on the same model, so three identical cards can
  // be reported as one answer instead of repeated three times.
  sameAs: string[];
  overBudget: boolean;
  noMatch: boolean;
};

const objectiveLabels: Array<{ id: Objective; label: string; hint: string }> = [
  { id: "cost", label: "Lowest cost", hint: "Cheapest model that clears the bar" },
  { id: "budget", label: "Best in budget", hint: "Highest scored model whose monthly spend fits the budget" },
  { id: "capability", label: "Most capable", hint: "Highest scored model that clears the bar, budget aside" },
];

export type Decision = {
  result: RecommendationResult;
  frontier: FrontierPick[];
  active: FrontierPick;
  costPick: FrontierPick;
  budgetPick: FrontierPick;
  apiModel: Model | null;
  apiSpend: number;
  apiWithinBudget: boolean;
  apiNoMatch: boolean;
  plan: Plan | null;
  planMonthly: number | null;
  planCoversVolume: boolean;
  planWithinBudget: boolean;
  planNoMatch: boolean;
  preferredPath: Lane;
  difference: number;
  sameMonthlyPrice: boolean;
  caption: string;
};

export function decide(
  catalog: Catalog,
  scenario: Scenario,
  workload: Workload,
  objective: Objective,
  preference: Preference,
): Decision {
  // One evaluation per objective, reused for the active answer and for the
  // frontier, so the card a reader selects and the card they compare against
  // can never come from different runs of the engine.
  const byObjective = new Map<Objective, RecommendationResult>(
    objectiveLabels.map((entry) => [entry.id, recommend(catalog, scenario, workload, entry.id)]),
  );
  const result = byObjective.get(objective) ?? recommend(catalog, scenario, workload, objective);

  const frontier: FrontierPick[] = objectiveLabels.map((entry) => {
    const evaluated = byObjective.get(entry.id)!;
    const model = evaluated.api.best?.model ?? null;
    const spend = evaluated.api.best?.monthlyCost ?? 0;
    const sameAs = model
      ? objectiveLabels
          .filter((other) => other.id !== entry.id)
          .filter((other) => byObjective.get(other.id)?.api.best?.model?.id === model.id)
          .map((other) => other.label)
      : [];
    return {
      ...entry,
      model,
      spend,
      sameAs,
      overBudget: spend > workload.budget,
      noMatch: evaluated.api.noMatch,
    };
  });

  const active = frontier.find((pick) => pick.id === objective) ?? frontier[0];
  const costPick = frontier.find((pick) => pick.id === "cost") ?? frontier[0];
  const budgetPick = frontier.find((pick) => pick.id === "budget") ?? frontier[0];

  const apiModel = result.api.best?.model ?? null;
  const apiSpend = result.api.best?.monthlyCost ?? 0;
  const apiNoMatch = result.api.noMatch;
  const apiWithinBudget = !apiNoMatch && apiSpend <= workload.budget;

  const planBest = result.plans.best;
  const plan = planBest?.plan ?? null;
  const planMonthly = plan?.monthly ?? null;
  const planCoversVolume = planBest?.coverage === 100;
  const planWithinBudget = planBest?.withinBudget ?? false;
  const planNoMatch = result.plans.noMatch;

  // The path follows from the budget and coverage facts, not from a fudge
  // factor: an option that does not fit the budget or the volume cannot be
  // preferred over one that does.
  const preferredPath: Lane = apiNoMatch && planNoMatch
    ? "api"
    : apiNoMatch
      ? "plans"
      : planNoMatch || !plan
        ? "api"
        : preference === "api"
          ? (apiWithinBudget || !planWithinBudget || !planCoversVolume ? "api" : "plans")
          : preference === "plans"
            ? (planWithinBudget && planCoversVolume ? "plans" : "api")
            : apiWithinBudget && !planWithinBudget
              ? "api"
              : planWithinBudget && planCoversVolume && !apiWithinBudget
                ? "plans"
                : apiSpend <= (planMonthly ?? Infinity)
                  ? "api"
                  : "plans";

  const difference = apiSpend - (planMonthly ?? 0);
  const sameMonthlyPrice = Math.abs(difference) < 0.005;

  const caption = apiNoMatch && planNoMatch
    ? "No model or plan clears the capability bar for this workload."
    : apiNoMatch
      ? "No model clears the capability bar for this workload."
      : planNoMatch || !plan
        ? `No subscription plan can be compared for this workload. ${apiModel!.name} API is estimated at ${monthlyPrice(apiSpend)}/mo.`
        : sameMonthlyPrice
          ? "Both options cost the same monthly for this workload."
          : difference < 0
            ? preferredPath === "api"
              ? `API saves ${monthlyPrice(Math.abs(difference))}/mo compared to ${plan.name}`
              : `${apiModel!.name} API is ${monthlyPrice(Math.abs(difference))}/mo cheaper than ${plan.name}`
            : preferredPath === "plans"
              ? `${plan.name} saves ${monthlyPrice(Math.abs(difference))}/mo compared to API spend`
              : `API costs ${monthlyPrice(Math.abs(difference))}/mo more than ${plan.name}`;

  return {
    result,
    frontier,
    active,
    costPick,
    budgetPick,
    apiModel,
    apiSpend,
    apiWithinBudget,
    apiNoMatch,
    plan,
    planMonthly,
    planCoversVolume,
    planWithinBudget,
    planNoMatch,
    preferredPath,
    difference,
    sameMonthlyPrice,
    caption,
  };
}

// A single settled sentence for the live region. Announcing the whole result
// panel on every keystroke floods a screen reader; this says what changed.
export function announceDecision(decision: Decision, workload: Workload): string {
  if (decision.apiNoMatch && decision.planNoMatch) {
    return `No option qualifies for ${workload.calls.toLocaleString()} calls within $${workload.budget}/mo.`;
  }
  if (decision.preferredPath === "plans" && decision.plan) {
    return `Best path: ${decision.plan.name} at $${decision.plan.monthly}/mo.`;
  }
  if (decision.apiModel) {
    return `Best path: ${decision.apiModel.name} API at ${monthlyPrice(decision.apiSpend)}/mo${decision.apiWithinBudget ? "" : ", over budget"}.`;
  }
  return "No qualified model for this workload.";
}

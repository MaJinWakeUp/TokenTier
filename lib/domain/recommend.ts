// Unified cost-first recommendation pipeline. The same pure functions power
// Rankings (preset evaluation) and Recommend (custom workload): one pipeline,
// one definition of "best." No React, browser, or filesystem dependencies.
//
// The default objective is lowest cost among eligible options that meet the
// workload's requirements. Secondary objectives (highest capability within
// budget, best plan coverage) are reported separately, never substituted for
// the primary when it fails.

import type { Catalog, Model, Plan, Scenario, Tier, UsageSettings, AccessSurface } from "../catalog/types.js";
import { gateModel, metricValue, type Rejection } from "./eligibility.js";
import { callCost, planEstimate, planCoverageScore } from "./pricing.js";
import { curveTiers, planWorkingModel } from "./placement.js";

export type Objective = "cost" | "budget" | "capability";

export type AccessRequirement = AccessSurface | "any";

export type Workload = {
  scenarioId: string;
  input: number;
  output: number;
  calls: number;
  cacheRatio: number;
  budget: number;
  access: AccessRequirement;
};

export type ApiEvaluation = {
  model: Model;
  costPerCall: number;
  monthlyCost: number;
  index: number | null;
  withinBudget: boolean;
  eligible: boolean;
  rejection?: Rejection | { state: "pricing" };
};

export type PlanEvaluation = {
  plan: Plan;
  estimate: ReturnType<typeof planEstimate> | null;
  coverage: number | null;
  withinBudget: boolean;
  workingModel: Model | null;
  eligible: boolean;
  meetsBar: boolean;
  sufficientCoverage: boolean | null;
};

export type RecommendationResult = {
  api: {
    evaluations: ApiEvaluation[];
    best: ApiEvaluation | null;
    noMatch: boolean;
    objective: Objective;
  };
  plans: {
    evaluations: PlanEvaluation[];
    best: PlanEvaluation | null;
    noMatch: boolean;
  };
};

// Evaluate a single model against a workload. Eligibility is hard: a model
// that fails the gate is excluded, never substituted as a fallback.
// Uses the workload's custom input/output (not the scenario preset's) so the
// cost reflects the user's actual token profile (F2).
function evaluateModel(
  model: Model,
  scenario: Scenario,
  settings: UsageSettings,
  calls: number,
  budget: number,
): ApiEvaluation {
  const requiredTokens = settings.input + settings.output;
  const rejection = gateModel(model, scenario, requiredTokens);
  const costPerCall = callCost(model, settings);
  const monthlyCost = costPerCall * calls;
  const index = metricValue(model.capability, scenario.gate.metric);
  // A model whose pricing is unsupported for this workload (NaN cost, F6) is
  // not eligible — it cannot be a valid winner. The rejection is reported so
  // the UI can show "unsupported pricing" alongside the model.
  const pricingUnsupported = Number.isNaN(costPerCall);
  const eligible = rejection === null && !pricingUnsupported;
  const finalRejection = pricingUnsupported
    ? ({ state: "pricing" } as const)
    : rejection ?? undefined;
  return {
    model,
    costPerCall,
    monthlyCost,
    index,
    withinBudget: Number.isFinite(monthlyCost) && monthlyCost <= budget,
    eligible,
    rejection: finalRejection,
  };
}

function evaluatePlan(
  plan: Plan,
  scenario: Scenario,
  settings: UsageSettings,
  calls: number,
  budget: number,
  modelById: Map<string, Model>,
): PlanEvaluation {
  const workingModel = planWorkingModel(plan, scenario, settings, modelById);
  const meetsBar = workingModel !== null;
  const fallback = modelById.get(plan.modelIds[0]) ?? null;
  const estimate = planEstimate(plan, settings, workingModel, fallback);
  const coverage = planCoverageScore(plan, settings, calls, workingModel, fallback);
  const withinBudget = (plan.monthly ?? Infinity) <= budget;

  // Coverage classification:
  // - true: verified allowance covers the call volume (coverage === 100)
  // - false: verified allowance does not cover it (coverage < 100)
  // - null: no verified allowance (break-even or unknown)
  let sufficientCoverage: boolean | null = null;
  if (coverage !== null) {
    sufficientCoverage = coverage >= 100;
  }

  return {
    plan,
    estimate,
    coverage,
    withinBudget,
    workingModel,
    eligible: meetsBar,
    meetsBar,
    sufficientCoverage,
  };
}

// Select the best API model by objective. Ties break by lower cost, then by id.
// - "cost": cheapest eligible option within budget. When none fit, best=null.
// - "budget": highest-index eligible within budget. When none fit, best=null.
// - "capability": highest-index eligible regardless of budget (budget ignored).
function selectBestApi(evaluations: ApiEvaluation[], objective: Objective, // eslint-disable-next-line @typescript-eslint/no-unused-vars
  budget: number): ApiEvaluation | null {
  const eligible = evaluations.filter((e) => e.eligible);
  if (eligible.length === 0) return null;

  if (objective === "capability") {
    return [...eligible].sort((a, b) => (b.index ?? 0) - (a.index ?? 0) || a.costPerCall - b.costPerCall || a.model.id.localeCompare(b.model.id))[0];
  }

  // cost and budget both filter by withinBudget.
  const affordable = eligible.filter((e) => e.withinBudget);
  if (affordable.length === 0) return null;

  if (objective === "cost") {
    return [...affordable].sort((a, b) => a.costPerCall - b.costPerCall || a.model.id.localeCompare(b.model.id))[0];
  }
  // budget: highest index among affordable.
  return [...affordable].sort((a, b) => (b.index ?? 0) - (a.index ?? 0) || a.costPerCall - b.costPerCall || a.model.id.localeCompare(b.model.id))[0];
}

// Select the best plan: ONLY eligible + sufficient coverage + within budget.
// Never substitutes an ineligible, insufficient, or over-budget plan.
// Ties break by lower monthly, then by id.
function selectBestPlan(evaluations: PlanEvaluation[]): PlanEvaluation | null {
  const eligible = evaluations.filter((e) => e.eligible);
  if (eligible.length === 0) return null;

  const sufficient = eligible.filter((e) => e.sufficientCoverage === true && e.withinBudget);
  if (sufficient.length === 0) return null;
  return [...sufficient].sort((a, b) => (a.plan.monthly ?? Infinity) - (b.plan.monthly ?? Infinity) || a.plan.id.localeCompare(b.plan.id))[0];
}

// Check whether a plan's access surfaces satisfy the workload's access requirement.
function planMatchesAccess(plan: Plan, access: AccessRequirement): boolean {
  if (access === "any") return true;
  if (!plan.access || plan.access.length === 0) return false;
  return plan.access.includes(access);
}

export function recommend(
  catalog: Catalog,
  scenario: Scenario,
  workload: Workload,
  objective: Objective,
): RecommendationResult {
  const settings: UsageSettings = {
    input: workload.input,
    output: workload.output,
    cacheRatio: workload.cacheRatio,
  };

  // Filter models by access requirement (F2): a chat-only workload must not
  // recommend a direct API model, and vice versa.
  const apiModelsEligible = workload.access === "any" || workload.access === "api";

  const apiEvaluations = catalog.models
    .filter(() => apiModelsEligible)
    .map((model) =>
      evaluateModel(model, scenario, settings, workload.calls, workload.budget),
    );

  const planEvaluations = catalog.plans
    .filter((plan) => plan.kind === "Subscription")
    .filter((plan) => planMatchesAccess(plan, workload.access))
    .map((plan) =>
      evaluatePlan(plan, scenario, settings, workload.calls, workload.budget, catalog.modelById),
    );

  const bestApi = selectBestApi(apiEvaluations, objective, workload.budget);
  const bestPlan = selectBestPlan(planEvaluations.filter((row) => workload.calls > 0 || row.plan.monthly === 0));

  return {
    api: {
      evaluations: apiEvaluations,
      best: bestApi,
      noMatch: bestApi === null,
      objective,
    },
    plans: {
      evaluations: planEvaluations,
      best: bestPlan,
      noMatch: bestPlan === null,
    },
  };
}

// Curved cost tiers over an evaluated population. This is the same curve the
// board uses — one definition of a tier letter, not two.
export function costTiers(
  evaluations: ApiEvaluation[],
  cuts?: [number, number, number, number],
): Map<string, Tier> {
  const eligible = evaluations
    .filter((evaluation) => evaluation.eligible)
    .map((evaluation) => ({ id: evaluation.model.id, cost: evaluation.costPerCall }));
  return curveTiers(eligible, cuts);
}

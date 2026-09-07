// Token cost arithmetic and plan allowance conversion. Pure functions; every
// dollar figure derives from the catalog's recorded rates.

import type { Model, Plan, Quota, RateBand, UsageSettings } from "../catalog/types.js";

// Select the applicable rate band for a given input token count. The default
// band (no threshold) always exists as the top-level input/cached/output fields.
// Threshold bands apply when the billable input reaches their threshold. Bands
// are evaluated highest-threshold-first: the first whose threshold is met wins.
function applicableBand(model: Model, inputTokens: number): RateBand {
  const defaultBand: RateBand = {
    input: model.input,
    cached: model.cached,
    output: model.output,
  };
  if (!model.rateBands || model.rateBands.length === 0) return defaultBand;
  const sorted = [...model.rateBands].sort((a, b) => (b.threshold ?? 0) - (a.threshold ?? 0));
  for (const band of sorted) {
    if (band.threshold !== undefined && inputTokens >= band.threshold) return band;
  }
  return defaultBand;
}

function callCost(model: Model, settings: UsageSettings, cacheRatioOverride?: number) {
  // A plan's own cache behaviour wins when it publishes one; otherwise the
  // workload's reuse share applies.
  const cacheRatio = cacheRatioOverride ?? settings.cacheRatio;

  // F6: when a model's published rates are only verified below a threshold and
  // the workload exceeds it, return NaN to signal unsupported pricing rather
  // than silently using the base rate.
  if (model.unsupportedBeyond !== undefined && settings.input >= model.unsupportedBeyond) {
    return NaN;
  }

  const band = applicableBand(model, settings.input);
  const cachedRate = band.cached ?? band.input;
  const inputCost = (settings.input * (1 - cacheRatio) * band.input + settings.input * cacheRatio * cachedRate) / 1_000_000;
  const outputCost = (settings.output * band.output) / 1_000_000;
  return inputCost + outputCost;
}

export { callCost };

// Returns true when the model has rate bands that could change the price for
// this workload's input size — used to flag threshold pricing in the UI.
export function hasThresholdPricing(model: Model, inputTokens: number): boolean {
  if (!model.rateBands || model.rateBands.length === 0) return false;
  const band = applicableBand(model, inputTokens);
  return band.input !== model.input || band.output !== model.output || band.cached !== model.cached;
}

// Discriminated basis: the UI can branch on kind rather than fragile string
// comparisons. Each variant carries the information the display needs.
export type EstimateBasis =
  | { kind: "allowance"; label: string }
  | { kind: "credit"; label: string }
  | { kind: "break-even"; label: string }
  | { kind: "free"; label: string }
  | { kind: "conditional"; label: string }
  | { kind: "unknown-quota"; label: string };

export type PlanEstimate = {
  callsLow: number;
  callsHigh: number;
  valueLow: number;
  valueHigh: number;
  basis: EstimateBasis;
};

// Converts a per-resetWindow amount to a monthly equivalent. Monthly budgets
// need monthly capacity; a weekly or 5h cap cannot be proven sufficient for a
// monthly workload without knowing the distribution of calls across windows.
const windowFactor: Record<string, number> = {
  monthly: 1,
  weekly: 4.33,
  "5h": 144, // ~6 five-hour windows per day × 30 days
};

// Select the working model for plan cost/conversion. For credit-allowance
// plans, the model must have published credit multipliers — the credit formula
// is independent of API price. For dollar-allowance and break-even plans, any
// model that clears the capability gate works. `fallbackModel` covers plans
// that simply offer access.
function modelForPlanCost(
  plan: Plan,
  workingModel: Model | null | undefined,
  fallbackModel: Model | null | undefined,
): Model | null {
  if (workingModel) return workingModel;
  return fallbackModel ?? null;
}

// Compute credits consumed per call using the published credit formula. This is
// independent of the model's API price: credits are charged by the provider's
// own multipliers, not dollar-per-token rates.
function creditsPerCall(
  plan: Plan,
  model: Model,
  settings: UsageSettings,
): number | null {
  const multipliers = plan.creditMultipliers?.[model.id];
  if (!multipliers) return null;
  const [inputMultiplier, cachedMultiplier, outputMultiplier] = multipliers;
  const cacheRatio = plan.cacheRatio ?? settings.cacheRatio;
  const credits = (
    settings.input * (1 - cacheRatio) * inputMultiplier
    + settings.input * cacheRatio * cachedMultiplier
    + settings.output * outputMultiplier
  ) / 10_000;
  if (!Number.isFinite(credits) || credits <= 0) return null;
  return credits;
}

// Converts a plan's published allowance into covered calls for one workload.
// `workingModel` is the model the workload would use on the plan; `fallbackModel`
// is the plan's first listed model, used when no working model qualifies.
export function planEstimate(
  plan: Plan,
  settings: UsageSettings,
  workingModel?: Model | null,
  fallbackModel?: Model | null,
): PlanEstimate | null {
  const model = modelForPlanCost(plan, workingModel, fallbackModel);
  if (!model) return null;
  const referenceCost = callCost(model, settings, plan.cacheRatio);

  // NaN cost means the model's pricing is unsupported for this workload's input
  // size (F6). Return null — the plan cannot be costed, not "free" or "infinite".
  if (Number.isNaN(referenceCost)) {
    return null;
  }

  const quota = plan.quotaDetail;

  // Credit-allowance plans: use the published credit formula if multipliers
  // are available for this model. Credit capacity depends on the credit formula
  // and the quota amount, NOT the API price (F5).
  if (quota?.kind === "credit-allowance") {
    const cpc = creditsPerCall(plan, model, settings);
    if (cpc === null) {
      // No credit multipliers for this model: cannot compute capacity.
      return null;
    }
    // Monthly credit budget from quota.amount and resetWindow.
    const monthlyCredits = quota.amount * (windowFactor[quota.resetWindow] ?? 1);

    // Period classification: only monthly resetWindow without conditionalLimits
    // can prove monthly sufficiency. Weekly/5h or multi-window plans are
    // conditional because monthly inputs can't prove the distribution of calls
    // across shorter windows.
    const hasConditional = plan.conditionalLimits && plan.conditionalLimits.length > 0;
    if (quota.resetWindow !== "monthly" || hasConditional) {
      // Compute an upper bound using the monthly projection, but classify as
      // conditional so coverage never scores 100.
      const calls = monthlyCredits / cpc;
      const label = hasConditional
        ? `Multi-window cap: ${plan.conditionalLimits!.map((l) => l.description).join(", ")}`
        : `${quota.resetWindow} reset — monthly distribution unknown`;
      return {
        callsLow: 0,
        callsHigh: calls,
        valueLow: 0,
        valueHigh: calls * referenceCost,
        basis: { kind: "conditional", label },
      };
    }

    const calls = monthlyCredits / cpc;
    return {
      callsLow: calls,
      callsHigh: calls,
      valueLow: calls * referenceCost,
      valueHigh: calls * referenceCost,
      basis: { kind: "credit", label: "Official credit formula" },
    };
  }

  // Dollar-allowance plans: the published dollar amount is the verified cap.
  // Request-limit plans publish a call count directly, so capacity needs no
  // conversion: one published request is one call. The API-equivalent value is
  // what those calls would have cost at list rates.
  if (quota?.kind === "request-limit") {
    const monthlyRequests = quota.amount * (windowFactor[quota.resetWindow] ?? 1);
    const value = Number.isFinite(referenceCost) ? monthlyRequests * referenceCost : 0;

    // Same period rule as the other allowances: only a monthly window with no
    // shorter cap can prove monthly sufficiency.
    const hasConditional = plan.conditionalLimits && plan.conditionalLimits.length > 0;
    if (quota.resetWindow !== "monthly" || hasConditional) {
      const label = hasConditional
        ? `Multi-window cap: ${plan.conditionalLimits!.map((l) => l.description).join(", ")}`
        : `${quota.resetWindow} reset — monthly distribution unknown`;
      return {
        callsLow: 0,
        callsHigh: monthlyRequests,
        valueLow: 0,
        valueHigh: value,
        basis: { kind: "conditional", label },
      };
    }

    return {
      callsLow: monthlyRequests,
      callsHigh: monthlyRequests,
      valueLow: value,
      valueHigh: value,
      basis: { kind: "allowance", label: "Official request limit" },
    };
  }

  // quotaDetail is authoritative — includedApiValue is NOT used as a fallback
  // when quotaDetail is present but relative/unknown.
  if (quota?.kind === "dollar-allowance") {
    const allowance = quota.amount;
    const monthlyAllowance = allowance * (windowFactor[quota.resetWindow] ?? 1);

    // Period classification: only monthly resetWindow without conditionalLimits
    // can prove monthly sufficiency. Weekly/5h or multi-window plans are
    // conditional.
    const hasConditional = plan.conditionalLimits && plan.conditionalLimits.length > 0;
    if (quota.resetWindow !== "monthly" || hasConditional) {
      if (!Number.isFinite(referenceCost) || referenceCost <= 0) {
        return {
          callsLow: Infinity,
          callsHigh: Infinity,
          valueLow: 0,
          valueHigh: 0,
          basis: { kind: "free", label: "Free per-call cost" },
        };
      }
      const calls = monthlyAllowance / referenceCost;
      const label = hasConditional
        ? `Multi-window cap: ${plan.conditionalLimits!.map((l) => l.description).join(", ")}`
        : `${quota.resetWindow} reset — monthly distribution unknown`;
      return {
        callsLow: 0,
        callsHigh: calls,
        valueLow: 0,
        valueHigh: monthlyAllowance,
        basis: { kind: "conditional", label },
      };
    }

    // A zero per-call cost means the model is free to run. Report it honestly:
    // the call cost is $0, so the allowance covers any volume, but label the
    // basis as "free" rather than implying a published allowance was verified.
    if (!Number.isFinite(referenceCost) || referenceCost <= 0) {
      return {
        callsLow: Infinity,
        callsHigh: Infinity,
        valueLow: 0,
        valueHigh: 0,
        basis: { kind: "free", label: "Free per-call cost" },
      };
    }

    const calls = monthlyAllowance / referenceCost;
    return {
      callsLow: calls,
      callsHigh: calls,
      valueLow: monthlyAllowance,
      valueHigh: monthlyAllowance,
      basis: { kind: "allowance", label: plan.evidence === "Official credit" ? "Included API credit" : "Official capped value" },
    };
  }

  // Relative-limit or unknown quota: quotaDetail is authoritative. Do NOT fall
  // back to includedApiValue — that is a legacy soft field that may conflate
  // a relative limit with a verified allowance. Return an unknown-quota basis
  // so the UI shows the plan exists but its capacity is not measurable.
  if (quota?.kind === "relative-limit" || quota?.kind === "unknown") {
    return {
      callsLow: 0,
      callsHigh: 0,
      valueLow: 0,
      valueHigh: 0,
      basis: { kind: "unknown-quota", label: "Relative limit — not convertible" },
    };
  }

  // No quotaDetail: legacy fields only. includedApiValue is used when
  // quotaDetail is absent (backward compatibility with pre-v3 catalogs).
  if (plan.includedApiValue !== undefined && plan.includedApiValue > 0) {
    if (!Number.isFinite(referenceCost) || referenceCost <= 0) {
      return {
        callsLow: Infinity,
        callsHigh: Infinity,
        valueLow: 0,
        valueHigh: 0,
        basis: { kind: "free", label: "Free per-call cost" },
      };
    }
    const calls = plan.includedApiValue / referenceCost;
    return {
      callsLow: calls,
      callsHigh: calls,
      valueLow: plan.includedApiValue,
      valueHigh: plan.includedApiValue,
      basis: { kind: "allowance", label: plan.evidence === "Official credit" ? "Included API credit" : "Official capped value" },
    };
  }

  // Price break-even is NOT verified allowance — it is a comparison of the plan
  // price against the equivalent API spend. Label it distinctly (F4).
  if (plan.monthly !== null && plan.monthly > 0) {
    if (!Number.isFinite(referenceCost) || referenceCost <= 0) {
      return {
        callsLow: Infinity,
        callsHigh: Infinity,
        valueLow: 0,
        valueHigh: 0,
        basis: { kind: "free", label: "Free per-call cost" },
      };
    }
    const calls = plan.monthly / referenceCost;
    return {
      callsLow: calls,
      callsHigh: calls,
      valueLow: plan.monthly,
      valueHigh: plan.monthly,
      basis: { kind: "break-even", label: "Price break-even (not verified allowance)" },
    };
  }

  return null;
}

// Coverage score for a target monthly call count: 100 when the published lower
// bound covers it, 70 when only the upper bound does, and a scaled penalty
// below that. Returns null when the plan publishes nothing convertible.
// Only verified allowance (credits or included value) counts as coverage.
// Break-even comparison does not prove the plan covers the workload (F4).
// Conditional and unknown-quota plans never score 100 (not proven sufficient).
export function planCoverageScore(
  plan: Plan,
  settings: UsageSettings,
  calls: number,
  workingModel?: Model | null,
  fallbackModel?: Model | null,
) {
  const estimate = planEstimate(plan, settings, workingModel, fallbackModel);
  if (!estimate) return null;
  // Only verified allowance (credits or included value) counts as coverage.
  // Break-even, conditional, and unknown do not prove the plan covers the
  // workload (F4).
  if (estimate.basis.kind !== "allowance" && estimate.basis.kind !== "credit") {
    if (estimate.basis.kind === "conditional") {
      // Conditional: coverage may reach 70 if the upper bound covers the calls.
      if (!Number.isFinite(estimate.callsHigh)) return 70;
      if (calls <= 0) return 70;
      if (estimate.callsHigh >= calls) return 70;
      return Math.max(10, Math.round(20 * (estimate.callsHigh / calls)));
    }
    return null;
  }
  // Infinite calls means full coverage.
  if (!Number.isFinite(estimate.callsLow)) return 100;
  if (calls <= 0) return 100;
  if (estimate.callsLow >= calls) return 100;
  if (estimate.callsHigh >= calls) return 70;
  return Math.max(10, Math.round(20 * (estimate.callsHigh / calls)));
}

// Exported for tests/UI that need to check the basis kind without constructing
// a full estimate.
export function isVerifiedAllowance(quota: Quota | undefined): boolean {
  return quota?.kind === "credit-allowance" || quota?.kind === "dollar-allowance" || quota?.kind === "request-limit";
}

// Exported for tests and placement: compute credits per call for a credit plan.
// Used by planWorkingModel to select the model with the most credits per call
// (not the cheapest API rate).
export { creditsPerCall };

// Capability gate and context eligibility. Pure functions over catalog data,
// shared by the site and the maintenance CLI so both apply the same rules.

import type { Capability, MetricKey, Model, Scenario } from "../catalog/types.js";

export function contextSize(context: string): number {
  const normalized = context.trim().toUpperCase();
  if (normalized.endsWith("M")) {
    return parseFloat(normalized.slice(0, -1)) * 1_000_000;
  }
  if (normalized.endsWith("K")) {
    return parseFloat(normalized.slice(0, -1)) * 1_000;
  }
  return parseFloat(normalized) || 0;
}

export function metricValue(capability: Capability | null, metric: MetricKey): number | null {
  const value = capability?.metrics?.[metric];
  return typeof value === "number" ? value : null;
}

export function scenarioTokens(scenario: Scenario) {
  return scenario.input + scenario.output;
}

// Eligibility is absolute: a published capability score must clear the bar the
// scenario declares, and the context window must hold the work. Returns null
// when the model qualifies, or the reason it does not.
export type Rejection =
  | { state: "below"; index: number; minIndex: number }
  | { state: "context"; index: number; minIndex: number }
  | { state: "output"; index: number; minIndex: number; maxOutput: number }
  | { state: "unscored" };

export const unscored: Rejection = { state: "unscored" };

export function gateModel(
  model: Model,
  scenario: Scenario,
  requiredTokens: number,
  outputTokens: number,
): Rejection | null {
  const { metric, minIndex } = scenario.gate;
  const index = metricValue(model.capability, metric);
  if (index === null) return unscored;
  if (index < minIndex) return { state: "below", index, minIndex };
  // Prefer the numeric contextTokens (v3) and fall back to parsing the string
  // for backward compatibility with pre-v3 catalogs.
  const contextTokens = model.contextTokens ?? contextSize(model.context);
  if (contextTokens < requiredTokens) return { state: "context", index, minIndex };
  // A published output ceiling binds independently of the context window: a
  // model with a 1M window and a 64K output cap cannot produce a 100K answer,
  // and pricing such a call would quote a request the model must refuse.
  if (model.maxOutputTokens !== undefined && outputTokens > model.maxOutputTokens) {
    return { state: "output", index, minIndex, maxOutput: model.maxOutputTokens };
  }
  return null;
}

export function capabilityOf(model: Model | undefined, metric: MetricKey) {
  return model ? metricValue(model.capability, metric) : null;
}

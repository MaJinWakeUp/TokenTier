// The workload contract: the complete, validated description of the work a
// reader wants priced. Rankings evaluates presets through it and Recommend
// evaluates a custom edit of it, so both surfaces price the same shape and a
// shared link restores every field rather than a subset.
//
// Pure: no React, browser, or filesystem dependency. The clamps live here so
// the URL parser, the preference store, and the form controls cannot disagree
// about what counts as a usable number.

import type { Scenario, ScenarioId } from "../catalog/types.js";
import type { AccessRequirement, Objective, Workload } from "./recommend.js";

export type { Workload, AccessRequirement, Objective };

export type Preference = "either" | "api" | "plans";

export type WorkloadLimit = { min: number; max: number };

export const workloadLimits = {
  input: { min: 1, max: 1_000_000 },
  output: { min: 1, max: 500_000 },
  calls: { min: 1, max: 100_000 },
  budget: { min: 1, max: 10_000 },
  cacheRatio: { min: 0, max: 0.95 },
} as const satisfies Record<string, WorkloadLimit>;

export const objectives: Objective[] = ["cost", "budget", "capability"];
export const accessRequirements: AccessRequirement[] = ["any", "api", "chat-app", "coding-client"];
export const preferences: Preference[] = ["either", "api", "plans"];

export function isObjective(value: unknown): value is Objective {
  return typeof value === "string" && (objectives as string[]).includes(value);
}

export function isAccessRequirement(value: unknown): value is AccessRequirement {
  return typeof value === "string" && (accessRequirements as string[]).includes(value);
}

export function isPreference(value: unknown): value is Preference {
  return typeof value === "string" && (preferences as string[]).includes(value);
}

// A number is usable only when it is finite and inside the published range.
// Anything else (NaN, Infinity, "", "abc", 1e309) falls back rather than
// silently clamping a nonsense value into a plausible-looking one.
export function readNumber(raw: unknown, limit: WorkloadLimit, fallback: number): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return clamp(value, limit);
}

export function clamp(value: number, limit: WorkloadLimit): number {
  return Math.min(limit.max, Math.max(limit.min, value));
}

// The default workload for a scenario: the preset's own typical month, with
// the reader's budget and access requirement carried over.
export function workloadFromScenario(
  scenario: Scenario,
  overrides: Partial<Pick<Workload, "budget" | "access">> = {},
): Workload {
  return {
    scenarioId: scenario.id,
    input: scenario.input,
    output: scenario.output,
    calls: scenario.calls,
    cacheRatio: scenario.cacheRatio,
    budget: overrides.budget ?? defaultBudget,
    access: overrides.access ?? "any",
  };
}

export const defaultBudget = 30;

// Two workloads price identically when every field that reaches the engine is
// equal. Used to tell a preset apart from an edited copy of it.
export function sameWorkload(a: Workload, b: Workload): boolean {
  return a.scenarioId === b.scenarioId
    && a.input === b.input
    && a.output === b.output
    && a.calls === b.calls
    && a.cacheRatio === b.cacheRatio
    && a.budget === b.budget
    && a.access === b.access;
}

// True when the workload still matches the preset it names, so the UI can say
// "preset" rather than "custom" without a separate dirty flag.
export function matchesScenarioPreset(workload: Workload, scenario: Scenario): boolean {
  return workload.scenarioId === scenario.id
    && workload.input === scenario.input
    && workload.output === scenario.output
    && workload.calls === scenario.calls
    && workload.cacheRatio === scenario.cacheRatio;
}

export function normalizeWorkload(
  draft: Partial<Record<keyof Workload, unknown>>,
  fallback: Workload,
  knownScenarioIds: readonly string[],
): Workload {
  const scenarioId = typeof draft.scenarioId === "string" && knownScenarioIds.includes(draft.scenarioId)
    ? (draft.scenarioId as ScenarioId)
    : fallback.scenarioId;
  return {
    scenarioId,
    input: readNumber(draft.input, workloadLimits.input, fallback.input),
    output: readNumber(draft.output, workloadLimits.output, fallback.output),
    calls: readNumber(draft.calls, workloadLimits.calls, fallback.calls),
    cacheRatio: readNumber(draft.cacheRatio, workloadLimits.cacheRatio, fallback.cacheRatio),
    budget: readNumber(draft.budget, workloadLimits.budget, fallback.budget),
    access: isAccessRequirement(draft.access) ? draft.access : fallback.access,
  };
}

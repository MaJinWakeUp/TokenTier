// The link contract, as pure functions.
//
// A shared link is the only way one reader hands a workload to another, so the
// parser and the serialiser live together and are tested without a browser.
// Precedence is URL first, then saved preferences, then defaults; parsing
// happens before anything is written back, so opening a link never overwrites
// the preferences it was about to replace.

import type { Scenario, ScenarioId } from "../catalog/types.js";
import {
  isObjective,
  isPreference,
  normalizeWorkload,
  type Objective,
  type Preference,
  type Workload,
} from "./workload.js";

export const routes = {
  rankings: "/",
  recommend: "/recommend/",
  tierList: "/tier-list/",
} as const;

export type RouteKey = keyof typeof routes;

// Pre-refactor links carried the view in a query parameter on the root page.
// They stay readable: the value names the route their parameters belong to.
const legacyViewRoutes: Record<string, RouteKey> = {
  explore: "rankings",
  recommendation: "recommend",
  rank: "tierList",
};

export function legacyRouteFor(params: URLSearchParams): RouteKey | null {
  const view = params.get("view");
  if (view === null) return null;
  return legacyViewRoutes[view] ?? null;
}

export type RecommendState = {
  workload: Workload;
  objective: Objective;
  preference: Preference;
};

export function parseRecommendState(
  params: URLSearchParams,
  fallback: RecommendState,
  scenarios: readonly Scenario[],
): RecommendState {
  const knownIds = scenarios.map((scenario) => scenario.id);
  const scenarioParam = params.get("scenario");
  const preset = scenarios.find((scenario) => scenario.id === scenarioParam);

  // Naming a scenario without editing its numbers means "price this preset",
  // so the preset's own typical month fills any field the link omitted.
  const base: Workload = preset
    ? {
        ...fallback.workload,
        scenarioId: preset.id,
        input: preset.input,
        output: preset.output,
        calls: preset.calls,
        cacheRatio: preset.cacheRatio,
      }
    : fallback.workload;

  const workload = normalizeWorkload(
    {
      scenarioId: scenarioParam ?? base.scenarioId,
      input: params.get("input") ?? base.input,
      output: params.get("output") ?? base.output,
      calls: params.get("calls") ?? base.calls,
      cacheRatio: params.get("cache") ?? base.cacheRatio,
      budget: params.get("budget") ?? base.budget,
      access: params.get("access") ?? base.access,
    },
    base,
    knownIds,
  );

  const priority = params.get("priority");
  const preference = params.get("preference");
  return {
    workload,
    objective: isObjective(priority) ? priority : fallback.objective,
    preference: isPreference(preference) ? preference : fallback.preference,
  };
}

export function recommendParams(state: RecommendState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("scenario", state.workload.scenarioId);
  params.set("calls", String(state.workload.calls));
  params.set("budget", String(state.workload.budget));
  params.set("input", String(state.workload.input));
  params.set("output", String(state.workload.output));
  params.set("cache", String(state.workload.cacheRatio));
  params.set("preference", state.preference);
  params.set("priority", state.objective);
  params.set("access", state.workload.access);
  return params;
}

export function parseRankingsScenario(
  params: URLSearchParams,
  fallback: ScenarioId,
  scenarios: readonly Scenario[],
): ScenarioId {
  const scenarioParam = params.get("scenario");
  const preset = scenarios.find((scenario) => scenario.id === scenarioParam);
  return preset ? preset.id : fallback;
}

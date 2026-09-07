// Application-side catalog assembly: joins the three JSON documents into the
// immutable structures the views consume, and derives the per-scenario tier
// boards once at module load. App-only; the CLI reads catalog files from disk
// and validates them through lib/catalog/validate.ts instead.

import modelCatalog from "@/data/api-models.json";
import planCatalog from "@/data/plans.json";
import scenarioCatalog from "@/data/scenarios.json";
import type {
  Catalog,
  Model,
  ModelCatalogDoc,
  Plan,
  PlanCatalogDoc,
  Scenario,
  ScenarioCatalogDoc,
  ScenarioId,
  UsageSettings,
} from "./types.js";
import { modelPlacements, planPlacements, gateSummary, type Placement } from "../domain/placement.js";
import { providerFilterNames } from "../format.js";

const models = (modelCatalog as unknown as ModelCatalogDoc).models as Model[];
const modelById = new Map(models.map((model) => [model.id, model]));
const plans = (planCatalog as unknown as PlanCatalogDoc).plans as Plan[];
const modelCatalogUpdatedAt = (modelCatalog as unknown as ModelCatalogDoc).updatedAt;
const planCatalogUpdatedAt = (planCatalog as unknown as PlanCatalogDoc).updatedAt;
const scenarios = (scenarioCatalog as unknown as ScenarioCatalogDoc).scenarios as Scenario[];
const tierCuts = (scenarioCatalog as unknown as ScenarioCatalogDoc).tierCuts as [number, number, number, number];
const rankingWeights = (scenarioCatalog as unknown as ScenarioCatalogDoc).ranking;
const capabilityIndex = (modelCatalog as unknown as ModelCatalogDoc).capabilityIndex;

export { models, modelById, plans, scenarios, capabilityIndex, modelCatalogUpdatedAt, planCatalogUpdatedAt, tierCuts, rankingWeights };

export const catalog: Catalog = {
  models,
  plans,
  scenarios,
  modelById,
  capabilityIndex,
  modelCatalogUpdatedAt,
  planCatalogUpdatedAt,
  tierCuts,
  rankingWeights,
};

export const providerNames = providerFilterNames(models.map((model) => model.provider));
export const planProviderNames = providerFilterNames(plans.map((plan) => plan.provider));

// Every input is static data, so the whole board is derived once at module load.
export const placementsByScenario = new Map(
  scenarios.map((scenario) => [
    scenario.id,
    {
      models: modelPlacements(models, scenario, tierCuts, rankingWeights.models),
      plans: planPlacements(plans, scenario, modelById, tierCuts, rankingWeights.plans),
    },
  ]),
);

const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

export function scenarioFor(scenarioId: ScenarioId): Scenario {
  return scenarioById.get(scenarioId) ?? scenarios[0];
}

export function settingsFor(scenarioId: ScenarioId): UsageSettings {
  const scenario = scenarioFor(scenarioId);
  return { input: scenario.input, output: scenario.output, cacheRatio: scenario.cacheRatio };
}

// The profile the app opens on. Every initial value is read from this one
// scenario, so the work-type selector can never disagree with the token counts,
// call volume and cache share shown underneath it.
export const defaultScenario = scenarioFor("code-medium");
export const defaultScenarioId = defaultScenario.id;

export function modelPlacement(id: string, scenarioId: ScenarioId): Placement {
  return placementsByScenario.get(scenarioId)?.models.get(id) ?? { state: "unscored" };
}

export function planPlacement(id: string, scenarioId: ScenarioId): Placement {
  return placementsByScenario.get(scenarioId)?.plans.get(id) ?? { state: "unscored" };
}

export function itemPlacement(item: Model | Plan, scenarioId: ScenarioId): Placement {
  return "kind" in item ? planPlacement(item.id, scenarioId) : modelPlacement(item.id, scenarioId);
}

export function gateSummaryFor(scenarioId: ScenarioId) {
  const placed = placementsByScenario.get(scenarioId);
  return gateSummary(models, placed?.models ?? new Map<string, Placement>());
}

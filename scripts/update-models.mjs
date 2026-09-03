#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Capability metrics a model record may carry. Only `intelligence` is published
// per model today; the others are reserved for Artificial Analysis sub-indices.
const metricKeys = ["intelligence", "codingAgent", "agentic", "longContext"];
const catalogKeys = ["capabilityIndex", "currency", "models", "schemaVersion", "unit", "updatedAt"];
const capabilityIndexKeys = ["attribution", "name", "scale", "source", "version"];
const requiredModelKeys = [
  "cached",
  "capability",
  "context",
  "id",
  "input",
  "name",
  "output",
  "provider",
  "source",
  "verifiedAt",
];
const allowedModelKeys = new Set([...requiredModelKeys, "note"]);
const requiredCapabilityKeys = ["indexVersion", "metrics", "source", "verifiedAt"];
const allowedCapabilityKeys = new Set([...requiredCapabilityKeys, "variant"]);
const planKinds = new Set(["Subscription", "BYOK client", "Pay as you go"]);
const evidenceValues = new Set([
  "Official quota",
  "Official credit",
  "Official relative limit",
  "Price break-even",
]);
const confidenceValues = new Set(["High", "Medium", "Low"]);
const requiredPlanKeys = [
  "apiIncluded",
  "confidence",
  "evidence",
  "id",
  "kind",
  "modelIds",
  "monthly",
  "name",
  "note",
  "provider",
  "quota",
  "source",
  "verifiedAt",
];
const allowedPlanKeys = new Set([
  ...requiredPlanKeys,
  "cacheRatio",
  "creditMultipliers",
  "includedApiValue",
  "weeklyCredits",
]);
// A gate that admits almost nothing is a data error, not a strict standard.
const minEligibleModelsPerScenario = 3;
const defaultCatalogPath = fileURLToPath(
  new URL("../data/api-models.json", import.meta.url),
);
const defaultScenariosPath = fileURLToPath(
  new URL("../data/scenarios.json", import.meta.url),
);
const defaultPlansPath = fileURLToPath(
  new URL("../data/plans.json", import.meta.url),
);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addExactKeyErrors(value, expectedKeys, location, errors) {
  if (!isRecord(value)) {
    errors.push(`${location} must be an object.`);
    return;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  const missing = expected.filter((key) => !actual.includes(key));
  const extra = actual.filter((key) => !expected.includes(key));
  if (missing.length > 0) errors.push(`${location} is missing: ${missing.join(", ")}.`);
  if (extra.length > 0) errors.push(`${location} has unknown keys: ${extra.join(", ")}.`);
}

function collectModelErrors(model, indexLabel) {
  const errors = [];
  const location = `model ${indexLabel}`;
  if (!isRecord(model)) {
    return [`${location} must be an object.`];
  }

  for (const key of requiredModelKeys) {
    if (!(key in model)) errors.push(`${location} is missing: ${key}.`);
  }
  const extra = Object.keys(model).filter((key) => !allowedModelKeys.has(key));
  if (extra.length > 0) errors.push(`${location} has unknown keys: ${extra.join(", ")}.`);

  if (typeof model.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(model.id)) {
    errors.push(`${location}.id must be a lowercase slug.`);
  }
  for (const key of ["provider", "name"]) {
    if (typeof model[key] !== "string" || model[key].trim() !== model[key] || model[key].length === 0) {
      errors.push(`${location}.${key} must be a nonempty trimmed string.`);
    }
  }
  for (const key of ["input", "output"]) {
    if (!Number.isFinite(model[key]) || model[key] <= 0) {
      errors.push(`${location}.${key} must be a positive finite number.`);
    }
  }
  if (model.cached !== null && (!Number.isFinite(model.cached) || model.cached < 0)) {
    errors.push(`${location}.cached must be null or a nonnegative finite number.`);
  }
  if (typeof model.context !== "string" || !/^[1-9]\d*(?:\.\d+)?[KM]$/.test(model.context)) {
    errors.push(`${location}.context must look like 128K, 1M, or 1.05M.`);
  }

  try {
    const source = new URL(model.source);
    if (source.protocol !== "https:") throw new Error("not HTTPS");
  } catch {
    errors.push(`${location}.source must be a valid HTTPS URL.`);
  }

  if (!isIsoDate(model.verifiedAt)) {
    errors.push(`${location}.verifiedAt must be an ISO date (YYYY-MM-DD).`);
  } else if (model.verifiedAt > localIsoDate()) {
    errors.push(`${location}.verifiedAt cannot be later than the current local date.`);
  }
  if ("note" in model && (typeof model.note !== "string" || model.note.trim() !== model.note || model.note.length === 0)) {
    errors.push(`${location}.note must be a nonempty trimmed string when provided.`);
  }

  errors.push(...collectCapabilityErrors(model.capability, location));
  return errors;
}

// `capability: null` is a deliberate third state: the model is listed and priced,
// but no independent score exists yet, so it never receives a derived tier.
function collectCapabilityErrors(capability, location) {
  if (capability === null) return [];
  const errors = [];
  const at = `${location}.capability`;
  if (!isRecord(capability)) {
    return [`${at} must be null or an object.`];
  }

  for (const key of requiredCapabilityKeys) {
    if (!(key in capability)) errors.push(`${at} is missing: ${key}.`);
  }
  const extra = Object.keys(capability).filter((key) => !allowedCapabilityKeys.has(key));
  if (extra.length > 0) errors.push(`${at} has unknown keys: ${extra.join(", ")}.`);

  if (!isRecord(capability.metrics) || Object.keys(capability.metrics).length === 0) {
    errors.push(`${at}.metrics must be a nonempty object.`);
  } else {
    for (const [metric, value] of Object.entries(capability.metrics)) {
      if (!metricKeys.includes(metric)) {
        errors.push(`${at}.metrics has unknown metric: ${metric}.`);
      }
      if (!Number.isFinite(value) || value < -100 || value > 100) {
        errors.push(`${at}.metrics.${metric} must be a finite number between -100 and 100.`);
      }
    }
  }

  // A composite index that gains evaluations cannot be compared across versions,
  // so every score records the version it was read under.
  if (typeof capability.indexVersion !== "string" || !/^\d+(?:\.\d+)*$/.test(capability.indexVersion)) {
    errors.push(`${at}.indexVersion must look like 4 or 4.1.1.`);
  }
  if ("variant" in capability && (typeof capability.variant !== "string" || capability.variant.trim() !== capability.variant || capability.variant.length === 0)) {
    errors.push(`${at}.variant must be a nonempty trimmed string when provided.`);
  }
  try {
    const source = new URL(capability.source);
    if (source.protocol !== "https:") throw new Error("not HTTPS");
  } catch {
    errors.push(`${at}.source must be a valid HTTPS URL.`);
  }
  if (!isIsoDate(capability.verifiedAt)) {
    errors.push(`${at}.verifiedAt must be an ISO date (YYYY-MM-DD).`);
  } else if (capability.verifiedAt > localIsoDate()) {
    errors.push(`${at}.verifiedAt cannot be later than the current local date.`);
  }
  return errors;
}

export function validateModel(model, indexLabel = "input") {
  const errors = collectModelErrors(model, indexLabel);
  if (errors.length > 0) {
    throw new Error(`Model validation failed:\n- ${errors.join("\n- ")}`);
  }
  return model;
}

export function validateDataset(dataset) {
  const errors = [];
  addExactKeyErrors(dataset, catalogKeys, "catalog", errors);
  if (!isRecord(dataset)) {
    throw new Error(`Model catalog validation failed:\n- ${errors.join("\n- ")}`);
  }

  if (dataset.schemaVersion !== 2) errors.push("catalog.schemaVersion must be 2.");
  if (dataset.currency !== "USD") errors.push("catalog.currency must be USD.");
  if (dataset.unit !== "per-million-tokens") {
    errors.push("catalog.unit must be per-million-tokens.");
  }
  if (!isIsoDate(dataset.updatedAt)) {
    errors.push("catalog.updatedAt must be an ISO date (YYYY-MM-DD).");
  } else if (dataset.updatedAt > localIsoDate()) {
    errors.push("catalog.updatedAt cannot be later than the current local date.");
  }
  if (!Array.isArray(dataset.models) || dataset.models.length === 0) {
    errors.push("catalog.models must be a nonempty array.");
  } else {
    dataset.models.forEach((model, index) => {
      errors.push(...collectModelErrors(model, `[${index}]`));
    });

    const ids = new Set();
    const identities = new Set();
    for (const model of dataset.models) {
      if (!isRecord(model)) continue;
      if (typeof model.id === "string") {
        if (ids.has(model.id)) errors.push(`Duplicate model id: ${model.id}.`);
        ids.add(model.id);
      }
      if (typeof model.provider === "string" && typeof model.name === "string") {
        const identity = `${model.provider}\u0000${model.name}`.toLowerCase();
        if (identities.has(identity)) {
          errors.push(`Duplicate provider/model name: ${model.provider} / ${model.name}.`);
        }
        identities.add(identity);
      }
    }

    // Scores read under different index versions are not comparable, and the
    // gate thresholds are anchored to one version at a time.
    const declaredVersion = dataset.capabilityIndex?.version;
    for (const model of dataset.models) {
      const version = model?.capability?.indexVersion;
      if (version !== undefined && version !== declaredVersion) {
        errors.push(
          `model ${model.id} was scored under index version ${version}, `
          + `but catalog.capabilityIndex.version is ${declaredVersion}. `
          + "Re-read the score and re-anchor the scenario thresholds.",
        );
      }
    }

    const verifiedDates = dataset.models
      .flatMap((model) => [model?.verifiedAt, model?.capability?.verifiedAt])
      .filter(isIsoDate);
    if (isIsoDate(dataset.updatedAt) && verifiedDates.some((date) => date > dataset.updatedAt)) {
      errors.push("catalog.updatedAt cannot be earlier than a model or capability verifiedAt date.");
    }
  }

  addExactKeyErrors(dataset.capabilityIndex, capabilityIndexKeys, "catalog.capabilityIndex", errors);
  if (isRecord(dataset.capabilityIndex)) {
    for (const key of ["name", "scale", "attribution"]) {
      if (typeof dataset.capabilityIndex[key] !== "string" || dataset.capabilityIndex[key].length === 0) {
        errors.push(`catalog.capabilityIndex.${key} must be a nonempty string.`);
      }
    }
    if (typeof dataset.capabilityIndex.version !== "string" || !/^\d+(?:\.\d+)*$/.test(dataset.capabilityIndex.version)) {
      errors.push("catalog.capabilityIndex.version must look like 4 or 4.1.1.");
    }
    try {
      const source = new URL(dataset.capabilityIndex.source);
      if (source.protocol !== "https:") throw new Error("not HTTPS");
    } catch {
      errors.push("catalog.capabilityIndex.source must be a valid HTTPS URL.");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Model catalog validation failed:\n- ${errors.join("\n- ")}`);
  }
  return dataset;
}

function metricValue(model, metric) {
  const value = model?.capability?.metrics?.[metric];
  return Number.isFinite(value) ? value : null;
}

export function eligibleModels(dataset, scenario) {
  return dataset.models.filter((model) => {
    const value = metricValue(model, scenario.gate.metric);
    return value !== null && value >= scenario.gate.minIndex;
  });
}

export function validateScenarios(scenarios, dataset) {
  const errors = [];
  addExactKeyErrors(
    scenarios,
    ["metric", "metricNote", "profileNote", "ranking", "scenarios", "schemaVersion", "tierCuts"],
    "scenarios",
    errors,
  );
  if (!isRecord(scenarios)) {
    throw new Error(`Scenario validation failed:\n- ${errors.join("\n- ")}`);
  }

  if (scenarios.schemaVersion !== 2) errors.push("scenarios.schemaVersion must be 2.");
  if (!metricKeys.includes(scenarios.metric)) {
    errors.push(`scenarios.metric must be one of: ${metricKeys.join(", ")}.`);
  }
  for (const key of ["metricNote", "profileNote"]) {
    if (typeof scenarios[key] !== "string" || scenarios[key].length === 0) {
      errors.push(`scenarios.${key} must be a nonempty string.`);
    }
  }

  // Tier cuts are the percentile boundaries that keep the board balanced as the
  // catalog grows, so they must be strictly increasing fractions.
  const cuts = scenarios.tierCuts;
  if (!Array.isArray(cuts) || cuts.length !== 3) {
    errors.push("scenarios.tierCuts must be an array of three percentile boundaries.");
  } else if (
    cuts.some((cut) => !Number.isFinite(cut) || cut <= 0 || cut >= 1)
    || cuts[0] >= cuts[1]
    || cuts[1] >= cuts[2]
  ) {
    errors.push("scenarios.tierCuts must be strictly increasing fractions between 0 and 1.");
  }

  for (const [group, keys] of [
    ["models", ["cost", "headroom"]],
    ["plans", ["price", "headroom", "confidence"]],
    ["recommendation", ["capability", "budget", "coverage", "confidence"]],
  ]) {
    const weights = scenarios.ranking?.[group];
    addExactKeyErrors(weights, keys, `scenarios.ranking.${group}`, errors);
    if (isRecord(weights)) {
      const total = keys.reduce((sum, key) => sum + (Number.isFinite(weights[key]) ? weights[key] : NaN), 0);
      if (!Number.isFinite(total) || Math.abs(total - 1) > 1e-9) {
        errors.push(`scenarios.ranking.${group} weights must be finite and sum to 1.`);
      }
    }
  }

  if (!Array.isArray(scenarios.scenarios) || scenarios.scenarios.length === 0) {
    errors.push("scenarios.scenarios must be a nonempty array.");
    throw new Error(`Scenario validation failed:\n- ${errors.join("\n- ")}`);
  }

  const ids = new Set();
  const modelIds = new Set(dataset.models.map((model) => model.id));
  for (const scenario of scenarios.scenarios) {
    const location = `scenario ${scenario?.id ?? "?"}`;
    addExactKeyErrors(
      scenario,
      ["cacheRatio", "calls", "description", "gate", "id", "input", "label", "output", "rationale"],
      location,
      errors,
    );
    if (!isRecord(scenario)) continue;

    if (typeof scenario.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scenario.id)) {
      errors.push(`${location}.id must be a lowercase slug.`);
    } else if (ids.has(scenario.id)) {
      errors.push(`Duplicate scenario id: ${scenario.id}.`);
    } else {
      ids.add(scenario.id);
    }
    for (const key of ["label", "description", "rationale"]) {
      if (typeof scenario[key] !== "string" || scenario[key].trim() !== scenario[key] || scenario[key].length === 0) {
        errors.push(`${location}.${key} must be a nonempty trimmed string.`);
      }
    }
    for (const key of ["input", "output"]) {
      if (!Number.isInteger(scenario[key]) || scenario[key] <= 0) {
        errors.push(`${location}.${key} must be a positive integer token count.`);
      }
    }
    // The recommendation view's defaults come straight from the profile, so the
    // call count and cache share have to be usable as form values.
    if (!Number.isInteger(scenario.calls) || scenario.calls <= 0 || scenario.calls > 100_000) {
      errors.push(`${location}.calls must be a positive integer no greater than 100,000.`);
    }
    if (!Number.isFinite(scenario.cacheRatio) || scenario.cacheRatio < 0 || scenario.cacheRatio > 0.95) {
      errors.push(`${location}.cacheRatio must be a fraction between 0 and 0.95.`);
    }

    const gate = scenario.gate;
    const gateKeys = ["anchor", "metric", "minIndex", "rationale"];
    addExactKeyErrors(
      gate,
      isRecord(gate) && "preferredMetric" in gate ? [...gateKeys, "preferredMetric"] : gateKeys,
      `${location}.gate`,
      errors,
    );
    if (!isRecord(gate)) continue;

    if (!metricKeys.includes(gate.metric)) {
      errors.push(`${location}.gate.metric must be one of: ${metricKeys.join(", ")}.`);
    }
    if ("preferredMetric" in gate && !metricKeys.includes(gate.preferredMetric)) {
      errors.push(`${location}.gate.preferredMetric must be one of: ${metricKeys.join(", ")}.`);
    }
    if (!Number.isFinite(gate.minIndex) || gate.minIndex < -100 || gate.minIndex > 100) {
      errors.push(`${location}.gate.minIndex must be a finite number between -100 and 100.`);
    }
    if (typeof gate.rationale !== "string" || gate.rationale.length === 0) {
      errors.push(`${location}.gate.rationale must explain why this threshold is where it is.`);
    }

    // The anchor is what makes a threshold re-derivable when the index is rebased:
    // it must be a real catalog model that actually clears its own bar.
    if (typeof gate.anchor !== "string" || !modelIds.has(gate.anchor)) {
      errors.push(`${location}.gate.anchor must be a model id present in the catalog.`);
    } else {
      const anchor = dataset.models.find((model) => model.id === gate.anchor);
      const anchorValue = metricValue(anchor, gate.metric);
      if (anchorValue === null) {
        errors.push(`${location}.gate.anchor ${gate.anchor} has no ${gate.metric} score to anchor against.`);
      } else if (anchorValue < gate.minIndex) {
        errors.push(
          `${location}.gate.anchor ${gate.anchor} scores ${anchorValue}, `
          + `below its own threshold of ${gate.minIndex}.`,
        );
      }
    }

    if (Number.isFinite(gate.minIndex)) {
      const eligible = eligibleModels(dataset, scenario);
      if (eligible.length < minEligibleModelsPerScenario) {
        errors.push(
          `${location} admits only ${eligible.length} model(s) at index >= ${gate.minIndex}; `
          + `at least ${minEligibleModelsPerScenario} are required.`,
        );
      }
    }
  }

  // Harder work cannot demand less capability than easier work.
  const ladder = ["code-easy", "code-medium", "code-hard"]
    .map((id) => scenarios.scenarios.find((scenario) => scenario.id === id))
    .filter((scenario) => isRecord(scenario) && Number.isFinite(scenario.gate?.minIndex));
  for (let index = 1; index < ladder.length; index += 1) {
    if (ladder[index].gate.minIndex < ladder[index - 1].gate.minIndex) {
      errors.push(
        `scenario ${ladder[index].id} sets a lower bar (${ladder[index].gate.minIndex}) `
        + `than ${ladder[index - 1].id} (${ladder[index - 1].gate.minIndex}).`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Scenario validation failed:\n- ${errors.join("\n- ")}`);
  }
  return scenarios;
}

export function validatePlans(document, dataset) {
  const errors = [];
  addExactKeyErrors(document, ["currency", "plans", "schemaVersion", "updatedAt"], "plans", errors);
  if (!isRecord(document)) {
    throw new Error(`Plan validation failed:\n- ${errors.join("\n- ")}`);
  }

  if (document.schemaVersion !== 1) errors.push("plans.schemaVersion must be 1.");
  if (document.currency !== "USD") errors.push("plans.currency must be USD.");
  if (!isIsoDate(document.updatedAt)) {
    errors.push("plans.updatedAt must be an ISO date (YYYY-MM-DD).");
  } else if (document.updatedAt > localIsoDate()) {
    errors.push("plans.updatedAt cannot be later than the current local date.");
  }

  if (!Array.isArray(document.plans) || document.plans.length === 0) {
    errors.push("plans.plans must be a nonempty array.");
    throw new Error(`Plan validation failed:\n- ${errors.join("\n- ")}`);
  }

  const modelIds = new Set(dataset.models.map((model) => model.id));
  const ids = new Set();
  for (const plan of document.plans) {
    const location = `plan ${plan?.id ?? "?"}`;
    if (!isRecord(plan)) {
      errors.push(`${location} must be an object.`);
      continue;
    }
    for (const key of requiredPlanKeys) {
      if (!(key in plan)) errors.push(`${location} is missing: ${key}.`);
    }
    const extra = Object.keys(plan).filter((key) => !allowedPlanKeys.has(key));
    if (extra.length > 0) errors.push(`${location} has unknown keys: ${extra.join(", ")}.`);

    if (typeof plan.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(plan.id)) {
      errors.push(`${location}.id must be a lowercase slug.`);
    } else if (ids.has(plan.id)) {
      errors.push(`Duplicate plan id: ${plan.id}.`);
    } else {
      ids.add(plan.id);
    }
    for (const key of ["provider", "name", "note", "quota", "apiIncluded"]) {
      if (typeof plan[key] !== "string" || plan[key].trim() !== plan[key] || plan[key].length === 0) {
        errors.push(`${location}.${key} must be a nonempty trimmed string.`);
      }
    }
    if (!planKinds.has(plan.kind)) {
      errors.push(`${location}.kind must be one of: ${[...planKinds].join(", ")}.`);
    }
    if (plan.monthly !== null && (!Number.isFinite(plan.monthly) || plan.monthly < 0)) {
      errors.push(`${location}.monthly must be null or a nonnegative finite number.`);
    }
    if (!evidenceValues.has(plan.evidence)) {
      errors.push(`${location}.evidence must be one of: ${[...evidenceValues].join(", ")}.`);
    }
    if (!confidenceValues.has(plan.confidence)) {
      errors.push(`${location}.confidence must be one of: ${[...confidenceValues].join(", ")}.`);
    }

    // Referential integrity: a plan's numbers are derived from whichever of its
    // models suits the scenario, so a dangling id silently breaks the estimates.
    if (!Array.isArray(plan.modelIds) || plan.modelIds.length === 0) {
      errors.push(`${location}.modelIds must be a nonempty array of catalog model ids.`);
    } else {
      for (const id of plan.modelIds) {
        if (typeof id !== "string" || !modelIds.has(id)) {
          errors.push(
            `${location}.modelIds contains "${id}", which is not in the model catalog. `
            + "Repoint the plan at listed models before removing one.",
          );
        }
      }
      if (new Set(plan.modelIds).size !== plan.modelIds.length) {
        errors.push(`${location}.modelIds contains duplicates.`);
      }
    }

    try {
      const source = new URL(plan.source);
      if (source.protocol !== "https:") throw new Error("not HTTPS");
    } catch {
      errors.push(`${location}.source must be a valid HTTPS URL.`);
    }
    if (!isIsoDate(plan.verifiedAt)) {
      errors.push(`${location}.verifiedAt must be an ISO date (YYYY-MM-DD).`);
    } else if (plan.verifiedAt > localIsoDate()) {
      errors.push(`${location}.verifiedAt cannot be later than the current local date.`);
    }

    if ("cacheRatio" in plan && (!Number.isFinite(plan.cacheRatio) || plan.cacheRatio < 0 || plan.cacheRatio > 1)) {
      errors.push(`${location}.cacheRatio must be a fraction between 0 and 1.`);
    }
    if ("includedApiValue" in plan && (!Number.isFinite(plan.includedApiValue) || plan.includedApiValue <= 0)) {
      errors.push(`${location}.includedApiValue must be a positive finite number.`);
    }
    if ("weeklyCredits" in plan && (!Number.isFinite(plan.weeklyCredits) || plan.weeklyCredits <= 0)) {
      errors.push(`${location}.weeklyCredits must be a positive finite number.`);
    }
    if ("creditMultipliers" in plan) {
      // Providers publish credit multipliers per model, so a plan that meters in
      // credits needs a set for every model it offers or its capacity for that
      // model cannot be computed at all.
      const multipliers = plan.creditMultipliers;
      if (!isRecord(multipliers)) {
        errors.push(`${location}.creditMultipliers must be an object keyed by model id.`);
      } else {
        for (const [id, triple] of Object.entries(multipliers)) {
          if (Array.isArray(plan.modelIds) && !plan.modelIds.includes(id)) {
            errors.push(`${location}.creditMultipliers has "${id}", which the plan does not offer.`);
          }
          if (!Array.isArray(triple) || triple.length !== 3 || triple.some((value) => !Number.isFinite(value) || value < 0)) {
            errors.push(`${location}.creditMultipliers.${id} must be three nonnegative numbers [input, cached, output].`);
          }
        }
        for (const id of Array.isArray(plan.modelIds) ? plan.modelIds : []) {
          if (!(id in multipliers)) {
            errors.push(`${location}.creditMultipliers is missing multipliers for ${id}.`);
          }
        }
      }
      if (!("weeklyCredits" in plan)) {
        errors.push(`${location}.creditMultipliers requires weeklyCredits.`);
      }
    }
    if ("weeklyCredits" in plan && !("creditMultipliers" in plan)) {
      errors.push(`${location}.weeklyCredits requires creditMultipliers.`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Plan validation failed:\n- ${errors.join("\n- ")}`);
  }
  return document;
}

function normalizeIncoming(value) {
  const models = Array.isArray(value) ? value : [value];
  if (models.length === 0) throw new Error("The input file contains no models.");
  models.forEach((model, index) => validateModel(model, `[${index}]`));
  const ids = new Set();
  for (const model of models) {
    if (ids.has(model.id)) throw new Error(`Duplicate input model id: ${model.id}.`);
    ids.add(model.id);
  }
  return models;
}

export function mergeModels(dataset, incomingValue, mode) {
  validateDataset(dataset);
  if (mode !== "add" && mode !== "update") {
    throw new Error("Mode must be add or update.");
  }
  const incoming = normalizeIncoming(incomingValue);
  const currentIds = new Set(dataset.models.map((model) => model.id));

  for (const model of incoming) {
    if (mode === "add" && currentIds.has(model.id)) {
      throw new Error(`Cannot add existing model id: ${model.id}. Use update instead.`);
    }
    if (mode === "update" && !currentIds.has(model.id)) {
      throw new Error(`Cannot update unknown model id: ${model.id}. Use add instead.`);
    }
  }

  const replacements = new Map(incoming.map((model) => [model.id, model]));
  const models = mode === "add"
    ? [...dataset.models, ...incoming]
    : dataset.models.map((model) => replacements.get(model.id) ?? model);
  const updatedAt = [
    dataset.updatedAt,
    ...incoming.flatMap((model) => [model.verifiedAt, model.capability?.verifiedAt]),
  ]
    .filter(isIsoDate)
    .sort()
    .at(-1);
  const merged = { ...dataset, updatedAt, models };
  validateDataset(merged);
  return merged;
}

async function readJson(filePath, label) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} at ${filePath}: ${error.message}`);
  }
}

export async function validateCatalogFile(catalogPath = defaultCatalogPath) {
  const resolvedCatalogPath = path.resolve(catalogPath);
  const dataset = await readJson(resolvedCatalogPath, "model catalog");
  validateDataset(dataset);
  return dataset;
}

// The three files only make sense together: thresholds are anchored to catalog
// models, and every plan derives its numbers from one.
export async function validateAllFiles({
  catalogPath = defaultCatalogPath,
  scenariosPath = defaultScenariosPath,
  plansPath = defaultPlansPath,
} = {}) {
  const dataset = await validateCatalogFile(catalogPath);
  const [scenarios, plans] = await Promise.all([
    readJson(path.resolve(scenariosPath), "scenario definitions"),
    readJson(path.resolve(plansPath), "plan catalog"),
  ]);
  validateScenarios(scenarios, dataset);
  validatePlans(plans, dataset);
  return { dataset, plans, scenarios };
}

// The three files are a set, so a model edit has to be checked against the
// scenario anchors and plan references it can invalidate. Companions default to
// the catalog's own directory, which is how they are laid out in `data/`.
async function validateCompanions(merged, resolvedCatalogPath, scenariosPath, plansPath) {
  const directory = path.dirname(resolvedCatalogPath);
  const companions = [
    {
      label: "scenario definitions",
      file: path.resolve(scenariosPath ?? path.join(directory, "scenarios.json")),
      validate: (document) => validateScenarios(document, merged),
    },
    {
      label: "plan catalog",
      file: path.resolve(plansPath ?? path.join(directory, "plans.json")),
      validate: (document) => validatePlans(document, merged),
    },
  ];

  for (const companion of companions) {
    if (!existsSync(companion.file)) continue;
    companion.validate(await readJson(companion.file, companion.label));
  }
}

export async function updateCatalog({
  mode,
  inputPath,
  dryRun = false,
  catalogPath = defaultCatalogPath,
  scenariosPath,
  plansPath,
}) {
  if (!inputPath) throw new Error(`The ${mode} command requires an input JSON file.`);
  const resolvedCatalogPath = path.resolve(catalogPath);
  const resolvedInputPath = path.resolve(inputPath);
  const lockPath = `${resolvedCatalogPath}.lock`;
  let ownsLock = false;

  if (!dryRun) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, { flag: "wx" });
      ownsLock = true;
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new Error(
          `The model catalog is locked by another update: ${lockPath}. `
          + "If no updater is running, delete the stale lock file and retry.",
        );
      }
      throw error;
    }
  }

  try {
    const [dataset, incoming] = await Promise.all([
      readJson(resolvedCatalogPath, "model catalog"),
      readJson(resolvedInputPath, "model input"),
    ]);
    const merged = mergeModels(dataset, incoming, mode);
    // Runs before the dry-run returns and before the atomic rename, so a change
    // that breaks a scenario anchor or a plan reference is never written.
    await validateCompanions(merged, resolvedCatalogPath, scenariosPath, plansPath);
    const incomingModels = Array.isArray(incoming) ? incoming : [incoming];

    if (dryRun) {
      return {
        dataset: merged,
        dryRun,
        mode,
        names: incomingModels.map((model) => model.name),
      };
    }

    const temporaryPath = `${resolvedCatalogPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, { flag: "wx" });
      await rename(temporaryPath, resolvedCatalogPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }

    return {
      dataset: merged,
      dryRun,
      mode,
      names: incomingModels.map((model) => model.name),
    };
  } finally {
    if (ownsLock) await unlink(lockPath);
  }
}

function usage() {
  return [
    "Usage:",
    "  node scripts/update-models.mjs validate",
    "  node scripts/update-models.mjs add <input.json> [--dry-run]",
    "  node scripts/update-models.mjs update <input.json> [--dry-run]",
  ].join("\n");
}

export async function main(args = process.argv.slice(2)) {
  const [command, inputPath, ...flags] = args;
  if (!command || !["validate", "add", "update"].includes(command)) {
    throw new Error(usage());
  }
  const unknownFlags = flags.filter((flag) => flag !== "--dry-run");
  if (unknownFlags.length > 0) throw new Error(`Unknown option: ${unknownFlags[0]}\n${usage()}`);

  if (command === "validate") {
    if (inputPath || flags.length > 0) throw new Error(usage());
    const { dataset, plans, scenarios } = await validateAllFiles();
    const scored = dataset.models.filter((model) => model.capability !== null).length;
    console.log(
      `Validated ${dataset.models.length} models (${scored} with a capability score) `
      + `in data/api-models.json.`,
    );
    console.log(`Validated ${plans.plans.length} plans in data/plans.json.`);
    console.log(
      `Validated ${scenarios.scenarios.length} scenarios in data/scenarios.json `
      + `against ${dataset.capabilityIndex.name} v${dataset.capabilityIndex.version}.`,
    );
    for (const scenario of scenarios.scenarios) {
      const eligible = eligibleModels(dataset, scenario).length;
      console.log(
        `  ${scenario.id.padEnd(12)} ${scenario.gate.metric} >= ${String(scenario.gate.minIndex).padStart(3)}`
        + ` · ${eligible}/${dataset.models.length} models qualify`,
      );
    }
    return;
  }

  const result = await updateCatalog({
    mode: command,
    inputPath,
    dryRun: flags.includes("--dry-run"),
  });
  const action = result.dryRun ? `Would ${command}` : command === "add" ? "Added" : "Updated";
  console.log(`${action} ${result.names.length} model(s): ${result.names.join(", ")}.`);
  console.log(`Catalog total: ${result.dataset.models.length}.`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

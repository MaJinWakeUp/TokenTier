// Structural validation for the three catalog documents. Shared by the site
// build and the maintenance CLI so both reject the same malformed data. Pure:
// no filesystem access here; the CLI owns reading and writing.

import type {
  Capability,
  Model,
  ModelCatalogDoc,
  PlanCatalogDoc,
  Scenario,
  ScenarioCatalogDoc,
} from "./types.js";
import { gateModel, scenarioTokens, contextSize } from "../domain/eligibility.js";

// Capability metrics a model record may carry. Only `intelligence` is published
// per model today; the others are reserved for Artificial Analysis sub-indices.
const metricKeys = ["intelligence", "codingAgent", "agentic", "longContext"] as const;
const catalogKeys = ["capabilityIndex", "currency", "models", "schemaVersion", "unit", "updatedAt"];
const capabilityIndexKeys = ["attribution", "name", "scale", "source", "version"];
const requiredModelKeys = [
  "cached",
  "capability",
  "context",
  "contextTokens",
  "id",
  "input",
  "name",
  "output",
  "provider",
  "source",
  "verifiedAt",
];
const allowedModelKeys = new Set([...requiredModelKeys, "note", "rateBands", "unsupportedBeyond"]);
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
const accessSurfaceValues = new Set(["api", "chat-app", "coding-client"]);
const quotaKinds = new Set(["dollar-allowance", "credit-allowance", "request-limit", "relative-limit", "unknown"]);
const resetWindows = new Set(["5h", "weekly", "monthly"]);
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
  "access",
  "cacheRatio",
  "conditionalLimits",
  "creditMultipliers",
  "includedApiValue",
  "overageInput",
  "overageOutput",
  "quotaDetail",
  "weeklyCredits",
]);
// A gate that admits almost nothing is a data error, not a strict standard.
const minEligibleModelsPerScenario = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isIsoDate(value: unknown): value is string {
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

function addExactKeyErrors(value: unknown, expectedKeys: readonly string[], location: string, errors: string[]) {
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

function collectModelErrors(model: unknown, indexLabel: string): string[] {
  const errors: string[] = [];
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
    if (typeof model[key] !== "string" || (model[key] as string).trim() !== model[key] || (model[key] as string).length === 0) {
      errors.push(`${location}.${key} must be a nonempty trimmed string.`);
    }
  }
  for (const key of ["input", "output"]) {
    if (!Number.isFinite(model[key]) || (model[key] as number) <= 0) {
      errors.push(`${location}.${key} must be a positive finite number.`);
    }
  }
  if (model.cached !== null && (!Number.isFinite(model.cached) || (model.cached as number) < 0)) {
    errors.push(`${location}.cached must be null or a nonnegative finite number.`);
  }
  if (typeof model.context !== "string" || !/^[1-9]\d*(?:\.\d+)?[KM]$/.test(model.context)) {
    errors.push(`${location}.context must look like 128K, 1M, or 1.05M.`);
  }
  // contextTokens is the numeric form of context, stored so eligibility and
  // pricing do not parse strings at runtime. It must be a positive integer.
  if (!Number.isInteger(model.contextTokens) || (model.contextTokens as number) <= 0) {
    errors.push(`${location}.contextTokens must be a positive integer token count.`);
  }
  // contextTokens must match the parsed context string (F7: numeric context consistency).
  if (Number.isInteger(model.contextTokens) && typeof model.context === "string") {
    const parsed = contextSize(model.context);
    if (parsed !== (model.contextTokens as number)) {
      errors.push(`${location}.contextTokens (${model.contextTokens}) must match context string "${model.context}" (${parsed}).`);
    }
  }

  try {
    const source = new URL(model.source as string);
    if (source.protocol !== "https:") throw new Error("not HTTPS");
  } catch {
    errors.push(`${location}.source must be a valid HTTPS URL.`);
  }

  if (!isIsoDate(model.verifiedAt)) {
    errors.push(`${location}.verifiedAt must be an ISO date (YYYY-MM-DD).`);
  } else if (model.verifiedAt > localIsoDate()) {
    errors.push(`${location}.verifiedAt cannot be later than the current local date.`);
  }
  if ("note" in model && (typeof model.note !== "string" || (model.note as string).trim() !== model.note || (model.note as string).length === 0)) {
    errors.push(`${location}.note must be a nonempty trimmed string when provided.`);
  }

  // Rate bands let a model price differently above an input-token threshold.
  // The top-level input/cached/output are always the default (no-threshold) band.
  if ("rateBands" in model && model.rateBands !== undefined) {
    if (!Array.isArray(model.rateBands)) {
      errors.push(`${location}.rateBands must be an array when provided.`);
    } else {
      const thresholds: number[] = [];
      for (const [i, band] of (model.rateBands as unknown[]).entries()) {
        const at = `${location}.rateBands[${i}]`;
        if (!isRecord(band)) {
          errors.push(`${at} must be an object.`);
          continue;
        }
        if (!Number.isFinite(band.input) || (band.input as number) < 0) {
          errors.push(`${at}.input must be a nonnegative finite number.`);
        }
        if (band.cached !== null && (!Number.isFinite(band.cached) || (band.cached as number) < 0)) {
          errors.push(`${at}.cached must be null or a nonnegative finite number.`);
        }
        if (!Number.isFinite(band.output) || (band.output as number) < 0) {
          errors.push(`${at}.output must be a nonnegative finite number.`);
        }
        if (band.threshold !== undefined) {
          if (!Number.isInteger(band.threshold) || (band.threshold as number) <= 0) {
            errors.push(`${at}.threshold must be a positive integer token count.`);
          } else {
            thresholds.push(band.threshold as number);
          }
        }
      }
      // Thresholds must be unique and ascending so band selection is deterministic.
      const sorted = [...thresholds].sort((a, b) => a - b);
      if (thresholds.length !== new Set(thresholds).size) {
        errors.push(`${location}.rateBands has duplicate thresholds.`);
      }
      if (JSON.stringify(thresholds) !== JSON.stringify(sorted)) {
        errors.push(`${location}.rateBands thresholds must be in ascending order.`);
      }
    }
  }

  // Models whose note mentions long-context or threshold rate changes must
  // publish structured rateBands, not prose-only pricing (F6). A note that
  // says "higher rates above N tokens" without bands means the engine cannot
  // compute the actual cost -- it would silently use the default rate.
  if (typeof model.note === "string") {
    const longContextMention = /(?:higher|increas\w*|threshold|long[ -]context)/i.test(model.note);
    const hasBands = Array.isArray(model.rateBands) && model.rateBands.length > 0;
    if (longContextMention && !hasBands) {
      errors.push(
        `${location}.note mentions long-context or threshold pricing but has no rateBands. `
        + "Add structured rateBands or clarify the note to not imply threshold pricing.",
      );
    }
  }

  // unsupportedBeyond marks the input token limit for which rates are verified.
  // Beyond it, pricing is unsupported (F6).
  if ("unsupportedBeyond" in model && model.unsupportedBeyond !== undefined) {
    if (!Number.isInteger(model.unsupportedBeyond) || (model.unsupportedBeyond as number) <= 0) {
      errors.push(`${location}.unsupportedBeyond must be a positive integer token count when provided.`);
    }
  }

  errors.push(...collectCapabilityErrors(model.capability, location));
  return errors;
}

// `capability: null` is a deliberate third state: the model is listed and priced,
// but no independent score exists yet, so it never receives a derived tier.
function collectCapabilityErrors(capability: unknown, location: string): string[] {
  if (capability === null) return [];
  const errors: string[] = [];
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
      if (!(metricKeys as readonly string[]).includes(metric)) {
        errors.push(`${at}.metrics has unknown metric: ${metric}.`);
      }
      if (!Number.isFinite(value) || (value as number) < -100 || (value as number) > 100) {
        errors.push(`${at}.metrics.${metric} must be a finite number between -100 and 100.`);
      }
    }
  }

  // A composite index that gains evaluations cannot be compared across versions,
  // so every score records the version it was read under.
  if (typeof capability.indexVersion !== "string" || !/^\d+(?:\.\d+)*$/.test(capability.indexVersion)) {
    errors.push(`${at}.indexVersion must look like 4 or 4.1.1.`);
  }
  if ("variant" in capability && (typeof capability.variant !== "string" || (capability.variant as string).trim() !== capability.variant || (capability.variant as string).length === 0)) {
    errors.push(`${at}.variant must be a nonempty trimmed string when provided.`);
  }
  try {
    const source = new URL(capability.source as string);
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

export function validateModel(model: unknown, indexLabel = "input"): Model {
  const errors = collectModelErrors(model, indexLabel);
  if (errors.length > 0) {
    throw new Error(`Model validation failed:\n- ${errors.join("\n- ")}`);
  }
  return model as Model;
}

export function validateDataset(dataset: unknown): ModelCatalogDoc {
  const errors: string[] = [];
  addExactKeyErrors(dataset, catalogKeys, "catalog", errors);
  if (!isRecord(dataset)) {
    throw new Error(`Model catalog validation failed:\n- ${errors.join("\n- ")}`);
  }

  if (dataset.schemaVersion !== 3) errors.push("catalog.schemaVersion must be 3.");
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
    (dataset.models as unknown[]).forEach((model, index) => {
      errors.push(...collectModelErrors(model, `[${index}]`));
    });

    const ids = new Set<string>();
    const identities = new Set<string>();
    for (const model of dataset.models as Record<string, unknown>[]) {
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
    const declaredVersion = (dataset.capabilityIndex as Record<string, unknown> | undefined)?.version;
    for (const model of dataset.models as Record<string, unknown>[]) {
      const capability = model?.capability as Record<string, unknown> | null | undefined;
      const version = capability?.indexVersion;
      if (version !== undefined && version !== declaredVersion) {
        errors.push(
          `model ${model.id} was scored under index version ${version}, `
          + `but catalog.capabilityIndex.version is ${declaredVersion}. `
          + "Re-read the score and re-anchor the scenario thresholds.",
        );
      }
    }

    const verifiedDates = (dataset.models as Record<string, unknown>[])
      .flatMap((model) => [model?.verifiedAt, (model?.capability as Record<string, unknown> | null)?.verifiedAt])
      .filter((date): date is string => isIsoDate(date));
    const catalogUpdatedAt = dataset.updatedAt;
    if (isIsoDate(catalogUpdatedAt) && verifiedDates.some((date) => date > catalogUpdatedAt)) {
      errors.push("catalog.updatedAt cannot be earlier than a model or capability verifiedAt date.");
    }
  }

  addExactKeyErrors(dataset.capabilityIndex, capabilityIndexKeys, "catalog.capabilityIndex", errors);
  if (isRecord(dataset.capabilityIndex)) {
    for (const key of ["name", "scale", "attribution"]) {
      if (typeof dataset.capabilityIndex[key] !== "string" || (dataset.capabilityIndex[key] as string).length === 0) {
        errors.push(`catalog.capabilityIndex.${key} must be a nonempty string.`);
      }
    }
    if (typeof dataset.capabilityIndex.version !== "string" || !/^\d+(?:\.\d+)*$/.test(dataset.capabilityIndex.version)) {
      errors.push("catalog.capabilityIndex.version must look like 4 or 4.1.1.");
    }
    try {
      const source = new URL(dataset.capabilityIndex.source as string);
      if (source.protocol !== "https:") throw new Error("not HTTPS");
    } catch {
      errors.push("catalog.capabilityIndex.source must be a valid HTTPS URL.");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Model catalog validation failed:\n- ${errors.join("\n- ")}`);
  }
  return dataset as unknown as ModelCatalogDoc;
}

function metricValue(model: Model | undefined, metric: string): number | null {
  const value = (model as { capability?: Capability | null } | undefined)?.capability?.metrics?.[metric as keyof Capability["metrics"]];
  return Number.isFinite(value as number) ? (value as number) : null;
}

// Eligibility for validation purposes uses the same rule as the site: a
// published score must clear the bar and the context window must hold the
// scenario's work. The CLI used to check the score only, so its qualifying
// counts could disagree with the UI's.
export function eligibleModels(dataset: ModelCatalogDoc, scenario: Scenario): Model[] {
  return dataset.models.filter((model) => gateModel(model, scenario, scenarioTokens(scenario)) === null);
}

export function validateScenarios(scenarios: unknown, dataset: ModelCatalogDoc): ScenarioCatalogDoc {
  const errors: string[] = [];
  addExactKeyErrors(
    scenarios,
    ["costRatioBands", "metric", "metricNote", "profileNote", "ranking", "scenarios", "schemaVersion", "tierCuts"],
    "scenarios",
    errors,
  );
  if (!isRecord(scenarios)) {
    throw new Error(`Scenario validation failed:\n- ${errors.join("\n- ")}`);
  }

  if (scenarios.schemaVersion !== 2) errors.push("scenarios.schemaVersion must be 2.");
  if (!(metricKeys as readonly string[]).includes(scenarios.metric as string)) {
    errors.push(`scenarios.metric must be one of: ${metricKeys.join(", ")}.`);
  }
  for (const key of ["metricNote", "profileNote"]) {
    if (typeof scenarios[key] !== "string" || (scenarios[key] as string).length === 0) {
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
  ] as const) {
    const weights = (scenarios.ranking as Record<string, unknown> | undefined)?.[group];
    addExactKeyErrors(weights, keys, `scenarios.ranking.${group}`, errors);
    if (isRecord(weights)) {
      const total = keys.reduce((sum, key) => sum + (Number.isFinite(weights[key]) ? (weights[key] as number) : NaN), 0);
      if (!Number.isFinite(total) || Math.abs(total - 1) > 1e-9) {
        errors.push(`scenarios.ranking.${group} weights must be finite and sum to 1.`);
      }
    }
  }

  if (!Array.isArray(scenarios.scenarios) || scenarios.scenarios.length === 0) {
    errors.push("scenarios.scenarios must be a nonempty array.");
    throw new Error(`Scenario validation failed:\n- ${errors.join("\n- ")}`);
  }

  const ids = new Set<string>();
  const modelIds = new Set(dataset.models.map((model) => model.id));
  for (const scenario of scenarios.scenarios as unknown[]) {
    const record = scenario as Record<string, unknown>;
    const location = `scenario ${record?.id ?? "?"}`;
    addExactKeyErrors(
      scenario,
      ["cacheRatio", "calls", "description", "gate", "id", "input", "label", "output", "rationale"],
      location,
      errors,
    );
    if (!isRecord(scenario)) continue;

    if (typeof record.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id)) {
      errors.push(`${location}.id must be a lowercase slug.`);
    } else if (ids.has(record.id)) {
      errors.push(`Duplicate scenario id: ${record.id}.`);
    } else {
      ids.add(record.id);
    }
    for (const key of ["label", "description", "rationale"]) {
      if (typeof record[key] !== "string" || (record[key] as string).trim() !== record[key] || (record[key] as string).length === 0) {
        errors.push(`${location}.${key} must be a nonempty trimmed string.`);
      }
    }
    for (const key of ["input", "output"]) {
      if (!Number.isInteger(record[key]) || (record[key] as number) <= 0) {
        errors.push(`${location}.${key} must be a positive integer token count.`);
      }
    }
    // The recommendation view's defaults come straight from the profile, so the
    // call count and cache share have to be usable as form values.
    if (!Number.isInteger(record.calls) || (record.calls as number) <= 0 || (record.calls as number) > 100_000) {
      errors.push(`${location}.calls must be a positive integer no greater than 100,000.`);
    }
    if (!Number.isFinite(record.cacheRatio) || (record.cacheRatio as number) < 0 || (record.cacheRatio as number) > 0.95) {
      errors.push(`${location}.cacheRatio must be a fraction between 0 and 0.95.`);
    }

    const gate = record.gate as Record<string, unknown> | undefined;
    const gateKeys = ["anchor", "metric", "minIndex", "rationale"];
    addExactKeyErrors(
      gate,
      isRecord(gate) && "preferredMetric" in gate ? [...gateKeys, "preferredMetric"] : gateKeys,
      `${location}.gate`,
      errors,
    );
    if (!isRecord(gate)) continue;

    if (!(metricKeys as readonly string[]).includes(gate.metric as string)) {
      errors.push(`${location}.gate.metric must be one of: ${metricKeys.join(", ")}.`);
    }
    if ("preferredMetric" in gate && !(metricKeys as readonly string[]).includes(gate.preferredMetric as string)) {
      errors.push(`${location}.gate.preferredMetric must be one of: ${metricKeys.join(", ")}.`);
    }
    if (!Number.isFinite(gate.minIndex) || (gate.minIndex as number) < -100 || (gate.minIndex as number) > 100) {
      errors.push(`${location}.gate.minIndex must be a finite number between -100 and 100.`);
    }
    if (typeof gate.rationale !== "string" || (gate.rationale as string).length === 0) {
      errors.push(`${location}.gate.rationale must explain why this threshold is where it is.`);
    }

    // The anchor is what makes a threshold re-derivable when the index is rebased:
    // it must be a real catalog model that actually clears its own bar.
    if (typeof gate.anchor !== "string" || !modelIds.has(gate.anchor)) {
      errors.push(`${location}.gate.anchor must be a model id present in the catalog.`);
    } else {
      const anchor = dataset.models.find((model) => model.id === gate.anchor);
      const anchorValue = metricValue(anchor, gate.metric as string);
      if (anchorValue === null) {
        errors.push(`${location}.gate.anchor ${gate.anchor} has no ${gate.metric} score to anchor against.`);
      } else if (anchorValue < (gate.minIndex as number)) {
        errors.push(
          `${location}.gate.anchor ${gate.anchor} scores ${anchorValue}, `
          + `below its own threshold of ${gate.minIndex}.`,
        );
      }
    }

    if (Number.isFinite(gate.minIndex)) {
      const eligible = eligibleModels(dataset, scenario as Scenario);
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
    .map((id) => (scenarios.scenarios as Scenario[]).find((scenario) => scenario.id === id))
    .filter((scenario) => isRecord(scenario) && Number.isFinite((scenario as Scenario).gate?.minIndex));
  for (let index = 1; index < ladder.length; index += 1) {
    if ((ladder[index] as Scenario).gate.minIndex < (ladder[index - 1] as Scenario).gate.minIndex) {
      errors.push(
        `scenario ${(ladder[index] as Scenario).id} sets a lower bar (${(ladder[index] as Scenario).gate.minIndex}) `
        + `than ${(ladder[index - 1] as Scenario).id} (${(ladder[index - 1] as Scenario).gate.minIndex}).`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Scenario validation failed:\n- ${errors.join("\n- ")}`);
  }
  return scenarios as unknown as ScenarioCatalogDoc;
}

export function validatePlans(document: unknown, dataset: ModelCatalogDoc): PlanCatalogDoc {
  const errors: string[] = [];
  addExactKeyErrors(document, ["currency", "plans", "schemaVersion", "updatedAt"], "plans", errors);
  if (!isRecord(document)) {
    throw new Error(`Plan validation failed:\n- ${errors.join("\n- ")}`);
  }

  if (document.schemaVersion !== 2) errors.push("plans.schemaVersion must be 2.");
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
  const ids = new Set<string>();
  for (const plan of document.plans as unknown[]) {
    const record = plan as Record<string, unknown>;
    const location = `plan ${record?.id ?? "?"}`;
    if (!isRecord(plan)) {
      errors.push(`${location} must be an object.`);
      continue;
    }
    for (const key of requiredPlanKeys) {
      if (!(key in record)) errors.push(`${location} is missing: ${key}.`);
    }
    const extra = Object.keys(record).filter((key) => !allowedPlanKeys.has(key));
    if (extra.length > 0) errors.push(`${location} has unknown keys: ${extra.join(", ")}.`);

    if (typeof record.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id)) {
      errors.push(`${location}.id must be a lowercase slug.`);
    } else if (ids.has(record.id)) {
      errors.push(`Duplicate plan id: ${record.id}.`);
    } else {
      ids.add(record.id);
    }
    for (const key of ["provider", "name", "note", "quota", "apiIncluded"]) {
      if (typeof record[key] !== "string" || (record[key] as string).trim() !== record[key] || (record[key] as string).length === 0) {
        errors.push(`${location}.${key} must be a nonempty trimmed string.`);
      }
    }
    if (!planKinds.has(record.kind as string)) {
      errors.push(`${location}.kind must be one of: ${[...planKinds].join(", ")}.`);
    }
    if (record.monthly !== null && (!Number.isFinite(record.monthly) || (record.monthly as number) < 0)) {
      errors.push(`${location}.monthly must be null or a nonnegative finite number.`);
    }
    if (!evidenceValues.has(record.evidence as string)) {
      errors.push(`${location}.evidence must be one of: ${[...evidenceValues].join(", ")}.`);
    }
    if (!confidenceValues.has(record.confidence as string)) {
      errors.push(`${location}.confidence must be one of: ${[...confidenceValues].join(", ")}.`);
    }

    // Referential integrity: a plan's numbers are derived from whichever of its
    // models suits the scenario, so a dangling id silently breaks the estimates.
    if (!Array.isArray(record.modelIds) || (record.modelIds as unknown[]).length === 0) {
      errors.push(`${location}.modelIds must be a nonempty array of catalog model ids.`);
    } else {
      for (const id of record.modelIds as unknown[]) {
        if (typeof id !== "string" || !modelIds.has(id)) {
          errors.push(
            `${location}.modelIds contains "${id}", which is not in the model catalog. `
            + "Repoint the plan at listed models before removing one.",
          );
        }
      }
      if (new Set(record.modelIds as unknown[]).size !== (record.modelIds as unknown[]).length) {
        errors.push(`${location}.modelIds contains duplicates.`);
      }
    }

    try {
      const source = new URL(record.source as string);
      if (source.protocol !== "https:") throw new Error("not HTTPS");
    } catch {
      errors.push(`${location}.source must be a valid HTTPS URL.`);
    }
    if (!isIsoDate(record.verifiedAt)) {
      errors.push(`${location}.verifiedAt must be an ISO date (YYYY-MM-DD).`);
    } else if (record.verifiedAt > localIsoDate()) {
      errors.push(`${location}.verifiedAt cannot be later than the current local date.`);
    }

    if ("cacheRatio" in record && (!Number.isFinite(record.cacheRatio) || (record.cacheRatio as number) < 0 || (record.cacheRatio as number) > 1)) {
      errors.push(`${location}.cacheRatio must be a fraction between 0 and 1.`);
    }
    if ("includedApiValue" in record && (!Number.isFinite(record.includedApiValue) || (record.includedApiValue as number) <= 0)) {
      errors.push(`${location}.includedApiValue must be a positive finite number.`);
    }
    if ("weeklyCredits" in record && (!Number.isFinite(record.weeklyCredits) || (record.weeklyCredits as number) <= 0)) {
      errors.push(`${location}.weeklyCredits must be a positive finite number.`);
    }
    if ("creditMultipliers" in record) {
      // Providers publish credit multipliers per model, so a plan that meters in
      // credits needs a set for every model it offers or its capacity for that
      // model cannot be computed at all.
      const multipliers = record.creditMultipliers as Record<string, unknown>;
      if (!isRecord(multipliers)) {
        errors.push(`${location}.creditMultipliers must be an object keyed by model id.`);
      } else {
        for (const [id, triple] of Object.entries(multipliers)) {
          if (Array.isArray(record.modelIds) && !(record.modelIds as string[]).includes(id)) {
            errors.push(`${location}.creditMultipliers has "${id}", which the plan does not offer.`);
          }
          if (!Array.isArray(triple) || triple.length !== 3 || triple.some((value) => !Number.isFinite(value) || (value as number) < 0)) {
            errors.push(`${location}.creditMultipliers.${id} must be three nonnegative numbers [input, cached, output].`);
          }
        }
        for (const id of Array.isArray(record.modelIds) ? (record.modelIds as string[]) : []) {
          if (!(id in multipliers)) {
            errors.push(`${location}.creditMultipliers is missing multipliers for ${id}.`);
          }
        }
      }
      if (!("weeklyCredits" in record)) {
        errors.push(`${location}.creditMultipliers requires weeklyCredits.`);
      }
    }
    if ("weeklyCredits" in record && !("creditMultipliers" in record)) {
      errors.push(`${location}.weeklyCredits requires creditMultipliers.`);
    }

    // Structured access surfaces (v3).
    if ("access" in record && record.access !== undefined) {
      if (!Array.isArray(record.access) || record.access.length === 0) {
        errors.push(`${location}.access must be a nonempty array when provided.`);
      } else {
        for (const surface of record.access as unknown[]) {
          if (!accessSurfaceValues.has(surface as string)) {
            errors.push(`${location}.access contains "${surface}", which is not a valid surface.`);
          }
        }
      }
    }

    // Discriminated quota object (v3).
    if ("quotaDetail" in record && record.quotaDetail !== undefined) {
      const q = record.quotaDetail as Record<string, unknown>;
      if (!isRecord(q)) {
        errors.push(`${location}.quotaDetail must be an object when provided.`);
      } else if (!quotaKinds.has(q.kind as string)) {
        errors.push(`${location}.quotaDetail.kind must be one of: ${[...quotaKinds].join(", ")}.`);
      } else {
        if (typeof q.source !== "string" || (q.source as string).length === 0) {
          errors.push(`${location}.quotaDetail.source must be a nonempty string.`);
        } else {
          try {
            const source = new URL(q.source as string);
            if (source.protocol !== "https:") throw new Error("not HTTPS");
          } catch {
            errors.push(`${location}.quotaDetail.source must be a valid HTTPS URL.`);
          }
        }
        if (!isIsoDate(q.verifiedAt)) {
          errors.push(`${location}.quotaDetail.verifiedAt must be an ISO date.`);
        }
        const kind = q.kind as string;
        if (kind === "dollar-allowance" || kind === "credit-allowance" || kind === "request-limit") {
          if (!Number.isFinite(q.amount) || (q.amount as number) < 0) {
            errors.push(`${location}.quotaDetail.amount must be a nonnegative finite number for ${kind}.`);
          }
          if (!resetWindows.has(q.resetWindow as string)) {
            errors.push(`${location}.quotaDetail.resetWindow must be one of: ${[...resetWindows].join(", ")} for ${kind}.`);
          }
        } else if (kind === "relative-limit" || kind === "unknown") {
          if (typeof q.description !== "string" || (q.description as string).length === 0) {
            errors.push(`${location}.quotaDetail.description must be a nonempty string for ${kind}.`);
          }
        }
      }
    }

    if ("overageInput" in record && (!Number.isFinite(record.overageInput) || (record.overageInput as number) < 0)) {
      errors.push(`${location}.overageInput must be a nonnegative finite number.`);
    }
    if ("overageOutput" in record && (!Number.isFinite(record.overageOutput) || (record.overageOutput as number) < 0)) {
      errors.push(`${location}.overageOutput must be a nonnegative finite number.`);
    }

    // Structured conditional limits (v3): secondary caps published alongside
    // the primary quotaDetail. Each must have an amount, resetWindow, and description.
    if ("conditionalLimits" in record && record.conditionalLimits !== undefined) {
      if (!Array.isArray(record.conditionalLimits)) {
        errors.push(`${location}.conditionalLimits must be an array when provided.`);
      } else {
        for (const [i, limit] of (record.conditionalLimits as unknown[]).entries()) {
          if (!isRecord(limit)) {
            errors.push(`${location}.conditionalLimits[${i}] must be an object.`);
            continue;
          }
          if (!Number.isFinite(limit.amount) || (limit.amount as number) < 0) {
            errors.push(`${location}.conditionalLimits[${i}].amount must be a nonnegative finite number.`);
          }
          if (!resetWindows.has(limit.resetWindow as string)) {
            errors.push(`${location}.conditionalLimits[${i}].resetWindow must be one of: ${[...resetWindows].join(", ")}.`);
          }
          if (typeof limit.description !== "string" || (limit.description as string).length === 0) {
            errors.push(`${location}.conditionalLimits[${i}].description must be a nonempty string.`);
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Plan validation failed:\n- ${errors.join("\n- ")}`);
  }
  return document as unknown as PlanCatalogDoc;
}

function normalizeIncoming(value: unknown): Model[] {
  const models = Array.isArray(value) ? value : [value];
  if (models.length === 0) throw new Error("The input file contains no models.");
  models.forEach((model, index) => validateModel(model, `[${index}]`));
  const ids = new Set<string>();
  for (const model of models) {
    if (ids.has(model.id)) throw new Error(`Duplicate input model id: ${model.id}.`);
    ids.add(model.id);
  }
  return models as Model[];
}

export function mergeModels(dataset: ModelCatalogDoc, incomingValue: unknown, mode: "add" | "update"): ModelCatalogDoc {
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
    .filter((date): date is string => isIsoDate(date))
    .sort()
    .at(-1) ?? dataset.updatedAt;
  const merged = { ...dataset, updatedAt, models };
  validateDataset(merged);
  return merged;
}

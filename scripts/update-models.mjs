#!/usr/bin/env node

import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scenarioIds = [
  "daily",
  "code-easy",
  "code-medium",
  "code-hard",
  "research",
  "writing",
  "innovation",
];
const tierValues = new Set(["S", "A", "B", "—"]);
const catalogKeys = ["currency", "models", "schemaVersion", "unit", "updatedAt"];
const requiredModelKeys = [
  "cached",
  "context",
  "id",
  "input",
  "name",
  "output",
  "provider",
  "source",
  "tiers",
  "verifiedAt",
];
const allowedModelKeys = new Set([...requiredModelKeys, "note"]);
const defaultCatalogPath = fileURLToPath(
  new URL("../data/api-models.json", import.meta.url),
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

  addExactKeyErrors(model.tiers, scenarioIds, `${location}.tiers`, errors);
  if (isRecord(model.tiers)) {
    for (const scenarioId of scenarioIds) {
      if (scenarioId in model.tiers && !tierValues.has(model.tiers[scenarioId])) {
        errors.push(`${location}.tiers.${scenarioId} must be S, A, B, or —.`);
      }
    }
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

  if (dataset.schemaVersion !== 1) errors.push("catalog.schemaVersion must be 1.");
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

    for (const scenarioId of scenarioIds) {
      if (!dataset.models.some((model) => model?.tiers?.[scenarioId] === "S")) {
        errors.push(`At least one S-tier model is required for ${scenarioId}.`);
      }
    }

    const verifiedDates = dataset.models
      .map((model) => model?.verifiedAt)
      .filter(isIsoDate);
    if (isIsoDate(dataset.updatedAt) && verifiedDates.some((date) => date > dataset.updatedAt)) {
      errors.push("catalog.updatedAt cannot be earlier than a model's verifiedAt date.");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Model catalog validation failed:\n- ${errors.join("\n- ")}`);
  }
  return dataset;
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
  const updatedAt = [dataset.updatedAt, ...incoming.map((model) => model.verifiedAt)]
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

export async function updateCatalog({
  mode,
  inputPath,
  dryRun = false,
  catalogPath = defaultCatalogPath,
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
    const dataset = await validateCatalogFile();
    console.log(`Validated ${dataset.models.length} models in data/api-models.json.`);
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

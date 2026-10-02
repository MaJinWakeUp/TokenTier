#!/usr/bin/env node

// Maintenance CLI for the model catalog. Argument parsing, filesystem access,
// write locking, and atomic replacement live here; every validation rule is
// imported from the shared library in lib/ (compiled to build/lib), which the
// site build uses too, so the CLI and the UI can never disagree on eligibility
// or structure.

import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export {
  eligibleModels,
  isIsoDate,
  mergeModels,
  validateDataset,
  validateModel,
  validatePlans,
  validateScenarios,
} from "../build/lib/catalog/validate.js";

import {
  eligibleModels,
  mergeModels,
  validateDataset,
  validatePlans,
  validateScenarios,
} from "../build/lib/catalog/validate.js";
import { defaultMaxAgeDays, freshnessReport } from "../build/lib/domain/freshness.js";

export { defaultMaxAgeDays, freshnessReport } from "../build/lib/domain/freshness.js";

// The CLI asks "how stale is this now", so it measures against today.
function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const defaultCatalogPath = fileURLToPath(
  new URL("../data/api-models.json", import.meta.url),
);
const defaultScenariosPath = fileURLToPath(
  new URL("../data/scenarios.json", import.meta.url),
);
const defaultPlansPath = fileURLToPath(
  new URL("../data/plans.json", import.meta.url),
);

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
    "  node scripts/update-models.mjs validate [--max-age=<days>]",
    "  node scripts/update-models.mjs add <input.json> [--dry-run]",
    "  node scripts/update-models.mjs update <input.json> [--dry-run]",
  ].join("\n");
}

export async function main(args = process.argv.slice(2)) {
  const [command, inputPath, ...flags] = args;
  if (!command || !["validate", "add", "update"].includes(command)) {
    throw new Error(usage());
  }
  // --max-age turns the freshness report from an advisory into a gate. It is
  // opt-in so that data ageing never blocks an unrelated build, while a refresh
  // pass can demand that nothing is past its date.
  const maxAgeFlag = [command, inputPath, ...flags].find((flag) => typeof flag === "string" && flag.startsWith("--max-age="));
  const maxAgeDays = maxAgeFlag ? Number(maxAgeFlag.slice("--max-age=".length)) : defaultMaxAgeDays;
  if (maxAgeFlag && (!Number.isFinite(maxAgeDays) || maxAgeDays < 0)) {
    throw new Error(`--max-age= needs a number of days.\n${usage()}`);
  }
  const unknownFlags = flags.filter((flag) => flag !== "--dry-run" && !flag.startsWith("--max-age="));
  if (unknownFlags.length > 0) throw new Error(`Unknown option: ${unknownFlags[0]}\n${usage()}`);

  if (command === "validate") {
    if (inputPath && !inputPath.startsWith("--max-age=")) throw new Error(usage());
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

    // Validation checks shape; this checks age. A record can be perfectly formed
    // and six weeks out of date, which is the failure mode that matters for a
    // site whose claim is that its numbers are current and sourced.
    const report = freshnessReport(dataset.models, plans.plans, localIsoDate(), maxAgeDays);
    console.log(
      `\nFreshness: ${report.counted} dated records, oldest ${report.oldest}`
      + ` · ${report.stale.length} past ${maxAgeDays} days.`,
    );
    for (const record of report.stale) {
      console.log(`  ${String(record.ageDays).padStart(3)}d  ${record.kind.padEnd(17)} ${record.id} (${record.verifiedAt})`);
    }
    if (maxAgeFlag && report.stale.length > 0) {
      throw new Error(`${report.stale.length} record(s) older than ${maxAgeDays} days. Re-verify them or raise --max-age.`);
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

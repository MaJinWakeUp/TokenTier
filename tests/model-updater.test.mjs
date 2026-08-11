import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  mergeModels,
  updateCatalog,
  validateDataset,
  validateModel,
} from "../scripts/update-models.mjs";

const scenarioIds = [
  "daily",
  "code-easy",
  "code-medium",
  "code-hard",
  "research",
  "writing",
  "innovation",
];

function localDateOffset(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const yesterday = localDateOffset(-1);
const today = localDateOffset(0);
const tomorrow = localDateOffset(1);

function model(overrides = {}) {
  return {
    id: "example-model",
    provider: "Example AI",
    name: "Example Model",
    input: 1,
    cached: 0.1,
    output: 5,
    context: "128K",
    source: "https://example.com/pricing",
    verifiedAt: today,
    note: "Official list price.",
    tiers: Object.fromEntries(scenarioIds.map((scenarioId) => [scenarioId, "S"])),
    ...overrides,
  };
}

function dataset(models = [model()], overrides = {}) {
  return {
    schemaVersion: 1,
    updatedAt: today,
    currency: "USD",
    unit: "per-million-tokens",
    models,
    ...overrides,
  };
}

async function temporaryFiles(catalog, input) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tokentier-models-"));
  const catalogPath = path.join(directory, "api-models.json");
  const inputPath = path.join(directory, "input.json");
  await Promise.all([
    writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`),
    writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`),
  ]);
  return { catalogPath, directory, inputPath };
}

test("validates the complete catalog schema", () => {
  const catalog = dataset();
  assert.equal(validateDataset(catalog), catalog);
  assert.equal(validateModel(catalog.models[0]), catalog.models[0]);
});

test("rejects malformed model data and incomplete scenario tiers", () => {
  const invalid = model({
    input: -1,
    source: "http://example.com/pricing",
    verifiedAt: "2026-02-30",
    tiers: { daily: "C" },
    typo: true,
  });
  assert.throws(
    () => validateModel(invalid),
    (error) => {
      assert.match(error.message, /unknown keys: typo/);
      assert.match(error.message, /input must be a positive finite number/);
      assert.match(error.message, /valid HTTPS URL/);
      assert.match(error.message, /ISO date/);
      assert.match(error.message, /tiers is missing/);
      assert.match(error.message, /tiers\.daily must be S, A, B, or —/);
      return true;
    },
  );
});

test("rejects model and catalog dates later than the current local date", () => {
  assert.throws(
    () => validateModel(model({ verifiedAt: tomorrow })),
    /verifiedAt cannot be later than the current local date/,
  );
  assert.throws(
    () => validateDataset(dataset(undefined, { updatedAt: tomorrow })),
    /updatedAt cannot be later than the current local date/,
  );
});

test("rejects duplicate identities and catalogs without an S tier", () => {
  const first = model();
  const duplicate = model({ id: "example-model-two" });
  assert.throws(() => validateDataset(dataset([first, duplicate])), /Duplicate provider\/model name/);

  const allA = model({ tiers: Object.fromEntries(scenarioIds.map((id) => [id, "A"])) });
  assert.throws(() => validateDataset(dataset([allA])), /At least one S-tier model/);
});

test("adds models at the end and updates models in place", () => {
  const original = model({ verifiedAt: yesterday });
  const added = model({
    id: "new-model",
    name: "New Model",
    verifiedAt: today,
  });
  const afterAdd = mergeModels(
    dataset([original], { updatedAt: yesterday }),
    added,
    "add",
  );
  assert.deepEqual(afterAdd.models.map((item) => item.id), ["example-model", "new-model"]);
  assert.equal(afterAdd.updatedAt, today);

  const replacement = model({ name: "Example Model Revised", output: 6 });
  const afterUpdate = mergeModels(afterAdd, replacement, "update");
  assert.deepEqual(afterUpdate.models.map((item) => item.id), ["example-model", "new-model"]);
  assert.equal(afterUpdate.models[0].name, "Example Model Revised");
  assert.equal(afterUpdate.models[0].output, 6);
});

test("requires explicit add or update semantics", () => {
  const catalog = dataset();
  assert.throws(
    () => mergeModels(catalog, model(), "add"),
    /Cannot add existing model id/,
  );
  assert.throws(
    () => mergeModels(catalog, model({ id: "missing-model", name: "Missing Model" }), "update"),
    /Cannot update unknown model id/,
  );
});

test("dry-run validates the result without changing the catalog", async (t) => {
  const incoming = model({ id: "new-model", name: "New Model" });
  const files = await temporaryFiles(dataset(), incoming);
  t.after(() => rm(files.directory, { recursive: true, force: true }));
  const before = await readFile(files.catalogPath, "utf8");

  const result = await updateCatalog({
    mode: "add",
    inputPath: files.inputPath,
    catalogPath: files.catalogPath,
    dryRun: true,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.dataset.models.length, 2);
  assert.equal(await readFile(files.catalogPath, "utf8"), before);
});

test("writes a validated catalog atomically", async (t) => {
  const incoming = model({ id: "new-model", name: "New Model" });
  const files = await temporaryFiles(dataset(), incoming);
  t.after(() => rm(files.directory, { recursive: true, force: true }));

  const result = await updateCatalog({
    mode: "add",
    inputPath: files.inputPath,
    catalogPath: files.catalogPath,
  });
  const written = JSON.parse(await readFile(files.catalogPath, "utf8"));

  assert.equal(result.dryRun, false);
  assert.deepEqual(written, result.dataset);
  assert.deepEqual(written.models.map((item) => item.id), ["example-model", "new-model"]);
  await assert.rejects(access(`${files.catalogPath}.lock`), { code: "ENOENT" });
});

test("an active lock blocks a concurrent write without being removed", async (t) => {
  const incoming = model({ id: "new-model", name: "New Model" });
  const files = await temporaryFiles(dataset(), incoming);
  const lockPath = `${files.catalogPath}.lock`;
  t.after(() => rm(files.directory, { recursive: true, force: true }));
  await writeFile(lockPath, "another-process\n", { flag: "wx" });
  const before = await readFile(files.catalogPath, "utf8");

  await assert.rejects(
    updateCatalog({
      mode: "add",
      inputPath: files.inputPath,
      catalogPath: files.catalogPath,
    }),
    /locked by another update/,
  );

  assert.equal(await readFile(files.catalogPath, "utf8"), before);
  assert.equal(await readFile(lockPath, "utf8"), "another-process\n");
});

test("releases its lock when validation fails", async (t) => {
  const invalid = model({ input: -1 });
  const files = await temporaryFiles(dataset(), invalid);
  const lockPath = `${files.catalogPath}.lock`;
  t.after(() => rm(files.directory, { recursive: true, force: true }));

  await assert.rejects(
    updateCatalog({
      mode: "add",
      inputPath: files.inputPath,
      catalogPath: files.catalogPath,
    }),
    /positive finite number/,
  );
  await assert.rejects(access(lockPath), { code: "ENOENT" });
});

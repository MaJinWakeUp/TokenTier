"use client";

import { readRaw, readRecord, storageKeys, writeRecord, legacyKeys } from "@/lib/browser/storage";

export type ApiColumnKey = "input" | "cached" | "output" | "context" | "index" | "fit" | "cost";
export type PlanColumnKey = "type" | "price" | "quota" | "apiIncluded" | "equivalent" | "fit" | "evidence";

export const apiColumnLabels: Record<ApiColumnKey, string> = {
  input: "Input / 1M",
  cached: "Cached input",
  output: "Output / 1M",
  context: "Context",
  index: "Index",
  fit: "Fit",
  cost: "Est. / call",
};

export const planColumnLabels: Record<PlanColumnKey, string> = {
  type: "Type",
  price: "Price",
  quota: "Published quota",
  apiIncluded: "API included?",
  equivalent: "API-cost equivalent",
  fit: "Fit",
  evidence: "Evidence",
};

export const defaultApiColumns: Record<ApiColumnKey, boolean> = {
  input: true,
  cached: true,
  output: true,
  context: true,
  index: true,
  fit: true,
  cost: true,
};

export const defaultPlanColumns: Record<PlanColumnKey, boolean> = {
  type: true,
  price: true,
  quota: true,
  apiIncluded: true,
  equivalent: true,
  fit: true,
  evidence: true,
};

export type ColumnPreferences = {
  api: Record<ApiColumnKey, boolean>;
  plans: Record<PlanColumnKey, boolean>;
};

export const defaultColumnPreferences: ColumnPreferences = {
  api: { ...defaultApiColumns },
  plans: { ...defaultPlanColumns },
};

const columnsVersion = 1;

// A stored map must name every column the current build knows about, with a
// boolean for each. A partial or renamed map is discarded rather than merged,
// because a half-applied column set reads as a bug in the table.
export function parseColumnMap<Key extends string>(
  raw: unknown,
  defaults: Record<Key, boolean>,
): Record<Key, boolean> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = (Object.keys(defaults) as Key[]).map((key) => [key, (raw as Record<string, unknown>)[key]] as const);
  if (entries.some(([, value]) => typeof value !== "boolean")) return null;
  return Object.fromEntries(entries) as Record<Key, boolean>;
}

function parseLegacyColumnJson<Key extends string>(raw: string | null, defaults: Record<Key, boolean>) {
  if (!raw) return null;
  try {
    return parseColumnMap(JSON.parse(raw) as unknown, defaults);
  } catch {
    return null;
  }
}

// Table columns are a display preference, kept apart from the workload numbers
// and from anything the reader authored, so clearing one never clears another.
export function readColumnPreferences(): ColumnPreferences {
  const stored = readRecord<ColumnPreferences>(storageKeys.columns, columnsVersion, (payload) => {
    if (!payload || typeof payload !== "object") return null;
    const record = payload as { api?: unknown; plans?: unknown };
    const api = parseColumnMap<ApiColumnKey>(record.api, defaultApiColumns);
    const plans = parseColumnMap<PlanColumnKey>(record.plans, defaultPlanColumns);
    if (!api || !plans) return null;
    return { api, plans };
  });
  if (stored.state === "ok") return stored.value;

  const legacyApi = parseLegacyColumnJson<ApiColumnKey>(readRaw(legacyKeys.apiColumns), defaultApiColumns);
  const legacyPlans = parseLegacyColumnJson<PlanColumnKey>(readRaw(legacyKeys.planColumns), defaultPlanColumns);
  if (legacyApi || legacyPlans) {
    return { api: legacyApi ?? { ...defaultApiColumns }, plans: legacyPlans ?? { ...defaultPlanColumns } };
  }
  return { api: { ...defaultApiColumns }, plans: { ...defaultPlanColumns } };
}

export function writeColumnPreferences(value: ColumnPreferences): boolean {
  return writeRecord(storageKeys.columns, columnsVersion, value);
}

"use client";

// Versioned, feature-scoped preference records.
//
// Every write can fail: private windows, denied site data, and full quotas all
// throw. Nothing here throws back at the caller — reads answer `null` and
// writes answer `false` — so a storage failure degrades to an unsaved session
// rather than breaking initialisation.
//
// Records are namespaced `tokentier.v<n>.<feature>` and carry their own
// version, so a future shape change can be recognised instead of silently
// misread. The pre-refactor flat `tokentier-*` keys are migrated once and then
// left in place, so rolling back to the previous build still finds them.

const namespace = "tokentier.v1";

export const storageKeys = {
  workload: `${namespace}.workload`,
  columns: `${namespace}.columns`,
  boards: `${namespace}.boards`,
  boardRecovery: `${namespace}.board-recovery`,
  // One marker per feature. A single shared marker meant whichever route the
  // reader opened first claimed the migration and the other feature's legacy
  // data was never imported.
  migrated: (feature: string) => `${namespace}.migrated.${feature}`,
  theme: "tokentier-theme",
} as const;

export const legacyKeys = {
  view: "tokentier-view",
  calls: "tokentier-rec-calls",
  budget: "tokentier-rec-budget",
  input: "tokentier-rec-input",
  output: "tokentier-rec-output",
  cache: "tokentier-rec-cache",
  priority: "tokentier-rec-priority",
  preference: "tokentier-rec-pref",
  access: "tokentier-rec-access",
  apiColumns: "tokentier-api-cols",
  planColumns: "tokentier-plan-cols",
  boards: "tokentier-rank-boards",
  boardSubject: "tokentier-rank-subject",
} as const;

function store(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    // Touching the property itself throws when site data is blocked.
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readRaw(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeRaw(key: string, value: string): boolean {
  try {
    const target = store();
    if (!target) return false;
    target.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): boolean {
  try {
    const target = store();
    if (!target) return false;
    target.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function readJson(key: string): unknown {
  const raw = readRaw(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    return writeRaw(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

// A stored record must declare the version it was written under. An unknown
// version is reported rather than coerced, so a caller can say so instead of
// rendering someone else's data as if it were current.
export type RecordRead<T> =
  | { state: "ok"; value: T }
  | { state: "missing" }
  | { state: "invalid" }
  | { state: "unknown-version"; version: number };

export function readRecord<T>(
  key: string,
  version: number,
  parse: (payload: unknown) => T | null,
): RecordRead<T> {
  const raw = readJson(key);
  if (raw === null) return { state: "missing" };
  if (typeof raw !== "object" || Array.isArray(raw)) return { state: "invalid" };
  const envelope = raw as { v?: unknown; data?: unknown };
  if (typeof envelope.v !== "number") return { state: "invalid" };
  if (envelope.v !== version) return { state: "unknown-version", version: envelope.v };
  const value = parse(envelope.data);
  return value === null ? { state: "invalid" } : { state: "ok", value };
}

export function writeRecord(key: string, version: number, data: unknown): boolean {
  return writeJson(key, { v: version, data });
}

// Legacy migration runs at most once per feature per browser. It never deletes
// the old keys: a reader who rolls back to the previous build still finds their
// work.
//
// `destination` is the versioned record the migration writes. When it already
// holds something, migration is skipped whatever the marker says — a migration
// that ran and then re-ran would overwrite edits made since with the stale
// legacy values. That also makes the upgrade from the older shared marker safe:
// a feature that already migrated is recognised by its record, not the marker.
export function migrateLegacyOnce(feature: string, destination: string, migrate: () => void): void {
  const marker = storageKeys.migrated(feature);
  if (readRaw(marker) === "1") return;
  try {
    if (readRaw(destination) === null) migrate();
  } finally {
    writeRaw(marker, "1");
  }
}

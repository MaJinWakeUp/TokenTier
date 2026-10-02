// How far behind a catalog record is. Age is measured against the date the
// catalog claims to be current rather than against the clock: a reader seeing
// "Updated Sep 30" is asking how far behind that claim a given row sits, and the
// answer must not differ between the server render and the browser. The CLI
// passes today's date instead, because a maintainer is asking a different
// question — how stale is this now.

import type { Model, Plan } from "../catalog/types.js";

// A record older than this is called out. Thirty days matches the freshness
// badge the header has always used.
export const defaultMaxAgeDays = 30;

export function ageInDays(verifiedAt: string, reference: string): number {
  const from = Date.parse(`${verifiedAt}T00:00:00Z`);
  const to = Date.parse(`${reference}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}

export type StaleKind = "model-price" | "model-capability" | "plan";

export type StaleRecord = {
  kind: StaleKind;
  id: string;
  name: string;
  verifiedAt: string;
  ageDays: number;
};

export type FreshnessReport = {
  reference: string;
  maxAgeDays: number;
  oldest: string | null;
  stale: StaleRecord[];
  counted: number;
};

function collect(models: Model[], plans: Plan[]): StaleRecord[] {
  const records: StaleRecord[] = [];
  for (const model of models) {
    records.push({ kind: "model-price", id: model.id, name: model.name, verifiedAt: model.verifiedAt, ageDays: 0 });
    if (model.capability) {
      records.push({
        kind: "model-capability",
        id: model.id,
        name: model.name,
        verifiedAt: model.capability.verifiedAt,
        ageDays: 0,
      });
    }
  }
  for (const plan of plans) {
    records.push({ kind: "plan", id: plan.id, name: plan.name, verifiedAt: plan.verifiedAt, ageDays: 0 });
  }
  return records;
}

// The earliest verification anywhere in the catalog. This, not the newest file
// timestamp, is how old the weakest claim on the page is.
export function oldestVerifiedAt(models: Model[], plans: Plan[]): string | null {
  const dates = collect(models, plans).map((record) => record.verifiedAt).filter(Boolean).sort();
  return dates[0] ?? null;
}

export function freshnessReport(
  models: Model[],
  plans: Plan[],
  reference: string,
  maxAgeDays: number = defaultMaxAgeDays,
): FreshnessReport {
  const records = collect(models, plans).map((record) => ({
    ...record,
    ageDays: ageInDays(record.verifiedAt, reference),
  }));
  return {
    reference,
    maxAgeDays,
    oldest: oldestVerifiedAt(models, plans),
    stale: records.filter((record) => record.ageDays > maxAgeDays).sort((a, b) => b.ageDays - a.ageDays),
    counted: records.length,
  };
}

// How far a single record lags the reference date, or 0 when it is within the
// allowance. Views use this to mark only the rows worth questioning.
export function lagBehind(verifiedAt: string, reference: string, maxAgeDays: number = defaultMaxAgeDays): number {
  const age = ageInDays(verifiedAt, reference);
  return age > maxAgeDays ? age : 0;
}

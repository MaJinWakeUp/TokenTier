// Shared catalog types for the model, plan, and scenario documents. One
// importable source for the application, the maintenance CLI, and tests; no
// React, browser, or filesystem dependencies live in this tree.

export type ScenarioId = string;
export type MetricKey = "intelligence" | "codingAgent" | "agentic" | "longContext";
export type Tier = "S" | "A" | "B" | "C" | "D";
export type Confidence = "High" | "Medium" | "Low";
export type PlanKind = "Subscription" | "BYOK client" | "Pay as you go";
export type EvidenceKind =
  | "Official quota"
  | "Official credit"
  | "Official relative limit"
  | "Price break-even";

// Structured access surfaces a provider exposes. Distinct from the soft
// `apiIncluded` text field, which remains for human-readable notes.
export type AccessSurface = "api" | "chat-app" | "coding-client";

// A single rate band. The default band applies when no threshold is stated or
// when the workload's input is below the threshold. A threshold band applies
// when the billable input token count reaches the threshold value.
export type RateBand = {
  input: number;
  cached: number | null;
  output: number;
  // Minimum billable input token count that triggers this band. Omit for the
  // default band. Bands are evaluated lowest-threshold-first; the first whose
  // threshold the workload reaches applies.
  threshold?: number;
};

// A discriminated quota object. Each variant carries only the fields its kind
// can evidence, so a break-even comparison cannot be mistaken for verified
// allowance.
export type Quota = { source: string; verifiedAt: string } & (
  | {
      kind: "dollar-allowance";
      amount: number;
      // Weekly/monthly/5h — the reset window the allowance covers.
      resetWindow: "5h" | "weekly" | "monthly";
      modelMeter?: string;
    }
  | {
      kind: "credit-allowance";
      amount: number;
      resetWindow: "5h" | "weekly" | "monthly";
      modelMeter?: string;
    }
  | {
      kind: "request-limit";
      amount: number;
      resetWindow: "5h" | "weekly" | "monthly";
    }
  | {
      kind: "relative-limit";
      description: string;
    }
  | {
      kind: "unknown";
      description: string;
    }
);


// A secondary cap published alongside a verified allowance. A plan whose
// quotaDetail records a dollar or credit allowance may still publish a
// shorter-window cap (e.g. $12/5h + $30/weekly + $60/monthly). When the
// shorter window would bind before the primary resetWindow, the plan's
// monthly capacity cannot be computed from the primary window alone.
export type ConditionalLimit = {
  amount: number;
  resetWindow: "5h" | "weekly" | "monthly";
  description: string;
};

// Per-call token profile. The cache share is the fraction of input billed at
// the cached rate; a profile that resends a stable prefix pays the cached rate
// for most of its input, which changes the ranking, not just the totals.
export type UsageSettings = {
  input: number;
  output: number;
  cacheRatio: number;
};

// Published capability scores. `null` is a deliberate third state: the model is
// listed and priced, but no independent score exists, so it never gets a tier.
export type Capability = {
  metrics: Partial<Record<MetricKey, number>>;
  indexVersion: string;
  variant?: string;
  source: string;
  verifiedAt: string;
};

export type Model = {
  id: string;
  provider: string;
  name: string;
  input: number;
  cached: number | null;
  output: number;
  context: string;
  // Numeric context window in tokens. Derived from `context` but stored
  // structurally so validation and eligibility do not parse strings at runtime.
  contextTokens: number;
  source: string;
  verifiedAt: string;
  note?: string;
  capability: Capability | null;
  // Optional typed rate bands. When absent, the top-level input/cached/output
  // fields are the only rates. When present, the top-level fields are the
  // default band and each entry is an additional band that applies when its
  // threshold is met.
  rateBands?: RateBand[];
  // Maximum input token count for which the published rates are verified.
  // When the workload's input exceeds this, callCost returns NaN to signal
  // unsupported pricing rather than silently using the base rate (F6).
  unsupportedBeyond?: number;
};

export type Plan = {
  id: string;
  provider: string;
  name: string;
  kind: PlanKind;
  monthly: number | null;
  // Every model the plan gives access to. Which one a scenario uses is chosen
  // per workload, because a $60 allowance goes much further on a small model.
  modelIds: string[];
  source: string;
  note: string;
  quota: string;
  evidence: EvidenceKind;
  confidence: Confidence;
  apiIncluded: string;
  verifiedAt: string;
  includedApiValue?: number;
  weeklyCredits?: number;
  // Keyed by model id: providers publish credit multipliers per model.
  creditMultipliers?: Record<string, [number, number, number]>;
  cacheRatio?: number;
  // Structured access surfaces the plan provides (v3). Distinct from the soft
  // `apiIncluded` text field, which remains for human-readable notes.
  access?: AccessSurface[];
  // Discriminated quota object (v3). When present, replaces the soft `quota`
  // text for machine-computed capacity. The text `quota` remains for display.
  quotaDetail?: Quota;
  // Optional overage price per million tokens, for plans that charge beyond the
  // included allowance at a different rate.
  overageInput?: number;
  overageOutput?: number;
  // Secondary caps published alongside the primary quotaDetail. When a shorter
  // window would bind before the primary resetWindow, the plan's monthly
  // capacity cannot be proven from the primary window alone (conditional).
  conditionalLimits?: ConditionalLimit[];
};

// The capability bar a scenario demands, plus the anchor model that makes the
// number re-derivable when the index is rebased.
export type Gate = {
  metric: MetricKey;
  minIndex: number;
  anchor: string;
  rationale: string;
  preferredMetric?: MetricKey;
};

export type Scenario = {
  id: ScenarioId;
  label: string;
  input: number;
  output: number;
  calls: number;
  cacheRatio: number;
  description: string;
  rationale: string;
  gate: Gate;
  // The most a reader doing this kind of work would plausibly pay for a
  // subscription. Plans above it are kept off the tier board and listed with
  // that reason, so a casual daily-use board is not dominated by $200 tiers.
  // It bounds the board only; Recommend uses the reader's own budget.
  planPriceCap: number;
};

export type CapabilityIndex = {
  name: string;
  version: string;
  scale: string;
  source: string;
  attribution: string;
};

export type ModelCatalogDoc = {
  schemaVersion: 3;
  updatedAt: string;
  currency: "USD";
  unit: "per-million-tokens";
  capabilityIndex: CapabilityIndex;
  models: Model[];
};

export type PlanCatalogDoc = {
  schemaVersion: 2;
  updatedAt: string;
  currency: "USD";
  plans: Plan[];
};

export type RankingWeights = {
  models: { cost: number; headroom: number };
  plans: { price: number; headroom: number; confidence: number };
  recommendation: { capability: number; budget: number; coverage: number; confidence: number };
};

export type ScenarioCatalogDoc = {
  schemaVersion: 2;
  metric: MetricKey;
  metricNote: string;
  profileNote: string;
  tierCuts: [number, number, number, number];
  ranking: RankingWeights;
  scenarios: Scenario[];
};

export type Catalog = {
  models: Model[];
  plans: Plan[];
  scenarios: Scenario[];
  modelById: Map<string, Model>;
  capabilityIndex: CapabilityIndex;
  modelCatalogUpdatedAt: string;
  planCatalogUpdatedAt: string;
  tierCuts: [number, number, number, number];
  rankingWeights: RankingWeights;
};

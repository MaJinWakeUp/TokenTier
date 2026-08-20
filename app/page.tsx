"use client";

import modelCatalog from "@/data/api-models.json";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import RankPlans from "./rank-plans";

type ScenarioId =
  | "daily"
  | "code-easy"
  | "code-medium"
  | "code-hard"
  | "research"
  | "writing"
  | "innovation";

type Tier = "S" | "A" | "B" | "—";
type Confidence = "High" | "Medium" | "Low";
type Lane = "api" | "plans";
type Preference = "either" | "api" | "plans";
type View = "explore" | "recommendation" | "rank";
type ApiColumnKey = "input" | "cached" | "output" | "context" | "fit" | "cost";
type PlanColumnKey = "type" | "price" | "quota" | "apiIncluded" | "equivalent" | "fit" | "evidence";

const apiColumnLabels: Record<ApiColumnKey, string> = {
  input: "Input / 1M",
  cached: "Cached input",
  output: "Output / 1M",
  context: "Context",
  fit: "Fit",
  cost: "Est. / call",
};

const planColumnLabels: Record<PlanColumnKey, string> = {
  type: "Type",
  price: "Price",
  quota: "Published quota",
  apiIncluded: "API included?",
  equivalent: "API-cost equivalent",
  fit: "Fit",
  evidence: "Evidence",
};

type UsageSettings = {
  input: number;
  output: number;
};

type Model = {
  id: string;
  provider: string;
  name: string;
  input: number;
  cached: number | null;
  output: number;
  context: string;
  source: string;
  verifiedAt: string;
  note?: string;
  tiers: Record<ScenarioId, Tier>;
};

type Plan = {
  id: string;
  provider: string;
  name: string;
  kind: "Subscription" | "BYOK client" | "Pay as you go";
  monthly: number | null;
  modelId: string;
  source: string;
  note: string;
  quota: string;
  evidence: "Official quota" | "Official credit" | "Official relative limit" | "Price break-even";
  confidence: Confidence;
  apiIncluded: string;
  includedApiValue?: number;
  weeklyCredits?: number;
  creditMultipliers?: [number, number, number];
  cacheRatio?: number;
  tiers: Record<ScenarioId, Tier>;
};

const scenarios: Array<{
  id: ScenarioId;
  label: string;
  input: number;
  output: number;
  description: string;
}> = [
  {
    id: "daily",
    label: "Daily use",
    input: 1200,
    output: 600,
    description: "Questions, summaries, planning, and everyday writing.",
  },
  {
    id: "code-easy",
    label: "Easy coding",
    input: 4000,
    output: 1500,
    description: "Small functions, explanations, tests, and local fixes.",
  },
  {
    id: "code-medium",
    label: "Medium coding",
    input: 18000,
    output: 6000,
    description: "Feature development, refactoring, and multi-file review.",
  },
  {
    id: "code-hard",
    label: "Hard coding",
    input: 70000,
    output: 18000,
    description: "Large repos, architectural work, and complex debugging.",
  },
  {
    id: "research",
    label: "Research",
    input: 45000,
    output: 5000,
    description: "Long documents, literature review, and source analysis.",
  },
  {
    id: "writing",
    label: "Writing",
    input: 3000,
    output: 2500,
    description: "Drafting, editing, tone adjustment, and long-form copy.",
  },
  {
    id: "innovation",
    label: "Innovation",
    input: 24000,
    output: 8000,
    description: "Brainstorming, strategy, product concepts, and novel ideas.",
  },
];

const tierScore: Record<Tier, number> = {
  S: 90,
  A: 80,
  B: 65,
  "—": 0,
};

const confidenceScore: Record<Confidence, number> = {
  High: 30,
  Medium: 20,
  Low: 10,
};

const tierDescriptions: Record<"S" | "A" | "B", string> = {
  S: "Top tier · Best overall",
  A: "Solid alternative",
  B: "Acceptable for light tasks",
};

const models: Model[] = modelCatalog.models as Model[];
const planCatalogUpdatedAt = "2026-08-19";

const plans: Plan[] = [
  {
    id: "chatgpt-plus",
    provider: "OpenAI",
    name: "ChatGPT Plus",
    kind: "Subscription",
    monthly: 20,
    modelId: "gpt-5-6-terra",
    source: "https://learn.chatgpt.com/docs/pricing",
    note: "Covers standard ChatGPT interface access; API platform usage is billed separately.",
    quota: "Rolling 5-hour limit across GPT-5.6 Terra and Luna",
    evidence: "Official relative limit",
    confidence: "Medium",
    apiIncluded: "No",
    cacheRatio: 0.25,
    tiers: {
      daily: "S",
      "code-easy": "S",
      "code-medium": "A",
      "code-hard": "A",
      research: "S",
      writing: "S",
      innovation: "A",
    },
  },
  {
    id: "chatgpt-pro-5x",
    provider: "OpenAI",
    name: "ChatGPT Pro (5x)",
    kind: "Subscription",
    monthly: 100,
    modelId: "gpt-5-6-sol",
    source: "https://learn.chatgpt.com/docs/pricing",
    note: "Higher allowances and prioritised access during peak times.",
    quota: "5x standard rolling allowances plus GPT-5.6 Sol access",
    evidence: "Official relative limit",
    confidence: "Medium",
    apiIncluded: "No",
    cacheRatio: 0.35,
    tiers: {
      daily: "A",
      "code-easy": "A",
      "code-medium": "S",
      "code-hard": "S",
      research: "S",
      writing: "S",
      innovation: "S",
    },
  },
  {
    id: "chatgpt-pro-20x",
    provider: "OpenAI",
    name: "ChatGPT Pro (20x)",
    kind: "Subscription",
    monthly: 200,
    modelId: "gpt-5-6-sol",
    source: "https://learn.chatgpt.com/docs/pricing",
    note: "Maximum rolling allowances and prioritised throughput for heavy users.",
    quota: "20x standard rolling allowances and continuous Sol access",
    evidence: "Official relative limit",
    confidence: "Medium",
    apiIncluded: "No",
    cacheRatio: 0.4,
    tiers: {
      daily: "B",
      "code-easy": "B",
      "code-medium": "A",
      "code-hard": "S",
      research: "S",
      writing: "A",
      innovation: "S",
    },
  },
  {
    id: "claude-pro",
    provider: "Anthropic",
    name: "Claude Pro",
    kind: "Subscription",
    monthly: 20,
    modelId: "claude-sonnet-5",
    source: "https://claude.com/pricing",
    note: "App-level rate limit applies. Agent SDK usage can be charged against plan credits with an extra fee.",
    quota: "5x Free plan allowances, dynamic by context size and demand",
    evidence: "Official credit",
    confidence: "Medium",
    apiIncluded: "Optional",
    includedApiValue: 20,
    cacheRatio: 0.3,
    tiers: {
      daily: "S",
      "code-easy": "S",
      "code-medium": "A",
      "code-hard": "A",
      research: "S",
      writing: "S",
      innovation: "A",
    },
  },
  {
    id: "claude-max-5x",
    provider: "Anthropic",
    name: "Claude Max (5x)",
    kind: "Subscription",
    monthly: 100,
    modelId: "claude-opus-5",
    source: "https://claude.com/pricing",
    note: "Designed for intensive research and long-context analysis.",
    quota: "5x Pro allowance across Opus and Sonnet models",
    evidence: "Official relative limit",
    confidence: "Medium",
    apiIncluded: "Optional",
    includedApiValue: 100,
    cacheRatio: 0.4,
    tiers: {
      daily: "B",
      "code-easy": "B",
      "code-medium": "A",
      "code-hard": "S",
      research: "S",
      writing: "S",
      innovation: "S",
    },
  },
  {
    id: "claude-max-20x",
    provider: "Anthropic",
    name: "Claude Max (20x)",
    kind: "Subscription",
    monthly: 200,
    modelId: "claude-opus-5",
    source: "https://claude.com/pricing",
    note: "Highest personal tier with maximum capacity and priority queues.",
    quota: "20x Pro allowance and full context limits",
    evidence: "Official relative limit",
    confidence: "Medium",
    apiIncluded: "Optional",
    includedApiValue: 200,
    cacheRatio: 0.45,
    tiers: {
      daily: "B",
      "code-easy": "B",
      "code-medium": "A",
      "code-hard": "S",
      research: "S",
      writing: "A",
      innovation: "S",
    },
  },
  {
    id: "google-ai-plus",
    provider: "Google",
    name: "Google AI Plus",
    kind: "Subscription",
    monthly: 9.99,
    modelId: "gemini-3-1-pro",
    source: "https://one.google.com/about/plans",
    note: "Consumer Gemini access with 2× Free usage limits. Gemini API usage is billed separately.",
    quota: "2× Free Gemini limits; compute-based limits refresh every 5 hours",
    evidence: "Official relative limit",
    confidence: "High",
    apiIncluded: "No",
    cacheRatio: 0.25,
    tiers: {
      daily: "A",
      "code-easy": "B",
      "code-medium": "B",
      "code-hard": "—",
      research: "A",
      writing: "A",
      innovation: "A",
    },
  },
  {
    id: "google-ai-pro",
    provider: "Google",
    name: "Google AI Pro",
    kind: "Subscription",
    monthly: 19.99,
    modelId: "gemini-3-1-pro",
    source: "https://gemini.google/us/subscriptions/",
    note: "Expanded Gemini, Deep Research, AI Studio, and Antigravity access. It does not include production Gemini API credit.",
    quota: "4× Free Gemini limits with expanded Pro model and Deep Research access",
    evidence: "Official relative limit",
    confidence: "High",
    apiIncluded: "No",
    cacheRatio: 0.35,
    tiers: {
      daily: "S",
      "code-easy": "S",
      "code-medium": "A",
      "code-hard": "A",
      research: "S",
      writing: "S",
      innovation: "A",
    },
  },
  {
    id: "google-ai-ultra-5x",
    provider: "Google",
    name: "Google AI Ultra (5x)",
    kind: "Subscription",
    monthly: 99.99,
    modelId: "gemini-3-1-pro",
    source: "https://gemini.google/us/subscriptions/",
    note: "Higher Gemini and Antigravity limits plus 10,000 monthly Flow credits. Production Gemini API usage remains separate.",
    quota: "5× Google AI Pro limits; 10,000 Flow credits / month",
    evidence: "Official relative limit",
    confidence: "High",
    apiIncluded: "No",
    cacheRatio: 0.4,
    tiers: {
      daily: "A",
      "code-easy": "A",
      "code-medium": "S",
      "code-hard": "S",
      research: "S",
      writing: "A",
      innovation: "S",
    },
  },
  {
    id: "google-ai-ultra-20x",
    provider: "Google",
    name: "Google AI Ultra (20x)",
    kind: "Subscription",
    monthly: 199.99,
    modelId: "gemini-3-1-pro",
    source: "https://gemini.google/us/subscriptions/",
    note: "Google's highest consumer limits plus 25,000 monthly Flow credits. Production Gemini API usage remains separate.",
    quota: "20× Google AI Pro limits; 25,000 Flow credits / month",
    evidence: "Official relative limit",
    confidence: "High",
    apiIncluded: "No",
    cacheRatio: 0.45,
    tiers: {
      daily: "B",
      "code-easy": "B",
      "code-medium": "A",
      "code-hard": "S",
      research: "S",
      writing: "B",
      innovation: "S",
    },
  },
  {
    id: "grok-super",
    provider: "xAI",
    name: "SuperGrok",
    kind: "Subscription",
    monthly: 30,
    modelId: "grok-4-6",
    source: "https://x.ai/pricing",
    note: "Includes Grok 4.6 access with higher limits, image and video generation, and live web and X search. API usage is separate.",
    quota: "Shared weekly product usage pool with pay-as-you-go overage",
    evidence: "Official relative limit",
    confidence: "Medium",
    apiIncluded: "No",
    cacheRatio: 0.2,
    tiers: {
      daily: "S",
      "code-easy": "S",
      "code-medium": "A",
      "code-hard": "S",
      research: "S",
      writing: "A",
      innovation: "S",
    },
  },
  {
    id: "grok-super-heavy",
    provider: "xAI",
    name: "SuperGrok Heavy",
    kind: "Subscription",
    monthly: 300,
    modelId: "grok-4-6",
    source: "https://x.ai/pricing",
    note: "Highest individual Grok tier with Heavy-model and Build Mode access. The public comparison lists the tier but the $300 price is corroborated from checkout and community sources.",
    quota: "Highest shared weekly Grok product pool and early feature access",
    evidence: "Official relative limit",
    confidence: "Low",
    apiIncluded: "No",
    cacheRatio: 0.35,
    tiers: {
      daily: "B",
      "code-easy": "B",
      "code-medium": "A",
      "code-hard": "S",
      research: "S",
      writing: "A",
      innovation: "S",
    },
  },
  {
    id: "cursor-pro",
    provider: "Cursor",
    name: "Cursor Pro",
    kind: "Subscription",
    monthly: 20,
    modelId: "gpt-5-6-terra",
    source: "https://cursor.com/docs/models-and-pricing",
    note: "Includes a $20 Other Models editor pool plus separate generous usage for Cursor models. This is not general API credit.",
    quota: "$20 Other Models usage plus Cursor Models pool",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Editor pool",
    includedApiValue: 20,
    cacheRatio: 0.4,
    tiers: {
      daily: "—",
      "code-easy": "S",
      "code-medium": "A",
      "code-hard": "B",
      research: "—",
      writing: "—",
      innovation: "—",
    },
  },
  {
    id: "cursor-pro-plus",
    provider: "Cursor",
    name: "Cursor Pro Plus",
    kind: "Subscription",
    monthly: 60,
    modelId: "gpt-5-6-terra",
    source: "https://cursor.com/docs/models-and-pricing",
    note: "Includes a $70 Other Models editor pool plus separate generous usage for Cursor models. This is not general API credit.",
    quota: "$70 Other Models usage plus Cursor Models pool",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Editor pool",
    includedApiValue: 70,
    cacheRatio: 0.4,
    tiers: {
      daily: "—",
      "code-easy": "S",
      "code-medium": "S",
      "code-hard": "A",
      research: "—",
      writing: "—",
      innovation: "—",
    },
  },
  {
    id: "cursor-ultra",
    provider: "Cursor",
    name: "Cursor Ultra",
    kind: "Subscription",
    monthly: 200,
    modelId: "gpt-5-6-terra",
    source: "https://cursor.com/docs/models-and-pricing",
    note: "Includes a $400 Other Models editor pool plus separate generous usage for Cursor models. This is not general API credit.",
    quota: "$400 Other Models usage plus Cursor Models pool",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Editor pool",
    includedApiValue: 400,
    cacheRatio: 0.45,
    tiers: {
      daily: "—",
      "code-easy": "A",
      "code-medium": "S",
      "code-hard": "S",
      research: "—",
      writing: "—",
      innovation: "—",
    },
  },
  {
    id: "opencode-go",
    provider: "OpenCode",
    name: "OpenCode Go",
    kind: "Subscription",
    monthly: 10,
    modelId: "glm-5-2",
    source: "https://opencode.ai/docs/go/",
    note: "Weekly credit allotment with peak and off-peak rate multipliers.",
    quota: "20,000 credits / week (peak / off-peak multipliers apply)",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Yes",
    weeklyCredits: 20000,
    creditMultipliers: [1, 0.2, 3],
    cacheRatio: 0.2,
    tiers: {
      daily: "A",
      "code-easy": "S",
      "code-medium": "A",
      "code-hard": "A",
      research: "A",
      writing: "A",
      innovation: "A",
    },
  },
  {
    id: "opencode-zen",
    provider: "OpenCode",
    name: "OpenCode Zen",
    kind: "Pay as you go",
    monthly: null,
    modelId: "kimi-k3",
    source: "https://opencode.ai/docs/zen/",
    note: "Pay-as-you-go proxy routing to multiple foundation models with unified billing.",
    quota: "Direct token pass-through with no monthly fee",
    evidence: "Price break-even",
    confidence: "Low",
    apiIncluded: "Yes",
    tiers: {
      daily: "A",
      "code-easy": "A",
      "code-medium": "A",
      "code-hard": "A",
      research: "A",
      writing: "A",
      innovation: "A",
    },
  },
  {
    id: "glm-coding-lite",
    provider: "Z.ai",
    name: "GLM Coding Lite",
    kind: "Subscription",
    monthly: 18,
    modelId: "glm-5-2",
    source: "https://docs.z.ai/devpack/overview",
    note: "Coding-tool subscription with GLM models and MCP access. The plan key is not a general production API balance.",
    quota: "10,000 credits / week; about 80 prompts / 5h",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Coding endpoint",
    weeklyCredits: 10000,
    creditMultipliers: [1, 0.2, 3],
    cacheRatio: 0.3,
    tiers: {
      daily: "—",
      "code-easy": "S",
      "code-medium": "A",
      "code-hard": "B",
      research: "—",
      writing: "—",
      innovation: "—",
    },
  },
  {
    id: "glm-coding-pro",
    provider: "Z.ai",
    name: "GLM Coding Pro",
    kind: "Subscription",
    monthly: 80,
    modelId: "glm-5-2",
    source: "https://z.ai/subscribe",
    note: "Six times the Lite credit pool with priority generation. The plan key is not a general production API balance.",
    quota: "60,000 credits / week; about 400 prompts / 5h",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Coding endpoint",
    weeklyCredits: 60000,
    creditMultipliers: [1, 0.2, 3],
    cacheRatio: 0.3,
    tiers: {
      daily: "—",
      "code-easy": "S",
      "code-medium": "S",
      "code-hard": "A",
      research: "—",
      writing: "—",
      innovation: "—",
    },
  },
  {
    id: "glm-coding-max",
    provider: "Z.ai",
    name: "GLM Coding Max",
    kind: "Subscription",
    monthly: 168,
    modelId: "glm-5-2",
    source: "https://z.ai/subscribe",
    note: "Fourteen times the Lite credit pool with dedicated peak resources. The plan key is not a general production API balance.",
    quota: "140,000 credits / week; about 1,600 prompts / 5h",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Coding endpoint",
    weeklyCredits: 140000,
    creditMultipliers: [1, 0.2, 3],
    cacheRatio: 0.35,
    tiers: {
      daily: "—",
      "code-easy": "A",
      "code-medium": "S",
      "code-hard": "S",
      research: "—",
      writing: "—",
      innovation: "—",
    },
  },
  {
    id: "kimi-moderato",
    provider: "Kimi",
    name: "Kimi Moderato",
    kind: "Subscription",
    monthly: 19,
    modelId: "kimi-k3",
    source: "https://www.kimi.com/help/membership/membership-pricing",
    note: "Shared Kimi membership pool; task counts are vendor estimates based on typical token use and are not API calls.",
    quota: "60 Agent credits; 1× Kimi Code credits; 2,000 database calls",
    evidence: "Official relative limit",
    confidence: "High",
    apiIncluded: "No",
    cacheRatio: 0.25,
    tiers: {
      daily: "A",
      "code-easy": "A",
      "code-medium": "B",
      "code-hard": "B",
      research: "A",
      writing: "A",
      innovation: "A",
    },
  },
  {
    id: "kimi-allegretto",
    provider: "Kimi",
    name: "Kimi Allegretto",
    kind: "Subscription",
    monthly: 39,
    modelId: "kimi-k3",
    source: "https://www.kimi.com/help/membership/membership-pricing",
    note: "Shared Kimi membership pool with Kimi Claw. Task counts are vendor estimates, not API-call guarantees.",
    quota: "150 Agent credits; 5× Kimi Code credits; 5,000 database calls",
    evidence: "Official relative limit",
    confidence: "High",
    apiIncluded: "No",
    cacheRatio: 0.25,
    tiers: {
      daily: "S",
      "code-easy": "S",
      "code-medium": "A",
      "code-hard": "A",
      research: "S",
      writing: "S",
      innovation: "A",
    },
  },
  {
    id: "kimi-allegro",
    provider: "Kimi",
    name: "Kimi Allegro",
    kind: "Subscription",
    monthly: 99,
    modelId: "kimi-k3",
    source: "https://www.kimi.com/help/membership/membership-pricing",
    note: "Larger shared Kimi membership pool with four concurrent Agent tasks. Task counts are estimates, not API calls.",
    quota: "360 Agent credits; 15× Kimi Code credits; 12,000 database calls",
    evidence: "Official relative limit",
    confidence: "High",
    apiIncluded: "No",
    cacheRatio: 0.3,
    tiers: {
      daily: "A",
      "code-easy": "A",
      "code-medium": "S",
      "code-hard": "A",
      research: "S",
      writing: "A",
      innovation: "S",
    },
  },
  {
    id: "kimi-vivace",
    provider: "Kimi",
    name: "Kimi Vivace",
    kind: "Subscription",
    monthly: 199,
    modelId: "kimi-k3",
    source: "https://www.kimi.com/help/membership/membership-pricing",
    note: "Kimi's highest membership pool and concurrency. Task counts are vendor estimates, not API-call guarantees.",
    quota: "720 Agent credits; 30× Kimi Code credits; 24,000 database calls",
    evidence: "Official relative limit",
    confidence: "High",
    apiIncluded: "No",
    cacheRatio: 0.35,
    tiers: {
      daily: "B",
      "code-easy": "B",
      "code-medium": "A",
      "code-hard": "S",
      research: "S",
      writing: "A",
      innovation: "S",
    },
  },
];

const providerNames = ["All", ...Array.from(new Set(models.map((m) => m.provider))).sort((a, b) => {
  const priority = ["OpenAI", "Anthropic", "xAI", "Google"];
  const aIdx = priority.indexOf(a);
  const bIdx = priority.indexOf(b);
  if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
  if (aIdx !== -1) return -1;
  if (bIdx !== -1) return 1;
  return a.localeCompare(b);
})];

const planProviderNames = ["All", ...Array.from(new Set(plans.map((p) => p.provider))).sort((a, b) => {
  const priority = ["OpenAI", "Anthropic", "xAI", "Google"];
  const aIdx = priority.indexOf(a);
  const bIdx = priority.indexOf(b);
  if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
  if (aIdx !== -1) return -1;
  if (bIdx !== -1) return 1;
  return a.localeCompare(b);
})];

const rankablePlans = plans
  .filter((plan) => plan.kind === "Subscription")
  .map(({ id, provider, name, monthly }) => ({ id, provider, name, monthly }));

function price(value: number, digits = 2) {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(digits > 2 ? digits : 4)}`;
  return `$${value.toFixed(digits)}`;
}

function monthlyPrice(value: number) {
  if (value === 0) return "$0";
  if (value < 1) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString()}`;
}

function contextSize(context: string): number {
  const normalized = context.trim().toUpperCase();
  if (normalized.endsWith("M")) {
    return parseFloat(normalized.slice(0, -1)) * 1_000_000;
  }
  if (normalized.endsWith("K")) {
    return parseFloat(normalized.slice(0, -1)) * 1_000;
  }
  return parseFloat(normalized) || 0;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.round(value));
}

function callCost(model: Model, settings: UsageSettings, cacheRatio = 0) {
  const cachedRate = model.cached ?? model.input;
  const inputCost = (settings.input * (1 - cacheRatio) * model.input + settings.input * cacheRatio * cachedRate) / 1_000_000;
  const outputCost = (settings.output * model.output) / 1_000_000;
  return inputCost + outputCost;
}

function planPrice(plan: Plan) {
  if (plan.monthly === null) return "Pay as you go";
  return `$${plan.monthly}`;
}

function planQuota(plan: Plan, scenarioId: ScenarioId) {
  if (!plan.id.startsWith("chatgpt-")) return plan.quota;
  const modelClass = ["daily", "code-easy"].includes(scenarioId)
    ? "Luna"
    : ["code-medium", "innovation"].includes(scenarioId)
      ? "Terra"
      : "Sol";
  const ranges = {
    "chatgpt-plus": { Luna: "250–2,000", Terra: "25–200", Sol: "10–100" },
    "chatgpt-pro-5x": { Luna: "1,250–10,000", Terra: "125–1,000", Sol: "50–500" },
    "chatgpt-pro-20x": { Luna: "5,000–40,000", Terra: "500–4,000", Sol: "200–2,000" },
  } as const;
  const range = ranges[plan.id as keyof typeof ranges][modelClass];
  return `${range} ${modelClass} local messages / 5h`;
}

function planEstimate(plan: Plan, settings: UsageSettings) {
  const model = models.find((item) => item.id === plan.modelId);
  if (!model) return null;
  const referenceCost = callCost(model, settings, plan.cacheRatio ?? 0);

  if (plan.weeklyCredits && plan.creditMultipliers) {
    const [inputMultiplier, cachedMultiplier, outputMultiplier] = plan.creditMultipliers;
    const cacheRatio = plan.cacheRatio ?? 0;
    const creditsPerCall = (
      settings.input * (1 - cacheRatio) * inputMultiplier
      + settings.input * cacheRatio * cachedMultiplier
      + settings.output * outputMultiplier
    ) / 10_000;
    const callsLow = (plan.weeklyCredits * 4.33) / creditsPerCall;
    const callsHigh = callsLow * 2;
    return {
      callsLow,
      callsHigh,
      valueLow: callsLow * referenceCost,
      valueHigh: callsHigh * referenceCost,
      basis: "Official credit formula · peak–off-peak",
    };
  }

  if (plan.includedApiValue !== undefined) {
    const calls = plan.includedApiValue / referenceCost;
    return {
      callsLow: calls,
      callsHigh: calls,
      valueLow: plan.includedApiValue,
      valueHigh: plan.includedApiValue,
      basis: plan.evidence === "Official credit" ? "Included API credit" : "Official capped value",
    };
  }

  if (plan.monthly !== null && plan.monthly > 0) {
    const calls = plan.monthly / referenceCost;
    return {
      callsLow: calls,
      callsHigh: calls,
      valueLow: plan.monthly,
      valueHigh: plan.monthly,
      basis: "Price break-even only",
    };
  }

  return null;
}

function formatEstimateRange(low: number, high: number) {
  if (Math.abs(high - low) < 1) return compactNumber(low);
  return `${compactNumber(low)}–${compactNumber(high)}`;
}

function formatMoneyRange(low: number, high: number) {
  if (Math.abs(high - low) < 0.01) return price(low, 0);
  return `${price(low, 0)}–${price(high, 0)}`;
}

function planCoverageScore(plan: Plan, settings: UsageSettings, calls: number) {
  const estimate = planEstimate(plan, settings);
  if (estimate && (plan.weeklyCredits || plan.includedApiValue !== undefined)) {
    if (estimate.callsLow >= calls) return 100;
    if (estimate.callsHigh >= calls) return 70;
    return Math.max(10, Math.round(20 * (estimate.callsHigh / calls)));
  }
  return null;
}

type IconName =
  | "warning"
  | "check"
  | "copy"
  | "close"
  | "arrow-up"
  | "arrow-down"
  | "arrow-right"
  | "external"
  | "search"
  | "chevron-down";

function Icon({ name, className, size = 16 }: { name: IconName; className?: string; size?: number }) {
  switch (name) {
    case "warning":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" x2="12" y1="9" y2="13" />
          <line x1="12" x2="12.01" y1="17" y2="17" />
        </svg>
      );
    case "check":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case "copy":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <rect height="14" rx="2" ry="2" width="14" x="8" y="8" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      );
    case "close":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
    case "arrow-up":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="m5 12 7-7 7 7" />
          <path d="M12 19V5" />
        </svg>
      );
    case "arrow-down":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="m19 12-7 7-7-7" />
          <path d="M12 5v14" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      );
    case "external":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
      );
    case "search":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
  }
}

function Modal({
  isOpen,
  onClose,
  title,
  titleId,
  children,
  maxWidth = "640px",
}: {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  titleId: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    triggerRef.current = document.activeElement;
    document.body.style.overflow = "hidden";
    const closeBtn = modalRef.current?.querySelector<HTMLButtonElement>(".modal-close-btn");
    closeBtn?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") {
        const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <button aria-label="Close modal overlay" className="modal-backdrop-dismiss" onClick={onClose} type="button" />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="detail-modal"
        ref={modalRef}
        role="dialog"
        style={{ maxWidth }}
      >
        <header className="detail-modal-header">
          <div className="detail-modal-title-wrap">
            {title}
          </div>
          <button aria-label="Close modal" className="modal-close-btn" onClick={onClose} type="button">
            <Icon name="close" size={16} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

type ThemeMode = "system" | "light" | "dark";

function getThemeSnapshot(): string {
  if (typeof window === "undefined") return "system:dark";
  const system = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  try {
    const saved = localStorage.getItem("tokentier-theme");
    if (saved === "light" || saved === "dark") return `${saved}:${saved}`;
    if (saved === "system") return `system:${system}`;
  } catch {
    // ignore
  }
  return `system:${system}`;
}

function getServerThemeSnapshot(): string {
  return "system:dark";
}

function subscribeTheme(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", callback);
  window.addEventListener("storage", callback);
  return () => {
    media.removeEventListener("change", callback);
    window.removeEventListener("storage", callback);
  };
}

export default function Home() {
  const [activeView, setActiveView] = useState<View>("explore");
  const [exploreScenarioId, setExploreScenarioId] = useState<ScenarioId>("code-medium");
  const [recommendationScenarioId, setRecommendationScenarioId] = useState<ScenarioId>("code-medium");
  const [recommendationInputTokens, setRecommendationInputTokens] = useState(18_000);
  const [recommendationOutputTokens, setRecommendationOutputTokens] = useState(6_000);
  const [exploreLane, setExploreLane] = useState<Lane>("api");
  const [recComparisonTab, setRecComparisonTab] = useState<Lane>("api");
  const [monthlyCalls, setMonthlyCalls] = useState(500);
  const [monthlyBudget, setMonthlyBudget] = useState(30);
  const [preference, setPreference] = useState<Preference>("either");
  const [showAllPlans, setShowAllPlans] = useState(false);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("cost");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeDetailItem, setActiveDetailItem] = useState<Model | Plan | null>(null);
  const [compareList, setCompareList] = useState<Array<Model | Plan>>([]);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  const searchInputRef = useRef<HTMLInputElement>(null);
  const columnsSelectorRef = useRef<HTMLDetailsElement>(null);

  const [visibleApiColumns, setVisibleApiColumns] = useState<Record<ApiColumnKey, boolean>>({
    input: true,
    cached: true,
    output: true,
    context: true,
    fit: true,
    cost: true,
  });
  const [visiblePlanColumns, setVisiblePlanColumns] = useState<Record<PlanColumnKey, boolean>>({
    type: true,
    price: true,
    quota: true,
    apiIncluded: true,
    equivalent: true,
    fit: true,
    evidence: true,
  });

  const switchView = (view: View) => {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => {
      if (view === "explore") {
        document.getElementById("explore-top-heading")?.focus();
      } else if (view === "recommendation") {
        document.getElementById("recommendation-top-heading")?.focus();
      } else {
        document.getElementById("rank-top-heading")?.focus();
      }
    }, 50);
  };

  const handleFooterNav = (e: React.MouseEvent<HTMLAnchorElement>, targetId: string) => {
    if (activeView !== "explore") {
      e.preventDefault();
      switchView("explore");
      setTimeout(() => {
        const el = document.getElementById(targetId);
        el?.scrollIntoView({ behavior: "smooth" });
      }, 60);
    }
  };

  const themeSnapshot = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const [themeMode, activeTheme] = themeSnapshot.split(":") as [ThemeMode, "light" | "dark"];

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time client state hydration from localStorage and URL params */
    try {
      const savedView = localStorage.getItem("tokentier-view");
      if (savedView === "explore" || savedView === "recommendation" || savedView === "rank") {
        setActiveView(savedView);
      }
      const savedCalls = localStorage.getItem("tokentier-rec-calls");
      if (savedCalls) setMonthlyCalls(Math.min(100_000, Math.max(1, Number(savedCalls) || 500)));
      const savedBudget = localStorage.getItem("tokentier-rec-budget");
      if (savedBudget) setMonthlyBudget(Math.min(10_000, Math.max(1, Number(savedBudget) || 30)));
      const savedInput = localStorage.getItem("tokentier-rec-input");
      if (savedInput) setRecommendationInputTokens(Math.min(1_000_000, Math.max(1, Number(savedInput) || 18_000)));
      const savedOutput = localStorage.getItem("tokentier-rec-output");
      if (savedOutput) setRecommendationOutputTokens(Math.min(500_000, Math.max(1, Number(savedOutput) || 6_000)));
      const savedPref = localStorage.getItem("tokentier-rec-pref");
      if (savedPref === "either" || savedPref === "api" || savedPref === "plans") setPreference(savedPref);
      const savedApiCols = localStorage.getItem("tokentier-api-cols");
      if (savedApiCols) setVisibleApiColumns(JSON.parse(savedApiCols));
      const savedPlanCols = localStorage.getItem("tokentier-plan-cols");
      if (savedPlanCols) setVisiblePlanColumns(JSON.parse(savedPlanCols));
    } catch {
      // ignore
    }

    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");
    const scenarioParam = params.get("scenario");
    const callsParam = params.get("calls");
    const budgetParam = params.get("budget");
    const inputParam = params.get("input");
    const outputParam = params.get("output");
    const prefParam = params.get("preference");

    if (viewParam === "explore" || viewParam === "recommendation" || viewParam === "rank") setActiveView(viewParam);
    const selectedScenario = scenarios.find((scenario) => scenario.id === scenarioParam);
    if (selectedScenario) {
      setExploreScenarioId(selectedScenario.id);
      setRecommendationScenarioId(selectedScenario.id);
      setRecommendationInputTokens(selectedScenario.input);
      setRecommendationOutputTokens(selectedScenario.output);
    }
    if (callsParam) {
      const c = Number(callsParam);
      if (!Number.isNaN(c) && c >= 1 && c <= 100_000) setMonthlyCalls(c);
    }
    if (budgetParam) {
      const b = Number(budgetParam);
      if (!Number.isNaN(b) && b >= 1 && b <= 10_000) setMonthlyBudget(b);
    }
    if (inputParam) {
      const i = Number(inputParam);
      if (!Number.isNaN(i) && i >= 1 && i <= 1_000_000) setRecommendationInputTokens(i);
    }
    if (outputParam) {
      const o = Number(outputParam);
      if (!Number.isNaN(o) && o >= 1 && o <= 500_000) setRecommendationOutputTokens(o);
    }
    if (prefParam === "either" || prefParam === "api" || prefParam === "plans") {
      setPreference(prefParam);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", activeView);
    if (activeView === "rank") params.delete("scenario");
    else params.set("scenario", activeView === "recommendation" ? recommendationScenarioId : exploreScenarioId);
    if (activeView === "recommendation") {
      params.set("calls", monthlyCalls.toString());
      params.set("budget", monthlyBudget.toString());
      params.set("input", recommendationInputTokens.toString());
      params.set("output", recommendationOutputTokens.toString());
      params.set("preference", preference);
    } else {
      params.delete("calls");
      params.delete("budget");
      params.delete("input");
      params.delete("output");
      params.delete("preference");
    }
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", newUrl);

    try {
      localStorage.setItem("tokentier-view", activeView);
      localStorage.setItem("tokentier-rec-calls", monthlyCalls.toString());
      localStorage.setItem("tokentier-rec-budget", monthlyBudget.toString());
      localStorage.setItem("tokentier-rec-input", recommendationInputTokens.toString());
      localStorage.setItem("tokentier-rec-output", recommendationOutputTokens.toString());
      localStorage.setItem("tokentier-rec-pref", preference);
      localStorage.setItem("tokentier-api-cols", JSON.stringify(visibleApiColumns));
      localStorage.setItem("tokentier-plan-cols", JSON.stringify(visiblePlanColumns));
    } catch {
      // ignore
    }
  }, [
    activeView,
    exploreScenarioId,
    recommendationScenarioId,
    monthlyCalls,
    monthlyBudget,
    recommendationInputTokens,
    recommendationOutputTokens,
    preference,
    visibleApiColumns,
    visiblePlanColumns,
  ]);

  useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || "").toLowerCase();
      const isInput = activeTag === "input" || activeTag === "textarea" || activeTag === "select";

      if ((event.metaKey || event.ctrlKey) && event.key === "1") {
        event.preventDefault();
        switchView("explore");
      } else if ((event.metaKey || event.ctrlKey) && event.key === "2") {
        event.preventDefault();
        switchView("recommendation");
      } else if ((event.metaKey || event.ctrlKey) && event.key === "3") {
        event.preventDefault();
        switchView("rank");
      } else if (event.key === "/" && !isInput && activeView === "explore") {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === "Escape") {
        if (columnsSelectorRef.current?.open) {
          columnsSelectorRef.current.open = false;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeView]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (columnsSelectorRef.current?.open && !columnsSelectorRef.current.contains(event.target as Node)) {
        columnsSelectorRef.current.open = false;
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const setThemeMode = (mode: ThemeMode) => {
    try {
      if (mode === "system") {
        localStorage.removeItem("tokentier-theme");
      } else {
        localStorage.setItem("tokentier-theme", mode);
      }
      const system = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      const effective = mode === "system" ? system : mode;
      document.documentElement.setAttribute("data-theme", effective);
      window.dispatchEvent(new Event("storage"));
    } catch {
      // ignore
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // ignore
    }
  };

  const toggleProvider = (name: string) => {
    if (name === "All") {
      setSelectedProviders([]);
      setLiveAnnouncement("Showing all providers");
      return;
    }
    setSelectedProviders((prev) => {
      const next = prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name];
      setLiveAnnouncement(next.length === 0 ? "Showing all providers" : `Filtered by ${next.join(", ")}`);
      return next;
    });
  };

  const toggleCompare = (item: Model | Plan) => {
    setCompareList((prev) => {
      const isPlan = "kind" in item;
      const prevIsPlan = prev.length > 0 && "kind" in prev[0];
      if (prev.length > 0 && isPlan !== prevIsPlan) {
        setLiveAnnouncement(`Switched comparison to ${isPlan ? "plans" : "models"}. ${item.name} added (1/3).`);
        return [item];
      }
      const exists = prev.some((p) => p.id === item.id);
      if (exists) {
        const next = prev.filter((p) => p.id !== item.id);
        setLiveAnnouncement(`${item.name} removed from comparison, ${next.length} of 3.`);
        return next;
      }
      if (prev.length >= 3) {
        const next = [...prev.slice(1), item];
        setLiveAnnouncement(`${item.name} added to comparison, 3 of 3.`);
        return next;
      }
      const next = [...prev, item];
      setLiveAnnouncement(`${item.name} added to comparison, ${next.length} of 3.`);
      return next;
    });
  };

  const handleHeaderSort = (columnKey: string) => {
    if (sortBy === columnKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      setLiveAnnouncement(`Sorted by ${columnKey} ${sortDirection === "asc" ? "descending" : "ascending"}`);
    } else {
      setSortBy(columnKey);
      setSortDirection("asc");
      setLiveAnnouncement(`Sorted by ${columnKey} ascending`);
    }
  };

  const exploreScenario = scenarios.find((item) => item.id === exploreScenarioId)!;
  const exploreSettings = useMemo<UsageSettings>(() => ({
    input: exploreScenario.input,
    output: exploreScenario.output,
  }), [exploreScenario]);
  const recommendationSettings = useMemo<UsageSettings>(() => ({
    input: recommendationInputTokens,
    output: recommendationOutputTokens,
  }), [recommendationInputTokens, recommendationOutputTokens]);

  const apiRecommendation = useMemo(() => {
    const requiredTokens = recommendationSettings.input + recommendationSettings.output;
    const candidates = models.filter(
      (model) => model.tiers[recommendationScenarioId] !== "—" && contextSize(model.context) >= requiredTokens,
    );
    const validCandidates = candidates.length > 0
      ? candidates
      : models.filter((model) => model.tiers[recommendationScenarioId] !== "—");
    const withinBudget = validCandidates.filter(
      (model) => callCost(model, recommendationSettings) * monthlyCalls <= monthlyBudget,
    );
    const eligible = withinBudget.length > 0 ? withinBudget : validCandidates;
    return [...eligible].sort((a, b) => {
      const aSpend = callCost(a, recommendationSettings) * monthlyCalls;
      const bSpend = callCost(b, recommendationSettings) * monthlyCalls;
      const aScore = tierScore[a.tiers[recommendationScenarioId]];
      const bScore = tierScore[b.tiers[recommendationScenarioId]];
      return bScore - aScore || aSpend - bSpend;
    })[0];
  }, [monthlyBudget, monthlyCalls, recommendationScenarioId, recommendationSettings]);

  const rankedPlanOptions = useMemo(() => {
    const requiredTokens = recommendationSettings.input + recommendationSettings.output;
    const candidates = plans.filter((plan) => {
      if (plan.kind !== "Subscription" || plan.tiers[recommendationScenarioId] === "—") return false;
      const underlyingModel = models.find((m) => m.id === plan.modelId);
      if (underlyingModel && contextSize(underlyingModel.context) < requiredTokens) {
        return false;
      }
      return true;
    });
    const validCandidates = candidates.length > 0
      ? candidates
      : plans.filter(
          (plan) => plan.kind === "Subscription" && plan.tiers[recommendationScenarioId] !== "—",
        );
    const options = validCandidates
      .map((plan) => {
        const estimate = planEstimate(plan, recommendationSettings);
        if (!estimate) return null;
        const coverage = planCoverageScore(plan, recommendationSettings, monthlyCalls);
        const withinBudget = (plan.monthly ?? Infinity) <= monthlyBudget;
        const score = tierScore[plan.tiers[recommendationScenarioId]] * 0.48
          + (withinBudget ? 100 : 0) * 0.22
          + (coverage ?? 25) * 0.2
          + confidenceScore[plan.confidence] * 0.1;
        return { plan, estimate, coverage, withinBudget, score };
      })
      .filter((option): option is NonNullable<typeof option> => option !== null);
    return options.sort((a, b) =>
      Number(b.withinBudget) - Number(a.withinBudget)
      || b.score - a.score
      || (a.plan.monthly ?? Infinity) - (b.plan.monthly ?? Infinity)
    );
  }, [monthlyBudget, monthlyCalls, recommendationScenarioId, recommendationSettings]);

  const recommendedPlanOption = rankedPlanOptions[0];
  const planRecommendation = recommendedPlanOption.plan;
  const recommendedPlanEstimate = recommendedPlanOption.estimate;
  const recommendedPlanCoverage = recommendedPlanOption.coverage;
  const recommendedApiSpend = callCost(apiRecommendation, recommendationSettings) * monthlyCalls;
  const planCoversVolume = recommendedPlanCoverage === 100;
  const planWithinBudget = recommendedPlanOption.withinBudget;
  const apiWithinBudget = recommendedApiSpend <= monthlyBudget;

  const preferredPath: Lane = preference === "api"
    ? apiWithinBudget || !planWithinBudget || !planCoversVolume ? "api" : "plans"
    : preference === "plans"
      ? planWithinBudget && planCoversVolume ? "plans" : "api"
      : recommendedApiSpend <= (planRecommendation.monthly ?? Infinity) * 0.65
        ? "api"
        : recommendedApiSpend >= (planRecommendation.monthly ?? Infinity) * 1.25 && planWithinBudget && planCoversVolume
          ? "plans"
          : planWithinBudget && planCoversVolume && !apiWithinBudget
            ? "plans"
            : "api";

  const recommendedPlanPrice = planRecommendation.monthly ?? 0;
  const recommendedPlanCalls = formatEstimateRange(recommendedPlanEstimate.callsLow, recommendedPlanEstimate.callsHigh);
  const apiPlanDifference = recommendedApiSpend - recommendedPlanPrice;
  const sameMonthlyPrice = Math.abs(apiPlanDifference) < 0.005;

  const diffFactCaption = sameMonthlyPrice
    ? "Both options cost the same monthly for this workload."
    : apiPlanDifference < 0
      ? preferredPath === "api"
        ? `API saves ${monthlyPrice(Math.abs(apiPlanDifference))}/mo compared to ${planRecommendation.name}`
        : `${apiRecommendation.name} API is ${monthlyPrice(Math.abs(apiPlanDifference))}/mo cheaper than ${planRecommendation.name}`
      : preferredPath === "plans"
        ? `${planRecommendation.name} saves ${monthlyPrice(Math.abs(apiPlanDifference))}/mo compared to API spend (~${recommendedPlanCalls} calls)`
        : `API costs ${monthlyPrice(Math.abs(apiPlanDifference))}/mo more than ${planRecommendation.name} (~${recommendedPlanCalls} calls)`;

  const rankedModelCosts = useMemo(() => {
    const requiredTokens = recommendationSettings.input + recommendationSettings.output;
    const candidates = models.filter((model) => contextSize(model.context) >= requiredTokens);
    const displayModels = candidates.length > 0 ? candidates : models;
    return displayModels
      .map((model) => {
        const perCall = callCost(model, recommendationSettings);
        return { model, perCall, monthly: perCall * monthlyCalls };
      })
      .sort((a, b) => a.monthly - b.monthly);
  }, [monthlyCalls, recommendationSettings]);

  const maxRankedMonthly = useMemo(() => {
    return Math.max(...rankedModelCosts.map((r) => r.monthly), 1);
  }, [rankedModelCosts]);

  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = models
      .filter((model) => {
        const matchesProvider = selectedProviders.length === 0 || selectedProviders.includes(model.provider);
        const matchesQuery = !normalizedQuery || `${model.provider} ${model.name}`.toLowerCase().includes(normalizedQuery);
        return matchesProvider && matchesQuery;
      });

    return filtered.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "name") comparison = a.name.localeCompare(b.name);
      else if (sortBy === "input") comparison = a.input - b.input;
      else if (sortBy === "cached") comparison = (a.cached ?? a.input) - (b.cached ?? b.input);
      else if (sortBy === "output") comparison = a.output - b.output;
      else if (sortBy === "context") comparison = contextSize(a.context) - contextSize(b.context);
      else if (sortBy === "fit") comparison = tierScore[a.tiers[exploreScenarioId]] - tierScore[b.tiers[exploreScenarioId]];
      else comparison = callCost(a, exploreSettings) - callCost(b, exploreSettings);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [exploreScenarioId, exploreSettings, selectedProviders, query, sortBy, sortDirection]);

  const visiblePlans = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = plans
      .filter((plan) => {
        const matchesProvider = selectedProviders.length === 0 || selectedProviders.includes(plan.provider);
        const matchesQuery = !normalizedQuery || `${plan.provider} ${plan.name} ${plan.kind}`.toLowerCase().includes(normalizedQuery);
        return matchesProvider && matchesQuery;
      });

    return filtered.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "name") comparison = a.name.localeCompare(b.name);
      else if (sortBy === "type") comparison = a.kind.localeCompare(b.kind);
      else if (sortBy === "confidence") comparison = confidenceScore[a.confidence] - confidenceScore[b.confidence];
      else if (sortBy === "fit") comparison = tierScore[a.tiers[exploreScenarioId]] - tierScore[b.tiers[exploreScenarioId]];
      else comparison = (a.monthly ?? Infinity) - (b.monthly ?? Infinity);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [exploreScenarioId, selectedProviders, query, sortBy, sortDirection]);

  const updateRecommendationProfile = (id: ScenarioId) => {
    const selected = scenarios.find((item) => item.id === id)!;
    setRecommendationScenarioId(id);
    setRecommendationInputTokens(selected.input);
    setRecommendationOutputTokens(selected.output);
  };

  const useExploreProfile = () => {
    updateRecommendationProfile(exploreScenarioId);
    switchView("recommendation");
  };

  const switchExploreLane = (lane: Lane) => {
    setExploreLane(lane);
    setSortBy(lane === "api" ? "cost" : "price");
    setSortDirection("asc");
    if (columnsSelectorRef.current) columnsSelectorRef.current.open = false;
  };

  const latestPricingUpdate = modelCatalog.updatedAt > planCatalogUpdatedAt ? modelCatalog.updatedAt : planCatalogUpdatedAt;
  const pricingUpdatedAt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${latestPricingUpdate}T00:00:00Z`));

  const daysSinceUpdate = useMemo(() => {
    try {
      const updateDate = new Date(`${latestPricingUpdate}T00:00:00Z`);
      const now = new Date();
      return Math.floor((now.getTime() - updateDate.getTime()) / (1000 * 60 * 60 * 24));
    } catch {
      return 0;
    }
  }, [latestPricingUpdate]);

  const isComparingPlans = compareList.length > 0 && "kind" in compareList[0];

  return (
    <main>
      <a className="skip-link" href={activeView === "explore" ? "#tier-board" : activeView === "recommendation" ? "#recommendation-settings" : "#rank-top"}>Skip to comparison</a>

      <div aria-live="polite" className="visually-hidden">{liveAnnouncement}</div>

      <header className="site-header">
        <a
          className="brand"
          href="#explore-top"
          aria-label="TokenTier home"
          onClick={(event) => {
            event.preventDefault();
            switchView("explore");
          }}
        >
          <span className="brand-mark">T/T</span>
          <span>TokenTier</span>
        </a>
        <nav className="workspace-tabs" aria-label="Comparison mode">
          <button
            aria-label="Explore profiles"
            aria-pressed={activeView === "explore"}
            className={activeView === "explore" ? "active" : ""}
            id="explore-tab"
            onClick={() => switchView("explore")}
            title="Explore profiles"
            type="button"
          >
            <span aria-hidden="true" className="workspace-tab-long">Explore profiles</span>
            <span aria-hidden="true" className="workspace-tab-short">Explore</span>
          </button>
          <button
            aria-label="Recommendation"
            aria-pressed={activeView === "recommendation"}
            className={activeView === "recommendation" ? "active" : ""}
            id="recommendation-tab"
            onClick={() => switchView("recommendation")}
            title="Recommendation"
            type="button"
          >
            <span aria-hidden="true" className="workspace-tab-long">Recommendation</span>
            <span aria-hidden="true" className="workspace-tab-short">Recommend</span>
          </button>
          <button
            aria-label="Rank plans"
            aria-pressed={activeView === "rank"}
            className={activeView === "rank" ? "active" : ""}
            id="rank-tab"
            onClick={() => switchView("rank")}
            title="Rank plans"
            type="button"
          >
            <span aria-hidden="true" className="workspace-tab-long">Rank plans</span>
            <span aria-hidden="true" className="workspace-tab-short">Rank</span>
          </button>
        </nav>
        <div className="header-actions">
          <span className={`freshness ${daysSinceUpdate > 30 ? "stale" : ""}`} title={`Data updated ${pricingUpdatedAt}`}>
            <i /> Updated {pricingUpdatedAt}
          </span>
          <div className="theme-switcher" role="group" aria-label="Theme">
            <button aria-label="Auto theme (follow system)" aria-pressed={themeMode === "system"} className={themeMode === "system" ? "active" : ""} onClick={() => setThemeMode("system")} title="Auto (system)" type="button">
              <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16"><rect height="14" rx="2" ry="2" width="20" x="2" y="3"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
            </button>
            <button aria-label="Light theme" aria-pressed={themeMode === "light"} className={themeMode === "light" ? "active" : ""} onClick={() => setThemeMode("light")} title="Light" type="button">
              <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16"><circle cx="12" cy="12" r="5"/><line x1="12" x2="12" y1="1" y2="3"/><line x1="12" x2="12" y1="21" y2="23"/><line x1="4.22" x2="5.64" y1="4.22" y2="5.64"/><line x1="18.36" x2="19.78" y1="18.36" y2="19.78"/><line x1="1" x2="3" y1="12" y2="12"/><line x1="21" x2="23" y1="12" y2="12"/><line x1="4.22" x2="5.64" y1="19.78" y2="18.36"/><line x1="18.36" x2="19.78" y1="5.64" y2="4.22"/></svg>
            </button>
            <button aria-label="Dark theme" aria-pressed={themeMode === "dark"} className={themeMode === "dark" ? "active" : ""} onClick={() => setThemeMode("dark")} title="Dark" type="button">
              <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            </button>
          </div>
        </div>
      </header>

      <div aria-labelledby="explore-tab" className="view-panel explore-panel" hidden={activeView !== "explore"} id="explore-panel" role="region">
        <section className="explore-hero" id="explore-top">
          <div className="explore-hero-main">
            <h1 id="explore-top-heading" tabIndex={-1}>Compare AI APIs and plans.</h1>
            <p className="explore-hero-sub">Independent pricing calculator, tier lists, and break-even limits across leading foundation models.</p>
            <div className="hero-stats-strip">
              <span><strong>{models.length}</strong> API models</span>
              <span className="dot-sep">·</span>
              <span><strong>{plans.filter((p) => p.kind === "Subscription").length}</strong> subscriptions</span>
              <span className="dot-sep">·</span>
              <span><strong>{scenarios.length}</strong> workload presets</span>
            </div>
          </div>
          <button className="button button-ghost hero-cta" onClick={useExploreProfile} type="button">
            Get a recommendation <span>→</span>
          </button>
        </section>

        <div className="explore-workspace">
          <aside aria-labelledby="profile-preset-title" className="scenario-dock">
            <header className="scenario-dock-heading">
              <span>Profile preset</span>
              <h2 id="profile-preset-title">{exploreScenario.label}</h2>
            </header>
            <label className="scenario-dock-select" htmlFor="explore-scenario">
              <span>Use case</span>
              <select id="explore-scenario" value={exploreScenarioId} onChange={(event) => setExploreScenarioId(event.target.value as ScenarioId)}>
                {scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <p className="scenario-dock-description">{exploreScenario.description}</p>
            <div className="preset-call" aria-label={`${exploreScenario.input.toLocaleString()} input and ${exploreScenario.output.toLocaleString()} output tokens per estimated call`}>
              <span>Preset per API call</span>
              <strong>{exploreScenario.input.toLocaleString()} input + {exploreScenario.output.toLocaleString()} output</strong>
            </div>
            <p className="scenario-dock-note">Used for the tier list and price estimates. Excludes tools, search, images, storage, taxes, and retries.</p>
            <button className="scenario-dock-action" onClick={() => { updateRecommendationProfile(exploreScenarioId); switchView("recommendation"); }} type="button">
              Customize in Recommend <span>→</span>
            </button>
          </aside>

          <div className="explore-content">
            <section className="section tier-section" id="tier-board">
              <div className="section-heading explore-section-heading">
                <div>
                  <span className="section-kicker">{exploreScenario.label}</span>
                  <h2>Tier list</h2>
                  <p>{exploreScenario.description}</p>
                </div>
                <div className="book-switch explore-lane-switch" role="group" aria-label="Tier list lane">
                  <button aria-pressed={exploreLane === "api"} className={exploreLane === "api" ? "active" : ""} onClick={() => switchExploreLane("api")} type="button">API models <span>{models.length}</span></button>
                  <button aria-pressed={exploreLane === "plans"} className={exploreLane === "plans" ? "active" : ""} onClick={() => switchExploreLane("plans")} type="button">Plans <span>{plans.filter((plan) => plan.kind === "Subscription").length}</span></button>
                </div>
              </div>

              <div className="tier-board">
                {(["S", "A", "B"] as const).map((tier) => (
                  <div className={`tier-row tier-${tier.toLowerCase()}`} key={tier}>
                    <div className="tier-label"><strong>{tier}</strong><span>{tierDescriptions[tier]}</span></div>
                    <div className="tier-models" role="group" aria-label={`${tier} tier items`}>
                      {(() => {
                        if (exploreLane === "api") {
                          const items = models
                            .filter((model) => model.tiers[exploreScenarioId] === tier)
                            .sort((a, b) => callCost(a, exploreSettings) - callCost(b, exploreSettings));
                          if (items.length === 0) {
                            return <p className="tier-empty">No models ranked in this tier for this scenario.</p>;
                          }
                          return items.map((item) => (
                            <button
                              aria-label={`${item.name}, ${item.provider}, ${price(callCost(item, exploreSettings), 3)} per call`}
                              className={`tier-model ${compareList.some((c) => c.id === item.id) ? "selected" : ""}`}
                              key={item.id}
                              onClick={() => setActiveDetailItem(item)}
                              type="button"
                            >
                              <span className="provider-orb" data-provider={item.provider} />
                              <span><strong title={item.name}>{item.name}</strong><small>{item.provider}</small></span>
                              <b>{price(callCost(item, exploreSettings), 3)}<small>/ call</small></b>
                            </button>
                          ));
                        }
                        const items = plans
                          .filter((plan) => plan.kind === "Subscription" && plan.tiers[exploreScenarioId] === tier)
                          .sort((a, b) => (a.monthly ?? Infinity) - (b.monthly ?? Infinity));
                        if (items.length === 0) {
                          return <p className="tier-empty">No plans ranked in this tier for this scenario.</p>;
                        }
                        return items.map((item) => (
                          <button
                            aria-label={`${item.name}, ${item.provider}, $${item.monthly} per month`}
                            className={`tier-model ${compareList.some((c) => c.id === item.id) ? "selected" : ""}`}
                            key={item.id}
                            onClick={() => setActiveDetailItem(item)}
                            type="button"
                          >
                            <span className="provider-orb" data-provider={item.provider} />
                            <span><strong title={item.name}>{item.name}</strong><small>{item.confidence} quota confidence</small></span>
                            <b>${item.monthly}<small>/ month</small></b>
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
                ))}
              </div>
              <p className="tier-note">API tiers combine task fit and cost. Plan tiers combine task fit, price, and quota confidence. Select a card to view specs or compare.</p>
            </section>

            <section className="section prices-section" id="prices">
              <div className="section-heading explore-section-heading">
                <div>
                  <span className="section-kicker">{exploreScenario.label}</span>
                  <h2>Price book</h2>
                  <p>Token rates, plan prices, credits, and published limits for this preset.</p>
                </div>
                <div className="book-switch explore-lane-switch" role="group" aria-label="Price book lane">
                  <button aria-pressed={exploreLane === "api"} className={exploreLane === "api" ? "active" : ""} onClick={() => switchExploreLane("api")} type="button">API rates <span>{models.length}</span></button>
                  <button aria-pressed={exploreLane === "plans"} className={exploreLane === "plans" ? "active" : ""} onClick={() => switchExploreLane("plans")} type="button">Plans &amp; access <span>{plans.length}</span></button>
                </div>
              </div>

              <div className="table-tools">
                <div className="table-tools-top">
                  <label className="search-field">
                    <Icon className="search-icon" name="search" size={15} />
                    <input
                      aria-label={`Search ${exploreLane}`}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={exploreLane === "api" ? "Search model or provider" : "Search plan, client, or provider"}
                      ref={searchInputRef}
                      type="search"
                      value={query}
                    />
                    <kbd className="search-shortcut-kbd">/</kbd>
                  </label>
                  <details className="columns-selector" ref={columnsSelectorRef}>
                    <summary className="columns-trigger">
                      <span>Columns ({exploreLane === "api" ? Object.values(visibleApiColumns).filter(Boolean).length + 1 : Object.values(visiblePlanColumns).filter(Boolean).length + 1})</span>
                      <Icon name="chevron-down" size={13} />
                    </summary>
                    <div className="columns-menu">
                      <div className="columns-menu-header">
                        <span>Show columns</span>
                        <button
                          className="columns-reset-btn"
                          onClick={() => {
                            if (exploreLane === "api") {
                              setVisibleApiColumns({ input: true, cached: true, output: true, context: true, fit: true, cost: true });
                            } else {
                              setVisiblePlanColumns({ type: true, price: true, quota: true, apiIncluded: true, equivalent: true, fit: true, evidence: true });
                            }
                          }}
                          type="button"
                        >
                          Reset
                        </button>
                      </div>
                      {exploreLane === "api"
                        ? (Object.keys(apiColumnLabels) as ApiColumnKey[]).map((col) => (
                            <label className="column-option" key={col}>
                              <input
                                checked={visibleApiColumns[col]}
                                onChange={(e) => setVisibleApiColumns((prev) => ({ ...prev, [col]: e.target.checked }))}
                                type="checkbox"
                              />
                              <span>{apiColumnLabels[col]}</span>
                            </label>
                          ))
                        : (Object.keys(planColumnLabels) as PlanColumnKey[]).map((col) => (
                            <label className="column-option" key={col}>
                              <input
                                checked={visiblePlanColumns[col]}
                                onChange={(e) => setVisiblePlanColumns((prev) => ({ ...prev, [col]: e.target.checked }))}
                                type="checkbox"
                              />
                              <span>{planColumnLabels[col]}</span>
                            </label>
                          ))}
                    </div>
                  </details>
                </div>

                <div className="provider-filters" role="group" aria-label="Filter by provider">
                  {(exploreLane === "api" ? providerNames : planProviderNames).map((name) => {
                    const isSelected = name === "All" ? selectedProviders.length === 0 : selectedProviders.includes(name);
                    return (
                      <button
                        aria-pressed={isSelected}
                        className={isSelected ? "active" : ""}
                        key={name}
                        onClick={() => toggleProvider(name)}
                        type="button"
                      >
                        {name}
                      </button>
                    );
                  })}
                  {selectedProviders.length > 0 && (
                    <button aria-label="Clear provider filters" className="provider-clear" onClick={() => setSelectedProviders([])} type="button">Clear</button>
                  )}
                </div>
              </div>

              <p className="table-scroll-hint">Scroll sideways to see all columns.</p>
              <div className="table-wrap">
                {exploreLane === "api" ? (
                  <table>
                    <caption className="visually-hidden">API rates and fit for {exploreScenario.label}</caption>
                    <thead>
                      <tr>
                        <th
                          aria-sort={sortBy === "name" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                          className="sortable-header"
                          onClick={() => handleHeaderSort("name")}
                          title="Sort by model name"
                        >
                          <span className="th-content">API model {sortBy === "name" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                        </th>
                        {visibleApiColumns.input && (
                          <th
                            aria-sort={sortBy === "input" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                            onClick={() => handleHeaderSort("input")}
                            title="Sort by input token rate"
                          >
                            <span className="th-content">Input / 1M {sortBy === "input" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                          </th>
                        )}
                        {visibleApiColumns.cached && (
                          <th
                            aria-sort={sortBy === "cached" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                            onClick={() => handleHeaderSort("cached")}
                            title="Sort by cached input rate"
                          >
                            <span className="th-content">Cached input {sortBy === "cached" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                          </th>
                        )}
                        {visibleApiColumns.output && (
                          <th
                            aria-sort={sortBy === "output" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                            onClick={() => handleHeaderSort("output")}
                            title="Sort by output token rate"
                          >
                            <span className="th-content">Output / 1M {sortBy === "output" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                          </th>
                        )}
                        {visibleApiColumns.context && (
                          <th
                            aria-sort={sortBy === "context" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                            onClick={() => handleHeaderSort("context")}
                            title="Sort by context window size"
                          >
                            <span className="th-content">Context {sortBy === "context" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                          </th>
                        )}
                        {visibleApiColumns.fit && (
                          <th
                            aria-sort={sortBy === "fit" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                            onClick={() => handleHeaderSort("fit")}
                            title="Sort by scenario fit"
                          >
                            <span className="th-content">Fit {sortBy === "fit" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                          </th>
                        )}
                        {visibleApiColumns.cost && (
                          <th
                            aria-sort={sortBy === "cost" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                            onClick={() => handleHeaderSort("cost")}
                            title="Sort by estimated per-call cost"
                          >
                            <span className="th-content">Est. / call {sortBy === "cost" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleModels.map((model) => {
                        const callCostValue = callCost(model, exploreSettings);
                        return (
                          <tr key={model.id}>
                            <td className="sticky-col">
                              <div className="table-item-cell">
                                <span className="provider-orb" data-provider={model.provider} />
                                <div className="model-cell">
                                  <div className="model-cell-header">
                                    <button className="table-item-name-btn" onClick={() => setActiveDetailItem(model)} type="button"><strong>{model.name}</strong></button>
                                  </div>
                                  <div className="model-cell-sub">
                                    <small>{model.provider}</small>
                                    {model.note && <details className="row-note"><summary>Note</summary><p>{model.note}</p></details>}
                                  </div>
                                </div>
                                <a aria-label={`Official pricing source for ${model.name}`} className="source-link" href={model.source} rel="noreferrer" target="_blank" title="Open official pricing source">
                                  <Icon name="external" size={13} />
                                </a>
                              </div>
                            </td>
                            {visibleApiColumns.input && <td>{price(model.input)}</td>}
                            {visibleApiColumns.cached && <td>{model.cached === null ? "—" : price(model.cached, 4)}</td>}
                            {visibleApiColumns.output && <td>{price(model.output)}</td>}
                            {visibleApiColumns.context && <td>{model.context}</td>}
                            {visibleApiColumns.fit && <td><span className={`mini-tier ${model.tiers[exploreScenarioId] === "—" ? "tier-na" : `tier-${model.tiers[exploreScenarioId].toLowerCase()}`}`}>{model.tiers[exploreScenarioId]}</span></td>}
                            {visibleApiColumns.cost && <td><strong>{price(callCostValue, 3)}</strong></td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <table className="plan-table">
                    <caption className="visually-hidden">Plan prices, quotas, and fit for {exploreScenario.label}</caption>
                    <thead>
                      <tr>
                        <th
                          aria-sort={sortBy === "name" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                          className="sortable-header"
                          onClick={() => handleHeaderSort("name")}
                          title="Sort by plan name"
                        >
                          <span className="th-content">Plan or access path {sortBy === "name" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                        </th>
                        {visiblePlanColumns.type && (
                          <th
                            aria-sort={sortBy === "type" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                            onClick={() => handleHeaderSort("type")}
                            title="Sort by plan type"
                          >
                            <span className="th-content">Type {sortBy === "type" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                          </th>
                        )}
                        {visiblePlanColumns.price && (
                          <th
                            aria-sort={sortBy === "price" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                            onClick={() => handleHeaderSort("price")}
                            title="Sort by monthly price"
                          >
                            <span className="th-content">Price {sortBy === "price" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                          </th>
                        )}
                        {visiblePlanColumns.quota && <th>Published quota</th>}
                        {visiblePlanColumns.apiIncluded && <th>API included?</th>}
                        {visiblePlanColumns.equivalent && <th>API-cost equivalent</th>}
                        {visiblePlanColumns.fit && (
                          <th
                            aria-sort={sortBy === "fit" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                            onClick={() => handleHeaderSort("fit")}
                            title="Sort by scenario fit"
                          >
                            <span className="th-content">Fit {sortBy === "fit" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                          </th>
                        )}
                        {visiblePlanColumns.evidence && (
                          <th
                            aria-sort={sortBy === "confidence" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                            className="sortable-header"
                            onClick={() => handleHeaderSort("confidence")}
                            title="Sort by quota confidence"
                          >
                            <span className="th-content">Evidence {sortBy === "confidence" && <Icon name={sortDirection === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePlans.map((plan) => {
                        const estimate = planEstimate(plan, exploreSettings);
                        return (
                          <tr key={plan.id}>
                            <td className="sticky-col">
                              <div className="table-item-cell">
                                <span className="provider-orb" data-provider={plan.provider} />
                                <div className="model-cell">
                                  <div className="model-cell-header">
                                    <button className="table-item-name-btn" onClick={() => setActiveDetailItem(plan)} type="button"><strong>{plan.name}</strong></button>
                                  </div>
                                  <div className="model-cell-sub">
                                    <small>{plan.provider}</small>
                                    <details className="row-note"><summary>Note</summary><p>{plan.note}</p></details>
                                  </div>
                                </div>
                                <a aria-label={`Official source for ${plan.name}`} className="source-link" href={plan.source} rel="noreferrer" target="_blank" title="Open official plan source">
                                  <Icon name="external" size={13} />
                                </a>
                              </div>
                            </td>
                            {visiblePlanColumns.type && <td><span className="kind-pill">{plan.kind}</span></td>}
                            {visiblePlanColumns.price && <td><strong>{planPrice(plan)}</strong>{plan.kind === "Subscription" && <small className="per-month"> / mo</small>}</td>}
                            {visiblePlanColumns.quota && <td className="wrap-cell">{planQuota(plan, exploreScenarioId)}</td>}
                            {visiblePlanColumns.apiIncluded && <td>{plan.apiIncluded}</td>}
                            {visiblePlanColumns.equivalent && <td>{estimate ? <><strong>{formatEstimateRange(estimate.callsLow, estimate.callsHigh)} calls</strong><small className="estimate-detail">{formatMoneyRange(estimate.valueLow, estimate.valueHigh)} · {estimate.basis}</small></> : <span className="muted-dash">Your API bill</span>}</td>}
                            {visiblePlanColumns.fit && <td><span className={`mini-tier ${plan.tiers[exploreScenarioId] === "—" ? "tier-na" : `tier-${plan.tiers[exploreScenarioId].toLowerCase()}`}`}>{plan.tiers[exploreScenarioId]}</span></td>}
                            {visiblePlanColumns.evidence && <td><span className={`evidence-badge evidence-${plan.confidence.toLowerCase()}`}>{plan.confidence}</span><small className="estimate-detail">{plan.evidence}</small></td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {(exploreLane === "api" ? visibleModels.length : visiblePlans.length) === 0 && (
                  <div className="empty-state">
                    <p>No entries match that search or provider filter.</p>
                    <button className="button button-ghost" onClick={() => { setQuery(""); setSelectedProviders([]); }} type="button">Clear search and filters</button>
                  </div>
                )}
              </div>
              <p className="book-note"><strong>Subscription access is not production API credit.</strong> An API-cost equivalent is not a usage quota unless the provider publishes credits or limits.</p>

              <details className="methodology-accordion" id="methodology">
                <summary>How estimates and equivalents work</summary>
                <div className="methodology-grid">
                  <div className="methodology-card">
                    <strong>1. Token Cost Math</strong>
                    <p>Per-call costs calculate exact published input, cached input, and output token rates divided by 1,000,000.</p>
                  </div>
                  <div className="methodology-card">
                    <strong>2. Prompt Cache Ratios</strong>
                    <p>Plans that utilize prompt caching (e.g. Cursor, Claude, GPT) apply calibrated cache-hit discounts to repeated context.</p>
                  </div>
                  <div className="methodology-card">
                    <strong>3. Quota Conversions</strong>
                    <p>Weekly credits and 5-hour rolling quotas are normalized to 30-day monthly equivalents based on active hours.</p>
                  </div>
                  <div className="methodology-card">
                    <strong>4. Price Break-Even Caveat</strong>
                    <p>Where hard limits are not published, break-even indicates where API spend matches subscription price, not guaranteed throughput.</p>
                  </div>
                </div>
              </details>

              <details className="sources price-sources" id="price-sources">
                <summary>Primary pricing and quota sources</summary>
                <div>
                  <a href="https://developers.openai.com/api/docs/models/compare" target="_blank" rel="noreferrer">OpenAI API ↗</a>
                  <a href="https://learn.chatgpt.com/docs/pricing" target="_blank" rel="noreferrer">ChatGPT plans ↗</a>
                  <a href="https://claude.com/pricing" target="_blank" rel="noreferrer">Claude API ↗</a>
                  <a href="https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan" target="_blank" rel="noreferrer">Claude plan credit ↗</a>
                  <a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">Gemini API ↗</a>
                  <a href="https://developers.google.com/profile/help/benefits" target="_blank" rel="noreferrer">Google plan credits ↗</a>
                  <a href="https://cursor.com/docs/models-and-pricing" target="_blank" rel="noreferrer">Cursor pools ↗</a>
                  <a href="https://opencode.ai/docs/go/" target="_blank" rel="noreferrer">OpenCode Go ↗</a>
                  <a href="https://opencode.ai/docs/zen/" target="_blank" rel="noreferrer">OpenCode Zen ↗</a>
                  <a href="https://docs.z.ai/guides/overview/pricing" target="_blank" rel="noreferrer">GLM API ↗</a>
                  <a href="https://docs.z.ai/devpack/overview" target="_blank" rel="noreferrer">GLM Coding plans ↗</a>
                  <a href="https://www.kimi.com/help/membership/membership-pricing" target="_blank" rel="noreferrer">Kimi membership ↗</a>
                  <a href="https://www.kimi.com/en/resources/kimi-k2-7-code" target="_blank" rel="noreferrer">Kimi API ↗</a>
                  <a href="https://api-docs.deepseek.com/quick_start/pricing/" target="_blank" rel="noreferrer">DeepSeek API ↗</a>
                  <a href="https://docs.x.ai/developers/pricing" target="_blank" rel="noreferrer">xAI API ↗</a>
                  <a href="https://x.ai/pricing" target="_blank" rel="noreferrer">Grok plans ↗</a>
                  <a href="https://mistral.ai/pricing/" target="_blank" rel="noreferrer">Mistral plans ↗</a>
                  <a href="https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you" target="_blank" rel="noreferrer">Perplexity plans ↗</a>
                </div>
              </details>
            </section>
          </div>
        </div>
      </div>

      <div aria-labelledby="recommendation-tab" className="view-panel recommendation-panel" hidden={activeView !== "recommendation"} id="recommendation-panel" role="region">
        <section className="recommendation-view" id="recommendation-top">
          <header className="recommendation-header">
            <div>
              <span>Custom comparison</span>
              <h1 id="recommendation-top-heading" tabIndex={-1}>Your recommendation</h1>
            </div>
            <p>Set your workload, calls, and budget. The best API and plan update immediately.</p>
          </header>

          <div className={`decision-banner recommendation-summary decision-${preferredPath}`} aria-live="polite">
            <div className="decision-banner-header">
              <div className="decision-banner-badge-group">
                <span className="best-path-badge">BEST PATH</span>
                {!apiWithinBudget && (
                  <div className="decision-fallback-note">
                    <Icon name="warning" size={13} />
                    <span>No model fits within ${monthlyBudget.toLocaleString()}/mo. Showing cheapest option ({apiRecommendation.name}).</span>
                  </div>
                )}
              </div>
              <button
                className="copy-link-btn"
                onClick={handleCopyLink}
                title="Copy shareable link to this recommendation"
                type="button"
              >
                <Icon name={copiedLink ? "check" : "copy"} size={14} />
                <span>{copiedLink ? "Link copied" : "Copy link"}</span>
              </button>
            </div>

            <div className="decision-facts-strip">
              <div className="decision-fact">
                <small>Monthly API Spend</small>
                <strong>{monthlyPrice(recommendedApiSpend)}</strong>
                <span>{apiRecommendation.name}</span>
              </div>
              <div className="decision-fact">
                <small>Plan Cost &amp; Quota</small>
                <strong>${recommendedPlanPrice}/mo</strong>
                <span>{planRecommendation.name} (~{recommendedPlanCalls} calls)</span>
              </div>
              <div className="decision-fact">
                <small>Difference</small>
                <strong>{sameMonthlyPrice ? "Same price" : `${monthlyPrice(Math.abs(apiPlanDifference))}/mo`}</strong>
                <span>{sameMonthlyPrice ? "Same monthly cost" : apiPlanDifference < 0 ? "API is more cost-effective" : "Plan is more cost-effective"}</span>
              </div>
            </div>
            <p className="decision-verdict-caption">{diffFactCaption}</p>
          </div>

          <div className="recommendation-workspace">
            <section className="settings-card" id="recommendation-settings" aria-labelledby="settings-title">
              <div className="settings-heading"><h2 id="settings-title">Your settings</h2></div>
              <div className="settings-body">
                <fieldset>
                  <legend>Workload</legend>
                  <div className="custom-settings-grid">
                    <label>
                      <span>Work type</span>
                      <select id="recommendation-profile" value={recommendationScenarioId} onChange={(event) => updateRecommendationProfile(event.target.value as ScenarioId)}>
                        {scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Input tokens / call</span>
                      <input inputMode="numeric" min="1" max="1000000" type="number" value={recommendationInputTokens} onChange={(event) => setRecommendationInputTokens(Math.min(1_000_000, Math.max(1, Number(event.target.value) || 1)))} />
                      <div className="preset-chips" role="group" aria-label="Input token presets">
                        {[2000, 18000, 50000, 100000].map((val) => (
                          <button key={val} type="button" className={`preset-chip ${recommendationInputTokens === val ? "active" : ""}`} onClick={() => setRecommendationInputTokens(val)}>
                            {val >= 1000 ? `${val / 1000}K` : val}
                          </button>
                        ))}
                      </div>
                    </label>
                    <label>
                      <span>Output tokens / call</span>
                      <input inputMode="numeric" min="1" max="500000" type="number" value={recommendationOutputTokens} onChange={(event) => setRecommendationOutputTokens(Math.min(500_000, Math.max(1, Number(event.target.value) || 1)))} />
                      <div className="preset-chips" role="group" aria-label="Output token presets">
                        {[500, 2000, 6000, 15000].map((val) => (
                          <button key={val} type="button" className={`preset-chip ${recommendationOutputTokens === val ? "active" : ""}`} onClick={() => setRecommendationOutputTokens(val)}>
                            {val >= 1000 ? `${val / 1000}K` : val}
                          </button>
                        ))}
                      </div>
                    </label>
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Monthly needs</legend>
                  <div className="custom-settings-grid">
                    <label>
                      <span>Calls / month</span>
                      <input inputMode="numeric" min="1" max="100000" type="number" value={monthlyCalls} onChange={(event) => setMonthlyCalls(Math.min(100_000, Math.max(1, Number(event.target.value) || 1)))} />
                    </label>
                    <label>
                      <span>Budget / month</span>
                      <input inputMode="numeric" min="1" max="10000" type="number" value={monthlyBudget} onChange={(event) => setMonthlyBudget(Math.min(10_000, Math.max(1, Number(event.target.value) || 1)))} />
                    </label>
                    <label>
                      <span>Preference</span>
                      <select value={preference} onChange={(event) => setPreference(event.target.value as Preference)}>
                        <option value="either">Compare both</option>
                        <option value="api">API first</option>
                        <option value="plans">Plan first</option>
                      </select>
                    </label>
                  </div>
                </fieldset>
                <p className="settings-note">
                  <span><strong>Work type</strong> controls task-fit and quota class.</span>
                  <br />
                  <span><strong>Token fields</strong> control API cost and plan-equivalent estimates.</span>
                </p>
              </div>
            </section>

            <section className="recommendation-card recommendation-output" aria-labelledby="recommendation-title">
              <div className="settings-heading"><h2 id="recommendation-title">Best path</h2></div>
              <div className="recommendation-grid">
                <article className={preferredPath === "api" ? "path-card primary" : "path-card"}>
                  <div className="path-card-label"><span>BEST API</span><span className={`mini-tier tier-${apiRecommendation.tiers[recommendationScenarioId].toLowerCase()}`}>{apiRecommendation.tiers[recommendationScenarioId]}</span></div>
                  <div className="path-title">
                    <span className="provider-orb" data-provider={apiRecommendation.provider} />
                    <div><strong>{apiRecommendation.name}</strong><small>{apiRecommendation.provider} · direct API</small></div>
                    {preferredPath === "api" && <span className="recommendation-badge">Best</span>}
                  </div>
                  <p className="path-price" title={`${price(recommendedApiSpend)} per month`}>{monthlyPrice(recommendedApiSpend)}<span>/ month</span></p>
                  <dl><div><dt>Per call</dt><dd>{price(callCost(apiRecommendation, recommendationSettings), 3)}</dd></div><div><dt>Budget</dt><dd>{apiWithinBudget ? "Fits" : `Over by ${monthlyPrice(recommendedApiSpend - monthlyBudget)}`}</dd></div><div><dt>Basis</dt><dd>Published token rates</dd></div></dl>
                  <div className="path-card-verdict"><p>{apiRecommendation.name} is estimated at {monthlyPrice(recommendedApiSpend)}/mo for {monthlyCalls.toLocaleString()} calls.</p></div>
                </article>

                <article className={preferredPath === "plans" ? "path-card primary" : "path-card"}>
                  <div className="path-card-label"><span>BEST PLAN</span><span className={`mini-tier tier-${planRecommendation.tiers[recommendationScenarioId].toLowerCase()}`}>{planRecommendation.tiers[recommendationScenarioId]}</span></div>
                  <div className="path-title">
                    <span className="provider-orb" data-provider={planRecommendation.provider} />
                    <div><strong>{planRecommendation.name}</strong><small>{planRecommendation.provider} · subscription</small></div>
                    {preferredPath === "plans" && <span className="recommendation-badge">Best</span>}
                  </div>
                  <p className="path-price">${planRecommendation.monthly}<span>/ month</span></p>
                  <dl><div><dt>{recommendedPlanEstimate.basis === "Price break-even only" ? "API-cost parity" : "Est. capacity"}</dt><dd>{formatEstimateRange(recommendedPlanEstimate.callsLow, recommendedPlanEstimate.callsHigh)} calls</dd></div><div><dt>Published quota</dt><dd>{planQuota(planRecommendation, recommendationScenarioId)}</dd></div><div><dt>Confidence</dt><dd>{planRecommendation.confidence} · {recommendedPlanEstimate.basis}</dd></div></dl>
                  {(planRecommendation.confidence === "Low" || recommendedPlanEstimate.basis === "Price break-even only") && (
                    <div className="confidence-caveat-badge">
                      <Icon name="warning" size={13} />
                      <span>Low confidence quota</span>
                    </div>
                  )}
                  <div className="path-card-verdict"><p>{planRecommendation.name}: ${planRecommendation.monthly}/month · {recommendedPlanCoverage === null ? "published quota cannot be converted to this profile" : `estimated ${recommendedPlanCalls} calls for this profile`}.</p></div>
                </article>
              </div>
            </section>
          </div>

          <section className="unified-comparison-card" aria-labelledby="unified-comparison-title">
            <div className="unified-comparison-header">
              <div className="unified-comparison-heading">
                <span>Detailed Comparison</span>
                <h2 id="unified-comparison-title">
                  {recComparisonTab === "api" ? "Monthly cost by model" : "Plan cost and quota comparison"}
                </h2>
                <p className="unified-comparison-meta">
                  {monthlyCalls.toLocaleString()} calls · {recommendationInputTokens.toLocaleString()} in + {recommendationOutputTokens.toLocaleString()} out · ${monthlyBudget.toLocaleString()} budget
                </p>
              </div>
              <div className="book-switch comparison-lane-switch" role="group" aria-label="Detailed comparison lane">
                <button aria-pressed={recComparisonTab === "api"} className={recComparisonTab === "api" ? "active" : ""} onClick={() => setRecComparisonTab("api")} type="button">API <span>{rankedModelCosts.length}</span></button>
                <button aria-pressed={recComparisonTab === "plans"} className={recComparisonTab === "plans" ? "active" : ""} onClick={() => setRecComparisonTab("plans")} type="button">Plans <span>{rankedPlanOptions.length}</span></button>
              </div>
            </div>

            {recComparisonTab === "api" ? (
              <div className="model-cost-columns">
                {rankedModelCosts.map(({ model, perCall, monthly }) => {
                  const recommended = model.id === apiRecommendation.id;
                  const tier = model.tiers[recommendationScenarioId];
                  const ratio = Math.min(1, monthly / maxRankedMonthly);
                  return (
                    <article className={`model-cost-row ${recommended ? "recommended" : ""}`} key={model.id}>
                      <div className="cost-row-bar" style={{ width: `${Math.max(3, Math.round(ratio * 100))}%` }} />
                      <div className="cost-model">
                        <span className="provider-orb" data-provider={model.provider} />
                        <div>
                          <button className="table-item-name-btn" onClick={() => setActiveDetailItem(model)} type="button"><strong>{model.name}</strong></button>
                          <small>{model.provider} · {tier === "—" ? "Not ranked" : `${tier} tier`}</small>
                        </div>
                        {recommended && <span className="recommendation-badge">Best API</span>}
                      </div>
                      <div className="cost-total">
                        <strong title={price(monthly)}>{monthlyPrice(monthly)}</strong>
                        <span>{price(perCall, 4)} / call</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="plan-match-grid">
                  {rankedPlanOptions.slice(0, showAllPlans ? rankedPlanOptions.length : 6).map(({ plan, estimate, coverage, withinBudget }, index) => (
                    <article className={`plan-match-card ${index === 0 ? "recommended" : ""}`} key={plan.id}>
                      <div className="plan-match-title">
                        <span className="provider-orb" data-provider={plan.provider} />
                        <div>
                          <button className="table-item-name-btn" onClick={() => setActiveDetailItem(plan)} type="button"><strong>{plan.name}</strong></button>
                          <small>{plan.provider}</small>
                        </div>
                        {index === 0 && <span className="recommendation-badge">Best plan</span>}
                      </div>
                      <p className="plan-match-price">${plan.monthly}<span>/ month</span></p>
                      <dl>
                        <div><dt>Budget</dt><dd>{withinBudget ? "Fits" : "Over budget"}</dd></div>
                        <div><dt>{estimate.basis === "Price break-even only" ? "API-cost parity" : "Est. capacity"}</dt><dd>{formatEstimateRange(estimate.callsLow, estimate.callsHigh)} calls</dd></div>
                        <div><dt>Your {monthlyCalls.toLocaleString()}-call target</dt><dd>{coverage === null ? "Cannot verify" : coverage === 100 ? "Estimated to cover" : coverage >= 70 ? "May cover at upper estimate" : "Below target"}</dd></div>
                        <div><dt>Evidence</dt><dd>{plan.confidence} · {plan.evidence}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
                {rankedPlanOptions.length > 6 && (
                  <button className="show-more-btn" onClick={() => setShowAllPlans((prev) => !prev)} type="button">
                    {showAllPlans ? "Show fewer plans" : `Show all ${rankedPlanOptions.length} plans`}
                  </button>
                )}
                <p className="plan-match-note">Price break-even shows economic parity only. It is not a promised quota unless the provider publishes credits or limits.</p>
              </>
            )}
          </section>
        </section>
      </div>

      <div aria-labelledby="rank-tab" className="view-panel rank-panel" hidden={activeView !== "rank"} id="rank-panel" role="region">
        <RankPlans plans={rankablePlans} />
      </div>

      <Modal
        isOpen={activeDetailItem !== null}
        maxWidth="640px"
        onClose={() => setActiveDetailItem(null)}
        title={
          activeDetailItem && (
            <>
              <span className="provider-orb" data-provider={activeDetailItem.provider} />
              <div>
                <h3 id="detail-modal-title">{activeDetailItem.name}</h3>
                <small>{activeDetailItem.provider} · {"kind" in activeDetailItem ? activeDetailItem.kind : "Foundation Model"}</small>
              </div>
            </>
          )
        }
        titleId="detail-modal-title"
      >
        {activeDetailItem && (
          <>
            <div className="detail-modal-body">
              {"input" in activeDetailItem ? (
                <div className="detail-specs-grid">
                  <div className="spec-box"><small>Input Rate</small><strong>{price(activeDetailItem.input)} / 1M</strong></div>
                  <div className="spec-box"><small>Cached Input</small><strong>{activeDetailItem.cached !== null ? `${price(activeDetailItem.cached, 4)} / 1M` : "—"}</strong></div>
                  <div className="spec-box"><small>Output Rate</small><strong>{price(activeDetailItem.output)} / 1M</strong></div>
                  <div className="spec-box"><small>Context Window</small><strong>{activeDetailItem.context}</strong></div>
                  <div className="spec-box"><small>Est. Call Cost ({exploreScenario.label})</small><strong>{price(callCost(activeDetailItem, exploreSettings), 4)}</strong></div>
                  <div className="spec-box"><small>{monthlyCalls.toLocaleString()} Calls / Month</small><strong>{monthlyPrice(callCost(activeDetailItem, exploreSettings) * monthlyCalls)}</strong></div>
                </div>
              ) : (
                <div className="detail-specs-grid">
                  <div className="spec-box"><small>Monthly Price</small><strong>{planPrice(activeDetailItem)}</strong></div>
                  <div className="spec-box"><small>Quota Evidence</small><strong>{activeDetailItem.confidence} ({activeDetailItem.evidence})</strong></div>
                  <div className="spec-box"><small>Underlying Model</small><strong>{models.find((m) => m.id === activeDetailItem.modelId)?.name ?? activeDetailItem.modelId}</strong></div>
                  <div className="spec-box"><small>API Included?</small><strong>{activeDetailItem.apiIncluded}</strong></div>
                  <div className="spec-box full-span"><small>Published Quota / Rule</small><strong>{planQuota(activeDetailItem, exploreScenarioId)}</strong></div>
                </div>
              )}

              {activeDetailItem.note && (
                <div className="modal-note-box">
                  <strong>Notes &amp; Limitations:</strong>
                  <p>{activeDetailItem.note}</p>
                </div>
              )}

              <div className="modal-scenario-fits">
                <strong>Scenario Fit Ratings:</strong>
                <div className="scenario-fits-list">
                  {scenarios.map((sc) => (
                    <div className="scenario-fit-item" key={sc.id}>
                      <span>{sc.label}</span>
                      <span className={`mini-tier tier-${activeDetailItem.tiers[sc.id].toLowerCase()}`}>{activeDetailItem.tiers[sc.id]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <footer className="detail-modal-footer">
              <button
                className={`button ${compareList.some((c) => c.id === activeDetailItem.id) ? "button-primary" : "button-ghost"}`}
                onClick={() => toggleCompare(activeDetailItem)}
                type="button"
              >
                {compareList.some((c) => c.id === activeDetailItem.id) ? "In compare tray" : "+ Add to compare"}
              </button>
              <a className="button button-ghost" href={activeDetailItem.source} rel="noreferrer" target="_blank">
                <span>Official source</span>
                <Icon name="external" size={14} />
              </a>
            </footer>
          </>
        )}
      </Modal>

      {compareList.length > 0 && (
        <aside aria-label="Item comparison tray" className="compare-floating-tray">
          <div className="compare-tray-content">
            <div className="compare-tray-items">
              <span className="compare-tray-label">Compare {isComparingPlans ? "plans" : "models"} ({compareList.length}/3):</span>
              {compareList.map((item) => (
                <span className="compare-item-tag" key={item.id}>
                  <span className="provider-orb" data-provider={item.provider} />
                  <strong>{item.name}</strong>
                  <button aria-label={`Remove ${item.name} from comparison`} onClick={() => toggleCompare(item)} type="button">
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="compare-tray-actions">
              <button className="button button-primary" onClick={() => setShowCompareModal(true)} type="button">
                Compare side-by-side
              </button>
              <button className="button button-ghost" onClick={() => setCompareList([])} type="button">
                Clear
              </button>
            </div>
          </div>
        </aside>
      )}

      <Modal
        isOpen={showCompareModal}
        maxWidth="900px"
        onClose={() => setShowCompareModal(false)}
        title={
          <div>
            <h3 id="compare-modal-title">Side-by-side comparison ({isComparingPlans ? "Plans" : "Models"} · {exploreScenario.label})</h3>
          </div>
        }
        titleId="compare-modal-title"
      >
        <div className="compare-modal-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Attribute</th>
                {compareList.map((item) => (
                  <th key={item.id}>
                    <div className="compare-th-item">
                      <span className="provider-orb" data-provider={item.provider} />
                      <strong>{item.name}</strong>
                      <small>{item.provider}</small>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!isComparingPlans ? (
                <>
                  <tr>
                    <td>Input / 1M</td>
                    {compareList.map((item) => (
                      <td key={item.id}>{"input" in item ? <strong>{price(item.input)}</strong> : null}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>Cached Input / 1M</td>
                    {compareList.map((item) => (
                      <td key={item.id}>{"cached" in item ? (item.cached !== null ? price(item.cached, 4) : "—") : null}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>Output / 1M</td>
                    {compareList.map((item) => (
                      <td key={item.id}>{"output" in item ? <strong>{price(item.output)}</strong> : null}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>Context Window</td>
                    {compareList.map((item) => (
                      <td key={item.id}>{"context" in item ? item.context : null}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>Est. Cost / Call ({exploreScenario.label})</td>
                    {compareList.map((item) => (
                      <td key={item.id}>{"input" in item ? <strong>{price(callCost(item, exploreSettings), 4)}</strong> : null}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>{monthlyCalls.toLocaleString()} Calls / Month</td>
                    {compareList.map((item) => (
                      <td key={item.id}>{"input" in item ? <strong>{monthlyPrice(callCost(item, exploreSettings) * monthlyCalls)}</strong> : null}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>Scenario Fit ({exploreScenario.label})</td>
                    {compareList.map((item) => (
                      <td key={item.id}>
                        <span className={`mini-tier tier-${item.tiers[exploreScenarioId].toLowerCase()}`}>{item.tiers[exploreScenarioId]}</span>
                      </td>
                    ))}
                  </tr>
                </>
              ) : (
                <>
                  <tr>
                    <td>Plan Type</td>
                    {compareList.map((item) => (
                      <td key={item.id}>{"kind" in item ? <span className="kind-pill">{item.kind}</span> : null}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>Monthly Price</td>
                    {compareList.map((item) => (
                      <td key={item.id}>{"monthly" in item ? <strong>{planPrice(item as Plan)}</strong> : null}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>Published Quota</td>
                    {compareList.map((item) => (
                      <td key={item.id}>{"quota" in item ? planQuota(item as Plan, exploreScenarioId) : null}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>API Included?</td>
                    {compareList.map((item) => (
                      <td key={item.id}>{"apiIncluded" in item ? item.apiIncluded : null}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>Equivalent Calls ({exploreScenario.label})</td>
                    {compareList.map((item) => {
                      if (!("kind" in item)) return <td key={item.id}>—</td>;
                      const est = planEstimate(item as Plan, exploreSettings);
                      return (
                        <td key={item.id}>
                          {est ? <strong>{formatEstimateRange(est.callsLow, est.callsHigh)} calls</strong> : "—"}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td>Quota Evidence</td>
                    {compareList.map((item) => (
                      <td key={item.id}>
                        {"confidence" in item ? <span className={`evidence-badge evidence-${item.confidence.toLowerCase()}`}>{item.confidence}</span> : null}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Scenario Fit ({exploreScenario.label})</td>
                    {compareList.map((item) => (
                      <td key={item.id}>
                        <span className={`mini-tier tier-${item.tiers[exploreScenarioId].toLowerCase()}`}>{item.tiers[exploreScenarioId]}</span>
                      </td>
                    ))}
                  </tr>
                </>
              )}
              <tr>
                <td>Official Source</td>
                {compareList.map((item) => (
                  <td key={item.id}>
                    <a className="button button-ghost" href={item.source} rel="noreferrer" target="_blank">
                      <span>Source</span>
                      <Icon name="external" size={13} />
                    </a>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Modal>

      {showBackToTop && compareList.length === 0 && (
        <button
          aria-label="Back to top"
          className="back-to-top-btn"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          type="button"
        >
          <Icon name="arrow-up" size={14} />
          <span>Top</span>
        </button>
      )}

      <footer className="site-footer">
        <div className="footer-top">
          <a className="brand" href={activeView === "explore" ? "#explore-top" : activeView === "recommendation" ? "#recommendation-top" : "#rank-top"} onClick={(e) => { e.preventDefault(); switchView(activeView); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            <span className="brand-mark">T/T</span>
            <span>TokenTier</span>
          </a>
          <nav className="footer-nav" aria-label="Footer navigation">
            <a href="#methodology" onClick={(e) => handleFooterNav(e, "methodology")}>Methodology</a>
            <a href="#prices" onClick={(e) => handleFooterNav(e, "prices")}>Price book</a>
            <a href="#price-sources" onClick={(e) => handleFooterNav(e, "price-sources")}>Sources</a>
            <a href="https://github.com/majinwakeup/tokentier" rel="noreferrer" target="_blank">
              <span>GitHub</span>
              <Icon name="external" size={13} />
            </a>
            <a href="https://github.com/majinwakeup/tokentier/issues" rel="noreferrer" target="_blank">
              <span>Report correction</span>
              <Icon name="external" size={13} />
            </a>
          </nav>
        </div>
        <div className="footer-bottom">
          <p className="footer-identity">© 2026 Jin Ma · Open-source code under MIT · Independent project</p>
          <span className="footer-freshness">Data updated {pricingUpdatedAt}</span>
        </div>
      </footer>
    </main>
  );
}

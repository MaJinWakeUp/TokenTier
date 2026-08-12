"use client";

import modelCatalog from "@/data/api-models.json";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

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
type View = "explore" | "recommendation";
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
    description: "Multi-file features, debugging, and tool-assisted iteration.",
  },
  {
    id: "code-hard",
    label: "Hard coding",
    input: 60000,
    output: 18000,
    description: "Repository-scale reasoning, migrations, and agentic work.",
  },
  {
    id: "research",
    label: "Research",
    input: 35000,
    output: 10000,
    description: "Long documents, synthesis, source finding, and open questions.",
  },
  {
    id: "writing",
    label: "Paper writing",
    input: 50000,
    output: 14000,
    description: "Literature context, structure, revision, and long-form drafting.",
  },
  {
    id: "innovation",
    label: "Innovation",
    input: 12000,
    output: 4000,
    description: "Divergent ideation, critique, reframing, and concept development.",
  },
];

const models = modelCatalog.models as unknown as Model[];
const pricingUpdatedAt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(`${modelCatalog.updatedAt}T00:00:00Z`));

const planTiers = (
  daily: Tier,
  easy: Tier,
  medium: Tier,
  hard: Tier,
  research: Tier,
  writing: Tier,
  innovation: Tier,
): Record<ScenarioId, Tier> => ({
  daily,
  "code-easy": easy,
  "code-medium": medium,
  "code-hard": hard,
  research,
  writing,
  innovation,
});

const plans: Plan[] = [
  {
    id: "opencode-client",
    provider: "OpenCode",
    name: "OpenCode client",
    kind: "BYOK client",
    monthly: 0,
    modelId: "glm-5-2",
    source: "https://opencode.ai/docs/",
    note: "The open-source coding client is free. Inference is billed by your provider, local model, Zen, or Go.",
    quota: "No bundled inference",
    evidence: "Official relative limit",
    confidence: "High",
    apiIncluded: "BYOK",
    tiers: planTiers("—", "—", "—", "—", "—", "—", "—"),
  },
  {
    id: "opencode-zen",
    provider: "OpenCode",
    name: "OpenCode Zen",
    kind: "Pay as you go",
    monthly: null,
    modelId: "glm-5-2",
    source: "https://opencode.ai/docs/zen/",
    note: "OpenAI-compatible PAYG gateway with zero model markup; card top-ups add 4.4% + $0.30.",
    quota: "No subscription cap",
    evidence: "Official relative limit",
    confidence: "High",
    apiIncluded: "Usage billed",
    tiers: planTiers("—", "—", "—", "—", "—", "—", "—"),
  },
  {
    id: "opencode-go",
    provider: "OpenCode",
    name: "OpenCode Go",
    kind: "Subscription",
    monthly: 10,
    modelId: "glm-5-2",
    source: "https://opencode.ai/docs/go/",
    note: "$5 first month. Vendor estimate for GLM-5.2 is 4,300 coding requests/month; model-specific estimates vary.",
    quota: "$12\u00A0/\u00A05h · $30\u00A0/\u00A0week · $60\u00A0/\u00A0month",
    evidence: "Official quota",
    confidence: "High",
    apiIncluded: "Capped coding endpoint",
    includedApiValue: 60,
    tiers: planTiers("—", "S", "S", "A", "—", "—", "—"),
  },
  {
    id: "cursor-pro",
    provider: "Cursor",
    name: "Cursor Pro",
    kind: "Subscription",
    monthly: 20,
    modelId: "claude-sonnet-5",
    source: "https://cursor.com/docs/models-and-pricing",
    note: "Third-party model pool is measured at published API rates. Cursor-model pool size remains undisclosed.",
    quota: "$20 third-party model pool",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Yes · in Cursor",
    includedApiValue: 20,
    tiers: planTiers("—", "S", "S", "A", "—", "—", "—"),
  },
  {
    id: "cursor-pro-plus",
    provider: "Cursor",
    name: "Cursor Pro+",
    kind: "Subscription",
    monthly: 60,
    modelId: "claude-sonnet-5",
    source: "https://cursor.com/docs/models-and-pricing",
    note: "Exact third-party pool; separate Cursor-model usage is described as generous, not a fixed dollar amount.",
    quota: "$70 third-party model pool",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Yes · in Cursor",
    includedApiValue: 70,
    tiers: planTiers("—", "A", "S", "S", "—", "—", "—"),
  },
  {
    id: "cursor-ultra",
    provider: "Cursor",
    name: "Cursor Ultra",
    kind: "Subscription",
    monthly: 200,
    modelId: "claude-sonnet-5",
    source: "https://cursor.com/docs/models-and-pricing",
    note: "Exact third-party model pool; Cursor itself is a coding workspace, not a general inference API.",
    quota: "$400 third-party model pool",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Yes · in Cursor",
    includedApiValue: 400,
    tiers: planTiers("—", "B", "A", "S", "—", "—", "—"),
  },
  {
    id: "glm-lite",
    provider: "Z.ai",
    name: "GLM Coding Lite",
    kind: "Subscription",
    monthly: 18,
    modelId: "glm-5-2",
    source: "https://docs.z.ai/devpack/overview",
    note: "Official range assumes 90.9% cache; off-peak requests burn 50% credits. Coding endpoints cannot power apps or SaaS.",
    quota: "10K credits/week · 43–87M tokens/week",
    evidence: "Official quota",
    confidence: "High",
    apiIncluded: "Coding endpoint only",
    weeklyCredits: 10_000,
    creditMultipliers: [6.9, 1.7, 24],
    cacheRatio: 0.909,
    tiers: planTiers("—", "S", "A", "B", "—", "—", "—"),
  },
  {
    id: "glm-pro",
    provider: "Z.ai",
    name: "GLM Coding Pro",
    kind: "Subscription",
    monthly: 72,
    modelId: "glm-5-2",
    source: "https://docs.z.ai/devpack/overview",
    note: "Annual offer can reduce the effective monthly price. Conversion combines Z.ai's official cache and token assumptions.",
    quota: "60K credits/week · 263–526M tokens/week",
    evidence: "Official quota",
    confidence: "High",
    apiIncluded: "Coding endpoint only",
    weeklyCredits: 60_000,
    creditMultipliers: [6.9, 1.7, 24],
    cacheRatio: 0.909,
    tiers: planTiers("—", "A", "S", "S", "—", "—", "—"),
  },
  {
    id: "glm-max",
    provider: "Z.ai",
    name: "GLM Coding Max",
    kind: "Subscription",
    monthly: 160,
    modelId: "glm-5-2",
    source: "https://docs.z.ai/devpack/overview",
    note: "Annual offer can reduce the effective monthly price. Weekly and rolling 5-hour limits both apply.",
    quota: "140K credits/week · 613–1,226M tokens/week",
    evidence: "Official quota",
    confidence: "High",
    apiIncluded: "Coding endpoint only",
    weeklyCredits: 140_000,
    creditMultipliers: [6.9, 1.7, 24],
    cacheRatio: 0.909,
    tiers: planTiers("—", "A", "S", "S", "—", "—", "—"),
  },
  {
    id: "chatgpt-plus",
    provider: "OpenAI",
    name: "ChatGPT Plus",
    kind: "Subscription",
    monthly: 20,
    modelId: "gpt-5-6-terra",
    source: "https://learn.chatgpt.com/docs/pricing",
    note: "Profile-specific Codex limits are published per rolling 5 hours; separate weekly limits may apply.",
    quota: "10–2,000 local messages / 5h by model",
    evidence: "Official quota",
    confidence: "High",
    apiIncluded: "No · API separate",
    tiers: planTiers("S", "S", "S", "A", "S", "S", "S"),
  },
  {
    id: "chatgpt-pro-5x",
    provider: "OpenAI",
    name: "ChatGPT Pro 5×",
    kind: "Subscription",
    monthly: 100,
    modelId: "gpt-5-6-sol",
    source: "https://learn.chatgpt.com/docs/pricing",
    note: "Published local-message range is five times Plus; weekly limits may still apply.",
    quota: "50–10,000 local messages / 5h by model",
    evidence: "Official quota",
    confidence: "High",
    apiIncluded: "No · API separate",
    tiers: planTiers("B", "B", "A", "S", "S", "S", "S"),
  },
  {
    id: "chatgpt-pro-20x",
    provider: "OpenAI",
    name: "ChatGPT Pro 20×",
    kind: "Subscription",
    monthly: 200,
    modelId: "gpt-5-6-sol",
    source: "https://learn.chatgpt.com/docs/pricing",
    note: "Published local-message range is twenty times Plus; it is not a fixed monthly API allowance.",
    quota: "200–40,000 local messages / 5h by model",
    evidence: "Official quota",
    confidence: "High",
    apiIncluded: "No · API separate",
    tiers: planTiers("B", "B", "A", "S", "S", "S", "S"),
  },
  {
    id: "claude-pro",
    provider: "Anthropic",
    name: "Claude Pro",
    kind: "Subscription",
    monthly: 20,
    modelId: "claude-sonnet-5",
    source: "https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan",
    note: "At least 5× Free per 5-hour session, plus a separate claimable Agent SDK credit billed at API rates.",
    quota: "5× Free + $20 Agent SDK credit",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Yes · $20 SDK",
    includedApiValue: 20,
    tiers: planTiers("S", "S", "S", "A", "A", "S", "S"),
  },
  {
    id: "claude-max-5x",
    provider: "Anthropic",
    name: "Claude Max 5×",
    kind: "Subscription",
    monthly: 100,
    modelId: "claude-opus-4-8",
    source: "https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan",
    note: "Five times Pro session usage plus a separate claimable $100 Agent SDK credit.",
    quota: "5× Pro + $100 Agent SDK credit",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Yes · $100 SDK",
    includedApiValue: 100,
    tiers: planTiers("A", "B", "S", "S", "S", "S", "S"),
  },
  {
    id: "claude-max-20x",
    provider: "Anthropic",
    name: "Claude Max 20×",
    kind: "Subscription",
    monthly: 200,
    modelId: "claude-opus-4-8",
    source: "https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan",
    note: "Twenty times Pro session usage plus a separate claimable $200 Agent SDK credit.",
    quota: "20× Pro + $200 Agent SDK credit",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Yes · $200 SDK",
    includedApiValue: 200,
    tiers: planTiers("A", "B", "S", "S", "S", "S", "S"),
  },
  {
    id: "google-ai-plus",
    provider: "Google",
    name: "Google AI Plus",
    kind: "Subscription",
    monthly: 9.99,
    modelId: "gemini-3-6-flash",
    source: "https://one.google.com/about/plans",
    note: "Current public US 2TB SKU. The older $7.99 launch SKU is no longer the current public price.",
    quota: "2× baseline · 5h and weekly limits",
    evidence: "Official relative limit",
    confidence: "Medium",
    apiIncluded: "No",
    tiers: planTiers("S", "A", "B", "B", "A", "A", "A"),
  },
  {
    id: "google-ai-pro",
    provider: "Google",
    name: "Google AI Pro",
    kind: "Subscription",
    monthly: 19.99,
    modelId: "gemini-3-1-pro",
    source: "https://developers.google.com/profile/help/benefits",
    note: "Hosted Gemini uses compute-weighted limits; the separate Cloud credit can be used for Gemini API or Vertex AI.",
    quota: "4× baseline + $10 Cloud credit",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Yes · $10 Cloud",
    includedApiValue: 10,
    tiers: planTiers("S", "A", "A", "B", "S", "S", "S"),
  },
  {
    id: "google-ultra-5x",
    provider: "Google",
    name: "Google AI Ultra 5×",
    kind: "Subscription",
    monthly: 100,
    modelId: "gemini-3-1-pro",
    source: "https://developers.google.com/profile/help/benefits",
    note: "Five times Pro hosted usage plus a separate $40 monthly Google Cloud credit.",
    quota: "5× Pro + $40 Cloud credit",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Yes · $40 Cloud",
    includedApiValue: 40,
    tiers: planTiers("A", "A", "S", "S", "S", "S", "S"),
  },
  {
    id: "google-ultra-20x",
    provider: "Google",
    name: "Google AI Ultra 20×",
    kind: "Subscription",
    monthly: 200,
    modelId: "gemini-3-1-pro",
    source: "https://developers.google.com/profile/help/benefits",
    note: "Twenty times Pro hosted usage plus a separate $100 monthly Google Cloud credit.",
    quota: "20× Pro + $100 Cloud credit",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "Yes · $100 Cloud",
    includedApiValue: 100,
    tiers: planTiers("B", "B", "A", "S", "S", "S", "S"),
  },
  {
    id: "kimi-moderato",
    provider: "Kimi",
    name: "Kimi Moderato",
    kind: "Subscription",
    monthly: 19,
    modelId: "kimi-k2-7-code",
    source: "https://www.kimi.com/help/membership/membership-pricing",
    note: "Kimi publishes a shared 300–1,200 request range across tiers, not a hard per-tier monthly API value.",
    quota: "60 agent credits · Code 1× · 300–1,200 requests/5h shared",
    evidence: "Official relative limit",
    confidence: "Medium",
    apiIncluded: "No · API separate",
    tiers: planTiers("S", "S", "A", "A", "A", "A", "A"),
  },
  {
    id: "kimi-allegretto",
    provider: "Kimi",
    name: "Kimi Allegretto",
    kind: "Subscription",
    monthly: 39,
    modelId: "kimi-k3",
    source: "https://www.kimi.com/help/membership/membership-pricing",
    note: "Adds K3 1M context and HighSpeed. HighSpeed consumes about three times quota.",
    quota: "150 agent credits · Code 5× · 300–1,200 requests/5h shared",
    evidence: "Official relative limit",
    confidence: "Medium",
    apiIncluded: "No · API separate",
    tiers: planTiers("A", "A", "S", "A", "S", "S", "S"),
  },
  {
    id: "kimi-allegro",
    provider: "Kimi",
    name: "Kimi Allegro",
    kind: "Subscription",
    monthly: 99,
    modelId: "kimi-k3",
    source: "https://www.kimi.com/help/membership/membership-pricing",
    note: "Shared membership and weekly Kimi Code ceilings still apply; API is billed separately.",
    quota: "360 agent credits · Code 15× · 300–1,200 requests/5h shared",
    evidence: "Official relative limit",
    confidence: "Medium",
    apiIncluded: "No · API separate",
    tiers: planTiers("B", "B", "A", "S", "S", "S", "S"),
  },
  {
    id: "kimi-vivace",
    provider: "Kimi",
    name: "Kimi Vivace",
    kind: "Subscription",
    monthly: 199,
    modelId: "kimi-k3",
    source: "https://www.kimi.com/help/membership/membership-pricing",
    note: "Highest Kimi membership allowance; published quotas remain rolling and shared rather than fixed API dollars.",
    quota: "720 agent credits · Code 30× · 300–1,200 requests/5h shared",
    evidence: "Official relative limit",
    confidence: "Medium",
    apiIncluded: "No · API separate",
    tiers: planTiers("B", "B", "A", "S", "S", "S", "S"),
  },
  {
    id: "mistral-pro",
    provider: "Mistral",
    name: "Mistral Pro",
    kind: "Subscription",
    monthly: 14.99,
    modelId: "mistral-large-3",
    source: "https://mistral.ai/pricing/",
    note: "The numeric ceiling applies to Flash answers, not every general chat or Vibe coding request.",
    quota: "6× Free · 150 Flash answers/day",
    evidence: "Official quota",
    confidence: "Medium",
    apiIncluded: "No",
    tiers: planTiers("A", "A", "A", "B", "A", "A", "A"),
  },
  {
    id: "perplexity-pro",
    provider: "Perplexity",
    name: "Perplexity Pro",
    kind: "Subscription",
    monthly: 20,
    modelId: "gemini-3-1-pro",
    source: "https://www.perplexity.ai/help-center/en/articles/10352901-what-is-perplexity-pro",
    note: "Multi-model research product. Advanced weekly limits are unpublished, so the estimate is price break-even only.",
    quota: "Best mode unlimited · advanced limits vary",
    evidence: "Price break-even",
    confidence: "Low",
    apiIncluded: "No · Sonar separate",
    tiers: planTiers("A", "B", "B", "B", "S", "A", "A"),
  },
  {
    id: "perplexity-max",
    provider: "Perplexity",
    name: "Perplexity Max",
    kind: "Subscription",
    monthly: 200,
    modelId: "gpt-5-6-sol",
    source: "https://www.perplexity.ai/help-center/en/articles/11680686-perplexity-max",
    note: "Includes $100 in Computer credits, which are not interchangeable with Sonar API credit.",
    quota: "10,000 Computer credits/month",
    evidence: "Official credit",
    confidence: "High",
    apiIncluded: "No · $100 Computer",
    tiers: planTiers("B", "B", "A", "A", "S", "S", "S"),
  },
  {
    id: "supergrok",
    provider: "xAI",
    name: "SuperGrok",
    kind: "Subscription",
    monthly: 30,
    modelId: "grok-4-5",
    source: "https://x.ai/pricing",
    note: "One compute-weighted weekly pool is shared across chat, coding, media, voice, and API; amount is unpublished.",
    quota: "Shared weekly pool · amount undisclosed",
    evidence: "Price break-even",
    confidence: "Low",
    apiIncluded: "Shared access only",
    tiers: planTiers("A", "A", "A", "A", "A", "A", "A"),
  },
  {
    id: "supergrok-plus",
    provider: "xAI",
    name: "SuperGrok Plus",
    kind: "Subscription",
    monthly: 100,
    modelId: "grok-4-5",
    source: "https://x.ai/pricing",
    note: "Higher shared weekly usage is promised, but xAI does not publish a numeric multiplier.",
    quota: "Significantly higher shared usage",
    evidence: "Price break-even",
    confidence: "Low",
    apiIncluded: "Shared access only",
    tiers: planTiers("B", "B", "A", "S", "A", "A", "A"),
  },
];

function sortProviders(providers: string[]): string[] {
  const priority = ["OpenAI", "Anthropic", "xAI", "Google"];
  const unique = Array.from(new Set(providers.filter((p) => p !== "All")));
  return [
    "All",
    ...unique.sort((a, b) => {
      const aIndex = priority.indexOf(a);
      const bIndex = priority.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    }),
  ];
}

const providerNames = sortProviders(models.map((model) => model.provider));
const planProviderNames = sortProviders(plans.map((plan) => plan.provider));
const tierDescriptions: Record<Exclude<Tier, "—">, string> = {
  S: "Best default / value",
  A: "Strong alternative",
  B: "Useful with tradeoffs",
};
const tierScore: Record<Tier, number> = { S: 100, A: 78, B: 52, "—": 0 };
const confidenceScore: Record<Confidence, number> = { High: 100, Medium: 70, Low: 40 };

function callCost(model: Model, settings: UsageSettings, cacheRatio = 0) {
  const cachedRate = model.cached ?? model.input;
  const effectiveInput = model.input * (1 - cacheRatio) + cachedRate * cacheRatio;
  return (settings.input * effectiveInput + settings.output * model.output) / 1_000_000;
}

function contextSize(value: string) {
  const amount = Number.parseFloat(value);
  return value.endsWith("M") ? amount * 1_000_000 : amount * 1_000;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function price(value: number, digits = 2) {
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(digits)}`;
}

function monthlyPrice(value: number) {
  if (value < 10_000) return price(value);
  return `$${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)}`;
}

function planPrice(plan: Plan) {
  if (plan.kind === "BYOK client") return "Free client";
  if (plan.kind === "Pay as you go") return "Usage only";
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
  const model = models.find((item) => item.id === plan.modelId)!;
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
  const [tierLane, setTierLane] = useState<Lane>("api");
  const [priceLane, setPriceLane] = useState<Lane>("api");
  const [recComparisonTab, setRecComparisonTab] = useState<Lane>("api");
  const [monthlyCalls, setMonthlyCalls] = useState(500);
  const [monthlyBudget, setMonthlyBudget] = useState(30);
  const [preference, setPreference] = useState<Preference>("either");
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("cost");
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

  const themeSnapshot = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const [themeMode, activeTheme] = themeSnapshot.split(":") as [ThemeMode, "light" | "dark"];

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", activeTheme);
  }, [activeTheme]);

  const cycleTheme = () => {
    const nextMode: ThemeMode =
      themeMode === "system"
        ? "light"
        : themeMode === "light"
          ? "dark"
          : "system";
    try {
      if (nextMode === "system") {
        localStorage.removeItem("tokentier-theme");
      } else {
        localStorage.setItem("tokentier-theme", nextMode);
      }
      const system = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      const effective = nextMode === "system" ? system : nextMode;
      document.documentElement.setAttribute("data-theme", effective);
      window.dispatchEvent(new Event("storage"));
    } catch {
      // ignore
    }
  };

  const toggleProvider = (name: string) => {
    if (name === "All") {
      setSelectedProviders([]);
      return;
    }
    setSelectedProviders((prev) => {
      if (prev.includes(name)) {
        return prev.filter((p) => p !== name);
      }
      return [...prev, name];
    });
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
    const candidates = models.filter((model) => model.tiers[recommendationScenarioId] !== "—");
    const withinBudget = candidates.filter(
      (model) => callCost(model, recommendationSettings) * monthlyCalls <= monthlyBudget,
    );
    const eligible = withinBudget.length > 0 ? withinBudget : candidates;
    return [...eligible].sort((a, b) => {
      const aSpend = callCost(a, recommendationSettings) * monthlyCalls;
      const bSpend = callCost(b, recommendationSettings) * monthlyCalls;
      const aScore = tierScore[a.tiers[recommendationScenarioId]];
      const bScore = tierScore[b.tiers[recommendationScenarioId]];
      return bScore - aScore || aSpend - bSpend;
    })[0];
  }, [monthlyBudget, monthlyCalls, recommendationScenarioId, recommendationSettings]);

  const rankedPlanOptions = useMemo(() => {
    const candidates = plans.filter(
      (plan) => plan.kind === "Subscription" && plan.tiers[recommendationScenarioId] !== "—",
    );
    return candidates
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
      .filter((option): option is NonNullable<typeof option> => option !== null)
      .sort((a, b) => b.score - a.score || (a.plan.monthly ?? Infinity) - (b.plan.monthly ?? Infinity));
  }, [monthlyBudget, monthlyCalls, recommendationScenarioId, recommendationSettings]);

  const recommendedPlanOption = rankedPlanOptions[0];
  const planRecommendation = recommendedPlanOption.plan;
  const recommendedPlanEstimate = recommendedPlanOption.estimate;
  const recommendedPlanCoverage = recommendedPlanOption.coverage;
  const recommendedApiSpend = callCost(apiRecommendation, recommendationSettings) * monthlyCalls;
  const planCoversVolume = recommendedPlanCoverage !== null && recommendedPlanCoverage >= 70;
  const planWithinBudget = recommendedPlanOption.withinBudget;
  const apiWithinBudget = recommendedApiSpend <= monthlyBudget;

  const preferredPath: Lane = preference === "api"
    ? apiWithinBudget || !planWithinBudget || !planCoversVolume ? "api" : "plans"
    : preference === "plans"
      ? planWithinBudget && planCoversVolume ? "plans" : "api"
      : recommendedApiSpend <= (planRecommendation.monthly ?? Infinity) * 0.65
        ? "api"
        : recommendedApiSpend >= (planRecommendation.monthly ?? Infinity) * 1.25 && planCoversVolume
          ? "plans"
          : planWithinBudget && planCoversVolume && !apiWithinBudget
            ? "plans"
            : "api";

  const verdictCopy = preferredPath === "plans"
    ? `${planRecommendation.name} fits your $${monthlyBudget.toLocaleString()} budget and has enough published capacity evidence for ${monthlyCalls.toLocaleString()} calls.`
    : !apiWithinBudget
      ? `${apiRecommendation.name} is the clearest fallback at ${monthlyPrice(recommendedApiSpend)}/month, although it exceeds your budget by ${monthlyPrice(recommendedApiSpend - monthlyBudget)}.`
      : !planCoversVolume
        ? `${apiRecommendation.name} fits your budget at ${monthlyPrice(recommendedApiSpend)}/month; the plan's published quota cannot confirm this workload.`
        : recommendedApiSpend <= (planRecommendation.monthly ?? Infinity)
          ? `${apiRecommendation.name} is ${monthlyPrice((planRecommendation.monthly ?? 0) - recommendedApiSpend)} less per month and stays within budget.`
          : `${apiRecommendation.name} matches your API preference and keeps spend transparent at ${monthlyPrice(recommendedApiSpend)}/month.`;

  const rankedModelCosts = useMemo(() => {
    return models
      .map((model) => {
        const perCall = callCost(model, recommendationSettings);
        return { model, perCall, monthly: perCall * monthlyCalls };
      })
      .sort((a, b) => a.monthly - b.monthly);
  }, [monthlyCalls, recommendationSettings]);

  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return models
      .filter((model) => {
        const matchesProvider = selectedProviders.length === 0 || selectedProviders.includes(model.provider);
        const matchesQuery = !normalizedQuery || `${model.provider} ${model.name}`.toLowerCase().includes(normalizedQuery);
        return matchesProvider && matchesQuery;
      })
      .sort((a, b) => {
        if (sortBy === "input") return a.input - b.input;
        if (sortBy === "output") return a.output - b.output;
        if (sortBy === "context") return contextSize(b.context) - contextSize(a.context);
        return callCost(a, exploreSettings) - callCost(b, exploreSettings);
      });
  }, [exploreSettings, selectedProviders, query, sortBy]);

  const visiblePlans = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return plans
      .filter((plan) => {
        const matchesProvider = selectedProviders.length === 0 || selectedProviders.includes(plan.provider);
        const matchesQuery = !normalizedQuery || `${plan.provider} ${plan.name} ${plan.kind}`.toLowerCase().includes(normalizedQuery);
        return matchesProvider && matchesQuery;
      })
      .sort((a, b) => {
        if (sortBy === "confidence") return confidenceScore[b.confidence] - confidenceScore[a.confidence];
        if (sortBy === "fit") return tierScore[b.tiers[exploreScenarioId]] - tierScore[a.tiers[exploreScenarioId]];
        return (a.monthly ?? Infinity) - (b.monthly ?? Infinity);
      });
  }, [exploreScenarioId, selectedProviders, query, sortBy]);

  const switchView = (view: View) => {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

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

  const switchPriceLane = (lane: Lane) => {
    setPriceLane(lane);
    setSelectedProviders([]);
    setSortBy(lane === "api" ? "cost" : "price");
  };

  return (
    <main>
      <a className="skip-link" href={activeView === "explore" ? "#tier-board" : "#recommendation-settings"}>Skip to comparison</a>

      <header className="site-header">
        <a
          className="brand"
          href="#explore-top"
          aria-label="TokenTier home"
          onClick={(event) => {
            event.preventDefault();
            switchView("explore");
          }}
        ><span className="brand-mark">T/T</span><span>TokenTier</span></a>
        <nav className="workspace-tabs" aria-label="Comparison mode">
          <button aria-label="Explore profiles" aria-pressed={activeView === "explore"} className={activeView === "explore" ? "active" : ""} id="explore-tab" onClick={() => switchView("explore")} type="button"><span aria-hidden="true" className="workspace-tab-long">Explore profiles</span><span aria-hidden="true" className="workspace-tab-short">Explore</span></button>
          <button aria-label="My recommendation" aria-pressed={activeView === "recommendation"} className={activeView === "recommendation" ? "active" : ""} id="recommendation-tab" onClick={() => switchView("recommendation")} type="button"><span aria-hidden="true" className="workspace-tab-long">My recommendation</span><span aria-hidden="true" className="workspace-tab-short">Recommend</span></button>
        </nav>
        <div className="header-actions">
          <span className="freshness"><i /> Updated {pricingUpdatedAt}</span>
          <button
            aria-label={`Theme: ${themeMode === "system" ? `Auto (${activeTheme})` : themeMode}. Click to cycle.`}
            className="theme-toggle"
            onClick={cycleTheme}
            title={
              themeMode === "system"
                ? `Auto: following system (${activeTheme}). Click for Light.`
                : themeMode === "light"
                  ? "Light theme. Click for Dark."
                  : "Dark theme. Click for Auto (System)."
            }
            type="button"
          >
            {themeMode === "system" ? (
              <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="15">
                <rect height="14" rx="2" ry="2" width="20" x="2" y="3"/>
                <line x1="8" x2="16" y1="21" y2="21"/>
                <line x1="12" x2="12" y1="17" y2="21"/>
              </svg>
            ) : themeMode === "light" ? (
              <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="15"><circle cx="12" cy="12" r="5"/><line x1="12" x2="12" y1="1" y2="3"/><line x1="12" x2="12" y1="21" y2="23"/><line x1="4.22" x2="5.64" y1="4.22" y2="5.64"/><line x1="18.36" x2="19.78" y1="18.36" y2="19.78"/><line x1="1" x2="3" y1="12" y2="12"/><line x1="21" x2="23" y1="12" y2="12"/><line x1="4.22" x2="5.64" y1="19.78" y2="18.36"/><line x1="18.36" x2="19.78" y1="5.64" y2="4.22"/></svg>
            ) : (
              <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="15"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
            <span>{themeMode === "system" ? "Auto" : themeMode === "light" ? "Light" : "Dark"}</span>
          </button>
        </div>
      </header>

      <div aria-labelledby="explore-tab" className="view-panel explore-panel" hidden={activeView !== "explore"} id="explore-panel" role="region">
      <aside className="scenario-dock" aria-label="Profile assumptions">
        <div className="scenario-dock-heading">
          <span>Profile assumptions</span>
        </div>
        <label className="scenario-dock-select" htmlFor="explore-scenario">
          <span>Use case</span>
          <select id="explore-scenario" value={exploreScenarioId} onChange={(event) => setExploreScenarioId(event.target.value as ScenarioId)}>
            {scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <p className="scenario-dock-impact">Updates the tier list and price book in Explore.</p>
        <dl className="scenario-dock-tokens">
          <div><dt>Input</dt><dd>{exploreScenario.input.toLocaleString()}</dd></div>
          <div><dt>Output</dt><dd>{exploreScenario.output.toLocaleString()}</dd></div>
          <div><dt>Total</dt><dd>{(exploreScenario.input + exploreScenario.output).toLocaleString()}</dd></div>
        </dl>
        <p className="scenario-dock-note">Tokens per estimated API call.</p>
        <button className="scenario-dock-action" onClick={useExploreProfile} type="button">Use in My recommendation <span>→</span></button>
        <details className="scenario-dock-more">
          <summary>How this profile works <span aria-hidden="true">+</span></summary>
          <p>Updates the tier list and price book in Explore.</p>
          <p>Costs exclude search, tools, images, storage, taxes, and retries.</p>
        </details>
      </aside>

      <section className="hero" id="explore-top">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow">Independent API and plan comparison</p>
          <h1>API or plan?<br /><span className="hero-diff-line"><em>Know the difference.</em></span></h1>
          <p className="hero-lede">
            Compare direct API costs with subscription prices and published quotas, then choose the best fit for your work.
          </p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={useExploreProfile} type="button">Use this profile <span>→</span></button>
            <a className="button button-ghost" href="#prices">Open the price book</a>
          </div>
          <dl className="hero-stats">
            <div><dt>{models.length}</dt><dd>API models</dd></div>
            <div><dt>{plans.filter((plan) => plan.kind === "Subscription").length}</dt><dd>subscriptions</dd></div>
            <div><dt>{scenarios.length}</dt><dd>work modes</dd></div>
          </dl>
        </div>
      </section>

      <section className="section tier-section" id="tier-board">
        <div className="section-heading single">
          <div><h2>Tier List</h2></div>
        </div>

        <div className="lane-switch" role="group" aria-label="Tier list lane">
          <button aria-pressed={tierLane === "api"} className={tierLane === "api" ? "active" : ""} onClick={() => setTierLane("api")} type="button"><strong>API models</strong><small>Pay per token</small></button>
          <button aria-pressed={tierLane === "plans"} className={tierLane === "plans" ? "active" : ""} onClick={() => setTierLane("plans")} type="button"><strong>Subscription plans</strong><small>Monthly price and quota</small></button>
        </div>

        <div className="tier-board">
          {(["S", "A", "B"] as const).map((tier) => (
            <div className={`tier-row tier-${tier.toLowerCase()}`} key={tier}>
              <div className="tier-label"><strong>{tier}</strong><span>{tierDescriptions[tier]}</span></div>
              <div className="tier-models">
                {tierLane === "api"
                  ? models
                    .filter((model) => model.tiers[exploreScenarioId] === tier)
                    .sort((a, b) => callCost(a, exploreSettings) - callCost(b, exploreSettings))
                    .map((model) => (
                      <article aria-label={`${model.name}, ${model.provider}, ${price(callCost(model, exploreSettings), 3)} per call`} className="tier-model" key={model.id}>
                        <span className="provider-orb" data-provider={model.provider} />
                        <span><strong title={model.name}>{model.name}</strong><small>{model.provider}</small></span>
                        <b>{price(callCost(model, exploreSettings), 3)}<small>/ call</small></b>
                      </article>
                    ))
                  : plans
                    .filter((plan) => plan.kind === "Subscription" && plan.tiers[exploreScenarioId] === tier)
                    .sort((a, b) => (a.monthly ?? Infinity) - (b.monthly ?? Infinity))
                    .map((plan) => (
                      <article aria-label={`${plan.name}, ${plan.provider}, $${plan.monthly} per month`} className="tier-model" key={plan.id}>
                        <span className="provider-orb" data-provider={plan.provider} />
                        <span><strong title={plan.name}>{plan.name}</strong><small>{plan.confidence} quota confidence</small></span>
                        <b>${plan.monthly}<small>/ month</small></b>
                      </article>
                    ))}
              </div>
            </div>
          ))}
        </div>
        <p className="tier-note">API tiers combine task fit and cost. Plan tiers combine task fit, price, and quota confidence. “—” means not intended for this use.</p>
      </section>

      <section className="section prices-section" id="prices">
        <div className="section-heading compact">
          <div><h2>Price Book</h2></div>
          <div className="section-intro"><p>Review API token rates alongside plan prices, credits, and published limits.</p></div>
        </div>

        <div className="book-switch" role="group" aria-label="Price book lane">
          <button aria-pressed={priceLane === "api"} className={priceLane === "api" ? "active" : ""} onClick={() => switchPriceLane("api")} type="button">API rates <span>{models.length}</span></button>
          <button aria-pressed={priceLane === "plans"} className={priceLane === "plans" ? "active" : ""} onClick={() => switchPriceLane("plans")} type="button">Plans &amp; access <span>{plans.length}</span></button>
        </div>

        <div className="table-tools">
          <div className="table-tools-top">
            <label className="search-field">
              <span>⌕</span>
              <input
                aria-label={`Search ${priceLane}`}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={priceLane === "api" ? "Search model or provider" : "Search plan, client, or provider"}
                type="search"
                value={query}
              />
            </label>
            <details className="columns-selector">
              <summary className="columns-trigger">
                <span>Columns ({priceLane === "api" ? Object.values(visibleApiColumns).filter(Boolean).length + 1 : Object.values(visiblePlanColumns).filter(Boolean).length + 1})</span>
                <span aria-hidden="true">▾</span>
              </summary>
              <div className="columns-menu">
                <div className="columns-menu-header">
                  <span>Show columns</span>
                  <button
                    className="columns-reset-btn"
                    onClick={() => {
                      if (priceLane === "api") {
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
                {priceLane === "api"
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
            <label className="sort-field">
              <span>Sort</span>
              <select onChange={(event) => setSortBy(event.target.value)} value={sortBy}>
                {priceLane === "api" ? (
                  <>
                    <option value="cost">Estimated call cost</option>
                    <option value="input">Input price</option>
                    <option value="output">Output price</option>
                    <option value="context">Context window</option>
                  </>
                ) : (
                  <>
                    <option value="price">Monthly price</option>
                    <option value="fit">Scenario fit</option>
                    <option value="confidence">Quota confidence</option>
                  </>
                )}
              </select>
            </label>
          </div>

          <div className="provider-filters" role="group" aria-label="Filter by provider">
            {(priceLane === "api" ? providerNames : planProviderNames).map((name) => {
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
          </div>
        </div>

        <p className="table-scroll-hint">Scroll sideways to see all columns.</p>
        <div className="table-wrap">
          {priceLane === "api" ? (
            <table>
              <caption className="visually-hidden">API rates and fit for {exploreScenario.label}</caption>
              <thead>
                <tr>
                  <th>API model</th>
                  {visibleApiColumns.input && <th>Input / 1M</th>}
                  {visibleApiColumns.cached && <th>Cached input</th>}
                  {visibleApiColumns.output && <th>Output / 1M</th>}
                  {visibleApiColumns.context && <th>Context</th>}
                  {visibleApiColumns.fit && <th>Fit</th>}
                  {visibleApiColumns.cost && <th>Est. / call</th>}
                </tr>
              </thead>
              <tbody>
                {visibleModels.map((model) => (
                  <tr key={model.id}>
                    <td>
                      <div className="table-item-cell">
                        <span className="provider-orb" data-provider={model.provider} />
                        <span className="model-cell">
                          <strong>{model.name}</strong>
                          <small>{model.provider}</small>
                        </span>
                        <a aria-label={`Official pricing source for ${model.name}${model.note ? `. Note: ${model.note}` : ""}`} className="source-link" href={model.source} rel="noreferrer" target="_blank" title={model.note ?? "Official pricing source"}>↗</a>
                      </div>
                    </td>
                    {visibleApiColumns.input && <td>{price(model.input)}</td>}
                    {visibleApiColumns.cached && <td>{model.cached === null ? "—" : price(model.cached, 4)}</td>}
                    {visibleApiColumns.output && <td>{price(model.output)}</td>}
                    {visibleApiColumns.context && <td>{model.context}</td>}
                    {visibleApiColumns.fit && <td><span className={`mini-tier ${model.tiers[exploreScenarioId] === "—" ? "tier-na" : `tier-${model.tiers[exploreScenarioId].toLowerCase()}`}`}>{model.tiers[exploreScenarioId]}</span></td>}
                    {visibleApiColumns.cost && <td><strong>{price(callCost(model, exploreSettings), 3)}</strong></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="plan-table">
              <caption className="visually-hidden">Plan prices, quotas, and fit for {exploreScenario.label}</caption>
              <thead>
                <tr>
                  <th>Plan or access path</th>
                  {visiblePlanColumns.type && <th>Type</th>}
                  {visiblePlanColumns.price && <th>Price</th>}
                  {visiblePlanColumns.quota && <th>Published quota</th>}
                  {visiblePlanColumns.apiIncluded && <th>API included?</th>}
                  {visiblePlanColumns.equivalent && <th>API-cost equivalent</th>}
                  {visiblePlanColumns.fit && <th>Fit</th>}
                  {visiblePlanColumns.evidence && <th>Evidence</th>}
                </tr>
              </thead>
              <tbody>
                {visiblePlans.map((plan) => {
                  const estimate = planEstimate(plan, exploreSettings);
                  return (
                    <tr key={plan.id}>
                      <td>
                        <div className="table-item-cell">
                          <span className="provider-orb" data-provider={plan.provider} />
                          <span className="model-cell">
                            <strong>{plan.name}</strong>
                            <small>{plan.provider}</small>
                          </span>
                          <a aria-label={`Official source for ${plan.name}. Note: ${plan.note}`} className="source-link" href={plan.source} rel="noreferrer" target="_blank" title={plan.note}>↗</a>
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
          {(priceLane === "api" ? visibleModels.length : visiblePlans.length) === 0 && <p className="empty-state">No entries match that search.</p>}
        </div>
        <p className="book-note"><strong>Subscription access is not production API credit.</strong> An API-cost equivalent is not a usage quota unless the provider publishes credits or limits.</p>
        <details className="sources price-sources"><summary>Primary pricing and quota sources <span aria-hidden="true">+</span></summary><div>
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
          <a href="https://mistral.ai/pricing/" target="_blank" rel="noreferrer">Mistral plans ↗</a>
          <a href="https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you" target="_blank" rel="noreferrer">Perplexity plans ↗</a>
        </div></details>
      </section>
      </div>

      <div aria-labelledby="recommendation-tab" className="view-panel recommendation-panel" hidden={activeView !== "recommendation"} id="recommendation-panel" role="region">
        <section className="recommendation-view" id="recommendation-top">
          <div className="hero-grid" aria-hidden="true" />
          <header className="recommendation-intro">
            <p className="eyebrow">Your workload · your budget · both paths</p>
            <h1>Build your<br /><span className="hero-diff-line"><em>best-fit month.</em></span></h1>
            <p className="hero-lede">Set the work type, token assumptions, and monthly limits. We compare direct API spend with subscription price and published capacity, then explain the strongest path.</p>
          </header>

          <div className="recommendation-workspace">
            <section className="settings-card" id="recommendation-settings" aria-labelledby="settings-title">
              <div className="settings-heading"><div><span>01</span><h2 id="settings-title">Your settings</h2></div></div>
              <div className="settings-body">
                <fieldset>
                  <legend>Workload</legend>
                  <div className="custom-settings-grid">
                    <label>Work type<select id="recommendation-profile" value={recommendationScenarioId} onChange={(event) => updateRecommendationProfile(event.target.value as ScenarioId)}>{scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                    <label>Input tokens / call<input inputMode="numeric" min="1" max="1000000" type="number" value={recommendationInputTokens} onChange={(event) => setRecommendationInputTokens(Math.min(1_000_000, Math.max(1, Number(event.target.value) || 1)))} /></label>
                    <label>Output tokens / call<input inputMode="numeric" min="1" max="500000" type="number" value={recommendationOutputTokens} onChange={(event) => setRecommendationOutputTokens(Math.min(500_000, Math.max(1, Number(event.target.value) || 1)))} /></label>
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Monthly needs</legend>
                  <div className="custom-settings-grid">
                    <label>Calls / month<input inputMode="numeric" min="1" max="100000" type="number" value={monthlyCalls} onChange={(event) => setMonthlyCalls(Math.min(100_000, Math.max(1, Number(event.target.value) || 1)))} /></label>
                    <label>Budget / month<input inputMode="numeric" min="1" max="10000" type="number" value={monthlyBudget} onChange={(event) => setMonthlyBudget(Math.min(10_000, Math.max(1, Number(event.target.value) || 1)))} /></label>
                    <label>Preference<select value={preference} onChange={(event) => setPreference(event.target.value as Preference)}><option value="either">Compare both</option><option value="api">API first</option><option value="plans">Plan first</option></select></label>
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
              <div className={`decision-banner decision-${preferredPath}`} aria-live="polite">
                <span>BEST PATH</span>
                <strong id="recommendation-title">{preferredPath === "api" ? "Use the API" : "Choose the plan"}</strong>
                <p>{verdictCopy}</p>
              </div>

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
                  <div className="path-card-verdict"><p>{recommendedPlanCoverage === null ? `${planRecommendation.name} is $${planRecommendation.monthly}/mo (quota not convertible to custom tokens).` : `${planRecommendation.name} is $${planRecommendation.monthly}/mo with ${recommendedPlanCoverage >= 70 ? "plausible" : "insufficient"} estimated capacity.`}</p></div>
                </article>
              </div>
            </section>
          </div>

          <section className="unified-comparison-card" aria-labelledby="unified-comparison-title">
            <div className="unified-comparison-header">
              <div className="unified-comparison-heading">
                <span>Detailed Comparison</span>
                <h2 id="unified-comparison-title">
                  {recComparisonTab === "api" ? "Monthly cost by model" : "Suitable subscriptions"}
                </h2>
                <p className="unified-comparison-meta">
                  {monthlyCalls.toLocaleString()} calls · {recommendationInputTokens.toLocaleString()} in + {recommendationOutputTokens.toLocaleString()} out · ${monthlyBudget.toLocaleString()} budget
                </p>
              </div>
            </div>

            <div className="lane-switch comparison-lane-switch" role="group" aria-label="Detailed comparison lane">
              <button
                aria-pressed={recComparisonTab === "api"}
                className={recComparisonTab === "api" ? "active" : ""}
                onClick={() => setRecComparisonTab("api")}
                type="button"
              >
                <strong>API models ({rankedModelCosts.length})</strong>
                <small>Ranked monthly cost</small>
              </button>
              <button
                aria-pressed={recComparisonTab === "plans"}
                className={recComparisonTab === "plans" ? "active" : ""}
                onClick={() => setRecComparisonTab("plans")}
                type="button"
              >
                <strong>Subscription plans ({rankedPlanOptions.length})</strong>
                <small>Workload suitability</small>
              </button>
            </div>

            {recComparisonTab === "api" ? (
              <div className="model-cost-columns">
                <div className="model-cost-column">
                  {rankedModelCosts.slice(0, Math.ceil(rankedModelCosts.length / 2)).map(({ model, perCall, monthly }) => {
                    const recommended = model.id === apiRecommendation.id;
                    const tier = model.tiers[recommendationScenarioId];
                    return (
                      <article className={`model-cost-row ${recommended ? "recommended" : ""}`} key={model.id}>
                        <div className="cost-model">
                          <span className="provider-orb" data-provider={model.provider} />
                          <div>
                            <strong>{model.name}</strong>
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
                <div className="model-cost-column">
                  {rankedModelCosts.slice(Math.ceil(rankedModelCosts.length / 2)).map(({ model, perCall, monthly }) => {
                    const recommended = model.id === apiRecommendation.id;
                    const tier = model.tiers[recommendationScenarioId];
                    return (
                      <article className={`model-cost-row ${recommended ? "recommended" : ""}`} key={model.id}>
                        <div className="cost-model">
                          <span className="provider-orb" data-provider={model.provider} />
                          <div>
                            <strong>{model.name}</strong>
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
              </div>
            ) : (
              <>
                <div className="plan-match-grid">
                  {rankedPlanOptions.slice(0, 6).map(({ plan, estimate, coverage, withinBudget }, index) => (
                    <article className={`plan-match-card ${index === 0 ? "recommended" : ""}`} key={plan.id}>
                      <div className="plan-match-title">
                        <span className="provider-orb" data-provider={plan.provider} />
                        <div>
                          <strong>{plan.name}</strong>
                          <small>{plan.provider}</small>
                        </div>
                        {index === 0 && <span className="recommendation-badge">Best plan</span>}
                      </div>
                      <p className="plan-match-price">${plan.monthly}<span>/ month</span></p>
                      <dl>
                        <div><dt>Budget</dt><dd>{withinBudget ? "Fits" : "Over budget"}</dd></div>
                        <div><dt>{estimate.basis === "Price break-even only" ? "API-cost parity" : "Est. capacity"}</dt><dd>{formatEstimateRange(estimate.callsLow, estimate.callsHigh)} calls</dd></div>
                        <div><dt>Coverage signal</dt><dd>{coverage === null ? "Not quantifiable" : coverage >= 70 ? "Plausible" : "Insufficient"}</dd></div>
                        <div><dt>Evidence</dt><dd>{plan.confidence} · {plan.evidence}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
                <p className="plan-match-note">Price break-even shows economic parity only. It is not a promised quota unless the provider publishes credits or limits.</p>
              </>
            )}
          </section>
        </section>
      </div>

      <footer>
        <a className="brand" href={activeView === "explore" ? "#explore-top" : "#recommendation-top"}><span className="brand-mark">T/T</span><span>TokenTier</span></a>
        <p className="footer-identity">© 2026 Jin Ma · Open-source code under MIT · Independent project</p>
      </footer>
    </main>
  );
}

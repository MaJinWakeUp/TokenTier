"use client";

import { useMemo, useState } from "react";

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

type Model = {
  id: string;
  provider: string;
  name: string;
  input: number;
  cached: number | null;
  output: number;
  context: string;
  source: string;
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
  shortLabel: string;
  input: number;
  output: number;
  description: string;
}> = [
  {
    id: "daily",
    label: "Daily use",
    shortLabel: "Daily",
    input: 1200,
    output: 600,
    description: "Questions, summaries, planning, and everyday writing.",
  },
  {
    id: "code-easy",
    label: "Coding · easy",
    shortLabel: "Easy code",
    input: 4000,
    output: 1500,
    description: "Small functions, explanations, tests, and local fixes.",
  },
  {
    id: "code-medium",
    label: "Coding · medium",
    shortLabel: "Medium code",
    input: 18000,
    output: 6000,
    description: "Multi-file features, debugging, and tool-assisted iteration.",
  },
  {
    id: "code-hard",
    label: "Coding · difficult",
    shortLabel: "Hard code",
    input: 60000,
    output: 18000,
    description: "Repository-scale reasoning, migrations, and agentic work.",
  },
  {
    id: "research",
    label: "Research exploration",
    shortLabel: "Research",
    input: 35000,
    output: 10000,
    description: "Long documents, synthesis, source finding, and open questions.",
  },
  {
    id: "writing",
    label: "Paper writing",
    shortLabel: "Paper writing",
    input: 50000,
    output: 14000,
    description: "Literature context, structure, revision, and long-form drafting.",
  },
  {
    id: "innovation",
    label: "Innovation",
    shortLabel: "Innovation",
    input: 12000,
    output: 4000,
    description: "Divergent ideation, critique, reframing, and concept development.",
  },
];

const models: Model[] = [
  {
    id: "gpt-5-6-sol",
    provider: "OpenAI",
    name: "GPT-5.6 Sol",
    input: 5,
    cached: 0.5,
    output: 30,
    context: "1.05M",
    source: "https://developers.openai.com/api/docs/models/compare",
    note: "Prompts above 272K input use 2× input and 1.5× output rates.",
    tiers: { daily: "B", "code-easy": "B", "code-medium": "A", "code-hard": "S", research: "S", writing: "S", innovation: "S" },
  },
  {
    id: "gpt-5-6-terra",
    provider: "OpenAI",
    name: "GPT-5.6 Terra",
    input: 2,
    cached: 0.2,
    output: 12,
    context: "1.05M",
    source: "https://developers.openai.com/api/docs/models/compare",
    note: "Live comparison-page rate; some search snippets remain stale.",
    tiers: { daily: "S", "code-easy": "A", "code-medium": "S", "code-hard": "A", research: "S", writing: "A", innovation: "A" },
  },
  {
    id: "gpt-5-6-luna",
    provider: "OpenAI",
    name: "GPT-5.6 Luna",
    input: 0.2,
    cached: 0.02,
    output: 1.2,
    context: "1.05M",
    source: "https://developers.openai.com/api/docs/models/compare",
    note: "Live comparison-page rate; some model-detail snippets remain stale.",
    tiers: { daily: "S", "code-easy": "S", "code-medium": "A", "code-hard": "A", research: "A", writing: "A", innovation: "A" },
  },
  {
    id: "claude-fable-5",
    provider: "Anthropic",
    name: "Claude Fable 5",
    input: 10,
    cached: 1,
    output: 50,
    context: "1M",
    source: "https://www.anthropic.com/news/claude-fable-5-mythos-5",
    note: "Special safeguards can limit some bio, chemistry, and cyber workflows.",
    tiers: { daily: "B", "code-easy": "B", "code-medium": "A", "code-hard": "S", research: "S", writing: "A", innovation: "S" },
  },
  {
    id: "claude-opus-4-8",
    provider: "Anthropic",
    name: "Claude Opus 4.8",
    input: 5,
    cached: 0.5,
    output: 25,
    context: "1M",
    source: "https://claude.com/pricing",
    tiers: { daily: "B", "code-easy": "B", "code-medium": "S", "code-hard": "S", research: "S", writing: "S", innovation: "S" },
  },
  {
    id: "claude-sonnet-5",
    provider: "Anthropic",
    name: "Claude Sonnet 5",
    input: 2,
    cached: 0.2,
    output: 10,
    context: "1M",
    source: "https://www.anthropic.com/news/claude-sonnet-5",
    note: "Introductory API price through Aug 31, 2026; then $3 / $15.",
    tiers: { daily: "S", "code-easy": "S", "code-medium": "S", "code-hard": "A", research: "A", writing: "S", innovation: "A" },
  },
  {
    id: "gemini-3-1-pro",
    provider: "Google",
    name: "Gemini 3.1 Pro",
    input: 2,
    cached: 0.2,
    output: 12,
    context: "1M",
    source: "https://ai.google.dev/gemini-api/docs/pricing",
    note: "Standard price shown for prompts up to 200K tokens.",
    tiers: { daily: "A", "code-easy": "S", "code-medium": "S", "code-hard": "S", research: "S", writing: "S", innovation: "S" },
  },
  {
    id: "gemini-3-6-flash",
    provider: "Google",
    name: "Gemini 3.6 Flash",
    input: 1.5,
    cached: 0.15,
    output: 7.5,
    context: "1M",
    source: "https://ai.google.dev/gemini-api/docs/pricing",
    tiers: { daily: "S", "code-easy": "S", "code-medium": "A", "code-hard": "B", research: "A", writing: "A", innovation: "A" },
  },
  {
    id: "grok-4-5",
    provider: "xAI",
    name: "Grok 4.5",
    input: 2,
    cached: 0.3,
    output: 6,
    context: "500K",
    source: "https://docs.x.ai/developers/pricing",
    note: "Prompts at or above 200K use higher long-context rates.",
    tiers: { daily: "A", "code-easy": "S", "code-medium": "S", "code-hard": "A", research: "A", writing: "A", innovation: "A" },
  },
  {
    id: "gemini-3-5-flash-lite",
    provider: "Google",
    name: "Gemini 3.5 Flash-Lite",
    input: 0.3,
    cached: 0.03,
    output: 2.5,
    context: "1M",
    source: "https://ai.google.dev/gemini-api/docs/pricing",
    tiers: { daily: "A", "code-easy": "S", "code-medium": "B", "code-hard": "B", research: "B", writing: "B", innovation: "B" },
  },
  {
    id: "deepseek-v4-pro",
    provider: "DeepSeek",
    name: "DeepSeek V4 Pro",
    input: 0.435,
    cached: 0.003625,
    output: 0.87,
    context: "1M",
    source: "https://api-docs.deepseek.com/quick_start/pricing/",
    note: "A published price increase is planned; re-check before production use.",
    tiers: { daily: "S", "code-easy": "S", "code-medium": "A", "code-hard": "B", research: "A", writing: "B", innovation: "B" },
  },
  {
    id: "mistral-large-3",
    provider: "Mistral",
    name: "Mistral Large 3",
    input: 0.5,
    cached: null,
    output: 1.5,
    context: "256K",
    source: "https://mistral.ai/pricing/api/",
    tiers: { daily: "A", "code-easy": "A", "code-medium": "A", "code-hard": "B", research: "A", writing: "A", innovation: "A" },
  },
  {
    id: "glm-5-2",
    provider: "Z.ai",
    name: "GLM-5.2",
    input: 1.4,
    cached: 0.26,
    output: 4.4,
    context: "200K",
    source: "https://docs.z.ai/guides/overview/pricing",
    note: "Also available through OpenCode Zen; web search costs $0.01/use.",
    tiers: { daily: "A", "code-easy": "S", "code-medium": "S", "code-hard": "A", research: "A", writing: "A", innovation: "A" },
  },
  {
    id: "kimi-k3",
    provider: "Kimi",
    name: "Kimi K3",
    input: 3,
    cached: 0.3,
    output: 15,
    context: "1M",
    source: "https://www.kimi.com/resources/kimi-k3-pricing",
    note: "Also available through OpenCode Zen; web search is billed separately.",
    tiers: { daily: "A", "code-easy": "A", "code-medium": "S", "code-hard": "A", research: "S", writing: "A", innovation: "S" },
  },
  {
    id: "kimi-k2-7-code",
    provider: "Kimi",
    name: "Kimi K2.7 Code",
    input: 0.95,
    cached: 0.19,
    output: 4,
    context: "256K",
    source: "https://www.kimi.com/en/resources/kimi-k2-7-code",
    note: "Coding-specialized API; not ranked for general writing or research.",
    tiers: { daily: "—", "code-easy": "S", "code-medium": "A", "code-hard": "B", research: "—", writing: "—", innovation: "—" },
  },
];

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
    quota: "$12 / 5h · $30 / week · $60 / month",
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

const providerNames = ["All", ...new Set(models.map((model) => model.provider))];
const planProviderNames = ["All", ...new Set(plans.map((plan) => plan.provider))];
const tierDescriptions: Record<Exclude<Tier, "—">, string> = {
  S: "Best default / value",
  A: "Strong alternative",
  B: "Useful with tradeoffs",
};
const tierScore: Record<Tier, number> = { S: 100, A: 78, B: 52, "—": 0 };
const confidenceScore: Record<Confidence, number> = { High: 100, Medium: 70, Low: 40 };

function callCost(model: Model, scenarioId: ScenarioId, cacheRatio = 0) {
  const scenario = scenarios.find((item) => item.id === scenarioId)!;
  const cachedRate = model.cached ?? model.input;
  const effectiveInput = model.input * (1 - cacheRatio) + cachedRate * cacheRatio;
  return (scenario.input * effectiveInput + scenario.output * model.output) / 1_000_000;
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

function planEstimate(plan: Plan, scenarioId: ScenarioId) {
  const model = models.find((item) => item.id === plan.modelId)!;
  const referenceCost = callCost(model, scenarioId, plan.cacheRatio ?? 0);
  const scenario = scenarios.find((item) => item.id === scenarioId)!;

  if (plan.weeklyCredits && plan.creditMultipliers) {
    const [inputMultiplier, cachedMultiplier, outputMultiplier] = plan.creditMultipliers;
    const cacheRatio = plan.cacheRatio ?? 0;
    const creditsPerCall = (
      scenario.input * (1 - cacheRatio) * inputMultiplier
      + scenario.input * cacheRatio * cachedMultiplier
      + scenario.output * outputMultiplier
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

function planCoverageScore(plan: Plan, scenarioId: ScenarioId, calls: number) {
  const estimate = planEstimate(plan, scenarioId);
  if (estimate && (plan.weeklyCredits || plan.includedApiValue !== undefined)) {
    if (estimate.callsLow >= calls) return 100;
    if (estimate.callsHigh >= calls) return 70;
    return Math.max(10, Math.round(20 * (estimate.callsHigh / calls)));
  }
  if (plan.evidence === "Official quota" || plan.evidence === "Official relative limit") {
    return calls <= 2000 ? 70 : 35;
  }
  return 40;
}

export default function Home() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>("code-medium");
  const [tierLane, setTierLane] = useState<Lane>("api");
  const [priceLane, setPriceLane] = useState<Lane>("api");
  const [monthlyCalls, setMonthlyCalls] = useState(500);
  const [monthlyBudget, setMonthlyBudget] = useState(30);
  const [preference, setPreference] = useState<Preference>("either");
  const [provider, setProvider] = useState("All");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("cost");

  const scenario = scenarios.find((item) => item.id === scenarioId)!;

  const bestApi = useMemo(() => {
    return models
      .filter((model) => model.tiers[scenarioId] === "S")
      .sort((a, b) => callCost(a, scenarioId) - callCost(b, scenarioId))[0];
  }, [scenarioId]);

  const bestPlan = useMemo(() => {
    return plans
      .filter((plan) => plan.kind === "Subscription" && plan.tiers[scenarioId] === "S")
      .sort((a, b) => {
        const confidenceGap = confidenceScore[b.confidence] - confidenceScore[a.confidence];
        if (confidenceGap) return confidenceGap;
        return (a.monthly ?? Infinity) - (b.monthly ?? Infinity);
      })[0];
  }, [scenarioId]);

  const apiRecommendation = useMemo(() => {
    const candidates = models.filter((model) => model.tiers[scenarioId] !== "—");
    return [...candidates].sort((a, b) => {
      const aSpend = callCost(a, scenarioId) * monthlyCalls;
      const bSpend = callCost(b, scenarioId) * monthlyCalls;
      const aBudget = aSpend <= monthlyBudget ? 100 : 0;
      const bBudget = bSpend <= monthlyBudget ? 100 : 0;
      const aScore = tierScore[a.tiers[scenarioId]] * 0.7 + aBudget * 0.3;
      const bScore = tierScore[b.tiers[scenarioId]] * 0.7 + bBudget * 0.3;
      return bScore - aScore || aSpend - bSpend;
    })[0];
  }, [monthlyBudget, monthlyCalls, scenarioId]);

  const planRecommendation = useMemo(() => {
    const candidates = plans.filter(
      (plan) => plan.kind === "Subscription" && plan.tiers[scenarioId] !== "—",
    );
    return [...candidates].sort((a, b) => {
      const aCoverage = planCoverageScore(a, scenarioId, monthlyCalls);
      const bCoverage = planCoverageScore(b, scenarioId, monthlyCalls);
      const aBudget = (a.monthly ?? Infinity) <= monthlyBudget ? 100 : 0;
      const bBudget = (b.monthly ?? Infinity) <= monthlyBudget ? 100 : 0;
      const aScore = tierScore[a.tiers[scenarioId]] * 0.48 + aBudget * 0.22 + aCoverage * 0.2 + confidenceScore[a.confidence] * 0.1;
      const bScore = tierScore[b.tiers[scenarioId]] * 0.48 + bBudget * 0.22 + bCoverage * 0.2 + confidenceScore[b.confidence] * 0.1;
      return bScore - aScore || (a.monthly ?? Infinity) - (b.monthly ?? Infinity);
    })[0];
  }, [monthlyBudget, monthlyCalls, scenarioId]);

  const recommendedApiSpend = callCost(apiRecommendation, scenarioId) * monthlyCalls;
  const recommendedPlanEstimate = planEstimate(planRecommendation, scenarioId)!;
  const recommendedPlanCoverage = planCoverageScore(planRecommendation, scenarioId, monthlyCalls);
  const planCoversVolume = recommendedPlanCoverage >= 70;
  const planWithinBudget = (planRecommendation.monthly ?? Infinity) <= monthlyBudget;
  const apiWithinBudget = recommendedApiSpend <= monthlyBudget;

  const preferredPath: Lane = preference === "api"
    ? apiWithinBudget || !planWithinBudget || !planCoversVolume ? "api" : "plans"
    : preference === "plans"
      ? planWithinBudget && planCoversVolume ? "plans" : "api"
      : recommendedApiSpend <= (planRecommendation.monthly ?? Infinity) * 0.65
        ? "api"
        : recommendedApiSpend >= (planRecommendation.monthly ?? Infinity) * 1.25 && planCoversVolume
          ? "plans"
          : planWithinBudget && !apiWithinBudget
            ? "plans"
            : "api";

  const verdictCopy = preferredPath === "plans"
    ? "The plan fits your budget and its documented capacity is plausible for this workload."
    : apiWithinBudget
      ? "The inspectable API estimate is the better fit for this volume and budget."
      : planWithinBudget && !planCoversVolume
        ? "The API estimate is more inspectable; the affordable plan lacks enough documented quota evidence."
        : "Neither path cleanly fits the budget; API remains the more inspectable baseline.";

  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return models
      .filter((model) => {
        const matchesProvider = provider === "All" || model.provider === provider;
        const matchesQuery = !normalizedQuery || `${model.provider} ${model.name}`.toLowerCase().includes(normalizedQuery);
        return matchesProvider && matchesQuery;
      })
      .sort((a, b) => {
        if (sortBy === "input") return a.input - b.input;
        if (sortBy === "output") return a.output - b.output;
        if (sortBy === "context") return contextSize(b.context) - contextSize(a.context);
        return callCost(a, scenarioId) - callCost(b, scenarioId);
      });
  }, [provider, query, scenarioId, sortBy]);

  const visiblePlans = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return plans
      .filter((plan) => {
        const matchesProvider = provider === "All" || plan.provider === provider;
        const matchesQuery = !normalizedQuery || `${plan.provider} ${plan.name} ${plan.kind}`.toLowerCase().includes(normalizedQuery);
        return matchesProvider && matchesQuery;
      })
      .sort((a, b) => {
        if (sortBy === "confidence") return confidenceScore[b.confidence] - confidenceScore[a.confidence];
        if (sortBy === "fit") return tierScore[b.tiers[scenarioId]] - tierScore[a.tiers[scenarioId]];
        return (a.monthly ?? Infinity) - (b.monthly ?? Infinity);
      });
  }, [provider, query, scenarioId, sortBy]);

  const switchPriceLane = (lane: Lane) => {
    setPriceLane(lane);
    setProvider("All");
    setSortBy(lane === "api" ? "cost" : "price");
  };

  return (
    <main>
      <a className="skip-link" href="#tier-board">Skip to comparison</a>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="TokenTier home"><span className="brand-mark">T/T</span><span>TokenTier</span></a>
        <nav aria-label="Main navigation">
          <a href="#tier-board">Tier lists</a>
          <a href="#calculator">Recommender</a>
          <a href="#prices">Price book</a>
          <a href="#method">Method</a>
        </nav>
        <span className="freshness"><i /> Checked Aug 11, 2026</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow"><span>Independent field guide</span> · APIs and plans, kept separate</p>
          <h1>API or plan?<br /><em>Know the difference.</em></h1>
          <p className="hero-lede">
            Compare the cost of direct model APIs with the real quotas, credits, and limits inside AI subscriptions—then choose for the work you do.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#calculator">Get a recommendation <span>↓</span></a>
            <a className="button button-ghost" href="#prices">Open the price book</a>
          </div>
          <dl className="hero-stats">
            <div><dt>{models.length}</dt><dd>API models</dd></div>
            <div><dt>{plans.filter((plan) => plan.kind === "Subscription").length}</dt><dd>subscriptions</dd></div>
            <div><dt>{scenarios.length}</dt><dd>work modes</dd></div>
          </dl>
        </div>

        <aside className="hero-card dual-value-card" aria-label="Current best value snapshot">
          <div className="hero-card-topline"><span>Best values for {scenario.label}</span><span className="live-pill">2 LANES</span></div>
          <div className="hero-choice-grid">
            <div className="hero-choice">
              <span className="lane-kicker">BEST API</span>
              <div className="hero-winner">
                <span className="provider-orb" data-provider={bestApi.provider} />
                <div><strong>{bestApi.name}</strong><span>{bestApi.provider}</span></div>
                <b>{price(callCost(bestApi, scenarioId), 3)}</b>
              </div>
              <small>Per profile call · pay only for usage</small>
            </div>
            <div className="hero-choice plan-choice">
              <span className="lane-kicker">BEST SUBSCRIPTION</span>
              <div className="hero-winner">
                <span className="provider-orb" data-provider={bestPlan.provider} />
                <div><strong>{bestPlan.name}</strong><span>{bestPlan.provider}</span></div>
                <b>${bestPlan.monthly}</b>
              </div>
              <small>{planQuota(bestPlan, scenarioId)}</small>
            </div>
          </div>
          <div className="hero-card-foot"><span>Editorial value picks</span><span>List prices · USD</span></div>
          <div className="hero-switcher" aria-label="Quick scenario selection">
            {scenarios.slice(0, 4).map((item) => (
              <button className={item.id === scenarioId ? "active" : ""} key={item.id} onClick={() => setScenarioId(item.id)} type="button">{item.shortLabel}</button>
            ))}
          </div>
        </aside>
      </section>

      <section className="section tier-section" id="tier-board">
        <div className="section-heading">
          <div><p className="section-index">01 / TWO DECISION BOARDS</p><h2>Pick the work.<br />Choose the lane.</h2></div>
          <div className="section-intro"><p>{scenario.description}</p><span>{scenario.input.toLocaleString()} input + {scenario.output.toLocaleString()} output tokens per API call</span></div>
        </div>

        <div className="scenario-tabs" role="group" aria-label="Use case">
          {scenarios.map((item) => (
            <button aria-pressed={item.id === scenarioId} className={item.id === scenarioId ? "active" : ""} key={item.id} onClick={() => setScenarioId(item.id)} type="button">{item.label}</button>
          ))}
        </div>

        <div className="lane-switch" aria-label="Tier list lane">
          <button aria-pressed={tierLane === "api"} className={tierLane === "api" ? "active" : ""} onClick={() => setTierLane("api")} type="button"><span>API</span><strong>API models</strong><small>Token rates · production use</small></button>
          <button aria-pressed={tierLane === "plans"} className={tierLane === "plans" ? "active" : ""} onClick={() => setTierLane("plans")} type="button"><span>PLAN</span><strong>Subscription plans</strong><small>Product quotas · personal use</small></button>
        </div>

        <div className="tier-board">
          {(["S", "A", "B"] as const).map((tier) => (
            <div className={`tier-row tier-${tier.toLowerCase()}`} key={tier}>
              <div className="tier-label"><strong>{tier}</strong><span>{tierDescriptions[tier]}</span></div>
              <div className="tier-models">
                {tierLane === "api"
                  ? models
                    .filter((model) => model.tiers[scenarioId] === tier)
                    .sort((a, b) => callCost(a, scenarioId) - callCost(b, scenarioId))
                    .map((model) => (
                      <article className="tier-model" key={model.id}>
                        <span className="provider-orb" data-provider={model.provider} />
                        <span><strong>{model.name}</strong><small>{model.provider} · API</small></span>
                        <b>{price(callCost(model, scenarioId), 3)}<small>/ call</small></b>
                      </article>
                    ))
                  : plans
                    .filter((plan) => plan.kind === "Subscription" && plan.tiers[scenarioId] === tier)
                    .sort((a, b) => (a.monthly ?? Infinity) - (b.monthly ?? Infinity))
                    .map((plan) => (
                      <article className="tier-model" key={plan.id}>
                        <span className="provider-orb" data-provider={plan.provider} />
                        <span><strong>{plan.name}</strong><small>{plan.confidence} quota confidence</small></span>
                        <b>${plan.monthly}<small>/ month</small></b>
                      </article>
                    ))}
              </div>
            </div>
          ))}
        </div>
        <p className="tier-note"><span>Separate lanes, separate promises:</span> API tiers rank model economics and task fit. Plan tiers rank product fit, price, published capacity, and quota confidence. “—” means the plan or model is not intended for that use.</p>
      </section>

      <section className="section calculator-section" id="calculator">
        <div className="calculator-copy">
          <p className="section-index">02 / API VS PLAN RECOMMENDER</p>
          <h2>Describe the month.<br />Get both paths.</h2>
          <p>We always return one API and one plan. The verdict considers workload fit, your volume, budget, published quota coverage, and how inspectable the estimate is.</p>
          <div className="formula"><span>API FORMULA</span><code>calls × ((input × input rate) + (output × output rate))</code></div>
        </div>

        <div className="calculator-card recommendation-card">
          <div className="calculator-fields recommendation-fields">
            <label>Workload<select value={scenarioId} onChange={(event) => setScenarioId(event.target.value as ScenarioId)}>{scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label>Calls / month<input inputMode="numeric" min="1" max="100000" type="number" value={monthlyCalls} onChange={(event) => setMonthlyCalls(Math.max(1, Number(event.target.value) || 1))} /></label>
            <label>Budget / month<input inputMode="numeric" min="1" max="10000" type="number" value={monthlyBudget} onChange={(event) => setMonthlyBudget(Math.max(1, Number(event.target.value) || 1))} /></label>
            <label>Preference<select value={preference} onChange={(event) => setPreference(event.target.value as Preference)}><option value="either">Compare both</option><option value="api">API first</option><option value="plans">Plan first</option></select></label>
          </div>

          <div className={`decision-banner decision-${preferredPath}`} aria-live="polite">
            <span>RECOMMENDED PATH</span>
            <strong>{preferredPath === "api" ? "Use the API" : "Choose the plan"}</strong>
            <p>{verdictCopy}</p>
          </div>

          <div className="recommendation-grid">
            <article className={preferredPath === "api" ? "path-card primary" : "path-card"}>
              <div className="path-card-label"><span>BEST API</span><span className={`mini-tier tier-${apiRecommendation.tiers[scenarioId].toLowerCase()}`}>{apiRecommendation.tiers[scenarioId]}</span></div>
              <div className="path-title"><span className="provider-orb" data-provider={apiRecommendation.provider} /><div><strong>{apiRecommendation.name}</strong><small>{apiRecommendation.provider} · direct API</small></div></div>
              <p className="path-price">{price(recommendedApiSpend)}<span>/ month</span></p>
              <dl><div><dt>Per call</dt><dd>{price(callCost(apiRecommendation, scenarioId), 3)}</dd></div><div><dt>Budget</dt><dd>{apiWithinBudget ? "Fits" : `Over by ${price(recommendedApiSpend - monthlyBudget)}`}</dd></div><div><dt>Confidence</dt><dd>High · token math</dd></div></dl>
            </article>

            <article className={preferredPath === "plans" ? "path-card primary" : "path-card"}>
              <div className="path-card-label"><span>BEST PLAN</span><span className={`mini-tier tier-${planRecommendation.tiers[scenarioId].toLowerCase()}`}>{planRecommendation.tiers[scenarioId]}</span></div>
              <div className="path-title"><span className="provider-orb" data-provider={planRecommendation.provider} /><div><strong>{planRecommendation.name}</strong><small>{planRecommendation.provider} · {planRecommendation.kind.toLowerCase()}</small></div></div>
              <p className="path-price">${planRecommendation.monthly}<span>/ month</span></p>
              <dl><div><dt>{recommendedPlanEstimate.basis === "Price break-even only" ? "API-cost parity" : "Est. capacity"}</dt><dd>{formatEstimateRange(recommendedPlanEstimate.callsLow, recommendedPlanEstimate.callsHigh)} profile calls</dd></div><div><dt>Published quota</dt><dd>{planQuota(planRecommendation, scenarioId)}</dd></div><div><dt>Confidence</dt><dd>{planRecommendation.confidence} · {recommendedPlanEstimate.basis}</dd></div></dl>
            </article>
          </div>

          <details className="call-profile"><summary>What counts as one {scenario.label.toLowerCase()} call? <span>+</span></summary><p>{scenario.input.toLocaleString()} uncached input tokens + {scenario.output.toLocaleString()} output tokens. Reasoning tokens count as output. Search, tools, images, storage, taxes, and retries are not included.</p></details>
        </div>
      </section>

      <section className="section prices-section" id="prices">
        <div className="section-heading compact">
          <div><p className="section-index">03 / TWO-LANE PRICE BOOK</p><h2>Rates and quotas,<br />side by side.</h2></div>
          <div className="section-intro"><p>Switch between direct API economics and the plans, clients, credits, and caps that wrap them.</p><span>Active profile: {scenario.label}</span></div>
        </div>

        <div className="book-switch" aria-label="Price book lane">
          <button aria-pressed={priceLane === "api"} className={priceLane === "api" ? "active" : ""} onClick={() => switchPriceLane("api")} type="button">API rates <span>{models.length}</span></button>
          <button aria-pressed={priceLane === "plans"} className={priceLane === "plans" ? "active" : ""} onClick={() => switchPriceLane("plans")} type="button">Plans &amp; access <span>{plans.length}</span></button>
        </div>

        <div className="table-tools">
          <label className="search-field"><span>⌕</span><input aria-label={`Search ${priceLane}`} onChange={(event) => setQuery(event.target.value)} placeholder={priceLane === "api" ? "Search model or provider" : "Search plan, client, or provider"} type="search" value={query} /></label>
          <div className="provider-filters" aria-label="Filter by provider">
            {(priceLane === "api" ? providerNames : planProviderNames).map((name) => <button aria-pressed={provider === name} className={provider === name ? "active" : ""} key={name} onClick={() => setProvider(name)} type="button">{name}</button>)}
          </div>
          <label className="sort-field"><span>Sort</span><select onChange={(event) => setSortBy(event.target.value)} value={sortBy}>{priceLane === "api" ? <><option value="cost">Estimated call cost</option><option value="input">Input price</option><option value="output">Output price</option><option value="context">Context window</option></> : <><option value="price">Monthly price</option><option value="fit">Scenario fit</option><option value="confidence">Quota confidence</option></>}</select></label>
        </div>

        <div className="table-wrap">
          {priceLane === "api" ? (
            <table>
              <thead><tr><th>API model</th><th>Input / 1M</th><th>Cached input</th><th>Output / 1M</th><th>Context</th><th>Fit</th><th>Est. / call</th></tr></thead>
              <tbody>{visibleModels.map((model) => (
                <tr key={model.id}><td><span className="provider-orb" data-provider={model.provider} /><span className="model-cell"><strong>{model.name}</strong><small title={model.note}>{model.provider}{model.note ? " · pricing caveat" : ""}</small></span><a aria-label={`Official pricing source for ${model.name}`} className="source-link" href={model.source} rel="noreferrer" target="_blank">↗</a></td><td>{price(model.input)}</td><td>{model.cached === null ? "—" : price(model.cached, 4)}</td><td>{price(model.output)}</td><td>{model.context}</td><td><span className={`mini-tier ${model.tiers[scenarioId] === "—" ? "tier-na" : `tier-${model.tiers[scenarioId].toLowerCase()}`}`}>{model.tiers[scenarioId]}</span></td><td><strong>{price(callCost(model, scenarioId), 3)}</strong></td></tr>
              ))}</tbody>
            </table>
          ) : (
            <table className="plan-table">
              <thead><tr><th>Plan or access path</th><th>Type</th><th>Price</th><th>Published quota</th><th>API included?</th><th>API-cost equivalent</th><th>Fit</th><th>Evidence</th></tr></thead>
              <tbody>{visiblePlans.map((plan) => {
                const estimate = planEstimate(plan, scenarioId);
                return (
                  <tr key={plan.id}><td><span className="provider-orb" data-provider={plan.provider} /><span className="model-cell"><strong>{plan.name}</strong><small title={plan.note}>{plan.provider} · {plan.note}</small></span><a aria-label={`Official source for ${plan.name}`} className="source-link" href={plan.source} rel="noreferrer" target="_blank">↗</a></td><td><span className="kind-pill">{plan.kind}</span></td><td><strong>{planPrice(plan)}</strong>{plan.kind === "Subscription" && <small className="per-month"> / mo</small>}</td><td className="wrap-cell">{planQuota(plan, scenarioId)}</td><td>{plan.apiIncluded}</td><td>{estimate ? <><strong>{formatEstimateRange(estimate.callsLow, estimate.callsHigh)} calls</strong><small className="estimate-detail">{formatMoneyRange(estimate.valueLow, estimate.valueHigh)} · {estimate.basis}</small></> : <span className="muted-dash">Your API bill</span>}</td><td><span className={`mini-tier ${plan.tiers[scenarioId] === "—" ? "tier-na" : `tier-${plan.tiers[scenarioId].toLowerCase()}`}`}>{plan.tiers[scenarioId]}</span></td><td><span className={`evidence-badge evidence-${plan.confidence.toLowerCase()}`}>{plan.confidence}</span><small className="estimate-detail">{plan.evidence}</small></td></tr>
                );
              })}</tbody>
            </table>
          )}
          {(priceLane === "api" ? visibleModels.length : visiblePlans.length) === 0 && <p className="empty-state">No entries match that search.</p>}
        </div>
        <p className="book-note"><span>API-cost equivalent is not always quota.</span> “Included API credit” and “official token quota” describe real capacity. “Price break-even” only shows how many direct API calls the same dollars could buy.</p>
      </section>

      <section className="section methodology-section" id="method">
        <div><p className="section-index">04 / READ THE LABEL</p><h2>Three kinds<br />of “value.”</h2></div>
        <div className="method-grid">
          <article><span>01</span><h3>Included credit</h3><p>Cursor, Claude Agent SDK, and some Google plans publish a real dollar pool. We divide that pool—not the sticker price—by the reference API call cost.</p></article>
          <article><span>02</span><h3>Published quota</h3><p>OpenCode Go and GLM publish caps or credit formulas. We preserve rolling windows and convert only where the vendor provides enough inputs.</p></article>
          <article><span>03</span><h3>Price break-even</h3><p>If a plan hides capacity, the call count is economic parity only. It is never presented as promised monthly usage.</p></article>
          <article><span>04</span><h3>Separate surfaces</h3><p>A chat plan, coding endpoint, client, API credit, and production API are not interchangeable. Each row says what is actually included.</p></article>
        </div>
        <details className="sources"><summary>Primary pricing and quota sources <span>+</span></summary><div>
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
          <a href="https://docs.x.ai/developers/pricing" target="_blank" rel="noreferrer">xAI API ↗</a>
          <a href="https://mistral.ai/pricing/" target="_blank" rel="noreferrer">Mistral plans ↗</a>
          <a href="https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you" target="_blank" rel="noreferrer">Perplexity plans ↗</a>
        </div></details>
      </section>

      <footer><a className="brand" href="#top"><span className="brand-mark">T/T</span><span>TokenTier</span></a><p>Choose the lane. Know the limit.</p><span>Prices checked Aug 11, 2026 · USD · v2.0</span></footer>
    </main>
  );
}

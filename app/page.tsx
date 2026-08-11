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

type Tier = "S" | "A" | "B";

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
  provider: string;
  name: string;
  monthly: number;
  modelId: string;
  source: string;
  note: string;
  proxy?: boolean;
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
    tiers: {
      daily: "A",
      "code-easy": "B",
      "code-medium": "A",
      "code-hard": "S",
      research: "S",
      writing: "S",
      innovation: "S",
    },
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
    note: "Prompts above 272K input use 2× input and 1.5× output rates.",
    tiers: {
      daily: "S",
      "code-easy": "A",
      "code-medium": "S",
      "code-hard": "A",
      research: "S",
      writing: "A",
      innovation: "A",
    },
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
    note: "Prompts above 272K input use 2× input and 1.5× output rates.",
    tiers: {
      daily: "S",
      "code-easy": "S",
      "code-medium": "A",
      "code-hard": "A",
      research: "A",
      writing: "A",
      innovation: "A",
    },
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
    id: "claude-opus-5",
    provider: "Anthropic",
    name: "Claude Opus 5",
    input: 5,
    cached: 0.5,
    output: 25,
    context: "1M",
    source: "https://www.anthropic.com/news/claude-opus-5",
    tiers: {
      daily: "A",
      "code-easy": "B",
      "code-medium": "S",
      "code-hard": "S",
      research: "S",
      writing: "S",
      innovation: "S",
    },
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
    tiers: {
      daily: "S",
      "code-easy": "S",
      "code-medium": "S",
      "code-hard": "A",
      research: "A",
      writing: "S",
      innovation: "A",
    },
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
    note: "Preview; standard price for prompts up to 200K tokens.",
    tiers: {
      daily: "A",
      "code-easy": "S",
      "code-medium": "S",
      "code-hard": "S",
      research: "S",
      writing: "S",
      innovation: "S",
    },
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
    tiers: {
      daily: "S",
      "code-easy": "S",
      "code-medium": "A",
      "code-hard": "B",
      research: "A",
      writing: "A",
      innovation: "A",
    },
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
    note: "Prompts at or above 200K use higher long-context rates for all tokens.",
    tiers: {
      daily: "A",
      "code-easy": "S",
      "code-medium": "S",
      "code-hard": "A",
      research: "A",
      writing: "A",
      innovation: "A",
    },
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
    tiers: {
      daily: "A",
      "code-easy": "S",
      "code-medium": "B",
      "code-hard": "B",
      research: "B",
      writing: "B",
      innovation: "B",
    },
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
    note: "Published price increase is planned; re-check before production use.",
    tiers: {
      daily: "A",
      "code-easy": "S",
      "code-medium": "A",
      "code-hard": "B",
      research: "A",
      writing: "B",
      innovation: "B",
    },
  },
  {
    id: "mistral-large",
    provider: "Mistral",
    name: "Mistral Large",
    input: 0.5,
    cached: null,
    output: 1.5,
    context: "256K",
    source: "https://mistral.ai/pricing/api/",
    tiers: {
      daily: "A",
      "code-easy": "A",
      "code-medium": "A",
      "code-hard": "B",
      research: "A",
      writing: "A",
      innovation: "A",
    },
  },
];

const plans: Plan[] = [
  {
    provider: "Google",
    name: "Google AI Plus",
    monthly: 7.99,
    modelId: "gemini-3-6-flash",
    source:
      "https://blog.google/products-and-platforms/products/google-one/google-ai-plus-availability/",
    note: "2× non-subscriber Gemini access; availability and pricing vary by region.",
  },
  {
    provider: "Mistral",
    name: "Mistral Pro",
    monthly: 14.99,
    modelId: "mistral-large",
    source: "https://mistral.ai/pricing/",
    note: "Higher chat, search, research, and Vibe coding limits.",
  },
  {
    provider: "OpenAI",
    name: "ChatGPT Plus",
    monthly: 20,
    modelId: "gpt-5-6-terra",
    source: "https://learn.chatgpt.com/docs/pricing",
    note: "Five-hour usage windows with possible weekly limits; API is separate.",
    proxy: true,
  },
  {
    provider: "Anthropic",
    name: "Claude Pro",
    monthly: 20,
    modelId: "claude-sonnet-5",
    source: "https://claude.com/pricing",
    note: "At least 5× Free per session with a weekly limit; API is separate.",
  },
  {
    provider: "Google",
    name: "Google AI Pro",
    monthly: 19.99,
    modelId: "gemini-3-1-pro",
    source: "https://one.google.com/about/google-ai-plans/",
    note: "4× access, Pro model availability, 1M context, and bundled storage.",
  },
  {
    provider: "Perplexity",
    name: "Perplexity Pro",
    monthly: 20,
    modelId: "gemini-3-1-pro",
    source:
      "https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you",
    note: "Multi-model research product; comparison uses Gemini Pro as a proxy.",
    proxy: true,
  },
  {
    provider: "xAI",
    name: "SuperGrok",
    monthly: 30,
    modelId: "grok-4-5",
    source: "https://x.ai/pricing",
    note: "Higher Grok app limits, advanced modes, and image/video access.",
  },
  {
    provider: "OpenAI",
    name: "ChatGPT Pro 5×",
    monthly: 100,
    modelId: "gpt-5-6-sol",
    source: "https://learn.chatgpt.com/docs/pricing",
    note: "Five-times Plus Codex usage; window and weekly limits still apply.",
    proxy: true,
  },
  {
    provider: "Anthropic",
    name: "Claude Max 5×",
    monthly: 100,
    modelId: "claude-opus-5",
    source: "https://claude.com/pricing",
    note: "Five-times Pro usage per session plus weekly limits.",
  },
  {
    provider: "Google",
    name: "Google AI Ultra 5×",
    monthly: 100,
    modelId: "gemini-3-1-pro",
    source:
      "https://blog.google/products-and-platforms/products/google-one/google-ai-subscriptions/",
    note: "Five-times Pro access with higher Deep Think and agent allowances.",
  },
  {
    provider: "xAI",
    name: "SuperGrok Plus",
    monthly: 100,
    modelId: "grok-4-5",
    source: "https://x.ai/pricing",
    note: "Significantly higher usage, priority access, and 1080p video.",
  },
  {
    provider: "OpenAI",
    name: "ChatGPT Pro 20×",
    monthly: 200,
    modelId: "gpt-5-6-sol",
    source: "https://learn.chatgpt.com/docs/pricing",
    note: "Twenty-times Plus Codex usage; not a fixed number of messages.",
    proxy: true,
  },
  {
    provider: "Anthropic",
    name: "Claude Max 20×",
    monthly: 200,
    modelId: "claude-opus-5",
    source: "https://claude.com/pricing",
    note: "Twenty-times Pro usage positioning; not a fixed message allowance.",
  },
  {
    provider: "Google",
    name: "Google AI Ultra 20×",
    monthly: 200,
    modelId: "gemini-3-1-pro",
    source:
      "https://blog.google/products-and-platforms/products/google-one/google-ai-subscriptions/",
    note: "Highest Google consumer limits with weekly compute-weighted caps.",
  },
  {
    provider: "Perplexity",
    name: "Perplexity Max",
    monthly: 200,
    modelId: "gpt-5-6-sol",
    source:
      "https://www.perplexity.ai/help-center/en/articles/11680686-perplexity-max",
    note: "Multi-model product with highest research limits and 10,000 credits.",
    proxy: true,
  },
];

const providerNames = [
  "All",
  "OpenAI",
  "Anthropic",
  "Google",
  "xAI",
  "DeepSeek",
  "Mistral",
];

const tierDescriptions: Record<Tier, string> = {
  S: "Best overall fit",
  A: "Strong alternative",
  B: "Good with tradeoffs",
};

function callCost(model: Model, scenarioId: ScenarioId) {
  const scenario = scenarios.find((item) => item.id === scenarioId)!;
  return (
    (scenario.input * model.input + scenario.output * model.output) / 1_000_000
  );
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

export default function Home() {
  const [scenarioId, setScenarioId] =
    useState<ScenarioId>("code-medium");
  const [selectedModelId, setSelectedModelId] = useState("gpt-5-6-terra");
  const [monthlyCalls, setMonthlyCalls] = useState(250);
  const [provider, setProvider] = useState("All");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("cost");

  const scenario = scenarios.find((item) => item.id === scenarioId)!;
  const selectedModel = models.find((item) => item.id === selectedModelId)!;
  const selectedCallCost = callCost(selectedModel, scenarioId);
  const projectedCost = selectedCallCost * monthlyCalls;

  const bestValue = useMemo(() => {
    return models
      .filter((model) => model.tiers[scenarioId] === "S")
      .sort((a, b) => callCost(a, scenarioId) - callCost(b, scenarioId))[0];
  }, [scenarioId]);

  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = models.filter((model) => {
      const matchesProvider = provider === "All" || model.provider === provider;
      const matchesQuery =
        !normalizedQuery ||
        `${model.provider} ${model.name}`.toLowerCase().includes(normalizedQuery);
      return matchesProvider && matchesQuery;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === "input") return a.input - b.input;
      if (sortBy === "output") return a.output - b.output;
      if (sortBy === "context") {
        return contextSize(b.context) - contextSize(a.context);
      }
      return callCost(a, scenarioId) - callCost(b, scenarioId);
    });
  }, [provider, query, scenarioId, sortBy]);

  return (
    <main>
      <a className="skip-link" href="#tier-board">
        Skip to comparison
      </a>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="TokenTier home">
          <span className="brand-mark">T/T</span>
          <span>TokenTier</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#tier-board">Tier list</a>
          <a href="#calculator">Calculator</a>
          <a href="#prices">API prices</a>
          <a href="#plans">Plans</a>
        </nav>
        <span className="freshness"><i /> Checked Aug 10, 2026</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow"><span>Independent field guide</span> · USD list prices</p>
          <h1>Know what every <em>prompt</em> costs.</h1>
          <p className="hero-lede">
            Compare leading AI models by the work you actually do—then translate
            monthly subscriptions into an honest, adjustable API-call estimate.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#tier-board">
              Find my model <span>↓</span>
            </a>
            <a className="button button-ghost" href="#prices">
              Compare all prices
            </a>
          </div>
          <dl className="hero-stats">
            <div><dt>{models.length}</dt><dd>current models</dd></div>
            <div><dt>{scenarios.length}</dt><dd>work modes</dd></div>
            <div><dt>{plans.length}</dt><dd>consumer plans</dd></div>
          </dl>
        </div>

        <aside className="hero-card" aria-label="Current best value snapshot">
          <div className="hero-card-topline">
            <span>Best value right now</span>
            <span className="live-pill">LIVE DATA</span>
          </div>
          <p className="hero-card-scenario">FOR {scenario.label.toUpperCase()}</p>
          <div className="hero-winner">
            <span className="provider-orb" data-provider={bestValue.provider} />
            <div>
              <strong>{bestValue.name}</strong>
              <span>{bestValue.provider}</span>
            </div>
            <b>{price(callCost(bestValue, scenarioId))}</b>
          </div>
          <div className="hero-meter">
            <span style={{ width: "84%" }} />
          </div>
          <div className="hero-card-foot">
            <span>Estimated per call</span>
            <span>{scenario.input.toLocaleString()} in · {scenario.output.toLocaleString()} out</span>
          </div>
          <div className="hero-switcher" aria-label="Quick scenario selection">
            {scenarios.slice(0, 4).map((item) => (
              <button
                className={item.id === scenarioId ? "active" : ""}
                key={item.id}
                onClick={() => setScenarioId(item.id)}
                type="button"
              >
                {item.shortLabel}
              </button>
            ))}
          </div>
        </aside>
      </section>

      <section className="section tier-section" id="tier-board">
        <div className="section-heading">
          <div>
            <p className="section-index">01 / DECISION BOARD</p>
            <h2>Pick the work.<br />See the winners.</h2>
          </div>
          <div className="section-intro">
            <p>{scenario.description}</p>
            <span>Assumption: {scenario.input.toLocaleString()} input + {scenario.output.toLocaleString()} output tokens per call</span>
          </div>
        </div>

        <div className="scenario-tabs" role="tablist" aria-label="Use case">
          {scenarios.map((item) => (
            <button
              aria-selected={item.id === scenarioId}
              className={item.id === scenarioId ? "active" : ""}
              key={item.id}
              onClick={() => setScenarioId(item.id)}
              role="tab"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="tier-board">
          {(["S", "A", "B"] as Tier[]).map((tier) => (
            <div className={`tier-row tier-${tier.toLowerCase()}`} key={tier}>
              <div className="tier-label">
                <strong>{tier}</strong>
                <span>{tierDescriptions[tier]}</span>
              </div>
              <div className="tier-models">
                {models
                  .filter((model) => model.tiers[scenarioId] === tier)
                  .sort((a, b) => callCost(a, scenarioId) - callCost(b, scenarioId))
                  .map((model) => (
                    <button
                      aria-pressed={selectedModelId === model.id}
                      className={`tier-model ${selectedModelId === model.id ? "selected" : ""}`}
                      key={model.id}
                      onClick={() => setSelectedModelId(model.id)}
                      type="button"
                    >
                      <span className="provider-orb" data-provider={model.provider} />
                      <span>
                        <strong>{model.name}</strong>
                        <small>{model.provider}</small>
                      </span>
                      <b>{price(callCost(model, scenarioId))}<small>/call</small></b>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
        <p className="tier-note">
          <span>How to read this:</span> tiers balance capability, price, context, and
          task fit. They are editorial guidance—not a universal benchmark score.
        </p>
      </section>

      <section className="section calculator-section" id="calculator">
        <div className="calculator-copy">
          <p className="section-index">02 / COST CALCULATOR</p>
          <h2>Turn tokens into a monthly number.</h2>
          <p>
            Use our scenario profile or change the call volume. This is the same
            math behind every subscription-equivalent estimate below.
          </p>
          <div className="formula">
            <span>FORMULA</span>
            <code>(input tokens × input rate) + (output tokens × output rate)</code>
          </div>
        </div>

        <div className="calculator-card">
          <div className="calculator-fields">
            <label>
              Model
              <select
                onChange={(event) => setSelectedModelId(event.target.value)}
                value={selectedModelId}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.provider} · {model.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Calls per month
              <input
                inputMode="numeric"
                max="100000"
                min="1"
                onChange={(event) =>
                  setMonthlyCalls(Math.max(1, Number(event.target.value) || 1))
                }
                type="number"
                value={monthlyCalls}
              />
            </label>
          </div>
          <div className="calculator-result" aria-live="polite">
            <div>
              <span>Projected API spend</span>
              <strong>{price(projectedCost)}</strong>
              <small>per month · standard token rates</small>
            </div>
            <div className="result-details">
              <p><span>Per call</span><b>{price(selectedCallCost, 3)}</b></p>
              <p><span>$20 buys</span><b>{compactNumber(20 / selectedCallCost)} calls</b></p>
              <p><span>Selected tier</span><b>{selectedModel.tiers[scenarioId]} tier</b></p>
            </div>
          </div>
          <div className="calculator-scale">
            <span>LIGHT USE</span>
            <i><b style={{ width: `${Math.min(100, (projectedCost / 200) * 100)}%` }} /></i>
            <span>POWER USE</span>
          </div>
        </div>
      </section>

      <section className="section prices-section" id="prices">
        <div className="section-heading compact">
          <div>
            <p className="section-index">03 / API PRICE BOOK</p>
            <h2>Every token,<br />side by side.</h2>
          </div>
          <p className="section-intro">
            Standard text rates in USD per 1M tokens. The estimate column follows
            your active <strong>{scenario.label}</strong> profile.
          </p>
        </div>

        <div className="table-tools">
          <label className="search-field">
            <span>⌕</span>
            <input
              aria-label="Search models"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search model or provider"
              type="search"
              value={query}
            />
          </label>
          <div className="provider-filters" aria-label="Filter by provider">
            {providerNames.map((name) => (
              <button
                aria-pressed={provider === name}
                className={provider === name ? "active" : ""}
                key={name}
                onClick={() => setProvider(name)}
                type="button"
              >
                {name}
              </button>
            ))}
          </div>
          <label className="sort-field">
            <span>Sort</span>
            <select onChange={(event) => setSortBy(event.target.value)} value={sortBy}>
              <option value="cost">Estimated call cost</option>
              <option value="input">Input price</option>
              <option value="output">Output price</option>
              <option value="context">Context window</option>
            </select>
          </label>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Input / 1M</th>
                <th>Cached input</th>
                <th>Output / 1M</th>
                <th>Context</th>
                <th>Fit</th>
                <th>Est. / call</th>
              </tr>
            </thead>
            <tbody>
              {visibleModels.map((model) => (
                <tr key={model.id}>
                  <td>
                    <span className="provider-orb" data-provider={model.provider} />
                    <span className="model-cell">
                      <strong>{model.name}</strong>
                      <small title={model.note}>{model.provider}{model.note ? " · pricing caveat" : ""}</small>
                    </span>
                    <a
                      aria-label={`Official pricing source for ${model.name}`}
                      className="source-link"
                      href={model.source}
                      rel="noreferrer"
                      target="_blank"
                    >↗</a>
                  </td>
                  <td>{price(model.input)}</td>
                  <td>{model.cached === null ? "—" : price(model.cached, 4)}</td>
                  <td>{price(model.output)}</td>
                  <td>{model.context}</td>
                  <td><span className={`mini-tier tier-${model.tiers[scenarioId].toLowerCase()}`}>{model.tiers[scenarioId]}</span></td>
                  <td><strong>{price(callCost(model, scenarioId), 3)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleModels.length === 0 && (
            <p className="empty-state">No models match that search.</p>
          )}
        </div>
      </section>

      <section className="section plans-section" id="plans">
        <div className="section-heading compact">
          <div>
            <p className="section-index">04 / SUBSCRIPTION MATH</p>
            <h2>What does a plan<br />really equal?</h2>
          </div>
          <div className="section-intro">
            <p>
              We divide each monthly fee by the estimated API cost of one
              <strong> {scenario.label.toLowerCase()}</strong> call.
            </p>
            <span>Equivalence is economic only—not a promise of included usage.</span>
          </div>
        </div>

        <div className="plan-grid">
          {plans.map((plan) => {
            const referenceModel = models.find((model) => model.id === plan.modelId)!;
            const equivalentCalls = plan.monthly / callCost(referenceModel, scenarioId);
            return (
              <article className="plan-card" key={`${plan.provider}-${plan.name}`}>
                <div className="plan-heading">
                  <span className="provider-orb" data-provider={plan.provider} />
                  <div>
                    <small>{plan.provider}</small>
                    <h3>{plan.name}</h3>
                  </div>
                  <a href={plan.source} rel="noreferrer" target="_blank" aria-label={`Source for ${plan.name}`}>↗</a>
                </div>
                <p className="plan-price"><strong>${plan.monthly}</strong><span>/ month</span></p>
                <div className="equivalent">
                  <span>API-cost equivalent</span>
                  <strong>≈ {compactNumber(equivalentCalls)} calls{plan.proxy ? "*" : ""}</strong>
                  <small>vs. {referenceModel.name} at {price(callCost(referenceModel, scenarioId), 3)} / call</small>
                </div>
                <p className="plan-note">{plan.note}</p>
              </article>
            );
          })}
        </div>
        <p className="proxy-note">
          * Proxy model used where a subscription dynamically routes across models
          or does not publish a one-to-one API equivalent.
        </p>
      </section>

      <section className="section methodology-section" id="method">
        <div>
          <p className="section-index">05 / READ THE FINE PRINT</p>
          <h2>Useful estimates.<br />Visible assumptions.</h2>
        </div>
        <div className="method-grid">
          <article>
            <span>01</span>
            <h3>One call is a profile</h3>
            <p>Each use case has a fixed input/output token pair. Real conversations grow with history, attachments, and retries.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Standard rates only</h3>
            <p>We exclude taxes, batch discounts, regional uplifts, caching, web search, code execution, images, and storage charges.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Plans are not API credits</h3>
            <p>A subscription bundles a product experience and variable limits. The call count only shows what the same dollars could buy via API.</p>
          </article>
          <article>
            <span>04</span>
            <h3>Tiers are directional</h3>
            <p>We combine published capabilities, context, task fit, and price. Run a small evaluation on your own prompts before committing.</p>
          </article>
        </div>
        <details className="sources">
          <summary>Official pricing &amp; model sources <span>+</span></summary>
          <div>
            <a href="https://developers.openai.com/api/docs/models/compare" target="_blank" rel="noreferrer">OpenAI API models ↗</a>
            <a href="https://openai.com/index/gpt-5-6/" target="_blank" rel="noreferrer">GPT-5.6 evaluations ↗</a>
            <a href="https://claude.com/pricing" target="_blank" rel="noreferrer">Claude pricing ↗</a>
            <a href="https://platform.claude.com/docs/en/about-claude/models/overview" target="_blank" rel="noreferrer">Claude model overview ↗</a>
            <a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">Gemini API pricing ↗</a>
            <a href="https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/" target="_blank" rel="noreferrer">Gemini model evidence ↗</a>
            <a href="https://docs.x.ai/developers/pricing" target="_blank" rel="noreferrer">xAI API pricing ↗</a>
            <a href="https://x.ai/news/grok-4-5" target="_blank" rel="noreferrer">Grok 4.5 evaluations ↗</a>
            <a href="https://api-docs.deepseek.com/quick_start/pricing/" target="_blank" rel="noreferrer">DeepSeek API pricing ↗</a>
            <a href="https://api-docs.deepseek.com/news/news260424" target="_blank" rel="noreferrer">DeepSeek V4 release ↗</a>
            <a href="https://mistral.ai/pricing/api/" target="_blank" rel="noreferrer">Mistral API pricing ↗</a>
          </div>
        </details>
      </section>

      <footer>
        <a className="brand" href="#top"><span className="brand-mark">T/T</span><span>TokenTier</span></a>
        <p>Choose on evidence. Re-check before you spend.</p>
        <span>Prices checked Aug 10, 2026 · USD · v1.0</span>
      </footer>
    </main>
  );
}

"use client";

import { capabilityIndex, costRatioBands, models, plans } from "@/lib/catalog";

// Source links are generated from the catalog the page is actually showing, so
// a link cannot outlive the row it documents or point somewhere the numbers no
// longer come from.
function catalogSources(): Array<{ label: string; url: string }> {
  const byUrl = new Map<string, string>();
  for (const model of models) {
    if (!byUrl.has(model.source)) byUrl.set(model.source, `${model.provider} API`);
  }
  for (const plan of plans) {
    if (!byUrl.has(plan.source)) byUrl.set(plan.source, `${plan.provider} plans`);
  }
  return [...byUrl.entries()]
    .map(([url, label]) => ({ url, label }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.url.localeCompare(b.url));
}

export function Methodology() {
  return (
    <details className="methodology-accordion" id="methodology">
      <summary>How estimates and equivalents work</summary>
      <div className="methodology-grid">
        <div className="methodology-card">
          <strong>1. Capability Gate</strong>
          <p>
            Each scenario declares a minimum {capabilityIndex.name} score (v{capabilityIndex.version}, {capabilityIndex.scale}),
            anchored to a named model so the number can be re-derived when the index is rebased. Scores are published by
            Artificial Analysis, not by us. A model with no published score is listed and priced but never given a tier.
            The bar is an editorial screening heuristic, not proof that a model will do your task.
          </p>
        </div>
        <div className="methodology-card">
          <strong>2. Derived Tiers</strong>
          <p>
            Tiers are computed, never hand-graded. Among the models that clear the bar and whose context window holds the
            work, S/A/B/C are assigned by cost ratio: a model within {costRatioBands[0]}x of the cheapest is S,
            within {costRatioBands[1]}x is A, within {costRatioBands[2]}x is B, else C. Equal costs always share a tier.
          </p>
        </div>
        <div className="methodology-card">
          <strong>3. Token Cost Math</strong>
          <p>Per-call costs calculate exact published input, cached input, and output token rates divided by 1,000,000.</p>
        </div>
        <div className="methodology-card">
          <strong>4. Cache Share</strong>
          <p>
            Every workload profile carries the share of input billed at the cached rate, and it applies to
            API costs as well as plan estimates. A plan that publishes its own cache behaviour overrides the
            profile. Ignoring this overstates the cost of agent work, where most of a large prompt is a cache read.
          </p>
        </div>
        <div className="methodology-card">
          <strong>5. Quota Conversions</strong>
          <p>
            Credit formulas use each provider&rsquo;s published multipliers and divisor; dollar-denominated caps convert
            at the same list rates the catalog stores. Only monthly allowances without shorter-window caps prove
            monthly sufficiency. Weekly, 5-hour, or multi-window caps are conditional; relative limits are unknown.
            Where no quota converts, capacity is left unscored rather than guessed.
          </p>
        </div>
        <div className="methodology-card">
          <strong>6. Price Break-Even Caveat</strong>
          <p>Where hard limits are not published, break-even indicates where API spend matches subscription price, not guaranteed throughput.</p>
        </div>
      </div>
    </details>
  );
}

export function PriceSources() {
  return (
    <details className="sources price-sources" id="price-sources">
      <summary>Primary pricing and quota sources</summary>
      <div>
        <a href={capabilityIndex.source} target="_blank" rel="noreferrer">Artificial Analysis capability index ↗</a>
        {catalogSources().map((source) => (
          <a href={source.url} key={source.url} rel="noreferrer" target="_blank">{source.label} ↗</a>
        ))}
      </div>
    </details>
  );
}

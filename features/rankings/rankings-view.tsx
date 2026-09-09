"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  catalog,
  capabilityIndex,
  defaultScenarioId,
  models,
  plans,
  scenarioFor,
  scenarios,
  settingsFor,
} from "@/lib/catalog";
import type { Model, Plan, ScenarioId } from "@/lib/catalog/types";
import { recommend } from "@/lib/domain/recommend";
import { workloadFromScenario } from "@/lib/domain/workload";
import { monthlyPrice, price } from "@/lib/format";
import { legacyRouteFor, parseRankingsScenario, replaceQuery, routes } from "@/lib/browser/url";
import {
  BackToTop,
  CatalogInspectorViews,
  useCatalogInspector,
} from "@/components/catalog-inspector";
import { PriceBook } from "./price-book";
import { TierBoard, type Lane } from "./tier-board";
import {
  readColumnPreferences,
  writeColumnPreferences,
  defaultColumnPreferences,
  type ColumnPreferences,
} from "./columns";

// The preset's own typical month, priced with no budget ceiling: Rankings
// answers "what costs least for this kind of work", so a budget would be a
// different question. Recommend is where a budget applies.
function cheapestQualified(scenarioId: ScenarioId) {
  const scenario = scenarioFor(scenarioId);
  const workload = { ...workloadFromScenario(scenario), budget: Infinity };
  return recommend(catalog, scenario, workload, "cost");
}

// Carry the preset itself to Recommend, but not the reader's budget or access
// requirement: those are their settings, and a link from Rankings should not
// silently reset them.
function customizeHref(scenarioId: ScenarioId): string {
  const scenario = scenarioFor(scenarioId);
  const params = new URLSearchParams({
    scenario: scenario.id,
    input: String(scenario.input),
    output: String(scenario.output),
    calls: String(scenario.calls),
    cache: String(scenario.cacheRatio),
  });
  return `${routes.recommend}?${params.toString()}`;
}

export function RankingsView() {
  const router = useRouter();
  const [scenarioId, setScenarioId] = useState<ScenarioId>(defaultScenarioId);
  const [lane, setLane] = useState<Lane>("api");
  const [columns, setColumns] = useState<ColumnPreferences>(defaultColumnPreferences);
  const [announcement, setAnnouncement] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const inspector = useCatalogInspector(setAnnouncement);

  // One hydration pass: read the link, then the saved preferences, then settle.
  // Nothing is written back before everything has been parsed, so opening a
  // link never overwrites the preferences it was about to replace.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from the URL and stored preferences */
    const params = new URLSearchParams(window.location.search);

    // Pre-refactor links put every view on the root. Hand the whole query to
    // the route that owns it rather than dropping the reader on Rankings.
    const legacy = legacyRouteFor(params);
    if (legacy && legacy !== "rankings") {
      params.delete("view");
      const query = params.toString();
      router.replace(`${routes[legacy]}${query ? `?${query}` : ""}`);
      return;
    }

    setScenarioId(parseRankingsScenario(params, defaultScenarioId, scenarios));
    setColumns(readColumnPreferences());
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [router]);

  useEffect(() => {
    if (!hydrated) return;
    replaceQuery(new URLSearchParams({ scenario: scenarioId }));
  }, [hydrated, scenarioId]);

  useEffect(() => {
    if (!hydrated) return;
    writeColumnPreferences(columns);
  }, [columns, hydrated]);

  const scenario = scenarioFor(scenarioId);
  const settings = useMemo(() => settingsFor(scenarioId), [scenarioId]);
  const leaders = useMemo(() => cheapestQualified(scenarioId), [scenarioId]);
  const bestModel = leaders.api.best;
  // The dock leads the board, so it honours the same ceiling: naming a plan the
  // cheapest qualifying option while the board refuses to rank it would be two
  // answers to one question.
  const bestPlan = leaders.plans.evaluations
    .filter((evaluation) => evaluation.eligible && evaluation.plan.monthly !== null)
    .filter((evaluation) => (evaluation.plan.monthly as number) <= scenario.planPriceCap)
    .sort((a, b) => (a.plan.monthly ?? Infinity) - (b.plan.monthly ?? Infinity))
    .at(0) ?? null;

  const inspect = (item: Model | Plan) => inspector.inspect(item);

  return (
    <main className="view-panel">
      <a className="skip-link" href="#tier-board">Skip to comparison</a>
      <div aria-live="polite" className="visually-hidden">{announcement}</div>

      <section className="explore-hero" id="explore-top">
        <div className="explore-hero-main">
          <h1 id="explore-top-heading" tabIndex={-1}>Compare AI APIs and plans.</h1>
          <p className="explore-hero-sub">Independent pricing calculator, tier lists, and break-even limits across leading foundation models.</p>
          <div className="hero-stats-strip">
            <span><strong>{models.length}</strong> API models</span>
            <span className="dot-sep">·</span>
            <span><strong>{plans.filter((plan) => plan.kind === "Subscription").length}</strong> subscriptions</span>
            <span className="dot-sep">·</span>
            <span><strong>{scenarios.length}</strong> workload presets</span>
            <span className="dot-sep">·</span>
            <span>tiers derived from <strong>{capabilityIndex.name}</strong> v{capabilityIndex.version}</span>
          </div>
        </div>
        <Link className="button button-ghost hero-cta" href={customizeHref(scenarioId)}>
          Get a recommendation <span>→</span>
        </Link>
      </section>

      <div className="explore-workspace">
        <aside aria-labelledby="profile-preset-title" className="scenario-dock">
          <header className="scenario-dock-heading">
            <span>Profile preset</span>
            <h2 id="profile-preset-title">{scenario.label}</h2>
          </header>
          <label className="scenario-dock-select" htmlFor="explore-scenario">
            <span>Use case</span>
            <select id="explore-scenario" value={scenarioId} onChange={(event) => setScenarioId(event.target.value as ScenarioId)}>
              {scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <p className="scenario-dock-description">{scenario.description}</p>
          <div className="preset-call" aria-label={`${scenario.input.toLocaleString()} input and ${scenario.output.toLocaleString()} output tokens per call, ${scenario.calls.toLocaleString()} calls a month, ${Math.round(scenario.cacheRatio * 100)} percent of input from cache`}>
            <span>Typical month</span>
            <strong>{scenario.input.toLocaleString()} in + {scenario.output.toLocaleString()} out</strong>
            <dl className="preset-call-facts">
              <div><dt>Calls</dt><dd>{scenario.calls.toLocaleString()} / mo</dd></div>
              <div><dt>From cache</dt><dd>{Math.round(scenario.cacheRatio * 100)}% of input</dd></div>
            </dl>
          </div>

          <div className="preset-leaders">
            <span>Cheapest that clears the bar</span>
            {bestModel ? (
              <button className="preset-leader" onClick={() => inspect(bestModel.model)} type="button">
                <span className="provider-orb" data-provider={bestModel.model.provider} />
                <span><strong title={bestModel.model.name}>{bestModel.model.name}</strong><small>API · {price(bestModel.costPerCall, 4)} / call</small></span>
                <b>{monthlyPrice(bestModel.monthlyCost)}<small>/ mo</small></b>
              </button>
            ) : (
              <p className="preset-leader-empty">No model clears the {scenario.label.toLowerCase()} bar at this context size.</p>
            )}
            {bestPlan ? (
              <button className="preset-leader" onClick={() => inspect(bestPlan.plan)} type="button">
                <span className="provider-orb" data-provider={bestPlan.plan.provider} />
                <span><strong title={bestPlan.plan.name}>{bestPlan.plan.name}</strong><small>Plan · via {bestPlan.workingModel?.name ?? bestPlan.plan.provider}</small></span>
                <b>${bestPlan.plan.monthly}<small>/ mo</small></b>
              </button>
            ) : (
              <p className="preset-leader-empty">No subscription plan under ${scenario.planPriceCap}/mo clears the bar for this preset.</p>
            )}
          </div>

          <p className="scenario-dock-rationale">{scenario.rationale}</p>
          <p className="scenario-dock-note">Used for the tier list and price estimates. Excludes tools, search, images, storage, taxes, and retries.</p>
          <Link className="scenario-dock-action" href={customizeHref(scenarioId)}>
            Customize in Recommend <span>→</span>
          </Link>
        </aside>

        <div className="explore-content">
          <TierBoard
            isCompared={inspector.isCompared}
            lane={lane}
            onInspect={inspect}
            onLaneChange={setLane}
            scenarioId={scenarioId}
          />
          <PriceBook
            announce={setAnnouncement}
            columns={columns}
            lane={lane}
            onColumnsChange={setColumns}
            onInspect={inspect}
            onLaneChange={setLane}
            scenarioId={scenarioId}
          />
        </div>
      </div>

      <CatalogInspectorViews
        context={{ scenarioId, settings, calls: scenario.calls }}
        inspector={inspector}
      />
      <BackToTop hidden={inspector.compareList.length > 0} />
    </main>
  );
}

export default RankingsView;

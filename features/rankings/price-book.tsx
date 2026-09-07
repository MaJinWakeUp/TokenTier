"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  modelById,
  modelPlacement,
  models,
  planPlacement,
  planProviderNames,
  plans,
  providerNames,
  scenarioFor,
  settingsFor,
} from "@/lib/catalog";
import type { Model, Plan, ScenarioId } from "@/lib/catalog/types";
import { contextSize, metricValue } from "@/lib/domain/eligibility";
import { confidenceScore, placementSort, planWorkingModel } from "@/lib/domain/placement";
import { callCost, planEstimate } from "@/lib/domain/pricing";
import {
  formatEstimateRange,
  formatMoneyRange,
  metricLabels,
  placementClass,
  placementLabel,
  placementReason,
  planPrice,
  planQuota,
  price,
} from "@/lib/format";
import { Icon } from "@/components/icon";
import {
  apiColumnLabels,
  defaultApiColumns,
  defaultPlanColumns,
  planColumnLabels,
  type ApiColumnKey,
  type ColumnPreferences,
  type PlanColumnKey,
} from "./columns";
import type { Lane } from "./tier-board";
import { Methodology, PriceSources } from "./methodology";

type SortState = { lane: Lane; by: string; direction: "asc" | "desc" };

function SortableHeader({
  label,
  columnKey,
  sort,
  onSort,
  title,
}: {
  label: string;
  columnKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  title: string;
}) {
  const active = sort.by === columnKey;
  return (
    <th aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} className="sortable-header">
      <button onClick={() => onSort(columnKey)} title={title} type="button">
        <span className="th-content">
          {label} {active && <Icon name={sort.direction === "asc" ? "arrow-up" : "arrow-down"} size={12} />}
        </span>
      </button>
    </th>
  );
}

export function PriceBook({
  scenarioId,
  lane,
  onLaneChange,
  columns,
  onColumnsChange,
  onInspect,
  announce,
}: {
  scenarioId: ScenarioId;
  lane: Lane;
  onLaneChange: (lane: Lane) => void;
  columns: ColumnPreferences;
  onColumnsChange: (next: ColumnPreferences) => void;
  onInspect: (item: Model | Plan) => void;
  announce: (message: string) => void;
}) {
  const scenario = scenarioFor(scenarioId);
  const metric = scenario.gate.metric;
  const settings = useMemo(() => settingsFor(scenarioId), [scenarioId]);

  const [query, setQuery] = useState("");
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [sortState, setSortState] = useState<SortState>({ lane: "api", by: "cost", direction: "asc" });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const columnsSelectorRef = useRef<HTMLDetailsElement>(null);

  // Switching lane changes which columns exist, so the sort resets to that
  // lane's default. Deriving it during render keeps the two from disagreeing
  // for a frame, which an effect-based reset would allow.
  const sort: SortState = sortState.lane === lane
    ? sortState
    : { lane, by: lane === "api" ? "cost" : "price", direction: "asc" };

  const handleSort = (columnKey: string) => {
    if (sort.by === columnKey) {
      const direction = sort.direction === "asc" ? "desc" : "asc";
      setSortState({ lane, by: columnKey, direction });
      announce(`Sorted by ${columnKey} ${direction === "asc" ? "ascending" : "descending"}`);
    } else {
      setSortState({ lane, by: columnKey, direction: "asc" });
      announce(`Sorted by ${columnKey} ascending`);
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      const editing = tag === "input" || tag === "textarea" || tag === "select";
      if (event.key === "/" && !editing) {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === "Escape" && columnsSelectorRef.current?.open) {
        columnsSelectorRef.current.open = false;
      }
    };
    const onDocClick = (event: MouseEvent) => {
      if (columnsSelectorRef.current?.open && !columnsSelectorRef.current.contains(event.target as Node)) {
        columnsSelectorRef.current.open = false;
      }
    };
    window.addEventListener("keydown", handler);
    document.addEventListener("click", onDocClick);
    return () => {
      window.removeEventListener("keydown", handler);
      document.removeEventListener("click", onDocClick);
    };
  }, []);

  const toggleProvider = (name: string) => {
    if (name === "All") {
      setSelectedProviders([]);
      announce("Showing all providers");
      return;
    }
    setSelectedProviders((prev) => {
      const next = prev.includes(name) ? prev.filter((entry) => entry !== name) : [...prev, name];
      announce(next.length === 0 ? "Showing all providers" : `Filtered by ${next.join(", ")}`);
      return next;
    });
  };

  const visibleModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const sortMetric = scenarioFor(scenarioId).gate.metric;
    return models
      .filter((model) =>
        (selectedProviders.length === 0 || selectedProviders.includes(model.provider))
        && (!normalized || `${model.provider} ${model.name}`.toLowerCase().includes(normalized)))
      .sort((a, b) => {
        let comparison = 0;
        if (sort.by === "name") comparison = a.name.localeCompare(b.name);
        else if (sort.by === "input") comparison = a.input - b.input;
        else if (sort.by === "cached") comparison = (a.cached ?? a.input) - (b.cached ?? b.input);
        else if (sort.by === "output") comparison = a.output - b.output;
        else if (sort.by === "context") comparison = contextSize(a.context) - contextSize(b.context);
        else if (sort.by === "index") comparison = (metricValue(a.capability, sortMetric) ?? -Infinity) - (metricValue(b.capability, sortMetric) ?? -Infinity);
        else if (sort.by === "fit") comparison = placementSort(modelPlacement(a.id, scenarioId), modelPlacement(b.id, scenarioId));
        else comparison = callCost(a, settings) - callCost(b, settings);
        return sort.direction === "asc" ? comparison : -comparison;
      });
  }, [query, scenarioId, selectedProviders, settings, sort.by, sort.direction]);

  const visiblePlans = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return plans
      .filter((plan) =>
        (selectedProviders.length === 0 || selectedProviders.includes(plan.provider))
        && (!normalized || `${plan.provider} ${plan.name} ${plan.kind}`.toLowerCase().includes(normalized)))
      .sort((a, b) => {
        let comparison = 0;
        if (sort.by === "name") comparison = a.name.localeCompare(b.name);
        else if (sort.by === "type") comparison = a.kind.localeCompare(b.kind);
        else if (sort.by === "confidence") comparison = confidenceScore[a.confidence] - confidenceScore[b.confidence];
        else if (sort.by === "fit") comparison = placementSort(planPlacement(a.id, scenarioId), planPlacement(b.id, scenarioId));
        else comparison = (a.monthly ?? Infinity) - (b.monthly ?? Infinity);
        return sort.direction === "asc" ? comparison : -comparison;
      });
  }, [query, scenarioId, selectedProviders, sort.by, sort.direction]);

  const apiColumns = columns.api;
  const planColumns = columns.plans;
  const visibleCount = lane === "api" ? visibleModels.length : visiblePlans.length;

  return (
    <section className="section prices-section" id="prices">
      <div className="section-heading explore-section-heading">
        <div>
          <span className="section-kicker">{scenario.label}</span>
          <h2>Price book</h2>
          <p>Token rates, plan prices, credits, and published limits for this preset.</p>
        </div>
        <div className="book-switch explore-lane-switch" role="group" aria-label="Price book lane">
          <button aria-pressed={lane === "api"} className={lane === "api" ? "active" : ""} onClick={() => onLaneChange("api")} type="button">API rates <span>{models.length}</span></button>
          <button aria-pressed={lane === "plans"} className={lane === "plans" ? "active" : ""} onClick={() => onLaneChange("plans")} type="button">Plans &amp; access <span>{plans.length}</span></button>
        </div>
      </div>

      <div className="table-tools">
        <div className="table-tools-top">
          <label className="search-field">
            <Icon className="search-icon" name="search" size={15} />
            <input
              aria-label={`Search ${lane}`}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={lane === "api" ? "Search model or provider" : "Search plan, client, or provider"}
              ref={searchInputRef}
              type="search"
              value={query}
            />
            <kbd className="search-shortcut-kbd">/</kbd>
          </label>
          <details className="columns-selector" ref={columnsSelectorRef}>
            <summary className="columns-trigger">
              <span>Columns ({lane === "api" ? Object.values(apiColumns).filter(Boolean).length + 1 : Object.values(planColumns).filter(Boolean).length + 1})</span>
              <Icon name="chevron-down" size={13} />
            </summary>
            <div className="columns-menu">
              <div className="columns-menu-header">
                <span>Show columns</span>
                <button
                  className="columns-reset-btn"
                  onClick={() => onColumnsChange(lane === "api"
                    ? { ...columns, api: { ...defaultApiColumns } }
                    : { ...columns, plans: { ...defaultPlanColumns } })}
                  type="button"
                >
                  Reset
                </button>
              </div>
              {lane === "api"
                ? (Object.keys(apiColumnLabels) as ApiColumnKey[]).map((col) => (
                    <label className="column-option" key={col}>
                      <input
                        checked={apiColumns[col]}
                        onChange={(event) => onColumnsChange({ ...columns, api: { ...apiColumns, [col]: event.target.checked } })}
                        type="checkbox"
                      />
                      <span>{apiColumnLabels[col]}</span>
                    </label>
                  ))
                : (Object.keys(planColumnLabels) as PlanColumnKey[]).map((col) => (
                    <label className="column-option" key={col}>
                      <input
                        checked={planColumns[col]}
                        onChange={(event) => onColumnsChange({ ...columns, plans: { ...planColumns, [col]: event.target.checked } })}
                        type="checkbox"
                      />
                      <span>{planColumnLabels[col]}</span>
                    </label>
                  ))}
            </div>
          </details>
        </div>

        <div className="provider-filters" role="group" aria-label="Filter by provider">
          {(lane === "api" ? providerNames : planProviderNames).map((name) => {
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
        {lane === "api" ? (
          <table>
            <caption className="visually-hidden">API rates and fit for {scenario.label}</caption>
            <thead>
              <tr>
                <SortableHeader columnKey="name" label="API model" onSort={handleSort} sort={sort} title="Sort by model name" />
                {apiColumns.input && <SortableHeader columnKey="input" label="Input / 1M" onSort={handleSort} sort={sort} title="Sort by input token rate" />}
                {apiColumns.cached && <SortableHeader columnKey="cached" label="Cached input" onSort={handleSort} sort={sort} title="Sort by cached input rate" />}
                {apiColumns.output && <SortableHeader columnKey="output" label="Output / 1M" onSort={handleSort} sort={sort} title="Sort by output token rate" />}
                {apiColumns.context && <SortableHeader columnKey="context" label="Context" onSort={handleSort} sort={sort} title="Sort by context window size" />}
                {apiColumns.index && <SortableHeader columnKey="index" label="Index" onSort={handleSort} sort={sort} title={`Sort by ${metricLabels[metric]}`} />}
                {apiColumns.fit && <SortableHeader columnKey="fit" label="Fit" onSort={handleSort} sort={sort} title="Sort by scenario fit" />}
                {apiColumns.cost && <SortableHeader columnKey="cost" label="Est. / call" onSort={handleSort} sort={sort} title="Sort by estimated per-call cost" />}
              </tr>
            </thead>
            <tbody>
              {visibleModels.map((model) => {
                const perCall = callCost(model, settings);
                const placement = modelPlacement(model.id, scenarioId);
                const modelIndex = metricValue(model.capability, metric);
                return (
                  <tr key={model.id}>
                    <td className="sticky-col">
                      <div className="table-item-cell">
                        <span className="provider-orb" data-provider={model.provider} />
                        <div className="model-cell">
                          <div className="model-cell-header">
                            <button className="table-item-name-btn" onClick={() => onInspect(model)} type="button"><strong>{model.name}</strong></button>
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
                    {apiColumns.input && <td>{price(model.input)}</td>}
                    {apiColumns.cached && <td>{model.cached === null ? "—" : price(model.cached, 4)}</td>}
                    {apiColumns.output && <td>{price(model.output)}</td>}
                    {apiColumns.context && <td>{model.context}</td>}
                    {apiColumns.index && (
                      <td>
                        {modelIndex === null
                          ? <span className="muted-dash" title={`Not scored on the ${metricLabels[metric]}`}>—</span>
                          : <a className="index-value" href={model.capability?.source} rel="noreferrer" target="_blank" title={`${metricLabels[metric]} ${modelIndex} (v${model.capability?.indexVersion}${model.capability?.variant ? `, ${model.capability.variant}` : ""}) · verified ${model.capability?.verifiedAt}`}>{modelIndex}</a>}
                      </td>
                    )}
                    {apiColumns.fit && (
                      <td>
                        <span className={`mini-tier ${placementClass(placement)}`} title={placementReason(placement, scenario, metric)}>
                          {placementLabel(placement)}
                        </span>
                      </td>
                    )}
                    {apiColumns.cost && <td><strong>{price(perCall, 3)}</strong></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="plan-table">
            <caption className="visually-hidden">Plan prices, quotas, and fit for {scenario.label}</caption>
            <thead>
              <tr>
                <SortableHeader columnKey="name" label="Plan or access path" onSort={handleSort} sort={sort} title="Sort by plan name" />
                {planColumns.type && <SortableHeader columnKey="type" label="Type" onSort={handleSort} sort={sort} title="Sort by plan type" />}
                {planColumns.price && <SortableHeader columnKey="price" label="Price" onSort={handleSort} sort={sort} title="Sort by monthly price" />}
                {planColumns.quota && <th>Published quota</th>}
                {planColumns.apiIncluded && <th>API included?</th>}
                {planColumns.equivalent && <th>API-cost equivalent</th>}
                {planColumns.fit && <SortableHeader columnKey="fit" label="Fit" onSort={handleSort} sort={sort} title="Sort by scenario fit" />}
                {planColumns.evidence && <SortableHeader columnKey="confidence" label="Evidence" onSort={handleSort} sort={sort} title="Sort by quota confidence" />}
              </tr>
            </thead>
            <tbody>
              {visiblePlans.map((plan) => {
                const workingModel = planWorkingModel(plan, scenario, settings, modelById);
                const estimate = planEstimate(plan, settings, workingModel, modelById.get(plan.modelIds[0]));
                const placement = planPlacement(plan.id, scenarioId);
                return (
                  <tr key={plan.id}>
                    <td className="sticky-col">
                      <div className="table-item-cell">
                        <span className="provider-orb" data-provider={plan.provider} />
                        <div className="model-cell">
                          <div className="model-cell-header">
                            <button className="table-item-name-btn" onClick={() => onInspect(plan)} type="button"><strong>{plan.name}</strong></button>
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
                    {planColumns.type && <td><span className="kind-pill">{plan.kind}</span></td>}
                    {planColumns.price && <td><strong>{planPrice(plan)}</strong>{plan.kind === "Subscription" && <small className="per-month"> / mo</small>}</td>}
                    {planColumns.quota && <td className="wrap-cell">{planQuota(plan, scenarioId)}</td>}
                    {planColumns.apiIncluded && <td>{plan.apiIncluded}</td>}
                    {planColumns.equivalent && (
                      <td>
                        {estimate ? (
                          <>
                            <strong>{formatEstimateRange(estimate.callsLow, estimate.callsHigh)} calls</strong>
                            <small className="estimate-detail">
                              {formatMoneyRange(estimate.valueLow, estimate.valueHigh)} · {estimate.basis.label}
                            </small>
                            {workingModel && (
                              <small className="estimate-detail" title={`Cheapest model on this plan that clears the ${scenario.label} bar`}>
                                via {workingModel.name}
                              </small>
                            )}
                          </>
                        ) : <span className="muted-dash">Your API bill</span>}
                      </td>
                    )}
                    {planColumns.fit && (
                      <td>
                        <span className={`mini-tier ${placementClass(placement)}`} title={placementReason(placement, scenario, metric)}>
                          {placementLabel(placement)}
                        </span>
                      </td>
                    )}
                    {planColumns.evidence && <td><span className={`evidence-badge evidence-${plan.confidence.toLowerCase()}`}>{plan.confidence}</span><small className="estimate-detail">{plan.evidence}</small></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {visibleCount === 0 && (
          <div className="empty-state">
            <p>No entries match that search or provider filter.</p>
            <button className="button button-ghost" onClick={() => { setQuery(""); setSelectedProviders([]); }} type="button">Clear search and filters</button>
          </div>
        )}
      </div>
      <p className="book-note"><strong>Subscription access is not production API credit.</strong> An API-cost equivalent is not a usage quota unless the provider publishes credits or limits.</p>

      <Methodology />
      <PriceSources />
    </section>
  );
}

export default PriceBook;

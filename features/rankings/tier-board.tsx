"use client";

import {
  capabilityIndex,
  gateSummaryFor,
  modelById,
  modelPlacement,
  models,
  planPlacement,
  plans,
  scenarioFor,
  settingsFor,
} from "@/lib/catalog";
import type { Model, Plan, ScenarioId } from "@/lib/catalog/types";
import { scenarioTokens } from "@/lib/domain/eligibility";
import { placementSort, planWorkingModel } from "@/lib/domain/placement";
import { callCost } from "@/lib/domain/pricing";
import { metricLabels, price, tierDescriptions, tierOrder } from "@/lib/format";

export type Lane = "api" | "plans";

// Why an item is not on the board, in the reader's terms. Nothing is silently
// dropped: an unscored or too-small model is listed with its reason, and a plan
// whose quota cannot be converted says so rather than disappearing.
function reasonFor(state: string, scenarioId: ScenarioId, index?: number, minIndex?: number): string {
  const scenario = scenarioFor(scenarioId);
  switch (state) {
    case "below":
      return `${metricLabels[scenario.gate.metric]} ${index} · below the ${minIndex} bar`;
    case "context":
      return `Context window too small for ${scenarioTokens(scenario).toLocaleString()} tokens`;
    case "unpriced":
      return "No fixed monthly price to rank against";
    default:
      return "Not independently scored";
  }
}

export function TierBoard({
  scenarioId,
  lane,
  onLaneChange,
  onInspect,
  isCompared,
}: {
  scenarioId: ScenarioId;
  lane: Lane;
  onLaneChange: (lane: Lane) => void;
  onInspect: (item: Model | Plan) => void;
  isCompared: (id: string) => boolean;
}) {
  const scenario = scenarioFor(scenarioId);
  const metric = scenario.gate.metric;
  const settings = settingsFor(scenarioId);
  const gate = gateSummaryFor(scenarioId);
  const subscriptions = plans.filter((plan) => plan.kind === "Subscription");

  const excludedModels = models
    .map((model) => ({ model, placement: modelPlacement(model.id, scenarioId) }))
    .filter(({ placement }) => placement.state !== "tier")
    .sort((a, b) => placementSort(b.placement, a.placement));

  const excludedPlans = subscriptions
    .map((plan) => ({ plan, placement: planPlacement(plan.id, scenarioId) }))
    .filter(({ placement }) => placement.state !== "tier");

  return (
    <section className="section tier-section" id="tier-board">
      <div className="section-heading explore-section-heading">
        <div>
          <span className="section-kicker">{scenario.label}</span>
          <h2>Tier list</h2>
          <p>{scenario.description}</p>
        </div>
        <div className="book-switch explore-lane-switch" role="group" aria-label="Tier list lane">
          <button aria-pressed={lane === "api"} className={lane === "api" ? "active" : ""} onClick={() => onLaneChange("api")} type="button">API models <span>{models.length}</span></button>
          <button aria-pressed={lane === "plans"} className={lane === "plans" ? "active" : ""} onClick={() => onLaneChange("plans")} type="button">Plans <span>{subscriptions.length}</span></button>
        </div>
      </div>

      <div className="gate-banner">
        <div className="gate-banner-rule">
          <strong>{metricLabels[metric]} &ge; {scenario.gate.minIndex}</strong>
          <span>{gate.qualifying} of {gate.total} models qualify for {scenario.label}</span>
        </div>
        <p>
          {scenario.gate.rationale}{" "}
          Anchored to {models.find((model) => model.id === scenario.gate.anchor)?.name ?? scenario.gate.anchor}
          {" "}on {capabilityIndex.name} v{capabilityIndex.version}.
        </p>
      </div>

      <div className="tier-board">
        {tierOrder.map((tier) => (
          <div className={`tier-row tier-${tier.toLowerCase()}`} key={tier}>
            <div className="tier-label"><strong>{tier}</strong><span>{tierDescriptions[tier]}</span></div>
            <div className="tier-models" role="group" aria-label={`${tier} tier items`}>
              {lane === "api" ? (() => {
                const items = models
                  .filter((model) => {
                    const placement = modelPlacement(model.id, scenarioId);
                    return placement.state === "tier" && placement.tier === tier;
                  })
                  .sort((a, b) => callCost(a, settings) - callCost(b, settings));
                if (items.length === 0) return <p className="tier-empty">No models ranked in this tier for this scenario.</p>;
                return items.map((item) => (
                  <button
                    aria-label={`${item.name}, ${item.provider}, ${price(callCost(item, settings), 3)} per call`}
                    className={`tier-model ${isCompared(item.id) ? "selected" : ""}`}
                    key={item.id}
                    onClick={() => onInspect(item)}
                    type="button"
                  >
                    <span className="provider-orb" data-provider={item.provider} />
                    <span><strong title={item.name}>{item.name}</strong><small>{item.provider}</small></span>
                    <b>{price(callCost(item, settings), 3)}<small>/ call</small></b>
                  </button>
                ));
              })() : (() => {
                const items = subscriptions
                  .filter((plan) => {
                    const placement = planPlacement(plan.id, scenarioId);
                    return placement.state === "tier" && placement.tier === tier;
                  })
                  .sort((a, b) => (a.monthly ?? Infinity) - (b.monthly ?? Infinity));
                if (items.length === 0) return <p className="tier-empty">No plans ranked in this tier for this scenario.</p>;
                return items.map((item) => (
                  <button
                    aria-label={`${item.name}, ${item.provider}, $${item.monthly} per month`}
                    className={`tier-model ${isCompared(item.id) ? "selected" : ""}`}
                    key={item.id}
                    onClick={() => onInspect(item)}
                    type="button"
                  >
                    <span className="provider-orb" data-provider={item.provider} />
                    <span>
                      <strong title={item.name}>{item.name}</strong>
                      <small>via {planWorkingModel(item, scenario, settings, modelById)?.name ?? item.provider}</small>
                    </span>
                    <b>${item.monthly}<small>/ month</small></b>
                  </button>
                ));
              })()}
            </div>
          </div>
        ))}
      </div>
      <p className="tier-note">
        Everything on the board already clears the {scenario.label.toLowerCase()} capability bar, so the
        letters rank value: models by per-call cost, plans by price and quota evidence. Select a card to view specs or compare.
      </p>

      {lane === "api" && excludedModels.length > 0 && (
        <details className="gate-excluded">
          <summary>Not on the board ({excludedModels.length})</summary>
          <ul>
            {excludedModels.map(({ model, placement }) => (
              <li key={model.id}>
                <span className="provider-orb" data-provider={model.provider} />
                <button className="table-item-name-btn" onClick={() => onInspect(model)} type="button">
                  <strong>{model.name}</strong>
                </button>
                <span className="gate-excluded-reason">
                  {reasonFor(
                    placement.state,
                    scenarioId,
                    placement.state === "below" ? placement.index : undefined,
                    placement.state === "below" ? placement.minIndex : undefined,
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {lane === "plans" && excludedPlans.length > 0 && (
        <details className="gate-excluded">
          <summary>Not on the board ({excludedPlans.length})</summary>
          <ul>
            {excludedPlans.map(({ plan, placement }) => (
              <li key={plan.id}>
                <span className="provider-orb" data-provider={plan.provider} />
                <button className="table-item-name-btn" onClick={() => onInspect(plan)} type="button">
                  <strong>{plan.name}</strong>
                </button>
                <span className="gate-excluded-reason">
                  {placement.state === "unscored"
                    ? "Quota is conditional or cannot be converted to this profile"
                    : reasonFor(
                        placement.state,
                        scenarioId,
                        placement.state === "below" ? placement.index : undefined,
                        placement.state === "below" ? placement.minIndex : undefined,
                      )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export default TierBoard;

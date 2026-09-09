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

  // The curve fills every letter whenever there are at least as many distinct
  // prices as tiers, so an empty row means a genuinely tiny population rather
  // than a gap in the middle of the board. Either way it is not drawn.
  const ranked: Array<Model | Plan> = lane === "api" ? models : subscriptions;
  const rows = tierOrder
    .map((tier) => ({
      tier,
      items: ranked
        .filter((item) => {
          const placement = lane === "api"
            ? modelPlacement(item.id, scenarioId)
            : planPlacement(item.id, scenarioId);
          return placement.state === "tier" && placement.tier === tier;
        })
        .sort((a, b) => (lane === "api"
          ? callCost(a as Model, settings) - callCost(b as Model, settings)
          : ((a as Plan).monthly ?? Infinity) - ((b as Plan).monthly ?? Infinity))),
    }))
    .filter((row) => row.items.length > 0);

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

      {rows.length === 0 ? (
        // Nothing in this lane clears the bar. Saying so beats an empty board
        // under a note claiming everything on it already qualified.
        <p className="tier-board-empty">
          No {lane === "api" ? "model" : "subscription plan"} clears the {scenario.label.toLowerCase()} bar
          {lane === "plans" ? " with a quota that converts to this profile" : ""}. Every one is listed below with the reason.
        </p>
      ) : (
      <div className="tier-board">
        {rows.map(({ tier, items }) => (
          <div className={`tier-row tier-${tier.toLowerCase()}`} key={tier}>
            <div className="tier-label"><strong>{tier}</strong><span>{tierDescriptions[tier]}</span></div>
            <div className="tier-models" role="group" aria-label={`${tier} tier items`}>
              {items.map((item) => (
                <button
                  aria-label={lane === "api"
                    ? `${item.name}, ${item.provider}, ${price(callCost(item as Model, settings), 3)} per call`
                    : `${item.name}, ${item.provider}, $${(item as Plan).monthly} per month`}
                  className={`tier-model ${isCompared(item.id) ? "selected" : ""}`}
                  key={item.id}
                  onClick={() => onInspect(item)}
                  type="button"
                >
                  <span className="provider-orb" data-provider={item.provider} />
                  <span>
                    <strong title={item.name}>{item.name}</strong>
                    <small>
                      {lane === "api"
                        ? item.provider
                        : `via ${planWorkingModel(item as Plan, scenario, settings, modelById)?.name ?? item.provider}`}
                    </small>
                  </span>
                  {lane === "api"
                    ? <b>{price(callCost(item as Model, settings), 3)}<small>/ call</small></b>
                    : <b>${(item as Plan).monthly}<small>/ month</small></b>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      )}
      {rows.length > 0 && (
        <p className="tier-note">
          Everything on the board already clears the {scenario.label.toLowerCase()} capability bar, so the
          letters rank value: models by per-call cost, plans by price and quota evidence. Select a card to view specs or compare.
        </p>
      )}

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

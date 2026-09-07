"use client";

import {
  capabilityIndex,
  itemPlacement,
  modelById,
  scenarioFor,
  scenarios,
} from "@/lib/catalog";
import type { Model, Plan, ScenarioId, UsageSettings } from "@/lib/catalog/types";
import { metricValue } from "@/lib/domain/eligibility";
import { planWorkingModel } from "@/lib/domain/placement";
import { callCost } from "@/lib/domain/pricing";
import {
  monthlyPrice,
  placementClass,
  placementLabel,
  placementReason,
  planPrice,
  planQuota,
  price,
} from "@/lib/format";
import { Icon } from "./icon";
import { Modal } from "./modal";

export type InspectionContext = {
  scenarioId: ScenarioId;
  settings: UsageSettings;
  calls: number;
};

// The details a reader needs before trusting a number: the published rates, the
// score the tier was derived from, and where each came from. Identical whether
// the card was opened from Rankings or from Recommend, so the two surfaces can
// never describe the same item differently.
export function ItemDetailsModal({
  item,
  context,
  inCompare,
  onToggleCompare,
  onClose,
}: {
  item: Model | Plan | null;
  context: InspectionContext;
  inCompare: boolean;
  onToggleCompare: (item: Model | Plan) => void;
  onClose: () => void;
}) {
  const scenario = scenarioFor(context.scenarioId);
  const metric = scenario.gate.metric;

  return (
    <Modal
      isOpen={item !== null}
      maxWidth="640px"
      onClose={onClose}
      title={
        item && (
          <>
            <span className="provider-orb" data-provider={item.provider} />
            <div>
              <h3 id="detail-modal-title">{item.name}</h3>
              <small>{item.provider} · {"kind" in item ? item.kind : "Foundation Model"}</small>
            </div>
          </>
        )
      }
      titleId="detail-modal-title"
    >
      {item && (
        <>
          <div className="detail-modal-body">
            {"input" in item ? (
              <div className="detail-specs-grid">
                <div className="spec-box"><small>Input Rate</small><strong>{price(item.input)} / 1M</strong></div>
                <div className="spec-box"><small>Cached Input</small><strong>{item.cached !== null ? `${price(item.cached, 4)} / 1M` : "—"}</strong></div>
                <div className="spec-box"><small>Output Rate</small><strong>{price(item.output)} / 1M</strong></div>
                <div className="spec-box"><small>Context Window</small><strong>{item.context}</strong></div>
                <div className="spec-box"><small>Est. Call Cost ({scenario.label})</small><strong>{price(callCost(item, context.settings), 4)}</strong></div>
                <div className="spec-box"><small>{context.calls.toLocaleString()} Calls / Month</small><strong>{monthlyPrice(callCost(item, context.settings) * context.calls)}</strong></div>
                <div className="spec-box full-span">
                  <small>{capabilityIndex.name}</small>
                  {item.capability === null ? (
                    <strong>Not independently scored</strong>
                  ) : (
                    <>
                      <strong>
                        {metricValue(item.capability, metric) ?? "—"}
                        <span className="spec-box-qualifier">
                          {" "}/ 100 · bar for {scenario.label.toLowerCase()} is {scenario.gate.minIndex}
                        </span>
                      </strong>
                      <small className="spec-box-note">
                        v{item.capability.indexVersion}
                        {item.capability.variant ? ` · ${item.capability.variant} effort` : ""}
                        {" · verified "}{item.capability.verifiedAt}{" · "}
                        <a href={item.capability.source} rel="noreferrer" target="_blank">source</a>
                      </small>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="detail-specs-grid">
                <div className="spec-box"><small>Monthly Price</small><strong>{planPrice(item)}</strong></div>
                <div className="spec-box"><small>Quota Evidence</small><strong>{item.confidence} ({item.evidence})</strong></div>
                <div className="spec-box">
                  <small>Model used for {scenario.label}</small>
                  {(() => {
                    const working = planWorkingModel(item, scenario, context.settings, modelById);
                    if (!working) return <strong>None that clears the bar</strong>;
                    const index = metricValue(working.capability, metric);
                    return (
                      <strong>
                        {working.name}
                        {index !== null && <span className="spec-box-qualifier"> · index {index}</span>}
                      </strong>
                    );
                  })()}
                </div>
                <div className="spec-box full-span">
                  <small>Models on this plan ({item.modelIds.length})</small>
                  <strong>{item.modelIds.map((id) => modelById.get(id)?.name ?? id).join(", ")}</strong>
                </div>
                <div className="spec-box"><small>API Included?</small><strong>{item.apiIncluded}</strong></div>
                <div className="spec-box"><small>Access surfaces</small><strong>{(item.access ?? []).join(", ") || "Not classified"}</strong></div>
                <div className="spec-box full-span"><small>Published Quota / Rule</small><strong>{planQuota(item, context.scenarioId)}</strong></div>
              </div>
            )}

            {item.note && (
              <div className="modal-note-box">
                <strong>Notes &amp; Limitations:</strong>
                <p>{item.note}</p>
              </div>
            )}

            <div className="modal-scenario-fits">
              <strong>Derived tier by scenario:</strong>
              <div className="scenario-fits-list">
                {scenarios.map((sc) => {
                  const placement = itemPlacement(item, sc.id);
                  return (
                    <div className="scenario-fit-item" key={sc.id}>
                      <span>{sc.label}</span>
                      <span className={`mini-tier ${placementClass(placement)}`} title={placementReason(placement, sc, sc.gate.metric)}>
                        {placementLabel(placement)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="modal-scenario-fits-note">
                Tiers are derived from {capabilityIndex.name} v{capabilityIndex.version} scores against each scenario&rsquo;s
                capability bar, then ranked on cost. Hover a letter for the reason.
              </p>
            </div>
          </div>
          <footer className="detail-modal-footer">
            <button
              className={`button ${inCompare ? "button-primary" : "button-ghost"}`}
              onClick={() => onToggleCompare(item)}
              type="button"
            >
              {inCompare ? "In compare tray" : "+ Add to compare"}
            </button>
            <a className="button button-ghost" href={item.source} rel="noreferrer" target="_blank">
              <span>Official source</span>
              <Icon name="external" size={14} />
            </a>
          </footer>
        </>
      )}
    </Modal>
  );
}

export default ItemDetailsModal;

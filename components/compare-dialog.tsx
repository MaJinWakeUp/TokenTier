"use client";

import { useMemo } from "react";
import { capabilityIndex, itemPlacement, modelById, scenarioFor } from "@/lib/catalog";
import type { Model, Plan } from "@/lib/catalog/types";
import { contextSize, metricValue } from "@/lib/domain/eligibility";
import { confidenceScore, planWorkingModel, tierRank, type Placement } from "@/lib/domain/placement";
import { callCost, planEstimate } from "@/lib/domain/pricing";
import {
  formatEstimateRange,
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
import type { InspectionContext } from "./item-details";

type CompareRow = {
  label: string;
  render: (item: Model | Plan) => React.ReactNode;
  // Present only on rows where one value is objectively better.
  score?: (item: Model | Plan) => number | null;
  better?: "higher" | "lower";
};

export function isPlanList(items: Array<Model | Plan>): boolean {
  return items.length > 0 && "kind" in items[0];
}

// One descriptor per row, so every row knows how to render itself and which
// direction counts as better. Without that a comparison table makes the
// reader do the comparing.
function useCompareRows(items: Array<Model | Plan>, context: InspectionContext): CompareRow[] {
  const { scenarioId, settings, calls } = context;
  const comparingPlans = isPlanList(items);

  return useMemo<CompareRow[]>(() => {
    const scenario = scenarioFor(scenarioId);
    const metric = scenario.gate.metric;
    const tierBadge = (placement: Placement) => (
      <span className={`mini-tier ${placementClass(placement)}`} title={placementReason(placement, scenario, metric)}>
        {placementLabel(placement)}
      </span>
    );
    const sourceRow: CompareRow = {
      label: "Official source",
      render: (item) => (
        <a className="button button-ghost" href={item.source} rel="noreferrer" target="_blank">
          <span>Source</span>
          <Icon name="external" size={13} />
        </a>
      ),
    };

    if (comparingPlans) {
      const working = (item: Model | Plan) => planWorkingModel(item as Plan, scenario, settings, modelById);
      return [
        { label: "Plan type", render: (item) => <span className="kind-pill">{(item as Plan).kind}</span> },
        {
          label: "Monthly price",
          render: (item) => <strong>{planPrice(item as Plan)}</strong>,
          score: (item) => (item as Plan).monthly,
          better: "lower",
        },
        {
          label: capabilityIndex.name,
          render: (item) => {
            const index = metricValue(working(item)?.capability ?? null, metric);
            return index === null ? <span className="muted-dash">Not scored</span> : <strong>{index}</strong>;
          },
          score: (item) => metricValue(working(item)?.capability ?? null, metric),
          better: "higher",
        },
        {
          label: `Model used (${scenario.label.toLowerCase()})`,
          render: (item) => working(item)?.name ?? <span className="muted-dash">None clears the bar</span>,
        },
        { label: "Published quota", render: (item) => planQuota(item as Plan, scenarioId) },
        { label: "API included?", render: (item) => (item as Plan).apiIncluded },
        {
          label: `Equivalent calls (${scenario.label.toLowerCase()})`,
          render: (item) => {
            const estimate = planEstimate(item as Plan, settings, working(item), modelById.get((item as Plan).modelIds[0]));
            return estimate
              ? <strong>{formatEstimateRange(estimate.callsLow, estimate.callsHigh)} calls</strong>
              : <span className="muted-dash">—</span>;
          },
          score: (item) => planEstimate(item as Plan, settings, working(item), modelById.get((item as Plan).modelIds[0]))?.callsLow ?? null,
          better: "higher",
        },
        {
          label: "Quota evidence",
          render: (item) => (
            <>
              <span className={`evidence-badge evidence-${(item as Plan).confidence.toLowerCase()}`}>{(item as Plan).confidence}</span>
              <small className="estimate-detail">{(item as Plan).evidence}</small>
            </>
          ),
          score: (item) => confidenceScore[(item as Plan).confidence],
          better: "higher",
        },
        {
          label: `Derived tier (${scenario.label.toLowerCase()})`,
          render: (item) => tierBadge(itemPlacement(item, scenarioId)),
          score: (item) => {
            const placement = itemPlacement(item, scenarioId);
            return placement.state === "tier" ? tierRank[placement.tier] : 0;
          },
          better: "higher",
        },
        sourceRow,
      ];
    }

    return [
      {
        label: capabilityIndex.name,
        render: (item) => {
          const index = metricValue((item as Model).capability, metric);
          return index === null ? <span className="muted-dash">Not scored</span> : <strong>{index}</strong>;
        },
        score: (item) => metricValue((item as Model).capability, metric),
        better: "higher",
      },
      {
        label: "Input / 1M",
        render: (item) => <strong>{price((item as Model).input)}</strong>,
        score: (item) => (item as Model).input,
        better: "lower",
      },
      {
        label: "Cached input / 1M",
        render: (item) => ((item as Model).cached === null ? "—" : price((item as Model).cached as number, 4)),
        score: (item) => (item as Model).cached ?? (item as Model).input,
        better: "lower",
      },
      {
        label: "Output / 1M",
        render: (item) => <strong>{price((item as Model).output)}</strong>,
        score: (item) => (item as Model).output,
        better: "lower",
      },
      {
        label: "Context window",
        render: (item) => (item as Model).context,
        score: (item) => contextSize((item as Model).context),
        better: "higher",
      },
      {
        label: `Est. cost / call (${scenario.label.toLowerCase()})`,
        render: (item) => <strong>{price(callCost(item as Model, settings), 4)}</strong>,
        score: (item) => callCost(item as Model, settings),
        better: "lower",
      },
      {
        label: `${calls.toLocaleString()} calls / month`,
        render: (item) => <strong>{monthlyPrice(callCost(item as Model, settings) * calls)}</strong>,
        score: (item) => callCost(item as Model, settings),
        better: "lower",
      },
      {
        label: `Derived tier (${scenario.label.toLowerCase()})`,
        render: (item) => tierBadge(itemPlacement(item, scenarioId)),
        score: (item) => {
          const placement = itemPlacement(item, scenarioId);
          return placement.state === "tier" ? tierRank[placement.tier] : 0;
        },
        better: "higher",
      },
      sourceRow,
    ];
  }, [calls, comparingPlans, scenarioId, settings]);
}

export function CompareTray({
  items,
  onRemove,
  onClear,
  onOpen,
}: {
  items: Array<Model | Plan>;
  onRemove: (item: Model | Plan) => void;
  onClear: () => void;
  onOpen: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <aside aria-label="Item comparison tray" className="compare-floating-tray">
      <div className="compare-tray-content">
        <div className="compare-tray-items">
          <span className="compare-tray-label">Compare {isPlanList(items) ? "plans" : "models"} ({items.length}/3):</span>
          {items.map((item) => (
            <span className="compare-item-tag" key={item.id}>
              <span className="provider-orb" data-provider={item.provider} />
              <strong>{item.name}</strong>
              <button aria-label={`Remove ${item.name} from comparison`} onClick={() => onRemove(item)} type="button">
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="compare-tray-actions">
          <button className="button button-primary" onClick={onOpen} type="button">Compare side-by-side</button>
          <button className="button button-ghost" onClick={onClear} type="button">Clear</button>
        </div>
      </div>
    </aside>
  );
}

export function CompareDialog({
  isOpen,
  onClose,
  items,
  context,
}: {
  isOpen: boolean;
  onClose: () => void;
  items: Array<Model | Plan>;
  context: InspectionContext;
}) {
  const rows = useCompareRows(items, context);
  const scenario = scenarioFor(context.scenarioId);
  const comparingPlans = isPlanList(items);

  return (
    <Modal
      isOpen={isOpen}
      maxWidth="900px"
      onClose={onClose}
      title={
        <div>
          <h3 id="compare-modal-title">Side-by-side comparison ({comparingPlans ? "Plans" : "Models"} · {scenario.label})</h3>
        </div>
      }
      titleId="compare-modal-title"
    >
      <div className="compare-modal-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th>Attribute</th>
              {items.map((item) => (
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
            {rows.map((row) => {
              // Mark the best cell so a comparison reads as a comparison. Ties
              // mark every tied cell; a single item is never a "winner".
              const scores = row.score ? items.map(row.score) : [];
              const usable = scores.filter((value): value is number => value !== null);
              const best = row.score && items.length > 1 && usable.length > 1
                ? (row.better === "higher" ? Math.max(...usable) : Math.min(...usable))
                : null;
              const allEqual = best !== null && usable.every((value) => value === best);
              return (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {items.map((item, index) => {
                    const isBest = best !== null && !allEqual && scores[index] === best;
                    return (
                      <td className={isBest ? "compare-best" : undefined} key={item.id}>
                        {isBest && <span className="visually-hidden">Best: </span>}
                        {row.render(item)}
                        {isBest && <Icon className="compare-best-mark" name="check" size={13} />}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="compare-note">
          A tick marks the better value in a row. {comparingPlans
            ? "Plan capacity and capability come from the cheapest model each plan offers that clears the bar."
            : `Costs use the ${scenario.label.toLowerCase()} profile.`}
        </p>
      </div>
    </Modal>
  );
}

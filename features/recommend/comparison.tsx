"use client";

import { useMemo, useState } from "react";
import { scenarioFor } from "@/lib/catalog";
import type { Model, Plan } from "@/lib/catalog/types";
import type { Decision } from "@/lib/domain/decision";
import type { PlanEvaluation } from "@/lib/domain/recommend";
import type { Workload } from "@/lib/domain/workload";
import { estimatePresentation, monthlyPrice, price } from "@/lib/format";

type Lane = "api" | "plans";

// Plans separate into what can be proven and what cannot. A plan whose quota
// is conditional or unpublished is still shown — hiding it would read as though
// it had been considered and rejected on price.
function partitionPlans(evaluations: PlanEvaluation[]) {
  const withEstimate = evaluations.filter(
    (evaluation): evaluation is PlanEvaluation & { estimate: NonNullable<PlanEvaluation["estimate"]> } =>
      evaluation.estimate !== null,
  );
  const qualifying = withEstimate
    .filter((evaluation) => evaluation.eligible && evaluation.sufficientCoverage === true)
    .sort((a, b) =>
      Number(b.withinBudget) - Number(a.withinBudget)
      || (a.plan.monthly ?? Infinity) - (b.plan.monthly ?? Infinity));
  const conditional = withEstimate
    .filter((evaluation) => !(evaluation.eligible && evaluation.sufficientCoverage === true))
    .sort((a, b) => (a.plan.monthly ?? Infinity) - (b.plan.monthly ?? Infinity));
  return { qualifying, conditional };
}

function coverageLabel(evaluation: PlanEvaluation): string {
  if (!evaluation.eligible) return "No model on this plan clears the bar";
  if (evaluation.coverage === null) return "Not measurable from the published quota";
  if (evaluation.coverage === 100) return "Estimated to cover";
  if (evaluation.coverage >= 70) return "May cover at the upper estimate";
  return "Below target";
}

export function DetailedComparison({
  decision,
  workload,
  onInspect,
}: {
  decision: Decision;
  workload: Workload;
  onInspect: (item: Model | Plan) => void;
}) {
  const [lane, setLane] = useState<Lane>("api");
  const [showAllPlans, setShowAllPlans] = useState(false);
  const scenario = scenarioFor(workload.scenarioId);

  const modelRows = useMemo(() => {
    return [...decision.result.api.evaluations].sort((a, b) => {
      // Unsupported pricing sorts last: there is no amount to compare.
      const aNaN = Number.isNaN(a.monthlyCost);
      const bNaN = Number.isNaN(b.monthlyCost);
      if (aNaN && bNaN) return a.model.id.localeCompare(b.model.id);
      if (aNaN) return 1;
      if (bNaN) return -1;
      return a.monthlyCost - b.monthlyCost || a.model.id.localeCompare(b.model.id);
    });
  }, [decision.result.api.evaluations]);

  const maxMonthly = useMemo(() => {
    const finite = modelRows.map((row) => row.monthlyCost).filter((value) => Number.isFinite(value));
    return Math.max(...finite, 1);
  }, [modelRows]);

  const { qualifying, conditional } = useMemo(
    () => partitionPlans(decision.result.plans.evaluations),
    [decision.result.plans.evaluations],
  );

  const shownPlans = showAllPlans ? qualifying : qualifying.slice(0, 6);

  return (
    <section className="unified-comparison-card" aria-labelledby="unified-comparison-title">
      <div className="unified-comparison-header">
        <div className="unified-comparison-heading">
          <span>Detailed Comparison</span>
          <h2 id="unified-comparison-title">
            {lane === "api" ? "Monthly cost by model" : "Plan cost and quota comparison"}
          </h2>
          <p className="unified-comparison-meta">
            {workload.calls.toLocaleString()} calls · {workload.input.toLocaleString()} in + {workload.output.toLocaleString()} out · ${workload.budget.toLocaleString()} budget
          </p>
        </div>
        <div className="book-switch comparison-lane-switch" role="group" aria-label="Detailed comparison lane">
          <button aria-pressed={lane === "api"} className={lane === "api" ? "active" : ""} onClick={() => setLane("api")} type="button">API <span>{modelRows.length}</span></button>
          <button aria-pressed={lane === "plans"} className={lane === "plans" ? "active" : ""} onClick={() => setLane("plans")} type="button">Plans <span>{qualifying.length + conditional.length}</span></button>
        </div>
      </div>

      {lane === "api" ? (
        modelRows.length === 0 ? (
          <p className="plan-match-note">
            The access requirement excludes direct API models, so only plans are compared for this workload.
          </p>
        ) : (
          <div className="model-cost-columns">
            {modelRows.map((row) => {
              const recommended = decision.apiModel !== null && row.model.id === decision.apiModel.id;
              const unsupported = Number.isNaN(row.monthlyCost);
              const ratio = unsupported ? 0 : Math.min(1, row.monthlyCost / maxMonthly);
              return (
                <article className={`model-cost-row ${recommended ? "recommended" : ""}`} key={row.model.id}>
                  <div className="cost-row-bar" style={{ width: `${Math.max(3, Math.round(ratio * 100))}%` }} />
                  <div className="cost-model">
                    <span className="provider-orb" data-provider={row.model.provider} />
                    <div>
                      <button className="table-item-name-btn" onClick={() => onInspect(row.model)} type="button"><strong>{row.model.name}</strong></button>
                      <small>
                        {row.model.provider} · {row.index === null
                          ? "not scored"
                          : row.eligible
                            ? `index ${row.index}, clears the bar`
                            : row.rejection?.state === "pricing" ? "unsupported pricing at this input size"
                              : row.rejection?.state === "context" ? "context window too small"
                                : `index ${row.index}, below the ${scenario.gate.minIndex} bar`}
                      </small>
                    </div>
                    {recommended && <span className="recommendation-badge">Best API</span>}
                  </div>
                  <div className="cost-total">
                    {unsupported ? (
                      <>
                        <strong>Unsupported</strong>
                        <span>Pricing not verified at this input size</span>
                      </>
                    ) : (
                      <>
                        <strong title={price(row.monthlyCost)}>{monthlyPrice(row.monthlyCost)}</strong>
                        <span>{price(row.costPerCall, 4)} / call</span>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )
      ) : (
        <>
          {qualifying.length === 0 ? (
            <p className="plan-match-note">
              No plan publishes an allowance that provably covers {workload.calls.toLocaleString()} calls a month for this profile.
            </p>
          ) : (
            <>
              <div className="plan-match-grid">
                {shownPlans.map((evaluation) => {
                  const isBest = decision.result.plans.best?.plan?.id === evaluation.plan.id;
                  return (
                    <article className={`plan-match-card ${isBest ? "recommended" : ""}`} key={evaluation.plan.id}>
                      <div className="plan-match-title">
                        <span className="provider-orb" data-provider={evaluation.plan.provider} />
                        <div>
                          <button className="table-item-name-btn" onClick={() => onInspect(evaluation.plan)} type="button"><strong>{evaluation.plan.name}</strong></button>
                          <small>{evaluation.plan.provider} · via {evaluation.workingModel?.name ?? "no qualifying model"}</small>
                        </div>
                        {isBest && <span className="recommendation-badge">Best plan</span>}
                      </div>
                      <p className="plan-match-price">${evaluation.plan.monthly}<span>/ month</span></p>
                      <dl>
                        <div><dt>Budget</dt><dd>{evaluation.withinBudget ? "Fits" : "Over budget"}</dd></div>
                        <div>
                          <dt>{evaluation.estimate.basis.kind === "break-even" ? "API-cost parity" : "Est. capacity"}</dt>
                          <dd>{estimatePresentation(evaluation.estimate).calls}</dd>
                        </div>
                        <div>
                          <dt>Your {workload.calls.toLocaleString()}-call target</dt>
                          <dd>{coverageLabel(evaluation)}</dd>
                        </div>
                        <div><dt>Evidence</dt><dd>{evaluation.plan.confidence} · {evaluation.plan.evidence}</dd></div>
                      </dl>
                    </article>
                  );
                })}
              </div>
              {qualifying.length > 6 && (
                <button className="show-more-btn" onClick={() => setShowAllPlans((prev) => !prev)} type="button">
                  {showAllPlans ? "Show fewer plans" : `Show all ${qualifying.length} plans`}
                </button>
              )}
            </>
          )}

          {conditional.length > 0 && (
            <details className="gate-excluded conditional-plans">
              <summary>Conditional or unmeasurable plans ({conditional.length})</summary>
              <ul>
                {conditional.map((evaluation) => (
                  <li key={evaluation.plan.id}>
                    <span className="provider-orb" data-provider={evaluation.plan.provider} />
                    <button className="table-item-name-btn" onClick={() => onInspect(evaluation.plan)} type="button">
                      <strong>{evaluation.plan.name}</strong>
                    </button>
                    <span className="gate-excluded-reason">
                      {evaluation.plan.monthly === null ? "Pay as you go" : `$${evaluation.plan.monthly}/mo`} · {coverageLabel(evaluation)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="plan-match-note">Price break-even shows economic parity only. It is not a promised quota unless the provider publishes credits or limits.</p>
        </>
      )}
    </section>
  );
}

export default DetailedComparison;

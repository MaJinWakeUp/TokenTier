"use client";

import { scenarioFor } from "@/lib/catalog";
import type { Model, Plan } from "@/lib/catalog/types";
import { capabilityOf } from "@/lib/domain/eligibility";
import type { Decision } from "@/lib/domain/decision";
import type { Objective, Workload } from "@/lib/domain/workload";
import {
  formatEstimateRange,
  metricLabels,
  monthlyPrice,
  monthlyPriceAgainst,
  planQuota,
  price,
} from "@/lib/format";
import { Icon } from "@/components/icon";

// What to do about it, in the reader's own terms. A constraint is never
// quietly relaxed, so the way out has to be said out loud.
function noMatchAdvice(decision: Decision, workload: Workload): string | null {
  if (decision.apiNoMatch && decision.planNoMatch) {
    return `Nothing qualifies at ${workload.calls.toLocaleString()} calls a month within $${workload.budget.toLocaleString()}. Raise the budget, lower the call volume, or pick a work type with a lower capability bar.`;
  }
  if (decision.apiNoMatch) {
    return "No API model clears this bar within the budget. Raising the budget or lowering the call volume is the direct fix; changing the access requirement widens the field.";
  }
  // A plan-only shortfall is already stated on the plan card itself, so
  // repeating it here would say the same thing twice.
  return null;
}

export function BestPath({
  decision,
  workload,
  objective,
  onObjective,
  onInspect,
}: {
  decision: Decision;
  workload: Workload;
  objective: Objective;
  onObjective: (value: Objective) => void;
  onInspect: (item: Model | Plan) => void;
}) {
  const scenario = scenarioFor(workload.scenarioId);
  const metric = scenario.gate.metric;
  const planBest = decision.result.plans.best;
  const estimate = planBest?.estimate ?? null;
  const apiIndex = decision.apiModel ? capabilityOf(decision.apiModel, metric) : null;
  const advice = noMatchAdvice(decision, workload);
  const planCalls = estimate ? formatEstimateRange(estimate.callsLow, estimate.callsHigh) : "—";
  const oneAnswer = decision.frontier.every((pick) => pick.model?.id === decision.frontier[0]?.model?.id);

  return (
    <>
      <div className={`decision-banner recommendation-summary decision-${decision.preferredPath}`}>
        <div className="decision-banner-header">
          <div className="decision-banner-badge-group">
            {!(decision.apiNoMatch && decision.planNoMatch) && <span className="best-path-badge">BEST PATH</span>}
            {!decision.apiWithinBudget && !decision.apiNoMatch && (
              <div className="decision-fallback-note">
                <Icon name="warning" size={13} />
                {decision.budgetPick.model ? (
                  <span>
                    You are viewing <strong>{decision.active.label.toLowerCase()}</strong>, which is{" "}
                    {monthlyPriceAgainst(decision.apiSpend, workload.budget)}/mo and over your{" "}
                    ${workload.budget.toLocaleString()}/mo budget.{" "}
                    <button className="inline-link" onClick={() => onObjective("budget")} type="button">Best in budget</button>{" "}
                    is {decision.budgetPick.model.name} at {monthlyPriceAgainst(decision.budgetPick.spend, workload.budget)}/mo.
                  </span>
                ) : (
                  <span>
                    No model clears the {scenario.label.toLowerCase()} bar within ${workload.budget.toLocaleString()}/mo.
                    You are viewing <strong>{decision.active.label.toLowerCase()}</strong> at{" "}
                    {monthlyPriceAgainst(decision.apiSpend, workload.budget)}/mo
                    {decision.costPick.model && decision.costPick.model.id !== decision.active.model?.id && (
                      <>, and the cheapest is {decision.costPick.model.name} at{" "}
                        {monthlyPriceAgainst(decision.costPick.spend, workload.budget)}/mo</>
                    )}.
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="decision-facts-strip">
          <div className="decision-fact">
            <small>Monthly API Spend</small>
            <strong>{decision.apiNoMatch ? "—" : monthlyPriceAgainst(decision.apiSpend, workload.budget)}</strong>
            <span>{decision.apiModel === null ? "No qualified model" : decision.apiModel.name}</span>
          </div>
          <div className="decision-fact">
            <small>Plan Cost &amp; Quota</small>
            <strong>{decision.plan === null ? "None" : `$${decision.planMonthly}/mo`}</strong>
            <span>{decision.plan === null ? "No comparable plan" : `${decision.plan.name} (~${planCalls} calls)`}</span>
          </div>
          <div className="decision-fact">
            <small>Difference</small>
            <strong>{decision.apiNoMatch || decision.plan === null ? "—" : decision.sameMonthlyPrice ? "Same price" : `${monthlyPrice(Math.abs(decision.difference))}/mo`}</strong>
            <span>{decision.apiNoMatch ? "No qualified model" : decision.plan === null ? "API only" : decision.sameMonthlyPrice ? "Same monthly cost" : decision.difference < 0 ? "API is more cost-effective" : "Plan is more cost-effective"}</span>
          </div>
        </div>
        <p className="decision-verdict-caption">{decision.caption}</p>
        {advice && <p className="decision-advice">{advice}</p>}
      </div>

      <section className="recommendation-card recommendation-output" aria-labelledby="recommendation-title">
        <div className="settings-heading"><h2 id="recommendation-title">Best path</h2></div>
        <div className="recommendation-grid">
          <article className={decision.preferredPath === "api" ? "path-card primary" : "path-card"}>
            <div className="path-card-label">
              <span>BEST API</span>
              <span className={`gate-pill ${decision.apiModel ? "gate-pass" : "gate-fail"}`}>
                {apiIndex === null ? "Not scored" : `Index ${apiIndex}`}
              </span>
            </div>
            {decision.apiModel === null ? (
              <div className="path-title">
                <div><strong>No qualified model</strong><small>No model clears the bar within these constraints</small></div>
              </div>
            ) : (
              <div className="path-title">
                <span className="provider-orb" data-provider={decision.apiModel.provider} />
                <div>
                  <button className="table-item-name-btn" onClick={() => onInspect(decision.apiModel as Model)} type="button">
                    <strong>{decision.apiModel.name}</strong>
                  </button>
                  <small>{decision.apiModel.provider} · direct API</small>
                </div>
                {decision.preferredPath === "api" && <span className="recommendation-badge">Best</span>}
              </div>
            )}
            <p className="path-price" title={`${price(decision.apiSpend)} per month`}>
              {decision.apiNoMatch ? "—" : monthlyPriceAgainst(decision.apiSpend, workload.budget)}<span>/ month</span>
            </p>
            <dl>
              <div><dt>Per call</dt><dd>{decision.result.api.best ? price(decision.result.api.best.costPerCall, 3) : "—"}</dd></div>
              <div><dt>Budget</dt><dd>{decision.apiNoMatch ? "—" : decision.apiWithinBudget ? "Fits" : `Over by ${monthlyPrice(decision.apiSpend - workload.budget)}`}</dd></div>
              <div><dt>Capability bar</dt><dd>{metricLabels[metric]} &ge; {scenario.gate.minIndex}</dd></div>
              <div><dt>Access</dt><dd>Direct API</dd></div>
            </dl>
            <div className="path-card-verdict">
              <p>
                {decision.apiModel
                  ? `${decision.active.hint}, at ${monthlyPriceAgainst(decision.apiSpend, workload.budget)}/mo for ${workload.calls.toLocaleString()} calls.`
                  : `No model clears the ${scenario.label.toLowerCase()} bar at this context size and budget.`}
              </p>
            </div>

            {decision.apiModel && (
              <div className="frontier" role="group" aria-label="API priority">
                <p className="frontier-caption">
                  {oneAnswer
                    ? "One model leads on every axis for this workload and budget."
                    : "These are three different answers. Pick which one to compare against the plan."}
                </p>
                {decision.frontier.map((pick) => (
                  <button
                    aria-pressed={objective === pick.id}
                    className={`frontier-option ${objective === pick.id ? "active" : ""}`}
                    key={pick.id}
                    onClick={() => onObjective(pick.id)}
                    title={pick.hint}
                    type="button"
                  >
                    <span className="frontier-option-label">
                      {pick.label}
                      {pick.sameAs.length > 0 && <small className="frontier-same"> · same as {pick.sameAs.join(" & ").toLowerCase()}</small>}
                    </span>
                    <span className="frontier-option-model">
                      {pick.model ? (
                        <>
                          <span className="provider-orb" data-provider={pick.model.provider} />
                          <strong>{pick.model.name}</strong>
                        </>
                      ) : (
                        <strong>None</strong>
                      )}
                    </span>
                    <span className="frontier-option-cost">
                      {pick.noMatch ? "—" : monthlyPriceAgainst(pick.spend, workload.budget)}<small>/ mo</small>
                      {pick.overBudget && !pick.noMatch && <small className="frontier-over">over budget</small>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </article>

          {decision.plan === null || estimate === null ? (
            <article className="path-card path-card-empty">
              <div className="path-card-label"><span>BEST PLAN</span></div>
              <p>
                No subscription plan has a published allowance that provably covers this workload within budget,
                so this comparison is API-only. Conditional and unmeasurable plans are listed below.
              </p>
            </article>
          ) : (
            <article className={decision.preferredPath === "plans" ? "path-card primary" : "path-card"}>
              <div className="path-card-label">
                <span>BEST PLAN</span>
                <span className={`gate-pill ${planBest?.meetsBar ? "gate-pass" : "gate-fail"}`}>
                  {(() => {
                    const index = planBest?.workingModel ? capabilityOf(planBest.workingModel, metric) : null;
                    return index === null ? "Not scored" : `Index ${index}`;
                  })()}
                </span>
              </div>
              <div className="path-title">
                <span className="provider-orb" data-provider={decision.plan.provider} />
                <div>
                  <button className="table-item-name-btn" onClick={() => onInspect(decision.plan as Plan)} type="button">
                    <strong>{decision.plan.name}</strong>
                  </button>
                  <small>{decision.plan.provider} · {(decision.plan.access ?? ["subscription"]).join(", ")}</small>
                </div>
                {decision.preferredPath === "plans" && <span className="recommendation-badge">Best</span>}
              </div>
              <p className="path-price">${decision.plan.monthly}<span>/ month</span></p>
              <dl>
                <div>
                  <dt>{estimate.basis.kind === "break-even" ? "API-cost parity" : "Est. capacity"}</dt>
                  <dd>{planCalls} calls</dd>
                </div>
                <div><dt>Model used</dt><dd>{planBest?.workingModel?.name ?? "None that clears the bar"}</dd></div>
                <div><dt>Published quota</dt><dd>{planQuota(decision.plan, workload.scenarioId)}</dd></div>
                <div><dt>Confidence</dt><dd>{decision.plan.confidence} · {estimate.basis.label}</dd></div>
              </dl>
              {(decision.plan.confidence === "Low" || estimate.basis.kind === "break-even") && (
                <div className="confidence-caveat-badge">
                  <Icon name="warning" size={13} />
                  <span>Low confidence quota</span>
                </div>
              )}
              <div className="path-card-verdict">
                <p>
                  {decision.plan.name}: ${decision.plan.monthly}/month ·{" "}
                  {planBest?.coverage === null
                    ? "published quota cannot be converted to this profile"
                    : `estimated ${planCalls} calls for this profile`}.
                </p>
              </div>
            </article>
          )}
        </div>
      </section>
    </>
  );
}

export default BestPath;

"use client";

import { scenarioFor } from "@/lib/catalog";
import type { Model, Plan } from "@/lib/catalog/types";
import { capabilityOf } from "@/lib/domain/eligibility";
import type { Decision } from "@/lib/domain/decision";
import type { Objective, Workload } from "@/lib/domain/workload";
import {
  estimatePresentation,
  metricLabels,
  monthlyPrice,
  monthlyPriceAgainst,
  planQuota,
  price,
} from "@/lib/format";
import { Icon } from "@/components/icon";

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
  const planCalls = estimatePresentation(estimate).calls;
  const oneAnswer = decision.frontier.every((pick) => pick.model?.id === decision.frontier[0]?.model?.id);

  return (
    <>
      <div className={`decision-banner recommendation-summary decision-${decision.preferredPath}`}>
        {/* The verdict states the question it answered, so it is still readable
            once the settings above it have scrolled out of view. */}
        <p className="decision-workload">
          <strong>{scenario.label}</strong>
          <span>{workload.calls.toLocaleString()} calls / mo</span>
          <span>{workload.input.toLocaleString()} in + {workload.output.toLocaleString()} out</span>
          <span>{Math.round(workload.cacheRatio * 100)}% cached</span>
          <span>${workload.budget.toLocaleString()} budget</span>
          <span>{workload.access === "any" ? "any surface" : workload.access}</span>
        </p>
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
            <span>{decision.plan === null ? "No comparable plan" : `${decision.plan.name} (~${planCalls})`}</span>
          </div>
          <div className="decision-fact">
            <small>Difference</small>
            <strong>{decision.apiNoMatch || decision.plan === null ? "—" : decision.sameMonthlyPrice ? "Same price" : `${monthlyPrice(Math.abs(decision.difference))}/mo`}</strong>
            <span>{decision.apiNoMatch ? "No qualified model" : decision.plan === null ? "API only" : decision.sameMonthlyPrice ? "Same monthly cost" : decision.difference < 0 ? "API is more cost-effective" : "Plan is more cost-effective"}</span>
          </div>
        </div>
        <p className="decision-verdict-caption">{decision.caption}</p>
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
                <div><strong>No qualified model</strong><small>{decision.apiReason}</small></div>
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
                  : decision.apiReason}
              </p>
            </div>

            {decision.result.api.evaluations.length > 0 && (
              <div className="frontier" role="group" aria-label="API priority">
                <p className="frontier-caption">
                  {oneAnswer && decision.apiModel
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
                {decision.planReason}
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
                  <dd>{planCalls}</dd>
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
                    : `estimated ${planCalls} for this profile`}.
                </p>
              </div>
            </article>
          )}
        </div>
      </section>
      {decision.planNoMatch && workload.calls > 0 && decision.conditionalPlans.length > 0 && (
        <section className="recommendation-card" aria-labelledby="conditional-title">
          <h2 id="conditional-title">Conditional plans to investigate</h2>
          <p>These fit your budget and model requirements. Coverage is unverified; they are not guaranteed matches.</p>
          <div className="recommendation-grid">
            {decision.conditionalPlans.map((entry) => <article className="path-card" key={entry.plan.id}>
              <span className="gate-pill">Conditional</span>
              <h3><button className="table-item-name-btn" type="button" onClick={() => onInspect(entry.plan)}>{entry.plan.name}</button></h3>
              <p>{monthlyPrice(entry.plan.monthly ?? 0)}/mo · {entry.workingModel?.name}</p>
              <p>{estimatePresentation(entry.estimate).calls}. {entry.plan.quota}</p>
              <p>{entry.plan.evidence}. {entry.plan.conditionalLimits?.map((limit) => limit.description).join("; ")}</p>
              <p>Confirm model-specific capacity and reset limits for your {workload.calls.toLocaleString()} monthly calls.</p>
              <a href={entry.plan.source} target="_blank" rel="noreferrer">Provider source</a>
            </article>)}
          </div>
        </section>
      )}
    </>
  );
}

export default BestPath;

"use client";

import { scenarios } from "@/lib/catalog";
import type { ScenarioId } from "@/lib/catalog/types";
import type { AccessRequirement, Preference } from "@/lib/domain/workload";
import { workloadLimits } from "@/lib/domain/workload";
import type { RecommendController } from "./state";

const inputPresets = [2000, 18000, 50000, 100000];
const outputPresets = [500, 2000, 6000, 15000];
const cachePresets = [0, 25, 60, 90];

function tokenLabel(value: number) {
  return value >= 1000 ? `${value / 1000}K` : String(value);
}

// The four questions that decide the answer come first — what the work is, how
// you need to reach it, how much of it there is, and what you can spend. Token
// sizes and cache share refine the estimate and sit one disclosure away, open
// on demand rather than buried behind a separate screen.
export function WorkloadForm({ controller }: { controller: RecommendController }) {
  const { workload } = controller;

  return (
    <section className="settings-card" id="recommendation-settings" aria-labelledby="settings-title">
      <div className="settings-heading"><h2 id="settings-title">Your settings</h2></div>
      <div className="settings-body">
        <fieldset>
          <legend>What you need</legend>
          <div className="custom-settings-grid">
            <label>
              <span>Work type</span>
              <select
                id="recommendation-profile"
                onChange={(event) => controller.setScenario(event.target.value as ScenarioId)}
                value={controller.scenarioChosen ? workload.scenarioId : ""}
              >
                {!controller.scenarioChosen && <option value="">Choose a work type…</option>}
                {scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <span>Access</span>
              <select onChange={(event) => controller.setAccess(event.target.value as AccessRequirement)} value={workload.access}>
                <option value="any">Any surface</option>
                <option value="api">Direct API</option>
                <option value="chat-app">Chat app</option>
                <option value="coding-client">Coding client</option>
              </select>
            </label>
            <label>
              <span>Calls / month</span>
              <input
                inputMode="numeric"
                max={workloadLimits.calls.max}
                min={workloadLimits.calls.min}
                onChange={(event) => controller.setWorkloadField("calls", Number(event.target.value))}
                type="number"
                value={workload.calls}
              />
            </label>
            <label>
              <span>Budget / month</span>
              <input
                inputMode="numeric"
                max={workloadLimits.budget.max}
                min={workloadLimits.budget.min}
                onChange={(event) => controller.setWorkloadField("budget", Number(event.target.value))}
                type="number"
                value={workload.budget}
              />
            </label>
          </div>
        </fieldset>

        <details className="advanced-settings" open>
          <summary>Token sizes and cache share</summary>
          <fieldset>
            <legend className="visually-hidden">Per-call token profile</legend>
            <div className="custom-settings-grid">
              <label>
                <span>Input tokens / call</span>
                <input
                  inputMode="numeric"
                  max={workloadLimits.input.max}
                  min={workloadLimits.input.min}
                  onChange={(event) => controller.setWorkloadField("input", Number(event.target.value))}
                  type="number"
                  value={workload.input}
                />
                <div className="preset-chips" role="group" aria-label="Input token presets">
                  {inputPresets.map((value) => (
                    <button
                      className={`preset-chip ${workload.input === value ? "active" : ""}`}
                      key={value}
                      onClick={() => controller.setWorkloadField("input", value)}
                      type="button"
                    >
                      {tokenLabel(value)}
                    </button>
                  ))}
                </div>
              </label>
              <label>
                <span>Output tokens / call</span>
                <input
                  inputMode="numeric"
                  max={workloadLimits.output.max}
                  min={workloadLimits.output.min}
                  onChange={(event) => controller.setWorkloadField("output", Number(event.target.value))}
                  type="number"
                  value={workload.output}
                />
                <div className="preset-chips" role="group" aria-label="Output token presets">
                  {outputPresets.map((value) => (
                    <button
                      className={`preset-chip ${workload.output === value ? "active" : ""}`}
                      key={value}
                      onClick={() => controller.setWorkloadField("output", value)}
                      type="button"
                    >
                      {tokenLabel(value)}
                    </button>
                  ))}
                </div>
              </label>
              <label>
                <span>Input from cache</span>
                <span className="input-affix">
                  <input
                    aria-describedby="cache-unit"
                    inputMode="numeric"
                    max={Math.round(workloadLimits.cacheRatio.max * 100)}
                    min={Math.round(workloadLimits.cacheRatio.min * 100)}
                    onChange={(event) => controller.setWorkloadField("cacheRatio", Number(event.target.value) / 100)}
                    type="number"
                    value={Math.round(workload.cacheRatio * 100)}
                  />
                  <span id="cache-unit">% of input</span>
                </span>
                <div className="preset-chips" role="group" aria-label="Cache share presets">
                  {cachePresets.map((value) => (
                    <button
                      className={`preset-chip ${Math.round(workload.cacheRatio * 100) === value ? "active" : ""}`}
                      key={value}
                      onClick={() => controller.setWorkloadField("cacheRatio", value / 100)}
                      type="button"
                    >
                      {value}%
                    </button>
                  ))}
                </div>
              </label>
              <label>
                <span>Preference</span>
                <select onChange={(event) => controller.setPreference(event.target.value as Preference)} value={controller.preference}>
                  <option value="either">Compare both</option>
                  <option value="api">API first</option>
                  <option value="plans">Plan first</option>
                </select>
              </label>
            </div>
          </fieldset>
          <p className="settings-note">
            <span><strong>Work type</strong> sets the capability bar and replaces the token counts, call volume, and cache share with that profile&rsquo;s typical month.</span>
            <br />
            <span><strong>Input from cache</strong> is the share of input billed at the cached rate. Agent sessions that resend a stable prefix sit high; one-off document analysis sits low.</span>
          </p>
        </details>
      </div>
    </section>
  );
}

export default WorkloadForm;

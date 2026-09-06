"use client";

import { useEffect, useMemo, useState } from "react";
import { catalog, scenarioFor, scenarios } from "@/lib/catalog";
import type { Model, Plan } from "@/lib/catalog/types";
import { announceDecision, decide } from "@/lib/domain/decision";
import { absoluteUrl, currentPathname } from "@/lib/browser/url";
import { Icon } from "@/components/icon";
import { BackToTop, CatalogInspectorViews, useCatalogInspector } from "@/components/catalog-inspector";
import { BestPath } from "./best-path";
import { DetailedComparison } from "./comparison";
import { useRecommendSettings } from "./state";
import { WorkloadForm } from "./workload-form";

export function RecommendView() {
  const controller = useRecommendSettings();
  const [announcement, setAnnouncement] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareState, setShareState] = useState<"idle" | "copied" | "manual">("idle");
  const inspector = useCatalogInspector(setAnnouncement);

  const scenario = scenarioFor(controller.workload.scenarioId);
  const decision = useMemo(
    () => decide(catalog, scenario, controller.workload, controller.objective, controller.preference),
    [controller.objective, controller.preference, controller.workload, scenario],
  );

  // A result panel that re-announces itself on every keystroke is unusable with
  // a screen reader, so the announcement waits for the edits to settle and then
  // says one sentence.
  useEffect(() => {
    if (!controller.scenarioChosen) return;
    const timer = setTimeout(() => setAnnouncement(announceDecision(decision, controller.workload)), 700);
    return () => clearTimeout(timer);
  }, [controller.scenarioChosen, controller.workload, decision]);

  const share = async () => {
    const url = absoluteUrl(currentPathname(), controller.shareParams);
    setShareUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      setShareState("copied");
      setTimeout(() => setShareState((state) => (state === "copied" ? "idle" : state)), 2000);
    } catch {
      // Clipboard access is routinely denied; the link still has to be usable.
      setShareState("manual");
    }
  };

  const inspect = (item: Model | Plan) => inspector.inspect(item);
  const settings = useMemo(
    () => ({
      input: controller.workload.input,
      output: controller.workload.output,
      cacheRatio: controller.workload.cacheRatio,
    }),
    [controller.workload.cacheRatio, controller.workload.input, controller.workload.output],
  );

  return (
    <main className="view-panel">
      <a className="skip-link" href="#recommendation-settings">Skip to your settings</a>
      <div aria-live="polite" className="visually-hidden">{announcement}</div>

      <section className="recommendation-view" id="recommendation-top">
        <header className="recommendation-header">
          <div>
            <span>Custom comparison</span>
            <h1 id="recommendation-top-heading" tabIndex={-1}>Your recommendation</h1>
          </div>
          <p>Set your workload, calls, and budget. The best API and plan update immediately.</p>
        </header>

        {!controller.storageWritable && (
          <p className="storage-warning">
            <Icon name="warning" size={13} />{" "}
            This browser is not saving preferences, so these settings will be gone on reload. The link below still carries them.
          </p>
        )}

        {!controller.scenarioChosen ? (
          <div className="decision-banner decision-api">
            <p className="decision-verdict-caption">
              Your saved workload numbers are here, but the work type they belong to was not saved by the
              previous version of this page. The work type sets the capability bar, so choose one below
              rather than have one assumed for you.
            </p>
            <p className="decision-advice">
              Choosing one sets the bar and keeps the numbers you already had:{" "}
              {scenarios.map((item) => item.label).join(" · ")}.
            </p>
          </div>
        ) : (
          <BestPath
            decision={decision}
            objective={controller.objective}
            onInspect={inspect}
            onObjective={controller.setObjective}
            workload={controller.workload}
          />
        )}

        <div className="recommendation-workspace">
          <WorkloadForm controller={controller} />

          <section className="settings-card share-card" aria-labelledby="share-title">
            <div className="settings-heading"><h2 id="share-title">Share this comparison</h2></div>
            <div className="settings-body">
              <p className="settings-note">
                The link carries the whole workload — work type, token sizes, call volume, cache share,
                budget, access requirement, and which objective you are viewing.
              </p>
              <button className="copy-link-btn" onClick={share} title="Copy a link to this recommendation" type="button">
                <Icon name={shareState === "copied" ? "check" : "copy"} size={14} />
                <span>{shareState === "copied" ? "Link copied" : "Copy link"}</span>
              </button>
              {shareState === "manual" && (
                <p className="share-manual-note">This browser blocked the clipboard. Select and copy the link below.</p>
              )}
              {shareUrl && (
                <label className="rank-share-field">
                  <span>Shareable link</span>
                  <input onFocus={(event) => event.currentTarget.select()} readOnly value={shareUrl} />
                </label>
              )}
            </div>
          </section>
        </div>

        {controller.scenarioChosen && (
          <DetailedComparison decision={decision} onInspect={inspect} workload={controller.workload} />
        )}
      </section>

      <CatalogInspectorViews
        context={{ scenarioId: controller.workload.scenarioId, settings, calls: controller.workload.calls }}
        inspector={inspector}
      />
      <BackToTop hidden={inspector.compareList.length > 0} />
    </main>
  );
}

export default RecommendView;

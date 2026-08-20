"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";

export type RankablePlan = {
  id: string;
  provider: string;
  name: string;
  monthly: number | null;
};

type RankTier = { id: string; name: string };
type RankBoard = { tiers: RankTier[]; placements: Record<string, string> };

const defaultBoard: RankBoard = {
  tiers: [
    { id: "s", name: "S · Best" },
    { id: "a", name: "A · Strong" },
    { id: "b", name: "B · Good" },
    { id: "c", name: "C · Situational" },
  ],
  placements: {},
};

function sharedBoard(plans: RankablePlan[]): RankBoard | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("board");
  if (!raw || raw.length > 12_000) return null;

  try {
    const parsed = JSON.parse(raw) as { t?: unknown; p?: unknown };
    if (!Array.isArray(parsed.t) || parsed.t.length === 0 || parsed.t.length > 12) return null;
    const tiers = parsed.t
      .filter((tier): tier is [string, string] => Array.isArray(tier) && typeof tier[0] === "string" && typeof tier[1] === "string")
      .map(([id, name]) => ({ id: id.slice(0, 40), name: name.trim().slice(0, 40) || "Untitled tier" }));
    if (tiers.length === 0 || new Set(tiers.map((tier) => tier.id)).size !== tiers.length) return null;

    const planIds = new Set(plans.map((plan) => plan.id));
    const tierIds = new Set(tiers.map((tier) => tier.id));
    const placements = Object.fromEntries(
      (Array.isArray(parsed.p) ? parsed.p : [])
        .filter((entry): entry is [string, string] => Array.isArray(entry) && planIds.has(entry[0]) && tierIds.has(entry[1])),
    );
    return { tiers, placements };
  } catch {
    return null;
  }
}

export default function RankPlans({ plans }: { plans: RankablePlan[] }) {
  const [board, setBoard] = useState<RankBoard>(defaultBoard);
  const [draggedPlanId, setDraggedPlanId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const loaded = sharedBoard(plans);
    if (!loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate an explicitly shared board from the URL once
    setBoard(loaded);
    setStatus("Shared tier list loaded.");
  }, [plans]);

  const planById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const unrankedGroups = useMemo(() => {
    const groups = new Map<string, RankablePlan[]>();
    plans.filter((plan) => !board.placements[plan.id]).forEach((plan) => {
      groups.set(plan.provider, [...(groups.get(plan.provider) ?? []), plan]);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [board.placements, plans]);

  const invalidateShare = () => {
    setShareUrl("");
    const params = new URLSearchParams(window.location.search);
    if (!params.has("board")) return;
    params.delete("board");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  const movePlan = (planId: string, tierId: string | null) => {
    if (!planById.has(planId)) return;
    setBoard((current) => {
      const placements = { ...current.placements };
      if (tierId) placements[planId] = tierId;
      else delete placements[planId];
      return { ...current, placements };
    });
    invalidateShare();
    setStatus(tierId ? `Moved ${planById.get(planId)?.name} to ${board.tiers.find((tier) => tier.id === tierId)?.name}.` : `Returned ${planById.get(planId)?.name} to unranked plans.`);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, tierId: string | null) => {
    event.preventDefault();
    const planId = event.dataTransfer.getData("text/plain") || draggedPlanId;
    if (planId) movePlan(planId, tierId);
    setDraggedPlanId(null);
    setDragTarget(null);
  };

  const addTier = () => {
    const id = `tier-${Date.now().toString(36)}`;
    setBoard((current) => ({ ...current, tiers: [...current.tiers, { id, name: `New tier ${current.tiers.length + 1}` }] }));
    invalidateShare();
  };

  const removeTier = (tierId: string) => {
    setBoard((current) => ({
      tiers: current.tiers.filter((tier) => tier.id !== tierId),
      placements: Object.fromEntries(Object.entries(current.placements).filter(([, assignedTier]) => assignedTier !== tierId)),
    }));
    invalidateShare();
    setStatus("Tier removed. Its plans are unranked again.");
  };

  const shareBoard = async () => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", "rank");
    params.delete("scenario");
    params.delete("calls");
    params.delete("budget");
    params.delete("input");
    params.delete("output");
    params.delete("preference");
    params.set("board", JSON.stringify({
      t: board.tiers.map((tier) => [tier.id, tier.name]),
      p: Object.entries(board.placements),
    }));
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", url);
    setShareUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Share link copied.");
    } catch {
      setStatus("Share link ready. Select and copy it below.");
    }
  };

  const renameTier = (tierId: string, name: string) => {
    setBoard((current) => ({
      ...current,
      tiers: current.tiers.map((tier) => tier.id === tierId ? { ...tier, name } : tier),
    }));
    invalidateShare();
  };

  const renderPlan = (plan: RankablePlan) => (
    <article
      className={`rank-plan-card ${draggedPlanId === plan.id ? "dragging" : ""}`}
      draggable
      key={plan.id}
      onDragEnd={() => { setDraggedPlanId(null); setDragTarget(null); }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", plan.id);
        setDraggedPlanId(plan.id);
      }}
    >
      <span aria-hidden="true" className="rank-drag-handle">⋮⋮</span>
      <div><strong>{plan.name}</strong><small>{plan.monthly === null ? plan.provider : `${plan.provider} · $${plan.monthly}/mo`}</small></div>
      <label>
        <span className="visually-hidden">Move {plan.name}</span>
        <select aria-label={`Move ${plan.name}`} onChange={(event) => movePlan(plan.id, event.target.value || null)} value={board.placements[plan.id] ?? ""}>
          <option value="">Unranked</option>
          {board.tiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
        </select>
      </label>
    </article>
  );

  return (
    <section className="rank-view" id="rank-top" aria-labelledby="rank-top-heading">
      <header className="rank-header">
        <div><span>YOUR BOARD</span><h1 id="rank-top-heading" tabIndex={-1}>Rank plans your way.</h1><p>Rename tiers, add your own, then drag subscription plans into place. Plans start grouped by company.</p></div>
        <div className="rank-actions">
          <button className="button button-primary" onClick={shareBoard} type="button">Copy share link</button>
          <button className="button button-ghost" onClick={() => { setBoard(defaultBoard); invalidateShare(); setStatus("Board reset."); }} type="button">Reset</button>
        </div>
      </header>

      <p className="rank-instructions" id="rank-instructions">Drag cards on desktop. On touch devices or with a keyboard, use each card’s move menu.</p>
      {status && <p aria-live="polite" className="rank-status">{status}</p>}
      {shareUrl && <label className="rank-share-field"><span>Shareable link</span><input onFocus={(event) => event.currentTarget.select()} readOnly value={shareUrl} /></label>}

      <div className="rank-layout">
        <div className="rank-board" aria-describedby="rank-instructions">
          {board.tiers.map((tier, index) => {
            const tierPlans = plans.filter((plan) => board.placements[plan.id] === tier.id);
            return (
              <section
                className={`rank-tier ${dragTarget === tier.id ? "drop-active" : ""}`}
                data-tone={index % 6}
                key={tier.id}
                onDragEnter={() => setDragTarget(tier.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDrop(event, tier.id)}
              >
                <header className="rank-tier-label">
                  <label><span className="visually-hidden">Tier name</span><input maxLength={40} onBlur={(event) => { if (!event.target.value.trim()) renameTier(tier.id, "Untitled tier"); }} onChange={(event) => renameTier(tier.id, event.target.value)} value={tier.name} /></label>
                  <button aria-label={`Remove ${tier.name}`} disabled={board.tiers.length === 1} onClick={() => removeTier(tier.id)} title={board.tiers.length === 1 ? "Keep at least one tier" : "Remove tier"} type="button">×</button>
                </header>
                <div className="rank-tier-items">
                  {tierPlans.length > 0 ? tierPlans.map(renderPlan) : <p>Drop plans here</p>}
                </div>
              </section>
            );
          })}
          <button className="rank-add-tier" onClick={addTier} type="button">+ Add tier</button>
        </div>

        <aside
          className={`rank-pool ${dragTarget === "unranked" ? "drop-active" : ""}`}
          onDragEnter={() => setDragTarget("unranked")}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => handleDrop(event, null)}
        >
          <header><div><span>PLAN OPTIONS</span><h2>Unranked plans</h2></div><strong>{unrankedGroups.reduce((total, [, items]) => total + items.length, 0)}</strong></header>
          {unrankedGroups.length > 0 ? (
            <div className="rank-company-grid">
              {unrankedGroups.map(([provider, providerPlans]) => (
                <section className="rank-company" key={provider}><h3>{provider}<span>{providerPlans.length}</span></h3><div>{providerPlans.map(renderPlan)}</div></section>
              ))}
            </div>
          ) : <p className="rank-pool-empty">Every plan is ranked. Drag one back here to unrank it.</p>}
        </aside>
      </div>
    </section>
  );
}

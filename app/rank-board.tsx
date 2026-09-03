"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";

export type RankableItem = {
  id: string;
  provider: string;
  name: string;
  detail: string;
};

type Subject = "plans" | "models";

type RankTier = { id: string; name: string };
type Board = { tiers: RankTier[]; placements: Record<string, string> };

const subjects: Array<{ id: Subject; label: string; short: string }> = [
  { id: "plans", label: "Subscription plans", short: "Plans" },
  { id: "models", label: "API models", short: "Models" },
];

const storageKey = "tokentier-rank-boards";
const subjectKey = "tokentier-rank-subject";

function defaultBoard(): Board {
  return {
    tiers: [
      { id: "s", name: "S · Best" },
      { id: "a", name: "A · Strong" },
      { id: "b", name: "B · Good" },
      { id: "c", name: "C · Situational" },
    ],
    placements: {},
  };
}

function isSubject(value: unknown): value is Subject {
  return value === "plans" || value === "models";
}

// An untouched board is not worth saving, and must never be announced as a
// restored one on the next visit.
function isPristine(board: Board) {
  if (Object.keys(board.placements).length > 0) return false;
  const initial = defaultBoard().tiers;
  return board.tiers.length === initial.length
    && board.tiers.every((tier, index) => tier.id === initial[index].id && tier.name === initial[index].name);
}

// Boards are user opinion, so they are only ever read from an explicit share
// link or this browser's own storage — never derived from the catalogs.
function parseBoard(raw: unknown, items: RankableItem[]): Board | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 12_000) return null;

  try {
    const parsed = JSON.parse(raw) as { t?: unknown; p?: unknown };
    return boardFromParsed(parsed, items);
  } catch {
    return null;
  }
}

function boardFromParsed(parsed: { t?: unknown; p?: unknown }, items: RankableItem[]): Board | null {
  if (!Array.isArray(parsed.t) || parsed.t.length === 0 || parsed.t.length > 12) return null;
  const tiers = parsed.t
    .filter((tier): tier is [string, string] => Array.isArray(tier) && typeof tier[0] === "string" && typeof tier[1] === "string")
    .map(([id, name]) => ({ id: id.slice(0, 40), name: name.trim().slice(0, 40) || "Untitled tier" }));
  if (tiers.length === 0 || new Set(tiers.map((tier) => tier.id)).size !== tiers.length) return null;

  const itemIds = new Set(items.map((item) => item.id));
  const tierIds = new Set(tiers.map((tier) => tier.id));
  const placements = Object.fromEntries(
    (Array.isArray(parsed.p) ? parsed.p : [])
      .filter((entry): entry is [string, string] => Array.isArray(entry) && itemIds.has(entry[0]) && tierIds.has(entry[1])),
  );
  return { tiers, placements };
}

function serializeBoard(board: Board) {
  return JSON.stringify({
    t: board.tiers.map((tier) => [tier.id, tier.name]),
    p: Object.entries(board.placements),
  });
}

function savedBoards(items: Record<Subject, RankableItem[]>): Partial<Record<Subject, Board>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { t?: unknown; p?: unknown }>;
    const restored: Partial<Record<Subject, Board>> = {};
    for (const subject of subjects) {
      const board = parsed?.[subject.id] ? boardFromParsed(parsed[subject.id], items[subject.id]) : null;
      if (board) restored[subject.id] = board;
    }
    return restored;
  } catch {
    return {};
  }
}

export default function RankBoard({ models, plans }: { models: RankableItem[]; plans: RankableItem[] }) {
  const itemsBySubject = useMemo<Record<Subject, RankableItem[]>>(
    () => ({ plans, models }),
    [models, plans],
  );

  const [subject, setSubject] = useState<Subject>("plans");
  const [boards, setBoards] = useState<Record<Subject, Board>>({
    plans: defaultBoard(),
    models: defaultBoard(),
  });
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [status, setStatus] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const items = itemsBySubject[subject];
  const board = boards[subject];

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from storage and an explicit share link */
    const restored = savedBoards(itemsBySubject);
    const params = new URLSearchParams(window.location.search);
    const urlSubject = params.get("subject");
    const nextSubject = isSubject(urlSubject)
      ? urlSubject
      : isSubject(window.localStorage?.getItem(subjectKey)) ? (window.localStorage.getItem(subjectKey) as Subject) : null;

    const shared = parseBoard(params.get("board"), itemsBySubject[nextSubject ?? "plans"]);
    if (shared) restored[nextSubject ?? "plans"] = shared;

    if (Object.keys(restored).length > 0) {
      setBoards((current) => ({ ...current, ...restored }));
    }
    if (nextSubject) setSubject(nextSubject);
    if (shared) setStatus("Shared tier list loaded.");
    else if (Object.values(restored).some((board) => !isPristine(board))) {
      setStatus("Your saved board is back.");
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [itemsBySubject]);

  // Persist after hydration so an empty first render never overwrites a saved board.
  useEffect(() => {
    if (!hydrated) return;
    try {
      const saved = Object.fromEntries(
        subjects
          .filter((option) => !isPristine(boards[option.id]))
          .map((option) => [option.id, JSON.parse(serializeBoard(boards[option.id]))]),
      );
      if (Object.keys(saved).length > 0) {
        window.localStorage.setItem(storageKey, JSON.stringify(saved));
      } else {
        window.localStorage.removeItem(storageKey);
      }
      window.localStorage.setItem(subjectKey, subject);
    } catch {
      // ignore
    }
  }, [boards, hydrated, subject]);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const unrankedGroups = useMemo(() => {
    const groups = new Map<string, RankableItem[]>();
    items.filter((item) => !board.placements[item.id]).forEach((item) => {
      groups.set(item.provider, [...(groups.get(item.provider) ?? []), item]);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [board.placements, items]);

  const rankedCount = items.filter((item) => board.placements[item.id]).length;

  const updateBoard = (update: (current: Board) => Board) => {
    setBoards((current) => ({ ...current, [subject]: update(current[subject]) }));
  };

  const invalidateShare = () => {
    setShareUrl("");
    const params = new URLSearchParams(window.location.search);
    if (!params.has("board")) return;
    params.delete("board");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  const switchSubject = (next: Subject) => {
    setSubject(next);
    setDragTarget(null);
    invalidateShare();
    setStatus(`Ranking ${next === "plans" ? "subscription plans" : "API models"}.`);
  };

  const moveItem = (itemId: string, tierId: string | null) => {
    if (!itemById.has(itemId)) return;
    updateBoard((current) => {
      const placements = { ...current.placements };
      if (tierId) placements[itemId] = tierId;
      else delete placements[itemId];
      return { ...current, placements };
    });
    invalidateShare();
    setStatus(tierId
      ? `Moved ${itemById.get(itemId)?.name} to ${board.tiers.find((tier) => tier.id === tierId)?.name}.`
      : `Returned ${itemById.get(itemId)?.name} to unranked.`);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, tierId: string | null) => {
    event.preventDefault();
    const itemId = event.dataTransfer.getData("text/plain") || draggedItemId;
    if (itemId) moveItem(itemId, tierId);
    setDraggedItemId(null);
    setDragTarget(null);
  };

  const addTier = () => {
    const id = `tier-${Date.now().toString(36)}`;
    updateBoard((current) => ({ ...current, tiers: [...current.tiers, { id, name: `New tier ${current.tiers.length + 1}` }] }));
    invalidateShare();
  };

  const removeTier = (tierId: string) => {
    updateBoard((current) => ({
      tiers: current.tiers.filter((tier) => tier.id !== tierId),
      placements: Object.fromEntries(Object.entries(current.placements).filter(([, assignedTier]) => assignedTier !== tierId)),
    }));
    invalidateShare();
    setStatus("Tier removed. Its cards are unranked again.");
  };

  const renameTier = (tierId: string, name: string) => {
    updateBoard((current) => ({
      ...current,
      tiers: current.tiers.map((tier) => tier.id === tierId ? { ...tier, name } : tier),
    }));
    invalidateShare();
  };

  const shareBoard = async () => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", "rank");
    params.set("subject", subject);
    for (const key of ["scenario", "calls", "budget", "input", "output", "preference"]) {
      params.delete(key);
    }
    params.set("board", serializeBoard(board));
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

  const renderItem = (item: RankableItem) => (
    <article
      className={`rank-plan-card ${draggedItemId === item.id ? "dragging" : ""}`}
      draggable
      key={item.id}
      onDragEnd={() => { setDraggedItemId(null); setDragTarget(null); }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
        setDraggedItemId(item.id);
      }}
    >
      <span aria-hidden="true" className="rank-drag-handle">⋮⋮</span>
      <span className="provider-orb" data-provider={item.provider} />
      <div><strong>{item.name}</strong><small>{item.provider} · {item.detail}</small></div>
      <label>
        <span className="visually-hidden">Move {item.name}</span>
        <select aria-label={`Move ${item.name}`} onChange={(event) => moveItem(item.id, event.target.value || null)} value={board.placements[item.id] ?? ""}>
          <option value="">Unranked</option>
          {board.tiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
        </select>
      </label>
    </article>
  );

  return (
    <section className="rank-view" id="rank-top" aria-labelledby="rank-top-heading">
      <header className="rank-header">
        <div>
          <span>YOUR BOARD</span>
          <h1 id="rank-top-heading" tabIndex={-1}>Rank them your way.</h1>
          <p>Rename tiers, add your own, then drag cards into place. Cards start grouped by company, and each board is kept separately in this browser.</p>
        </div>
        <div className="rank-actions">
          <button className="button button-primary" disabled={rankedCount === 0} onClick={shareBoard} title={rankedCount === 0 ? "Place at least one card first" : "Copy a link to this board"} type="button">Copy share link</button>
          <button className="button button-ghost" onClick={() => { updateBoard(() => defaultBoard()); invalidateShare(); setStatus("Board reset."); }} type="button">Reset</button>
        </div>
      </header>

      <div className="rank-subject-switch book-switch" role="group" aria-label="Rank subject">
        {subjects.map((option) => (
          <button
            aria-pressed={subject === option.id}
            className={subject === option.id ? "active" : ""}
            key={option.id}
            onClick={() => switchSubject(option.id)}
            type="button"
          >
            {option.label} <span>{itemsBySubject[option.id].length}</span>
          </button>
        ))}
      </div>

      <p className="rank-instructions" id="rank-instructions">Drag cards on desktop. On touch devices or with a keyboard, use each card’s move menu.</p>
      {status && <p aria-live="polite" className="rank-status">{status}</p>}
      {shareUrl && <label className="rank-share-field"><span>Shareable link</span><input onFocus={(event) => event.currentTarget.select()} readOnly value={shareUrl} /></label>}

      <div className="rank-layout">
        <div className="rank-board" aria-describedby="rank-instructions">
          {board.tiers.map((tier, index) => {
            const tierItems = items.filter((item) => board.placements[item.id] === tier.id);
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
                  {tierItems.length > 0 ? tierItems.map(renderItem) : <p>Drop cards here</p>}
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
          <header>
            <div><span>{subject === "plans" ? "PLAN OPTIONS" : "MODEL OPTIONS"}</span><h2>{subject === "plans" ? "Unranked plans" : "Unranked models"}</h2></div>
            <strong>{unrankedGroups.reduce((total, [, group]) => total + group.length, 0)}</strong>
          </header>
          {unrankedGroups.length > 0 ? (
            <div className="rank-company-grid">
              {unrankedGroups.map(([provider, providerItems]) => (
                <section className="rank-company" key={provider}><h3>{provider}<span>{providerItems.length}</span></h3><div>{providerItems.map(renderItem)}</div></section>
              ))}
            </div>
          ) : <p className="rank-pool-empty">Everything is ranked. Drag a card back here to unrank it.</p>}
        </aside>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { models, plans } from "@/lib/catalog";
import { metricValue } from "@/lib/domain/eligibility";
import {
  decodeBoard,
  defaultBoard,
  encodeBoard,
  isPristine,
  isSubject,
  limits,
  placedIds,
  rankedCount,
  retiredIds,
  subjects,
  tierOf,
  type Board,
  type RankableItem,
  type Subject,
} from "@/lib/boards/codec";
import {
  addTier,
  clearRetired,
  moveTier,
  nudgeItem,
  placeItem,
  removeTier,
  renameTier,
  setNote,
  setTitle,
} from "@/lib/boards/actions";
import { absoluteUrl, currentPathname } from "@/lib/browser/url";
import { Icon } from "@/components/icon";
import {
  clearRecovery,
  emptyBoards,
  readBoards,
  replaceUnreadableBoards,
  readRecovery,
  saveRecovery,
  writeBoards,
  type Recovery,
} from "./storage";

const rankablePlans: RankableItem[] = plans
  .filter((plan) => plan.kind === "Subscription")
  .map((plan) => ({
    id: plan.id,
    provider: plan.provider,
    name: plan.name,
    detail: plan.monthly === null ? "pay as you go" : `$${plan.monthly}/mo`,
  }));

const rankableModels: RankableItem[] = models.map((model) => {
  const index = metricValue(model.capability, "intelligence");
  return {
    id: model.id,
    provider: model.provider,
    name: model.name,
    detail: index === null ? "not scored" : `index ${index}`,
  };
});

const itemsBySubject: Record<Subject, RankableItem[]> = { plans: rankablePlans, models: rankableModels };

type Preview = { subject: Subject; board: Board; from: "link" | "file" };

function providersOf(items: RankableItem[]): string[] {
  return [...new Set(items.map((item) => item.provider))].sort((a, b) => a.localeCompare(b));
}

export function TierListView() {
  const [subject, setSubject] = useState<Subject>("plans");
  const [boards, setBoards] = useState<Record<Subject, Board>>(emptyBoards);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [status, setStatus] = useState("");
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareState, setShareState] = useState<"idle" | "copied" | "manual" | "too-large">("idle");
  const [poolQuery, setPoolQuery] = useState("");
  const [poolProvider, setPoolProvider] = useState("All");
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const items = itemsBySubject[subject];
  const editing = preview === null;
  const board = preview ? preview.board : boards[subject];

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from storage and an explicit share link */
    const stored = readBoards(itemsBySubject);
    setStorageBlocked(stored.blocked);
    const restored = { ...emptyBoards(), ...stored.boards };
    setBoards(restored);

    const params = new URLSearchParams(window.location.search);
    // New links carry the board in the fragment, which browsers do not send to
    // the server. Query-string links from the previous build still open.
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const encoded = fragment.get("board") ?? params.get("board");
    const linkSubject = fragment.get("subject") ?? params.get("subject");
    // A link names its own subject. Otherwise open on the saved one — unless
    // that board is untouched and the other holds actual work, which is what
    // happens to a board migrated from a build that did not save the subject.
    const withWork = subjects.filter((option) => !isPristine(restored[option.id]));
    const nextSubject: Subject = isSubject(linkSubject)
      ? linkSubject
      : isPristine(restored[stored.subject]) && withWork.length > 0
        ? withWork[0].id
        : stored.subject;
    setSubject(nextSubject);

    if (encoded) {
      const decoded = decodeBoard(encoded, itemsBySubject[nextSubject]);
      if (decoded.state === "ok") {
        // A shared board is a preview. Nothing the reader saved is touched
        // until they say so.
        setPreview({ subject: decoded.subject ?? nextSubject, board: decoded.board, from: "link" });
        if (decoded.subject) setSubject(decoded.subject);
        setStatus("Previewing a shared tier list. Your own board is untouched until you import it.");
      } else if (decoded.state === "too-large") {
        setStatus("That shared link is too large to open. Ask for the JSON export instead.");
      } else if (decoded.state === "unknown-version") {
        setStatus(`That link was made by a newer version of this page (format ${decoded.version}), so it cannot be opened here.`);
      } else {
        setStatus("That shared link could not be read, so your own board is shown instead.");
      }
    } else if (withWork.length > 0) {
      setStatus("Your saved board is back.");
      setSaved(true);
    }

    setRecovery(readRecovery(itemsBySubject));
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Persist after hydration so an empty first render never overwrites saved
  // work, and never while a preview is open — a preview is someone else's.
  useEffect(() => {
    if (!hydrated || preview || storageBlocked) return;
    // Persisting is the external system this effect exists to update, and
    // whether the write landed is that system answering back. The editor has to
    // know, because "Saved in this browser" must not be claimed on a failure.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage feedback, not derived state
    setSaved(writeBoards(subject, boards));
  }, [boards, hydrated, preview, subject, storageBlocked]);

  const update = (change: (current: Board) => Board) => {
    if (!editing) return;
    setBoards((current) => ({ ...current, [subject]: change(current[subject]) }));
    invalidateShare();
  };

  const invalidateShare = () => {
    setShareUrl("");
    setShareState("idle");
  };

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const placed = useMemo(() => placedIds(board), [board]);
  const retired = useMemo(() => retiredIds(board, items), [board, items]);
  const providers = useMemo(() => ["All", ...providersOf(items)], [items]);

  // The pool filter narrows what you can pick up. It must never change what is
  // already on the board.
  const unrankedGroups = useMemo(() => {
    const normalized = poolQuery.trim().toLowerCase();
    const groups = new Map<string, RankableItem[]>();
    items
      .filter((item) => !placed.has(item.id))
      .filter((item) => poolProvider === "All" || item.provider === poolProvider)
      .filter((item) => !normalized || `${item.provider} ${item.name}`.toLowerCase().includes(normalized))
      .forEach((item) => groups.set(item.provider, [...(groups.get(item.provider) ?? []), item]));
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items, placed, poolProvider, poolQuery]);

  const unrankedTotal = items.filter((item) => !placed.has(item.id)).length;

  const switchSubject = (next: Subject) => {
    setSubject(next);
    setDragTarget(null);
    invalidateShare();
    setStatus(`Ranking ${next === "plans" ? "subscription plans" : "API models"}.`);
  };

  const moveItem = (itemId: string, tierId: string | null) => {
    update((current) => placeItem(current, itemId, tierId));
    const name = itemById.get(itemId)?.name ?? itemId;
    setStatus(tierId
      ? `Moved ${name} to ${board.tiers.find((tier) => tier.id === tierId)?.name}.`
      : `Returned ${name} to unranked.`);
  };

  const nudge = (itemId: string, delta: number) => {
    update((current) => nudgeItem(current, itemId, delta));
    const name = itemById.get(itemId)?.name ?? itemId;
    setStatus(`${name} moved ${delta < 0 ? "earlier" : "later"} in its tier.`);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, tierId: string | null) => {
    event.preventDefault();
    const itemId = event.dataTransfer.getData("text/plain") || draggedItemId;
    if (itemId) moveItem(itemId, tierId);
    setDraggedItemId(null);
    setDragTarget(null);
  };

  const resetBoard = () => {
    saveRecovery(subject, boards[subject], "Board reset");
    setRecovery({ subject, board: boards[subject], reason: "Board reset" });
    setBoards((current) => ({ ...current, [subject]: defaultBoard() }));
    invalidateShare();
    setStatus("Board reset. Undo is available until you leave.");
  };

  const undoRecovery = () => {
    if (!recovery) return;
    setSubject(recovery.subject);
    setBoards((current) => ({ ...current, [recovery.subject]: recovery.board }));
    clearRecovery();
    setRecovery(null);
    setStatus("Restored the board from before that change.");
  };

  const share = async () => {
    const encoded = encodeBoard(board, subject);
    if (encoded.length > limits.encodedPayload) {
      setShareState("too-large");
      setStatus("This board is too large for a dependable link. Export it as a file instead.");
      return;
    }
    const fragment = `board=${encodeURIComponent(encoded)}&subject=${subject}`;
    const url = absoluteUrl(currentPathname(), undefined, fragment);
    setShareUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      setShareState("copied");
      setStatus("Share link copied.");
    } catch {
      setShareState("manual");
      setStatus("Share link ready. Select and copy it below.");
    }
  };

  const exportBoard = () => {
    const encoded = encodeBoard(board, subject);
    const blob = new Blob([encoded], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tokentier-${subject}-board.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Board exported as a JSON file.");
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const decoded = decodeBoard(text, itemsBySubject[subject]);
      if (decoded.state !== "ok") {
        setStatus(
          decoded.state === "too-large" ? "That file is too large to read."
            : decoded.state === "unknown-version" ? `That file uses a newer format (version ${decoded.version}).`
            : "That file is not a TokenTier board.",
        );
        return;
      }
      setPreview({ subject: decoded.subject ?? subject, board: decoded.board, from: "file" });
      if (decoded.subject) setSubject(decoded.subject);
      setStatus("Previewing the imported board. Your own board is untouched until you import it.");
    } catch {
      setStatus("That file could not be read.");
    }
  };

  const adoptPreview = () => {
    if (!preview) return;
    saveRecovery(preview.subject, boards[preview.subject], "Replaced by an imported board");
    setRecovery({ subject: preview.subject, board: boards[preview.subject], reason: "Replaced by an imported board" });
    setBoards((current) => ({ ...current, [preview.subject]: preview.board }));
    setSubject(preview.subject);
    setPreview(null);
    clearShareParams();
    setStatus("Imported board is now yours. Undo is available.");
  };

  const discardPreview = () => {
    setPreview(null);
    clearShareParams();
    setStatus("Preview closed. Your own board is unchanged.");
  };

  // Both the legacy query form and the fragment form have to go: leaving either
  // behind would re-open the preview on the next reload, over the board the
  // reader has just imported.
  const clearShareParams = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("board");
    params.delete("subject");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  };

  const renderCard = (item: RankableItem | { id: string; retired: true }) => {
    const known = "provider" in item ? item : null;
    const currentTier = tierOf(board, item.id);
    const ids = currentTier ? board.order[currentTier] ?? [] : [];
    const position = ids.indexOf(item.id);
    return (
      <article
        className={`rank-plan-card ${draggedItemId === item.id ? "dragging" : ""} ${known ? "" : "retired"}`}
        draggable={editing}
        key={item.id}
        onDragEnd={() => { setDraggedItemId(null); setDragTarget(null); }}
        onDragStart={(event) => {
          if (!editing) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.id);
          setDraggedItemId(item.id);
        }}
      >
        <span aria-hidden="true" className="rank-drag-handle">⋮⋮</span>
        <span className="provider-orb" data-provider={known?.provider ?? "Retired"} />
        <div>
          <strong>{known?.name ?? item.id}</strong>
          <small>{known ? `${known.provider} · ${known.detail}` : "No longer in the catalog"}</small>
        </div>
        <div className="rank-card-controls">
          {currentTier && (
            <span className="rank-card-order" role="group" aria-label={`Reorder ${known?.name ?? item.id}`}>
              <button
                aria-label={`Move ${known?.name ?? item.id} earlier`}
                disabled={!editing || position <= 0}
                onClick={() => nudge(item.id, -1)}
                type="button"
              >
                <Icon name="arrow-up" size={12} />
              </button>
              <button
                aria-label={`Move ${known?.name ?? item.id} later`}
                disabled={!editing || position === -1 || position >= ids.length - 1}
                onClick={() => nudge(item.id, 1)}
                type="button"
              >
                <Icon name="arrow-down" size={12} />
              </button>
            </span>
          )}
          <label>
            <span className="visually-hidden">Move {known?.name ?? item.id}</span>
            <select
              aria-label={`Move ${known?.name ?? item.id}`}
              disabled={!editing}
              onChange={(event) => moveItem(item.id, event.target.value || null)}
              value={currentTier ?? ""}
            >
              <option value="">Unranked</option>
              {board.tiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
            </select>
          </label>
        </div>
      </article>
    );
  };

  return (
    <main className="view-panel">
      {storageBlocked && <div role="alert" className="decision-advice">
        <p>Saved boards could not be read. Autosave is paused to preserve them. You can edit and export this session.</p>
        {!preview && <button className="button button-ghost" type="button" onClick={() => {
          if (replaceUnreadableBoards(subject, boards)) { setStorageBlocked(false); setSaved(true); setStatus("Original saved data backed up; this session is now saved."); }
          else setStatus("Could not preserve a backup and save. Original data is unchanged; export this session instead.");
        }}>Back up original data and replace saved boards</button>}
      </div>}
      <a className="skip-link" href="#rank-top">Skip to your board</a>
      <section className="rank-view" id="rank-top" aria-labelledby="rank-top-heading">
        <header className="rank-header">
          <div>
            <span>YOUR OPINION</span>
            <h1 id="rank-top-heading" tabIndex={-1}>Rank them your way.</h1>
            <p>
              This board is your own opinion, kept separate from the calculated rankings. Rename tiers,
              add your own, then drag cards into place or use each card&rsquo;s move controls. Each board is
              kept separately in this browser.
            </p>
          </div>
          <div className="rank-actions">
            <button className="button button-primary" disabled={rankedCount(board) === 0} onClick={share} title={rankedCount(board) === 0 ? "Place at least one card first" : "Copy a link to this board"} type="button">Copy share link</button>
            <button className="button button-ghost" onClick={exportBoard} type="button">
              <Icon name="download" size={13} /> <span>Export</span>
            </button>
            <button className="button button-ghost" onClick={() => fileInputRef.current?.click()} type="button">Import</button>
            <button className="button button-ghost" disabled={!editing} onClick={resetBoard} type="button">Reset</button>
            <input
              accept="application/json,.json"
              className="visually-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = "";
              }}
              ref={fileInputRef}
              type="file"
            />
          </div>
        </header>

        {preview && (
          <div className="rank-preview-banner">
            <p>
              <strong>Preview.</strong> This board came from {preview.from === "link" ? "a shared link" : "a file"}.
              Nothing you saved has changed. Importing it replaces your {preview.subject === "plans" ? "plans" : "models"} board,
              and the replaced board stays recoverable for one step.
            </p>
            <div className="rank-actions">
              <button className="button button-primary" onClick={adoptPreview} type="button">Use this board</button>
              <button className="button button-ghost" onClick={discardPreview} type="button">Discard preview</button>
            </div>
          </div>
        )}

        {recovery && !preview && (
          <div className="rank-recovery-banner">
            <p><Icon name="undo" size={13} /> {recovery.reason}. You can put it back.</p>
            <div className="rank-actions">
              <button className="button button-ghost" onClick={undoRecovery} type="button">Undo</button>
              <button className="button button-ghost" onClick={() => { clearRecovery(); setRecovery(null); }} type="button">Dismiss</button>
            </div>
          </div>
        )}

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

        <div className="rank-meta-fields">
          <label>
            <span>Board title</span>
            <input
              disabled={!editing}
              maxLength={limits.title}
              onChange={(event) => update((current) => setTitle(current, event.target.value))}
              placeholder={subject === "plans" ? "My plan ranking" : "My model ranking"}
              value={board.title}
            />
          </label>
          <label>
            <span>Use-case note (optional)</span>
            <input
              disabled={!editing}
              maxLength={limits.note}
              onChange={(event) => update((current) => setNote(current, event.target.value))}
              placeholder="What this ranking is for"
              value={board.note}
            />
          </label>
        </div>

        <p className="rank-instructions" id="rank-instructions">
          Drag cards on desktop. On touch devices or with a keyboard, use each card&rsquo;s move menu and the
          up and down buttons to order cards inside a tier.
        </p>
        <p aria-live="polite" className="rank-status">
          {status}
          {hydrated && editing && !saved && rankedCount(board) > 0 && " This browser is not saving; use Export to keep a copy."}
          {hydrated && editing && saved && !isPristine(board) && " Saved in this browser."}
        </p>
        {shareState === "too-large" && (
          <p className="rank-status">This board is past the {limits.encodedPayload.toLocaleString()}-character link limit. Export it as a file instead.</p>
        )}
        {shareUrl && (
          <label className="rank-share-field">
            <span>Shareable link</span>
            <input onFocus={(event) => event.currentTarget.select()} readOnly value={shareUrl} />
          </label>
        )}

        {retired.length > 0 && (
          <p className="rank-status">
            {retired.length} card{retired.length === 1 ? "" : "s"} on this board {retired.length === 1 ? "is" : "are"} no longer in the catalog.
            {" "}
            <button className="inline-link" disabled={!editing} onClick={() => update((current) => clearRetired(current, new Set(items.map((item) => item.id))))} type="button">
              Remove retired cards
            </button>
          </p>
        )}

        <div className="rank-layout">
          <div className="rank-board" aria-describedby="rank-instructions">
            {board.tiers.map((tier, index) => {
              const ids = board.order[tier.id] ?? [];
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
                    <label>
                      <span className="visually-hidden">Tier name</span>
                      <input
                        disabled={!editing}
                        maxLength={limits.tierName}
                        onBlur={(event) => { if (!event.target.value.trim()) update((current) => renameTier(current, tier.id, "Untitled tier")); }}
                        onChange={(event) => update((current) => renameTier(current, tier.id, event.target.value))}
                        value={tier.name}
                      />
                    </label>
                    <span className="rank-tier-controls">
                      <button aria-label={`Move ${tier.name} up`} disabled={!editing || index === 0} onClick={() => update((current) => moveTier(current, tier.id, -1))} type="button">
                        <Icon name="arrow-up" size={12} />
                      </button>
                      <button aria-label={`Move ${tier.name} down`} disabled={!editing || index === board.tiers.length - 1} onClick={() => update((current) => moveTier(current, tier.id, 1))} type="button">
                        <Icon name="arrow-down" size={12} />
                      </button>
                      <button
                        aria-label={`Remove ${tier.name}`}
                        disabled={!editing || board.tiers.length <= limits.minTiers}
                        onClick={() => { update((current) => removeTier(current, tier.id)); setStatus("Tier removed. Its cards are unranked again."); }}
                        title={board.tiers.length <= limits.minTiers ? "Keep at least one tier" : "Remove tier"}
                        type="button"
                      >
                        ×
                      </button>
                    </span>
                  </header>
                  <div className="rank-tier-items">
                    {ids.length > 0
                      ? ids.map((id) => renderCard(itemById.get(id) ?? { id, retired: true as const }))
                      : <p>Drop cards here</p>}
                  </div>
                </section>
              );
            })}
            <button
              className="rank-add-tier"
              disabled={!editing || board.tiers.length >= limits.maxTiers}
              onClick={() => update((current) => addTier(current))}
              title={board.tiers.length >= limits.maxTiers ? `A board holds at most ${limits.maxTiers} tiers` : "Add a tier"}
              type="button"
            >
              + Add tier
            </button>
          </div>

          <aside
            className={`rank-pool ${dragTarget === "unranked" ? "drop-active" : ""}`}
            onDragEnter={() => setDragTarget("unranked")}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, null)}
          >
            <header>
              <div>
                <span>{subject === "plans" ? "PLAN OPTIONS" : "MODEL OPTIONS"}</span>
                <h2>{subject === "plans" ? "Unranked plans" : "Unranked models"}</h2>
              </div>
              <strong>{unrankedTotal}</strong>
            </header>
            <div className="rank-pool-filters">
              <label className="search-field">
                <Icon className="search-icon" name="search" size={15} />
                <input
                  aria-label="Search unranked cards"
                  onChange={(event) => setPoolQuery(event.target.value)}
                  placeholder="Search name or provider"
                  type="search"
                  value={poolQuery}
                />
              </label>
              <label>
                <span className="visually-hidden">Filter by provider</span>
                <select aria-label="Filter by provider" onChange={(event) => setPoolProvider(event.target.value)} value={poolProvider}>
                  {providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                </select>
              </label>
            </div>
            {unrankedGroups.length > 0 ? (
              <div className="rank-company-grid">
                {unrankedGroups.map(([provider, providerItems]) => (
                  <section className="rank-company" key={provider}>
                    <h3>{provider}<span>{providerItems.length}</span></h3>
                    <div>{providerItems.map((item) => renderCard(item))}</div>
                  </section>
                ))}
              </div>
            ) : (
              <p className="rank-pool-empty">
                {unrankedTotal === 0
                  ? "Everything is ranked. Drag a card back here to unrank it."
                  : "No unranked card matches that search or provider."}
              </p>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

export default TierListView;

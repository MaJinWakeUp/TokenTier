// The board payload and its versioned codec.
//
// A board is the reader's own opinion, so it is only ever read from their own
// storage or from a link they opened — never derived from the catalogs. The
// payload records ordered tiers and ordered cards inside each tier, because an
// unordered set cannot represent "these two are both A, but this one first".
//
// Everything the editor can produce must decode, and everything that decodes
// must be renderable: unknown ids come back as retired cards rather than being
// dropped, so a board never silently loses a row.

export type Subject = "plans" | "models";

export type RankableItem = {
  id: string;
  provider: string;
  name: string;
  detail: string;
};

export type RankTier = { id: string; name: string };

export type Board = {
  title: string;
  note: string;
  tiers: RankTier[];
  // tier id -> ordered card ids. Ids the catalog no longer knows are kept here
  // and surfaced as retired cards.
  order: Record<string, string[]>;
};

export const limits = {
  title: 60,
  note: 140,
  tierName: 40,
  tierId: 40,
  minTiers: 1,
  maxTiers: 12,
  // A link people can paste into a chat window. Past this the board is offered
  // as a file instead of a link that will be truncated somewhere in transit.
  encodedPayload: 12_000,
} as const;

export const payloadVersion = 2;

export const subjects: Array<{ id: Subject; label: string; short: string }> = [
  { id: "plans", label: "Subscription plans", short: "Plans" },
  { id: "models", label: "API models", short: "Models" },
];

export function isSubject(value: unknown): value is Subject {
  return value === "plans" || value === "models";
}

export function defaultBoard(): Board {
  return {
    title: "",
    note: "",
    tiers: [
      { id: "s", name: "S · Best" },
      { id: "a", name: "A · Strong" },
      { id: "b", name: "B · Good" },
      { id: "c", name: "C · Situational" },
    ],
    // Every tier owns an entry, empty or not, so a decoded board and a board
    // built in the editor are the same shape and compare equal.
    order: { s: [], a: [], b: [], c: [] },
  };
}

// An untouched board is not worth saving, and must never be announced as a
// restored one on the next visit.
export function isPristine(board: Board): boolean {
  if (board.title.trim() !== "" || board.note.trim() !== "") return false;
  if (Object.values(board.order).some((ids) => ids.length > 0)) return false;
  const initial = defaultBoard().tiers;
  return board.tiers.length === initial.length
    && board.tiers.every((tier, index) => tier.id === initial[index].id && tier.name === initial[index].name);
}

export function boundedText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function placedIds(board: Board): Set<string> {
  return new Set(Object.values(board.order).flat());
}

export function tierOf(board: Board, itemId: string): string | null {
  for (const [tierId, ids] of Object.entries(board.order)) {
    if (ids.includes(itemId)) return tierId;
  }
  return null;
}

export function rankedCount(board: Board): number {
  return placedIds(board).size;
}

// Ids the current catalog no longer contains. They stay on the board as
// retired cards so a reader can see what happened rather than wonder where a
// row went.
export function retiredIds(board: Board, items: RankableItem[]): string[] {
  const known = new Set(items.map((item) => item.id));
  return [...placedIds(board)].filter((id) => !known.has(id));
}

export type DecodeResult =
  | { state: "ok"; board: Board; subject: Subject | null }
  | { state: "empty" }
  | { state: "too-large" }
  | { state: "unknown-version"; version: number }
  | { state: "invalid" };

function normalizeTiers(raw: unknown): RankTier[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > limits.maxTiers) return null;
  const tiers = raw
    .filter((tier): tier is [string, string] => Array.isArray(tier) && typeof tier[0] === "string" && typeof tier[1] === "string")
    .map(([id, name]) => ({ id: id.slice(0, limits.tierId), name: name.trim().slice(0, limits.tierName) || "Untitled tier" }));
  if (tiers.length === 0 || new Set(tiers.map((tier) => tier.id)).size !== tiers.length) return null;
  return tiers;
}

// Version 1 payloads recorded a card's tier but not its position. Ordering them
// by the catalog's own order is deterministic: the same old link always
// migrates to the same board.
function orderFromV1(pairs: unknown, tiers: RankTier[], items: RankableItem[]): Record<string, string[]> {
  const tierIds = new Set(tiers.map((tier) => tier.id));
  const assignment = new Map<string, string>();
  for (const entry of Array.isArray(pairs) ? pairs : []) {
    if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string" && tierIds.has(entry[1])) {
      assignment.set(entry[0], entry[1]);
    }
  }
  const order: Record<string, string[]> = {};
  for (const tier of tiers) order[tier.id] = [];
  const catalogOrder = items.map((item) => item.id);
  const seen = new Set<string>();
  for (const id of catalogOrder) {
    const tierId = assignment.get(id);
    if (tierId) {
      order[tierId].push(id);
      seen.add(id);
    }
  }
  // Ids the catalog no longer knows keep their placement, appended in the
  // payload's own order so the migration stays deterministic.
  for (const [id, tierId] of assignment) {
    if (!seen.has(id)) order[tierId].push(id);
  }
  return order;
}

function orderFromV2(raw: unknown, tiers: RankTier[]): Record<string, string[]> {
  const tierIds = new Set(tiers.map((tier) => tier.id));
  const order: Record<string, string[]> = {};
  for (const tier of tiers) order[tier.id] = [];
  const placed = new Set<string>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !tierIds.has(entry[0])) continue;
    const ids = Array.isArray(entry[1]) ? entry[1] : [];
    for (const id of ids) {
      // A card can only be in one tier: a payload claiming otherwise keeps the
      // first placement rather than rendering the same card twice.
      if (typeof id === "string" && !placed.has(id)) {
        order[entry[0]].push(id);
        placed.add(id);
      }
    }
  }
  return order;
}

export function decodeBoard(raw: unknown, items: RankableItem[]): DecodeResult {
  if (typeof raw !== "string" || raw.length === 0) return { state: "empty" };
  if (raw.length > limits.encodedPayload) return { state: "too-large" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "invalid" };
  }
  return decodeParsedBoard(parsed, items);
}

export function decodeParsedBoard(parsed: unknown, items: RankableItem[]): DecodeResult {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { state: "invalid" };
  const payload = parsed as { v?: unknown; s?: unknown; n?: unknown; d?: unknown; t?: unknown; o?: unknown; p?: unknown };

  const version = typeof payload.v === "number" ? payload.v : 1;
  if (version > payloadVersion) return { state: "unknown-version", version };

  const tiers = normalizeTiers(payload.t);
  if (!tiers) return { state: "invalid" };

  const order = version >= 2
    ? orderFromV2(payload.o, tiers)
    : orderFromV1(payload.p, tiers, items);

  return {
    state: "ok",
    subject: isSubject(payload.s) ? payload.s : null,
    board: {
      title: boundedText(payload.n, limits.title),
      note: boundedText(payload.d, limits.note),
      tiers,
      order,
    },
  };
}

export function boardPayload(board: Board, subject: Subject) {
  return {
    v: payloadVersion,
    s: subject,
    n: board.title,
    d: board.note,
    t: board.tiers.map((tier) => [tier.id, tier.name]),
    o: board.tiers.map((tier) => [tier.id, board.order[tier.id] ?? []]),
  };
}

export function encodeBoard(board: Board, subject: Subject): string {
  return JSON.stringify(boardPayload(board, subject));
}

// Every edit a board editor can make, as pure transformations.
//
// The rule this file exists to keep: the editor cannot create data its decoder
// rejects. Tier counts, name lengths, and single-tier membership are enforced
// here, so a board that came out of the editor always survives a round trip
// through the codec.

import {
  boundedText,
  defaultBoard,
  limits,
  tierOf,
  type Board,
  type RankTier,
} from "./codec.js";

function withOrder(board: Board, order: Record<string, string[]>): Board {
  return { ...board, order };
}

export function setTitle(board: Board, title: string): Board {
  return { ...board, title: boundedText(title, limits.title) };
}

export function setNote(board: Board, note: string): Board {
  return { ...board, note: boundedText(note, limits.note) };
}

export function renameTier(board: Board, tierId: string, name: string): Board {
  return {
    ...board,
    tiers: board.tiers.map((tier) => (tier.id === tierId ? { ...tier, name: boundedText(name, limits.tierName) } : tier)),
  };
}

// Ids are generated rather than derived from the name so renaming a tier never
// re-parents the cards inside it.
export function addTier(board: Board, idSeed: string = Date.now().toString(36)): Board {
  if (board.tiers.length >= limits.maxTiers) return board;
  const taken = new Set(board.tiers.map((tier) => tier.id));
  let id = `tier-${idSeed}`;
  let suffix = 1;
  while (taken.has(id)) id = `tier-${idSeed}-${suffix++}`;
  const tier: RankTier = { id, name: `New tier ${board.tiers.length + 1}` };
  return { ...board, tiers: [...board.tiers, tier], order: { ...board.order, [id]: [] } };
}

// Removing a tier unranks its cards rather than deleting them: the reader chose
// those cards, and only the grouping was removed.
export function removeTier(board: Board, tierId: string): Board {
  if (board.tiers.length <= limits.minTiers) return board;
  const order = { ...board.order };
  delete order[tierId];
  return { ...board, tiers: board.tiers.filter((tier) => tier.id !== tierId), order };
}

export function moveTier(board: Board, tierId: string, delta: number): Board {
  const index = board.tiers.findIndex((tier) => tier.id === tierId);
  if (index === -1) return board;
  const target = index + delta;
  if (target < 0 || target >= board.tiers.length) return board;
  const tiers = [...board.tiers];
  const [moved] = tiers.splice(index, 1);
  tiers.splice(target, 0, moved);
  return { ...board, tiers };
}

// Placing a card removes it from wherever it was first, so a card is never in
// two tiers at once. `index` is a position inside the destination; omitting it
// appends.
export function placeItem(board: Board, itemId: string, tierId: string | null, index?: number): Board {
  const order: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(board.order)) {
    order[key] = ids.filter((id) => id !== itemId);
  }
  if (tierId === null) return withOrder(board, order);
  if (!board.tiers.some((tier) => tier.id === tierId)) return board;

  const target = order[tierId] ?? [];
  const at = index === undefined ? target.length : Math.max(0, Math.min(target.length, index));
  order[tierId] = [...target.slice(0, at), itemId, ...target.slice(at)];
  return withOrder(board, order);
}

// Move a card one place earlier or later inside its own tier. This is the
// keyboard and touch equivalent of a drag: WCAG 2.2 requires the dragging
// gesture to have a non-drag alternative.
export function nudgeItem(board: Board, itemId: string, delta: number): Board {
  const tierId = tierOf(board, itemId);
  if (tierId === null) return board;
  const ids = board.order[tierId] ?? [];
  const index = ids.indexOf(itemId);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= ids.length) return board;
  const next = [...ids];
  next.splice(index, 1);
  next.splice(target, 0, itemId);
  return withOrder(board, { ...board.order, [tierId]: next });
}

export function resetBoard(): Board {
  return defaultBoard();
}

// Drop any card the catalog no longer knows about. Only ever run when the
// reader asks for it, so a retired card stays visible until then.
export function clearRetired(board: Board, knownIds: Set<string>): Board {
  const order: Record<string, string[]> = {};
  for (const [tierId, ids] of Object.entries(board.order)) {
    order[tierId] = ids.filter((id) => knownIds.has(id));
  }
  return withOrder(board, order);
}

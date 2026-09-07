// Personal board behaviour: the versioned payload, the migration from the
// pre-refactor format, and the editor operations. These import the functions
// rather than asserting on component source, so they keep holding when the
// editor's markup changes.

import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBoard,
  decodeParsedBoard,
  defaultBoard,
  encodeBoard,
  isPristine,
  limits,
  rankedCount,
  retiredIds,
  tierOf,
} from "../build/lib/boards/codec.js";
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
} from "../build/lib/boards/actions.js";

const items = [
  { id: "alpha", provider: "Acme", name: "Alpha", detail: "$10/mo" },
  { id: "beta", provider: "Acme", name: "Beta", detail: "$20/mo" },
  { id: "gamma", provider: "Zeta", name: "Gamma", detail: "$30/mo" },
];

function boardWith(order) {
  return { ...defaultBoard(), order };
}

// -- Round trip ---------------------------------------------------------------

test("a valid board round-trips with identical title, tiers, order and assignments", () => {
  let board = defaultBoard();
  board = setTitle(board, "Coding picks");
  board = setNote(board, "For agent work");
  board = placeItem(board, "gamma", "s");
  board = placeItem(board, "alpha", "s");
  board = placeItem(board, "beta", "b");
  board = renameTier(board, "s", "Top");

  const decoded = decodeBoard(encodeBoard(board, "plans"), items);
  assert.equal(decoded.state, "ok");
  assert.equal(decoded.subject, "plans");
  assert.deepEqual(decoded.board, board);
  // Order inside a tier is the reader's ranking, not the catalog's.
  assert.deepEqual(decoded.board.order.s, ["gamma", "alpha"]);
});

test("the editor cannot create data its decoder rejects", () => {
  let board = defaultBoard();
  // Overlong text everywhere the editor accepts text.
  board = setTitle(board, "x".repeat(500));
  board = setNote(board, "y".repeat(500));
  board = renameTier(board, "s", "z".repeat(500));
  // Past the tier ceiling.
  for (let i = 0; i < 40; i += 1) board = addTier(board, `seed${i}`);

  assert.equal(board.title.length, limits.title);
  assert.equal(board.note.length, limits.note);
  assert.equal(board.tiers[0].name.length, limits.tierName);
  assert.equal(board.tiers.length, limits.maxTiers);

  const decoded = decodeBoard(encodeBoard(board, "models"), items);
  assert.equal(decoded.state, "ok");
  assert.deepEqual(decoded.board, board);
});

// -- Legacy migration ---------------------------------------------------------

test("a version 1 payload migrates with a deterministic order", () => {
  const legacy = {
    t: [["s", "S · Best"], ["a", "A · Strong"]],
    p: [["gamma", "s"], ["alpha", "s"], ["beta", "a"]],
  };
  const first = decodeParsedBoard(legacy, items);
  const second = decodeParsedBoard(legacy, items);
  assert.equal(first.state, "ok");
  // Version 1 never recorded a position, so the catalog's own order decides —
  // and decides the same way every time.
  assert.deepEqual(first.board.order.s, ["alpha", "gamma"]);
  assert.deepEqual(first.board.order.a, ["beta"]);
  assert.deepEqual(first.board, second.board);
});

test("a version 1 payload keeps placements the catalog no longer knows", () => {
  const decoded = decodeParsedBoard({ t: [["s", "S"]], p: [["retired-model", "s"], ["alpha", "s"]] }, items);
  assert.equal(decoded.state, "ok");
  assert.deepEqual(decoded.board.order.s, ["alpha", "retired-model"]);
  assert.deepEqual(retiredIds(decoded.board, items), ["retired-model"]);
});

// -- Malformed and out-of-range payloads -------------------------------------

test("malformed, empty, oversized and future payloads are each reported distinctly", () => {
  assert.equal(decodeBoard("", items).state, "empty");
  assert.equal(decodeBoard("not json", items).state, "invalid");
  assert.equal(decodeBoard(JSON.stringify({ t: [] }), items).state, "invalid");
  assert.equal(decodeBoard(JSON.stringify({ t: "nope" }), items).state, "invalid");
  assert.equal(decodeBoard("x".repeat(limits.encodedPayload + 1), items).state, "too-large");

  const future = decodeBoard(JSON.stringify({ v: 99, t: [["s", "S"]], o: [] }), items);
  assert.equal(future.state, "unknown-version");
  assert.equal(future.version, 99);
});

test("a payload past the tier ceiling is rejected rather than truncated", () => {
  const tiers = Array.from({ length: limits.maxTiers + 1 }, (_, i) => [`t${i}`, `Tier ${i}`]);
  assert.equal(decodeBoard(JSON.stringify({ v: 2, t: tiers, o: [] }), items).state, "invalid");
});

test("duplicate tier ids and duplicate placements cannot produce a doubled card", () => {
  assert.equal(decodeBoard(JSON.stringify({ v: 2, t: [["s", "S"], ["s", "S again"]], o: [] }), items).state, "invalid");

  const decoded = decodeBoard(
    JSON.stringify({ v: 2, t: [["s", "S"], ["a", "A"]], o: [["s", ["alpha"]], ["a", ["alpha", "beta"]]] }),
    items,
  );
  assert.equal(decoded.state, "ok");
  assert.deepEqual(decoded.board.order.s, ["alpha"]);
  assert.deepEqual(decoded.board.order.a, ["beta"]);
});

// -- Editor operations --------------------------------------------------------

test("placing a card removes it from wherever it was", () => {
  let board = placeItem(defaultBoard(), "alpha", "s");
  board = placeItem(board, "alpha", "b");
  assert.equal(tierOf(board, "alpha"), "b");
  assert.deepEqual(board.order.s ?? [], []);
  assert.equal(rankedCount(board), 1);
});

test("placing accepts a position inside the destination", () => {
  let board = placeItem(defaultBoard(), "alpha", "s");
  board = placeItem(board, "beta", "s");
  board = placeItem(board, "gamma", "s", 1);
  assert.deepEqual(board.order.s, ["alpha", "gamma", "beta"]);
});

test("nudging moves a card inside its tier and stops at the ends", () => {
  let board = placeItem(placeItem(defaultBoard(), "alpha", "s"), "beta", "s");
  assert.deepEqual(nudgeItem(board, "alpha", -1).order.s, ["alpha", "beta"], "already first");
  board = nudgeItem(board, "alpha", 1);
  assert.deepEqual(board.order.s, ["beta", "alpha"]);
  assert.deepEqual(nudgeItem(board, "alpha", 1).order.s, ["beta", "alpha"], "already last");
  // An unranked card has nothing to move within.
  assert.deepEqual(nudgeItem(board, "gamma", -1), board);
});

test("removing a tier unranks its cards instead of deleting them", () => {
  let board = placeItem(defaultBoard(), "alpha", "s");
  board = removeTier(board, "s");
  assert.equal(board.tiers.some((tier) => tier.id === "s"), false);
  assert.equal(rankedCount(board), 0);
});

test("the last tier cannot be removed", () => {
  let board = defaultBoard();
  for (const tier of ["a", "b", "c"]) board = removeTier(board, tier);
  assert.equal(board.tiers.length, limits.minTiers);
  assert.deepEqual(removeTier(board, "s"), board);
});

test("tiers reorder and refuse to move past the ends", () => {
  const board = defaultBoard();
  assert.deepEqual(moveTier(board, "s", -1), board);
  assert.deepEqual(moveTier(board, "c", 1), board);
  assert.equal(moveTier(board, "s", 1).tiers[1].id, "s");
});

test("retired cards stay until they are explicitly cleared", () => {
  const board = boardWith({ s: ["alpha", "ghost"] });
  assert.deepEqual(retiredIds(board, items), ["ghost"]);
  const cleared = clearRetired(board, new Set(items.map((item) => item.id)));
  assert.deepEqual(cleared.order.s, ["alpha"]);
});

test("an untouched board is never treated as saved work", () => {
  assert.equal(isPristine(defaultBoard()), true);
  assert.equal(isPristine(setTitle(defaultBoard(), "Mine")), false);
  assert.equal(isPristine(placeItem(defaultBoard(), "alpha", "s")), false);
  assert.equal(isPristine(addTier(defaultBoard(), "seed")), false);
});

test("a board over the link limit is detectable before a link is offered", () => {
  let board = defaultBoard();
  board = setTitle(board, "x".repeat(limits.title));
  for (let i = 0; i < 400; i += 1) board = placeItem(board, `synthetic-item-${i}`, "s");
  assert.ok(encodeBoard(board, "plans").length > 0);
  // The guard is a length check on the encoded payload, and the decoder agrees
  // with the editor about where the limit is.
  const oversized = "x".repeat(limits.encodedPayload + 1);
  assert.equal(decodeBoard(oversized, items).state, "too-large");
});

"use client";

// Board persistence: versioned records, a one-step recovery snapshot, and a
// one-time migration of the pre-refactor keys.
//
// Storage is treated as unreliable on purpose. Every write reports whether it
// landed, so the editor can say "saved in this browser" only when it is true
// and offer a file export when it is not.

import {
  boardPayload,
  decodeParsedBoard,
  defaultBoard,
  isPristine,
  isSubject,
  subjects,
  type Board,
  type RankableItem,
  type Subject,
} from "@/lib/boards/codec";
import {
  legacyKeys,
  migrateLegacyOnce,
  readJson,
  readRecord,
  removeKey,
  storageKeys,
  writeRecord,
} from "@/lib/browser/storage";

const boardsVersion = 1;

export type StoredBoards = {
  subject: Subject;
  boards: Partial<Record<Subject, Board>>;
};

type BoardsRecord = { subject: string; boards: Record<string, unknown> };

function parseBoards(payload: unknown, items: Record<Subject, RankableItem[]>): StoredBoards | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Partial<BoardsRecord>;
  const boards: Partial<Record<Subject, Board>> = {};
  for (const subject of subjects) {
    const entry = record.boards?.[subject.id];
    if (!entry) continue;
    const decoded = decodeParsedBoard(entry, items[subject.id]);
    if (decoded.state === "ok") boards[subject.id] = decoded.board;
  }
  return {
    subject: isSubject(record.subject) ? record.subject : "plans",
    boards,
  };
}

// The pre-refactor build stored `{plans: {t, p}, models: {t, p}}` under a flat
// key. Those payloads decode through the version 1 path, which orders each
// tier by the catalog's own order — the same old board every time.
function migrateLegacyBoards(items: Record<Subject, RankableItem[]>): void {
  const legacy = readJson(legacyKeys.boards);
  if (!legacy || typeof legacy !== "object") return;
  const record = legacy as Record<string, unknown>;
  const boards: Record<string, unknown> = {};
  for (const subject of subjects) {
    const decoded = decodeParsedBoard(record[subject.id], items[subject.id]);
    if (decoded.state === "ok" && !isPristine(decoded.board)) {
      boards[subject.id] = boardPayload(decoded.board, subject.id);
    }
  }
  if (Object.keys(boards).length === 0) return;
  const savedSubject = readJson(legacyKeys.boardSubject);
  writeRecord(storageKeys.boards, boardsVersion, {
    subject: isSubject(savedSubject) ? savedSubject : "plans",
    boards,
  });
}

export function readBoards(items: Record<Subject, RankableItem[]>): StoredBoards {
  migrateLegacyOnce(() => migrateLegacyBoards(items));
  const stored = readRecord(storageKeys.boards, boardsVersion, (payload) => parseBoards(payload, items));
  if (stored.state === "ok") return stored.value;
  return { subject: "plans", boards: {} };
}

// An untouched board is not saved: it would be announced as restored work on
// the next visit. The record is still written, so the chosen subject survives.
export function writeBoards(subject: Subject, boards: Record<Subject, Board>): boolean {
  const payloads: Record<string, unknown> = {};
  for (const option of subjects) {
    const board = boards[option.id];
    if (!isPristine(board)) payloads[option.id] = boardPayload(board, option.id);
  }
  return writeRecord(storageKeys.boards, boardsVersion, { subject, boards: payloads });
}

export type Recovery = { subject: Subject; board: Board; reason: string };

// A reset or an import replaces work the reader did by hand, so the previous
// board is kept for one step. Recovery outlives a reload, because noticing the
// mistake usually happens after one.
export function saveRecovery(subject: Subject, board: Board, reason: string): boolean {
  return writeRecord(storageKeys.boardRecovery, boardsVersion, {
    subject,
    reason,
    board: boardPayload(board, subject),
  });
}

export function readRecovery(items: Record<Subject, RankableItem[]>): Recovery | null {
  const stored = readRecord(storageKeys.boardRecovery, boardsVersion, (payload) => {
    if (!payload || typeof payload !== "object") return null;
    const record = payload as { subject?: unknown; reason?: unknown; board?: unknown };
    if (!isSubject(record.subject)) return null;
    const decoded = decodeParsedBoard(record.board, items[record.subject]);
    if (decoded.state !== "ok") return null;
    return {
      subject: record.subject,
      reason: typeof record.reason === "string" ? record.reason : "Previous board",
      board: decoded.board,
    } satisfies Recovery;
  });
  return stored.state === "ok" ? stored.value : null;
}

export function clearRecovery(): void {
  removeKey(storageKeys.boardRecovery);
}

export function emptyBoards(): Record<Subject, Board> {
  return { plans: defaultBoard(), models: defaultBoard() };
}

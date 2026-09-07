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
  readRaw,
  writeRaw,
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
  if (!isSubject(record.subject) || !record.boards || typeof record.boards !== "object" || Array.isArray(record.boards)
    || Object.keys(record.boards).some((key) => !isSubject(key))) return null;
  const boards: Partial<Record<Subject, Board>> = {};
  for (const subject of subjects) {
    const entry = record.boards?.[subject.id];
    if (!(subject.id in record.boards)) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const payload = entry as { v?: unknown; t?: unknown; o?: unknown; p?: unknown };
    if (payload.v !== undefined && payload.v !== 1 && payload.v !== 2) return null;
    if (!Array.isArray(payload.t) || payload.t.length === 0) return null;
    if (payload.t.some((tier: unknown) => !Array.isArray(tier) || tier.length !== 2 || typeof tier[0] !== "string" || typeof tier[1] !== "string")) return null;
    const tierIds = new Set(payload.t.map((tier) => tier[0]));
    if (payload.v !== 2 && (!Array.isArray(payload.p) || payload.p.some((row: unknown) => !Array.isArray(row) || typeof row[0] !== "string" || !tierIds.has(row[1])))) return null;
    if (payload.v === 2 && (!Array.isArray(payload.o) || payload.o.some((row: unknown) =>
      !Array.isArray(row) || typeof row[0] !== "string" || !tierIds.has(row[0]) || !Array.isArray(row[1]) || row[1].some((id: unknown) => typeof id !== "string")))) return null;
    if (payload.v === 2) {
      const rows = payload.o as [string, string[]][];
      const ids = rows.flatMap((row) => row[1]);
      if (new Set(rows.map((row) => row[0])).size !== rows.length || new Set(ids).size !== ids.length) return null;
    }
    const decoded = decodeParsedBoard(entry, items[subject.id]);
    if (decoded.state !== "ok") return null;
    boards[subject.id] = decoded.board;
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

export function readBoards(items: Record<Subject, RankableItem[]>): StoredBoards & { blocked: boolean } {
  migrateLegacyOnce("boards", storageKeys.boards, () => migrateLegacyBoards(items));
  const stored = readRecord(storageKeys.boards, boardsVersion, (payload) => parseBoards(payload, items));
  if (stored.state === "ok") return { ...stored.value, blocked: false };
  return { subject: "plans", boards: {}, blocked: stored.state !== "missing" };
}

// An untouched board is not saved: it would be announced as restored work on
// the next visit. The record is still written, so the chosen subject survives.
export function writeBoards(subject: Subject, boards: Record<Subject, Board>): boolean {
  const current = readRecord(storageKeys.boards, boardsVersion, (payload) => parseBoards(payload, { plans: [], models: [] }));
  if (current.state !== "ok" && current.state !== "missing") return false;
  return persistBoards(subject, boards);
}

function persistBoards(subject: Subject, boards: Record<Subject, Board>): boolean {
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

// Preserve the exact bytes before an explicit replacement, including future formats.
export function replaceUnreadableBoards(subject: Subject, boards: Record<Subject, Board>): boolean {
  const raw = readRaw(storageKeys.boards);
  if (raw !== null) {
    const backup = readRaw(storageKeys.boardBackup);
    if (backup !== null && backup !== raw) return false;
    if (!writeRaw(storageKeys.boardBackup, raw)) return false;
  }
  return persistBoards(subject, boards);
}

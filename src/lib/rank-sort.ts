import { boxplotFromRow } from "./boxplot";
import { fold } from "./format";
import type { CoupleSurvival, ScoreRow } from "../types";

export const SORT_KEYS = [
  "overall",
  "average",
  "couple",
  "dancers",
  "block",
  "round",
  "marks",
  "spread",
  "survival",
  "rank",
  "cutoff",
  "classified",
] as const;

export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

const DEFAULT_DIR: Record<SortKey, SortDir> = {
  overall: "desc",
  average: "desc",
  couple: "asc",
  dancers: "asc",
  block: "asc",
  round: "asc",
  marks: "desc",
  spread: "desc",
  survival: "desc",
  rank: "asc",
  cutoff: "desc",
  classified: "desc",
};

export function isSortKey(value: string | null): value is SortKey {
  return !!value && (SORT_KEYS as readonly string[]).includes(value);
}

export function defaultSortKey(year: number, hasOverall = true): SortKey {
  return year === 2026 || !hasOverall ? "average" : "overall";
}

export function defaultSortDir(key: SortKey): SortDir {
  return DEFAULT_DIR[key];
}

export function parseSortDir(value: string | null, key: SortKey): SortDir {
  if (value === "asc" || value === "desc") return value;
  return defaultSortDir(key);
}

function cmpRound(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, "en", { numeric: true });
}

function cmpNames(a: ScoreRow, b: ScoreRow): number {
  const d1 = fold(a.dancer1).localeCompare(fold(b.dancer1));
  if (d1 !== 0) return d1;
  return fold(a.dancer2).localeCompare(fold(b.dancer2));
}

function survivalScore(row: CoupleSurvival | undefined): number {
  if (!row) return Number.NEGATIVE_INFINITY;
  const q = row.pCuartos ?? -1;
  return row.pFinal * 1_000_000 + row.pSemi * 1_000 + q;
}

function cmpByKey(
  a: ScoreRow,
  b: ScoreRow,
  key: SortKey,
  survivalById: Map<number, CoupleSurvival>,
): number {
  switch (key) {
    case "overall":
      return (a.overall ?? -1) - (b.overall ?? -1);
    case "average":
      return a.average - b.average;
    case "couple":
      return a.coupleId - b.coupleId;
    case "dancers":
      return cmpNames(a, b);
    case "block":
      return a.blockId.localeCompare(b.blockId);
    case "round":
      return cmpRound(a.round, b.round);
    case "marks":
      return boxplotFromRow(a).boxMid - boxplotFromRow(b).boxMid;
    case "spread":
      return a.spread - b.spread;
    case "survival":
      return survivalScore(survivalById.get(a.coupleId)) - survivalScore(survivalById.get(b.coupleId));
    case "rank":
      return a.rankInBlock - b.rankInBlock || a.rankOverall - b.rankOverall;
    case "cutoff":
      return a.cutoffDelta - b.cutoffDelta;
    case "classified":
      return Number(a.classified) - Number(b.classified);
  }
}

export function sortRows(
  rows: ScoreRow[],
  key: SortKey,
  dir: SortDir,
  survivalById: Map<number, CoupleSurvival>,
): ScoreRow[] {
  const copy = [...rows];
  const sign = dir === "asc" ? 1 : -1;
  copy.sort((a, b) => {
    const c = cmpByKey(a, b, key, survivalById);
    if (c !== 0) return sign * c;
    if (b.average !== a.average) return b.average - a.average;
    return a.coupleId - b.coupleId;
  });
  return copy;
}

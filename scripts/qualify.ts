import type { Dataset, ScoreRow } from "../src/types.ts";

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function simpleAverage(scores: number[]): {
  average: number;
  dropped: boolean[];
} {
  const dropped = scores.map(() => false);
  if (scores.length === 0) return { average: 0, dropped };
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { average: round3(avg), dropped };
}

export function scoreAverage(
  scores: number[],
  scoring: "trimmed" | "simple",
): { average: number; dropped: boolean[] } {
  return scoring === "simple" ? simpleAverage(scores) : truncatedAverage(scores);
}

export function truncatedAverage(scores: number[]): {
  average: number;
  dropped: boolean[];
} {
  const dropped = scores.map(() => false);
  if (scores.length === 0) return { average: 0, dropped };
  if (scores.length <= 2) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return { average: round3(avg), dropped };
  }

  let maxI = 0;
  let minI = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[maxI]) maxI = i;
    if (scores[i] < scores[minI]) minI = i;
  }

  if (maxI === minI) {
    dropped[0] = true;
    dropped[1] = true;
  } else {
    dropped[maxI] = true;
    dropped[minI] = true;
  }

  const kept = scores.filter((_, i) => !dropped[i]);
  const avg = kept.reduce((a, b) => a + b, 0) / kept.length;
  return { average: round3(avg), dropped };
}

export function qualifyFromHighlights<T extends { average: number; coupleId: number }>(
  rows: T[],
  highlighted: (row: T) => boolean,
): { cutoff: number; classifiedCount: number; ranks: Map<number, number> } {
  const ranks = blockRanks(rows);
  const inRows = rows.filter(highlighted);
  const cutoff = inRows.length ? Math.min(...inRows.map((r) => r.average)) : 0;
  return { cutoff, classifiedCount: inRows.length, ranks };
}

export function qualifyBlock<T extends { average: number; coupleId: number }>(
  rows: T[],
): { cutoff: number; classifiedCount: number; ranks: Map<number, number> } {
  const sorted = [...rows].sort((a, b) => {
    if (b.average !== a.average) return b.average - a.average;
    return a.coupleId - b.coupleId;
  });
  const n = sorted.length;
  const cutoffRank = Math.max(1, Math.ceil(n / 2));
  const cutoff = n === 0 ? 0 : sorted[cutoffRank - 1]!.average;
  const ranks = new Map<number, number>();
  let lastAvg = Infinity;
  let lastRank = 0;
  sorted.forEach((row, i) => {
    if (row.average !== lastAvg) {
      lastRank = i + 1;
      lastAvg = row.average;
    }
    ranks.set(row.coupleId, lastRank);
  });
  const classifiedCount = sorted.filter((r) => r.average >= cutoff).length;
  return { cutoff, classifiedCount, ranks };
}

export function blockRanks<T extends { average: number; coupleId: number }>(
  rows: T[],
): Map<number, number> {
  const sorted = [...rows].sort((a, b) => {
    if (b.average !== a.average) return b.average - a.average;
    return a.coupleId - b.coupleId;
  });
  const ranks = new Map<number, number>();
  let lastAvg = Infinity;
  let lastRank = 0;
  sorted.forEach((row, i) => {
    if (row.average !== lastAvg) {
      lastRank = i + 1;
      lastAvg = row.average;
    }
    ranks.set(row.coupleId, lastRank);
  });
  return ranks;
}

/** Mark classified by membership in the next stage (couple ID join). */
export function qualifyByNextStage(current: Dataset, nextIds: Set<number> | null): void {
  const terminal = nextIds === null;
  for (const block of current.blocks) {
    const blockRows = current.rows.filter((r) => r.blockId === block.id);
    for (const row of blockRows) {
      row.classified = terminal ? true : nextIds.has(row.coupleId);
    }
    const inRows = blockRows.filter((r) => r.classified);
    block.classifiedCount = inRows.length;
    block.cutoff = inRows.length ? Math.min(...inRows.map((r) => r.average)) : 0;
    const ranks = blockRanks(blockRows);
    for (const row of blockRows) {
      row.rankInBlock = ranks.get(row.coupleId) ?? 0;
      row.cutoffDelta = round3(row.average - block.cutoff);
    }
  }
}

const STAGE_ORDER = ["clasificatoria", "cuartos", "semifinal", "final"] as const;

export function applyAdvancement(datasets: Dataset[]): void {
  const ordered = [...datasets].sort(
    (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage),
  );
  for (let i = 0; i < ordered.length; i++) {
    const current = ordered[i]!;
    const next = ordered[i + 1];
    qualifyByNextStage(
      current,
      next ? new Set(next.rows.map((r) => r.coupleId)) : null,
    );
  }
}

export function attachOverallRanks(rows: ScoreRow[]): void {
  const sorted = [...rows].sort((a, b) => {
    if (b.average !== a.average) return b.average - a.average;
    if (a.blockId !== b.blockId) return a.blockId.localeCompare(b.blockId);
    return a.coupleId - b.coupleId;
  });
  let lastAvg = Infinity;
  let lastRank = 0;
  sorted.forEach((row, i) => {
    if (row.average !== lastAvg) {
      lastRank = i + 1;
      lastAvg = row.average;
    }
    row.rankOverall = lastRank;
  });
}


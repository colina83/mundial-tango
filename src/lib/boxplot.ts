import type { JudgeScore, ScoreRow } from "../types";

export const SCORE_DOMAIN_LO = 5;
export const SCORE_DOMAIN_HI = 8;

export interface BoxplotStats {
  min: number;
  max: number;
  boxLo: number;
  boxMid: number;
  boxHi: number;
  judges: JudgeScore[];
}

export function boxplotFromRow(row: ScoreRow): BoxplotStats {
  const scores = row.judges.map((j) => j.score);
  const kept = row.judges
    .filter((j) => !j.dropped)
    .map((j) => j.score)
    .sort((a, b) => a - b);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  return {
    min,
    max,
    boxLo: kept[0] ?? min,
    boxMid: kept[Math.floor((kept.length - 1) / 2)] ?? row.average,
    boxHi: kept[kept.length - 1] ?? max,
    judges: row.judges,
  };
}

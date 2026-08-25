import type { Dataset, ScoreRow } from "../types";

export interface HistBin {
  start: number;
  end: number;
  label: string;
  count: number;
}

export function histogram(rows: ScoreRow[], bin = 0.05): HistBin[] {
  if (!rows.length) return [];
  const avgs = rows.map((r) => r.average);
  const min = Math.floor(Math.min(...avgs) / bin) * bin;
  const max = Math.ceil(Math.max(...avgs) / bin) * bin;
  const bins: HistBin[] = [];
  for (let start = min; start < max - 1e-9; start += bin) {
    const end = Math.round((start + bin) * 1000) / 1000;
    const count = avgs.filter((a) => a >= start && a < end - 1e-12).length;
    bins.push({
      start: Math.round(start * 1000) / 1000,
      end,
      label: start.toFixed(2),
      count,
    });
  }
  const last = bins[bins.length - 1];
  if (last) {
    last.count += avgs.filter((a) => a >= last.end - 1e-12).length;
  }
  return bins;
}

export interface JudgeStat {
  name: string;
  mean: number;
  count: number;
}

export function judgeStats(rows: ScoreRow[]): JudgeStat[] {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const row of rows) {
    for (const j of row.judges) {
      const cur = acc.get(j.name) ?? { sum: 0, n: 0 };
      cur.sum += j.score;
      cur.n += 1;
      acc.set(j.name, cur);
    }
  }
  return [...acc.entries()]
    .map(([name, { sum, n }]) => ({
      name,
      mean: Math.round((sum / n) * 1000) / 1000,
      count: n,
    }))
    .sort((a, b) => b.mean - a.mean);
}

export interface RoundStat {
  round: string;
  mean: number;
  count: number;
}

export function roundStats(rows: ScoreRow[]): RoundStat[] {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const row of rows) {
    const cur = acc.get(row.round) ?? { sum: 0, n: 0 };
    cur.sum += row.average;
    cur.n += 1;
    acc.set(row.round, cur);
  }
  return [...acc.entries()]
    .map(([round, { sum, n }]) => ({
      round,
      mean: Math.round((sum / n) * 1000) / 1000,
      count: n,
    }))
    .sort((a, b) => b.mean - a.mean);
}

export function topSpread(rows: ScoreRow[], n = 12): ScoreRow[] {
  return [...rows].sort((a, b) => b.spread - a.spread).slice(0, n);
}

export function classifiedTotal(data: Dataset): number {
  return data.blocks.reduce((s, b) => s + b.classifiedCount, 0);
}

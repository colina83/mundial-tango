import { coupleName } from "./format";
import type { BlockId, ScoreRow, Stage } from "../types";

export const TOP_N_JUDGE_MARKS = 10;

export interface HeatCell {
  coupleId: number;
  blockId: BlockId;
  coupleLabel: string;
  coupleName: string;
  judgeName: string;
  judgeShort: string;
  score: number | null;
  dropped: boolean | null;
  plot: number;
}

export interface SpearmanCell {
  judgeA: string;
  judgeB: string;
  shortA: string;
  shortB: string;
  rho: number | null;
  n: number;
  plot: number;
}

/** Typical mark range for coloring this competition stage (not pista ronda). */
export function stageScoreDomain(stage: Stage): readonly [number, number] {
  if (stage === "final") return [7, 10];
  if (stage === "semifinal") return [7, 9];
  return [5, 8];
}

export function lastName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? full;
}

export function coupleHeatLabel(row: ScoreRow): string {
  return `#${row.coupleId} ${lastName(row.dancer1)} & ${lastName(row.dancer2)}`;
}

export function shortJudgeName(name: string, all: readonly string[]): string {
  const first = name.split(/\s+/).filter(Boolean)[0] ?? name;
  const collisions = all.filter((n) => (n.split(/\s+/).filter(Boolean)[0] ?? n) === first);
  if (collisions.length <= 1) return first;
  const parts = name.split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const initial = last.charAt(0);
  return initial ? `${first} ${initial}.` : first;
}

/** Top couples in this stage by overall rank, then average. */
export function topByStageRank(rows: ScoreRow[], n = TOP_N_JUDGE_MARKS): ScoreRow[] {
  return [...rows]
    .sort((a, b) => {
      if (a.rankOverall !== b.rankOverall) return a.rankOverall - b.rankOverall;
      if (b.average !== a.average) return b.average - a.average;
      return a.coupleId - b.coupleId;
    })
    .slice(0, n);
}

export function judgeNamesFromRows(rows: ScoreRow[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const j of row.judges) {
      if (!seen.has(j.name)) {
        seen.add(j.name);
        names.push(j.name);
      }
    }
  }
  return names;
}

export function heatmapCells(rows: ScoreRow[], judges: readonly string[]): HeatCell[] {
  const shorts = judges.map((name) => shortJudgeName(name, judges));
  const cells: HeatCell[] = [];
  for (const row of rows) {
    const byName = new Map(row.judges.map((j) => [j.name, j]));
    for (let i = 0; i < judges.length; i++) {
      const judgeName = judges[i]!;
      const mark = byName.get(judgeName);
      cells.push({
        coupleId: row.coupleId,
        blockId: row.blockId,
        coupleLabel: coupleHeatLabel(row),
        coupleName: coupleName(row),
        judgeName,
        judgeShort: shorts[i]!,
        score: mark?.score ?? null,
        dropped: mark ? mark.dropped : null,
        plot: 1,
      });
    }
  }
  return cells;
}

export function averageRanks(values: number[]): number[] {
  const n = values.length;
  const order = values.map((value, index) => ({ value, index }));
  order.sort((a, b) => a.value - b.value);
  const ranks = Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1]!.value === order[i]!.value) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!.index] = avg;
    i = j + 1;
  }
  return ranks;
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (den < 1e-12) return null;
  return num / den;
}

export function spearman(xs: number[], ys: number[]): number | null {
  return pearson(averageRanks(xs), averageRanks(ys));
}

function alignedScores(
  rows: ScoreRow[],
  judgeA: string,
  judgeB: string,
): { a: number[]; b: number[] } {
  const a: number[] = [];
  const b: number[] = [];
  for (const row of rows) {
    const sa = row.judges.find((j) => j.name === judgeA);
    const sb = row.judges.find((j) => j.name === judgeB);
    if (sa == null || sb == null) continue;
    a.push(sa.score);
    b.push(sb.score);
  }
  return { a, b };
}

export function spearmanMatrix(rows: ScoreRow[], judges: readonly string[]): SpearmanCell[] {
  const shorts = judges.map((name) => shortJudgeName(name, judges));
  const cells: SpearmanCell[] = [];
  for (let i = 0; i < judges.length; i++) {
    for (let j = 0; j < judges.length; j++) {
      const judgeA = judges[i]!;
      const judgeB = judges[j]!;
      if (i === j) {
        cells.push({
          judgeA,
          judgeB,
          shortA: shorts[i]!,
          shortB: shorts[j]!,
          rho: 1,
          n: rows.filter((r) => r.judges.some((m) => m.name === judgeA)).length,
          plot: 1,
        });
        continue;
      }
      const { a, b } = alignedScores(rows, judgeA, judgeB);
      cells.push({
        judgeA,
        judgeB,
        shortA: shorts[i]!,
        shortB: shorts[j]!,
        rho: spearman(a, b),
        n: a.length,
        plot: 1,
      });
    }
  }
  return cells;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(lerp(ar, br, t), lerp(ag, bg, t), lerp(ab, bb, t));
}

function ramp(t: number, stops: readonly (readonly [number, string])[]): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i - 1]!;
    const [t2, c2] = stops[i]!;
    if (x <= t2) {
      const u = t2 === t1 ? 1 : (x - t1) / (t2 - t1);
      return mixHex(c1, c2, u);
    }
  }
  return stops[stops.length - 1]![1];
}

/** GitHub Super Dark sequential: muted → blue → pink. */
export function scoreFill(score: number, lo: number, hi: number): string {
  const t = hi <= lo ? 1 : (score - lo) / (hi - lo);
  return ramp(t, [
    [0, "#21262d"],
    [0.4, "#1f6feb"],
    [0.72, "#58a6ff"],
    [1, "#f778ba"],
  ]);
}

/** Diverging: red (disagree) → dark → green (agree). */
export function rhoFill(rho: number): string {
  if (rho >= 0) return ramp(rho, [
    [0, "#21262d"],
    [0.45, "#238636"],
    [1, "#3fb950"],
  ]);
  return ramp(-rho, [
    [0, "#21262d"],
    [0.45, "#da3633"],
    [1, "#f85149"],
  ]);
}

export function contrastText(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.58 ? "#0d1117" : "#e6edf3";
}

export function formatRho(rho: number | null): string {
  if (rho == null || Number.isNaN(rho)) return "—";
  if (Math.abs(rho - 1) < 1e-9) return "1";
  if (Math.abs(rho + 1) < 1e-9) return "−1";
  const abs = Math.abs(rho).toFixed(2);
  return rho < 0 ? `−${abs}` : abs;
}

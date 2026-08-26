/**
 * Stage-survival odds from clasificatoria standing (2024–2025 training → 2026).
 *
 * Labels join later stages by couple ID only. Unmatched later-stage IDs are
 * wildcards — not treated as clasificatoria couples who advanced.
 * Features never use later-stage scores.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  BlockId,
  CoupleSurvival,
  Dataset,
  GateScores,
  ScoreRow,
  SpreadBand,
  Stage,
  StandingKind,
  SurvivalBacktest,
  SurvivalBandRates,
  SurvivalBestStage,
  SurvivalDecileRow,
  SurvivalLogisticGate,
  SurvivalModelFile,
  SurvivalModelKind,
  SurvivalPrior,
  YearSurvivalFile,
} from "../src/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = join(ROOT, "public", "data");
const PROCESSED_DATA = join(ROOT, "data", "processed");

export const SURVIVAL_DISCLAIMER =
  "Based on 2024–2025 couples with similar clasificatoria standing. Not a prediction of the champion.";

const FEATURE_NAMES = [
  "standingPct",
  "overallPct",
  "spread",
  "iqr",
  "classified",
  "samePair",
  "onePartner",
  "priorSemi",
  "priorFinal",
] as const;

type FeatureName = (typeof FEATURE_NAMES)[number];

const MIN_SPREAD_BAND_N = 8;
const LOGISTIC_LAMBDA = 0.5;
const STAGE_RANK: Record<SurvivalBestStage, number> = {
  clasificatoria: 0,
  cuartos: 1,
  semifinal: 2,
  final: 3,
};

const PARTICLES = new Set([
  "de",
  "del",
  "da",
  "di",
  "van",
  "von",
  "y",
  "la",
  "las",
  "los",
  "el",
  "le",
  "den",
  "dos",
  "das",
  "san",
  "e",
  "du",
]);

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

async function loadJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function loadDataset(year: number, stage: Stage): Promise<Dataset | null> {
  return loadJson<Dataset>(join(PUBLIC_DATA, String(year), `results-${stage}.json`));
}

function idSet(rows: ScoreRow[]): Set<number> {
  return new Set(rows.map((r) => r.coupleId));
}

function percentileFromRank(rank: number, n: number): number {
  if (n <= 1) return 1;
  return 1 - (rank - 1) / (n - 1);
}

function decileOf(pct: number): number {
  return Math.min(9, Math.max(0, Math.floor(pct * 10)));
}

function decileLabel(decile: number): string {
  if (decile === 9) return "top 10%";
  if (decile === 0) return "bottom 10%";
  return `${decile * 10}–${decile * 10 + 10}%`;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - i) + sorted[hi]! * (i - lo);
}

function iqrOf(row: ScoreRow): number {
  const kept = row.judges
    .filter((j) => !j.dropped)
    .map((j) => j.score)
    .sort((a, b) => a - b);
  if (kept.length < 2) return 0;
  return quantile(kept, 0.75) - quantile(kept, 0.25);
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 1;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(v) || 1;
}

function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function personKey(name: string): string {
  const raw = foldName(name)
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const tokens = raw.filter((t) => t.length >= 2 && !PARTICLES.has(t));
  const use = tokens.length ? tokens : raw;
  if (!use.length) return "";
  return `${use[0]}|${use[use.length - 1]}`;
}

function pairKey(row: ScoreRow): string {
  return [personKey(row.dancer1), personKey(row.dancer2)].sort().join("&&");
}

interface YearIndex {
  year: number;
  clas: Dataset;
  later: Partial<Record<Stage, Set<number>>>;
  byPair: Map<string, ScoreRow>;
  byPerson: Map<string, ScoreRow[]>;
  collisions: Set<string>;
}

function bestStageOf(id: number, later: Partial<Record<Stage, Set<number>>>): SurvivalBestStage {
  if (later.final?.has(id)) return "final";
  if (later.semifinal?.has(id)) return "semifinal";
  if (later.cuartos?.has(id)) return "cuartos";
  return "clasificatoria";
}

function indexYear(year: number, clas: Dataset, later: Partial<Record<Stage, Set<number>>>): YearIndex {
  const byPair = new Map<string, ScoreRow>();
  const byPerson = new Map<string, ScoreRow[]>();
  const counts = new Map<string, number>();
  for (const row of clas.rows) {
    byPair.set(pairKey(row), row);
    for (const key of [personKey(row.dancer1), personKey(row.dancer2)]) {
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const list = byPerson.get(key) ?? [];
      list.push(row);
      byPerson.set(key, list);
    }
  }
  const collisions = new Set(
    [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k),
  );
  return { year, clas, later, byPair, byPerson, collisions };
}

function matchPrior(
  row: ScoreRow,
  priors: YearIndex[],
  selfCollisions: Set<string>,
): SurvivalPrior {
  const pk = pairKey(row);
  const people = [personKey(row.dancer1), personKey(row.dancer2)].filter(Boolean);

  for (const prior of priors) {
    const same = prior.byPair.get(pk);
    if (same) {
      return {
        match: "samePair",
        year: prior.year,
        best: bestStageOf(same.coupleId, prior.later),
      };
    }

    const hits: ScoreRow[] = [];
    let skippedAmbiguousHit = false;
    for (const p of people) {
      const list = prior.byPerson.get(p) ?? [];
      if (!list.length) continue;
      if (selfCollisions.has(p) || prior.collisions.has(p)) {
        skippedAmbiguousHit = true;
        continue;
      }
      hits.push(...list);
    }
    const unique = [...new Map(hits.map((h) => [h.coupleId, h])).values()];
    if (unique.length >= 1) {
      const best = unique
        .map((h) => bestStageOf(h.coupleId, prior.later))
        .sort((a, b) => STAGE_RANK[b] - STAGE_RANK[a])[0]!;
      return {
        match: "onePartner",
        year: prior.year,
        best,
      };
    }
    if (skippedAmbiguousHit) {
      return { match: "collision" };
    }
  }
  return { match: "none" };
}

interface LabeledCouple {
  year: number;
  row: ScoreRow;
  standingKind: StandingKind;
  standingPct: number;
  overallPct: number;
  spread: number;
  iqr: number;
  classified: number;
  decile: number;
  prior: SurvivalPrior;
  yCuartos: number | null;
  ySemi: number;
  yFinal: number;
}

function standingOf(row: ScoreRow, clas: Dataset): { kind: StandingKind; pct: number } {
  const hasBlocks = clas.blocks.some((b) => b.id !== "_");
  if (hasBlocks) {
    const n = clas.rows.filter((r) => r.blockId === row.blockId).length;
    return { kind: "block", pct: percentileFromRank(row.rankInBlock, n) };
  }
  return {
    kind: "overall",
    pct: percentileFromRank(row.rankOverall, clas.rows.length),
  };
}

function labelYear(
  year: number,
  clas: Dataset,
  later: Partial<Record<Stage, Set<number>>>,
  priors: YearIndex[],
): LabeledCouple[] {
  const overallN = clas.rows.length;
  const selfIndex = indexYear(year, clas, later);
  return clas.rows.map((row) => {
    const standing = standingOf(row, clas);
    const prior = matchPrior(row, priors, selfIndex.collisions);
    return {
      year,
      row,
      standingKind: standing.kind,
      standingPct: standing.pct,
      overallPct: percentileFromRank(row.rankOverall, overallN),
      spread: row.spread,
      iqr: iqrOf(row),
      classified: row.classified ? 1 : 0,
      decile: decileOf(standing.pct),
      prior,
      yCuartos: later.cuartos ? (later.cuartos.has(row.coupleId) ? 1 : 0) : null,
      ySemi: later.semifinal?.has(row.coupleId) ? 1 : 0,
      yFinal: later.final?.has(row.coupleId) ? 1 : 0,
    };
  });
}

function rates(n: number, kQ: number | null, kS: number, kF: number): SurvivalBandRates {
  return {
    n,
    pCuartos: kQ === null || n === 0 ? (kQ === null ? null : 0) : round3(kQ / n),
    pSemi: n === 0 ? 0 : round3(kS / n),
    pFinal: n === 0 ? 0 : round3(kF / n),
  };
}

function buildDeciles(couples: LabeledCouple[], includeCuartos: boolean): SurvivalDecileRow[] {
  const rows: SurvivalDecileRow[] = [];
  for (let d = 0; d < 10; d++) {
    const bucket = couples.filter((c) => c.decile === d);
    const spreads = bucket.map((c) => c.spread).sort((a, b) => a - b);
    const spreadMedian = round3(quantile(spreads, 0.5));
    const kQ = includeCuartos ? bucket.filter((c) => c.yCuartos === 1).length : null;
    const kS = bucket.filter((c) => c.ySemi === 1).length;
    const kF = bucket.filter((c) => c.yFinal === 1).length;
    const lowB = bucket.filter((c) => c.spread < spreadMedian);
    const highB = bucket.filter((c) => c.spread >= spreadMedian);
    const k = (xs: LabeledCouple[]) =>
      rates(
        xs.length,
        includeCuartos ? xs.filter((c) => c.yCuartos === 1).length : null,
        xs.filter((c) => c.ySemi === 1).length,
        xs.filter((c) => c.yFinal === 1).length,
      );
    rows.push({
      decile: d,
      label: decileLabel(d),
      n: bucket.length,
      pCuartos: kQ === null || !bucket.length ? (includeCuartos ? 0 : null) : round3(kQ / bucket.length),
      pSemi: bucket.length ? round3(kS / bucket.length) : 0,
      pFinal: bucket.length ? round3(kF / bucket.length) : 0,
      spreadMedian,
      low: k(lowB),
      high: k(highB),
    });
  }
  return rows;
}

function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 0];
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return [round3(clamp01(center - half)), round3(clamp01(center + half))];
}

function ciFromRate(p: number, n: number): [number, number] {
  return wilson(Math.round(p * n), n);
}

interface LookupPick {
  pCuartos: number | null;
  pSemi: number;
  pFinal: number;
  ciCuartos: [number, number] | null;
  ciSemi: [number, number];
  ciFinal: [number, number];
  cohortN: number;
  spreadBand: SpreadBand | null;
}

function lookupApply(table: SurvivalDecileRow[], decile: number, spread: number): LookupPick {
  const row = table[decile] ?? table[0]!;
  let used: SurvivalBandRates = {
    n: row.n,
    pCuartos: row.pCuartos,
    pSemi: row.pSemi,
    pFinal: row.pFinal,
  };
  let band: SpreadBand | null = null;
  const candidate = spread >= row.spreadMedian ? row.high : row.low;
  if (candidate.n >= MIN_SPREAD_BAND_N) {
    used = candidate;
    band = spread >= row.spreadMedian ? "high" : "low";
  }
  const n = used.n;
  return {
    pCuartos: used.pCuartos,
    pSemi: used.pSemi,
    pFinal: used.pFinal,
    ciCuartos: used.pCuartos === null ? null : ciFromRate(used.pCuartos, n),
    ciSemi: ciFromRate(used.pSemi, n),
    ciFinal: ciFromRate(used.pFinal, n),
    cohortN: n,
    spreadBand: band,
  };
}

function lookupDecileOnly(table: SurvivalDecileRow[], decile: number): LookupPick {
  const row = table[decile] ?? table[0]!;
  return {
    pCuartos: row.pCuartos,
    pSemi: row.pSemi,
    pFinal: row.pFinal,
    ciCuartos: row.pCuartos === null ? null : ciFromRate(row.pCuartos, row.n),
    ciSemi: ciFromRate(row.pSemi, row.n),
    ciFinal: ciFromRate(row.pFinal, row.n),
    cohortN: row.n,
    spreadBand: null,
  };
}

function brier(pairs: { p: number; y: number }[]): number {
  if (!pairs.length) return 0;
  return round4(mean(pairs.map((x) => (x.p - x.y) ** 2)));
}

/** Expected calibration error, 10 equal-width predicted-probability bins. */
function ece(pairs: { p: number; y: number }[], bins = 10): number {
  if (!pairs.length) return 0;
  let err = 0;
  for (let i = 0; i < bins; i++) {
    const lo = i / bins;
    const hi = (i + 1) / bins;
    const g = pairs.filter((x) =>
      i === bins - 1 ? x.p >= lo && x.p <= hi : x.p >= lo && x.p < hi,
    );
    if (!g.length) continue;
    err +=
      (g.length / pairs.length) *
      Math.abs(mean(g.map((x) => x.p)) - mean(g.map((x) => x.y)));
  }
  return round4(err);
}

function sigmoid(z: number): number {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    const swap = M[col]!;
    M[col] = M[pivot]!;
    M[pivot] = swap;
    const div = M[col]![col]!;
    if (Math.abs(div) < 1e-10) return null;
    for (let j = col; j <= n; j++) M[col]![j]! /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      for (let j = col; j <= n; j++) M[r]![j]! -= f * M[col]![j]!;
    }
  }
  return M.map((row) => row[n]!);
}

function featureVector(c: LabeledCouple): Record<FeatureName, number> {
  return {
    standingPct: c.standingPct,
    overallPct: c.overallPct,
    spread: c.spread,
    iqr: c.iqr,
    classified: c.classified,
    samePair: c.prior.match === "samePair" ? 1 : 0,
    onePartner: c.prior.match === "onePartner" ? 1 : 0,
    priorSemi:
      c.prior.best === "semifinal" || c.prior.best === "final" ? 1 : 0,
    priorFinal: c.prior.best === "final" ? 1 : 0,
  };
}

interface FittedLogistic {
  intercept: number;
  beta: number[];
  mean: number[];
  sd: number[];
}

function fitLogistic(couples: LabeledCouple[], y: number[]): FittedLogistic | null {
  if (couples.length < 20) return null;
  const raw = couples.map((c) => FEATURE_NAMES.map((name) => featureVector(c)[name]));
  const means = FEATURE_NAMES.map((_, j) => mean(raw.map((r) => r[j]!)));
  const sds = FEATURE_NAMES.map((_, j) => stdev(raw.map((r) => r[j]!)));
  const X = raw.map((r) => [1, ...r.map((v, j) => (v - means[j]!) / sds[j]!)]);
  const pDim = X[0]!.length;
  let beta = new Array<number>(pDim).fill(0);

  for (let iter = 0; iter < 40; iter++) {
    const pHat = X.map((row) => sigmoid(row.reduce((s, v, j) => s + v * beta[j]!, 0)));
    const grad = new Array<number>(pDim).fill(0);
    const H = Array.from({ length: pDim }, () => new Array<number>(pDim).fill(0));
    for (let i = 0; i < X.length; i++) {
      const row = X[i]!;
      const w = Math.max(1e-6, pHat[i]! * (1 - pHat[i]!));
      const resid = pHat[i]! - y[i]!;
      for (let j = 0; j < pDim; j++) {
        grad[j]! += row[j]! * resid;
        for (let k = 0; k < pDim; k++) {
          H[j]![k]! += w * row[j]! * row[k]!;
        }
      }
    }
    for (let j = 1; j < pDim; j++) {
      grad[j]! += LOGISTIC_LAMBDA * beta[j]!;
      H[j]![j]! += LOGISTIC_LAMBDA;
    }
    const step = solveLinear(H, grad);
    if (!step) break;
    let maxStep = 0;
    for (let j = 0; j < pDim; j++) {
      beta[j]! -= step[j]!;
      maxStep = Math.max(maxStep, Math.abs(step[j]!));
    }
    if (maxStep < 1e-6) break;
  }

  return {
    intercept: beta[0]!,
    beta: beta.slice(1),
    mean: means,
    sd: sds,
  };
}

function predictLogistic(fit: FittedLogistic, c: LabeledCouple): number {
  const raw = FEATURE_NAMES.map((name) => featureVector(c)[name]);
  let z = fit.intercept;
  for (let j = 0; j < FEATURE_NAMES.length; j++) {
    z += fit.beta[j]! * ((raw[j]! - fit.mean[j]!) / fit.sd[j]!);
  }
  return round3(sigmoid(z));
}

function packGate(fit: FittedLogistic): SurvivalLogisticGate {
  const coefficients: Record<string, number> = {};
  const mean: Record<string, number> = {};
  const sd: Record<string, number> = {};
  for (let i = 0; i < FEATURE_NAMES.length; i++) {
    const name = FEATURE_NAMES[i]!;
    coefficients[name] = round4(fit.beta[i]!);
    mean[name] = round4(fit.mean[i]!);
    sd[name] = round4(fit.sd[i]!);
  }
  return { intercept: round4(fit.intercept), coefficients, mean, sd };
}

function stageWord(best: SurvivalBestStage): string {
  if (best === "final") return "finalist";
  if (best === "semifinal") return "semi";
  if (best === "cuartos") return "cuartos";
  return "clasificatoria only";
}

function whyLine(c: LabeledCouple, band: SpreadBand | null): string {
  const kind = c.standingKind === "block" ? "Block" : "Field";
  const standing =
    c.decile === 9
      ? `${kind} top 10%`
      : c.decile === 0
        ? `${kind} bottom 10%`
        : `${kind} ${c.decile * 10}–${c.decile * 10 + 10}%`;
  const parts = [standing, `spread ${c.spread.toFixed(2)}`];
  if (band) parts.push(`${band}-spread`);
  if (c.prior.match === "samePair" && c.prior.year && c.prior.best) {
    parts.push(`same pair was ${c.prior.year} ${stageWord(c.prior.best)}`);
  } else if (c.prior.match === "onePartner" && c.prior.year && c.prior.best) {
    parts.push(`one partner was ${c.prior.year} ${stageWord(c.prior.best)}`);
  } else if (c.prior.match === "collision") {
    parts.push("prior-year name collision ignored");
  }
  return parts.join(" · ");
}

function toCoupleSurvival(
  c: LabeledCouple,
  pick: LookupPick,
  includeCuartos: boolean,
  includeRealized: boolean,
): CoupleSurvival {
  const rec: CoupleSurvival = {
    coupleId: c.row.coupleId,
    blockId: c.row.blockId as BlockId,
    pCuartos: includeCuartos ? pick.pCuartos : null,
    pSemi: pick.pSemi,
    pFinal: pick.pFinal,
    ciCuartos: includeCuartos ? pick.ciCuartos : null,
    ciSemi: pick.ciSemi,
    ciFinal: pick.ciFinal,
    cohortN: pick.cohortN,
    decile: c.decile,
    standingKind: c.standingKind,
    percentile: round3(c.standingPct),
    spread: round3(c.spread),
    spreadBand: pick.spreadBand,
    prior: c.prior,
    why: whyLine(c, pick.spreadBand),
  };
  if (includeRealized) {
    rec.realized = {
      ...(includeCuartos && c.yCuartos !== null ? { cuartos: c.yCuartos === 1 } : {}),
      semifinal: c.ySemi === 1,
      final: c.yFinal === 1,
    };
  }
  return rec;
}

function gateBrier(
  couples: LabeledCouple[],
  pred: (c: LabeledCouple) => { pCuartos: number | null; pSemi: number; pFinal: number },
  includeCuartos: boolean,
): GateScores {
  const scores: GateScores = {
    semifinal: brier(couples.map((c) => ({ p: pred(c).pSemi, y: c.ySemi }))),
    final: brier(couples.map((c) => ({ p: pred(c).pFinal, y: c.yFinal }))),
  };
  if (includeCuartos) {
    scores.cuartos = brier(
      couples
        .filter((c) => c.yCuartos !== null)
        .map((c) => ({ p: pred(c).pCuartos ?? 0, y: c.yCuartos ?? 0 })),
    );
  }
  return scores;
}

function gateEce(
  couples: LabeledCouple[],
  pred: (c: LabeledCouple) => { pCuartos: number | null; pSemi: number; pFinal: number },
  includeCuartos: boolean,
): GateScores {
  const scores: GateScores = {
    semifinal: ece(couples.map((c) => ({ p: pred(c).pSemi, y: c.ySemi }))),
    final: ece(couples.map((c) => ({ p: pred(c).pFinal, y: c.yFinal }))),
  };
  if (includeCuartos) {
    scores.cuartos = ece(
      couples
        .filter((c) => c.yCuartos !== null)
        .map((c) => ({ p: pred(c).pCuartos ?? 0, y: c.yCuartos ?? 0 })),
    );
  }
  return scores;
}

/** Semi + final only — cuartos is nearly a 50% block rule, so it shouldn't pick the model. */
function rankingBrier(s: GateScores): number {
  return (s.semifinal + s.final) / 2;
}

function logisticPredictors(
  fits: Partial<Record<"cuartos" | "semifinal" | "final", FittedLogistic>>,
) {
  return (c: LabeledCouple) => ({
    pCuartos: fits.cuartos ? predictLogistic(fits.cuartos, c) : null,
    pSemi: fits.semifinal ? predictLogistic(fits.semifinal, c) : 0,
    pFinal: fits.final ? predictLogistic(fits.final, c) : 0,
  });
}

function fitGates(couples: LabeledCouple[], includeCuartos: boolean) {
  const fits: Partial<Record<"cuartos" | "semifinal" | "final", FittedLogistic>> = {};
  if (includeCuartos) {
    const y = couples.map((c) => c.yCuartos ?? 0);
    const fit = fitLogistic(couples, y);
    if (fit) fits.cuartos = fit;
  }
  const semi = fitLogistic(couples, couples.map((c) => c.ySemi));
  const fin = fitLogistic(couples, couples.map((c) => c.yFinal));
  if (semi) fits.semifinal = semi;
  if (fin) fits.final = fin;
  return fits;
}

function leaveOneBlockOut(
  couples: LabeledCouple[],
  includeCuartos: boolean,
): { lookup: GateScores; logistic: GateScores } {
  const blocks = [...new Set(couples.map((c) => c.row.blockId))];
  const lookupPairs: {
    cuartos: { p: number; y: number }[];
    semi: { p: number; y: number }[];
    final: { p: number; y: number }[];
  } = { cuartos: [], semi: [], final: [] };
  const logPairs = { cuartos: [] as { p: number; y: number }[], semi: [] as { p: number; y: number }[], final: [] as { p: number; y: number }[] };

  for (const block of blocks) {
    const train = couples.filter((c) => c.row.blockId !== block);
    const test = couples.filter((c) => c.row.blockId === block);
    const table = buildDeciles(train, includeCuartos);
    const fits = fitGates(train, includeCuartos);
    const logPred = logisticPredictors(fits);
    for (const c of test) {
      const lu = lookupApply(table, c.decile, c.spread);
      if (includeCuartos && c.yCuartos !== null) {
        lookupPairs.cuartos.push({ p: lu.pCuartos ?? 0, y: c.yCuartos });
        logPairs.cuartos.push({ p: logPred(c).pCuartos ?? 0, y: c.yCuartos });
      }
      lookupPairs.semi.push({ p: lu.pSemi, y: c.ySemi });
      lookupPairs.final.push({ p: lu.pFinal, y: c.yFinal });
      logPairs.semi.push({ p: logPred(c).pSemi, y: c.ySemi });
      logPairs.final.push({ p: logPred(c).pFinal, y: c.yFinal });
    }
  }

  const pack = (p: typeof lookupPairs): GateScores => ({
    ...(includeCuartos ? { cuartos: brier(p.cuartos) } : {}),
    semifinal: brier(p.semi),
    final: brier(p.final),
  });
  return { lookup: pack(lookupPairs), logistic: pack(logPairs) };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function wildcardReport(clas: Dataset, later: Partial<Record<Stage, Set<number>>>) {
  const clasIds = idSet(clas.rows);
  const stages: Stage[] = (["cuartos", "semifinal", "final"] as const).filter(
    (s) => later[s],
  );
  return stages.map((stage) => {
    const ids = later[stage]!;
    const unmatched = [...ids].filter((id) => !clasIds.has(id)).length;
    const clasAdvanced = [...clasIds].filter((id) => ids.has(id)).length;
    return { stage, unmatched, clasAdvanced };
  });
}

function remapOverallDecile(c: LabeledCouple): number {
  return decileOf(c.overallPct);
}

export async function generateSurvival(): Promise<SurvivalModelFile> {
  const clas25 = await loadDataset(2025, "clasificatoria");
  const clas24 = await loadDataset(2024, "clasificatoria");
  const clas26 = await loadDataset(2026, "clasificatoria");
  if (!clas25 || !clas24) {
    throw new Error("Need public/data/2024 and 2025 clasificatoria JSON to build survival odds.");
  }

  const later25: Partial<Record<Stage, Set<number>>> = {
    cuartos: idSet((await loadDataset(2025, "cuartos"))?.rows ?? []),
    semifinal: idSet((await loadDataset(2025, "semifinal"))?.rows ?? []),
    final: idSet((await loadDataset(2025, "final"))?.rows ?? []),
  };
  const later24: Partial<Record<Stage, Set<number>>> = {
    semifinal: idSet((await loadDataset(2024, "semifinal"))?.rows ?? []),
    final: idSet((await loadDataset(2024, "final"))?.rows ?? []),
  };

  const idx24 = indexYear(2024, clas24, later24);
  const idx25 = indexYear(2025, clas25, later25);

  const couples25 = labelYear(2025, clas25, later25, [idx24]);
  const couples24 = labelYear(2024, clas24, later24, []);
  const couples26 = clas26
    ? labelYear(2026, clas26, {}, [idx25, idx24])
    : [];

  const deciles2025 = buildDeciles(couples25, true);
  const deciles2024 = buildDeciles(couples24, false);

  const predLookup = (table: SurvivalDecileRow[]) => (c: LabeledCouple) =>
    lookupApply(table, c.decile, c.spread);
  const predLookupPlain = (table: SurvivalDecileRow[]) => (c: LabeledCouple) =>
    lookupDecileOnly(table, c.decile);

  const fits25 = fitGates(couples25, true);
  const logPred25 = logisticPredictors(fits25);

  const inSampleLookup = gateBrier(couples25, predLookupPlain(deciles2025), true);
  const inSampleLookupSpread = gateBrier(couples25, predLookup(deciles2025), true);
  const inSampleLogistic = gateBrier(couples25, logPred25, true);
  const eceLookup = gateEce(couples25, predLookup(deciles2025), true);
  const eceLogistic = gateEce(couples25, logPred25, true);
  const lobo = leaveOneBlockOut(couples25, true);

  const fits24 = fitGates(
    couples24.map((c) => ({ ...c, standingPct: c.overallPct, decile: remapOverallDecile(c) })),
    false,
  );
  const couples25Overall = couples25.map((c) => ({
    ...c,
    standingPct: c.overallPct,
    standingKind: "overall" as const,
    decile: remapOverallDecile(c),
  }));
  const deciles24ForWf = buildDeciles(
    couples24.map((c) => ({ ...c, standingPct: c.overallPct, decile: remapOverallDecile(c) })),
    false,
  );
  const walkLookup = gateBrier(couples25Overall, predLookup(deciles24ForWf), false);
  const walkLogistic = gateBrier(couples25Overall, logisticPredictors(fits24), false);

  const logisticBetterBrier =
    rankingBrier(lobo.logistic) < rankingBrier(lobo.lookup) &&
    rankingBrier(inSampleLogistic) < rankingBrier(inSampleLookupSpread);
  const logisticBetterCal =
    rankingBrier(eceLogistic) <= rankingBrier(eceLookup);
  const chosen: SurvivalModelKind =
    logisticBetterBrier && logisticBetterCal ? "logistic" : "lookup";
  const reason = chosen === "logistic"
    ? `Logistic beat lookup on semi+final Brier and calibration; shipping regularized logistic.`
    : `Lookup wins on calibration (in-sample ECE semi/final ${eceLookup.semifinal}/${eceLookup.final} vs logistic ${eceLogistic.semifinal}/${eceLogistic.final}). LOBO Brier lookup ${rankingBrier(lobo.lookup)} vs logistic ${rankingBrier(lobo.logistic)}. Shipping 2025 block-percentile decile lookup with spread as a second axis.`;

  const backtest: SurvivalBacktest = {
    chosen,
    reason,
    inSample2025: {
      lookup: inSampleLookup,
      lookupSpread: inSampleLookupSpread,
      logistic: inSampleLogistic,
      eceLookup,
      eceLogistic,
    },
    leaveOneBlockOut2025: lobo,
    walkForward2024to2025: {
      lookup: walkLookup,
      logistic: walkLogistic,
      note: "2024 overall-percentile model tested on 2025 overall percentile (not block). 2025 is the only structural twin of 2026 for P(cuartos).",
    },
  };

  const model: SurvivalModelFile = {
    generatedAt: new Date().toISOString(),
    model: chosen,
    disclaimer: SURVIVAL_DISCLAIMER,
    trainingYears: [2024, 2025],
    deciles2025,
    deciles2024,
    logistic: {
      shipped: chosen === "logistic",
      features: [...FEATURE_NAMES],
      gates: {
        ...(fits25.cuartos ? { cuartos: packGate(fits25.cuartos) } : {}),
        ...(fits25.semifinal ? { semifinal: packGate(fits25.semifinal) } : {}),
        ...(fits25.final ? { final: packGate(fits25.final) } : {}),
      },
    },
    backtest,
    wildcards: {
      "2025": wildcardReport(clas25, later25),
      "2024": wildcardReport(clas24, later24),
    },
  };

  const applyChosen = (c: LabeledCouple, table: SurvivalDecileRow[]): LookupPick => {
    if (chosen === "logistic") {
      const p = logPred25(c);
      const n = table[c.decile]?.n ?? 0;
      return {
        pCuartos: p.pCuartos,
        pSemi: p.pSemi,
        pFinal: p.pFinal,
        ciCuartos: p.pCuartos === null ? null : ciFromRate(p.pCuartos, n),
        ciSemi: ciFromRate(p.pSemi, n),
        ciFinal: ciFromRate(p.pFinal, n),
        cohortN: n,
        spreadBand: null,
      };
    }
    return lookupApply(table, c.decile, c.spread);
  };

  const yearFiles: YearSurvivalFile[] = [
    {
      year: 2025,
      generatedAt: model.generatedAt,
      model: chosen,
      disclaimer: SURVIVAL_DISCLAIMER,
      gates: ["cuartos", "semifinal", "final"],
      couples: couples25.map((c) => toCoupleSurvival(c, applyChosen(c, deciles2025), true, true)),
    },
    {
      year: 2024,
      generatedAt: model.generatedAt,
      model: "lookup",
      disclaimer: SURVIVAL_DISCLAIMER,
      gates: ["semifinal", "final"],
      couples: couples24.map((c) =>
        toCoupleSurvival(c, lookupApply(deciles2024, c.decile, c.spread), false, true),
      ),
    },
  ];
  if (clas26) {
    yearFiles.push({
      year: 2026,
      generatedAt: model.generatedAt,
      model: chosen,
      disclaimer: SURVIVAL_DISCLAIMER,
      gates: ["cuartos", "semifinal", "final"],
      couples: couples26.map((c) => toCoupleSurvival(c, applyChosen(c, deciles2025), true, false)),
    });
  }

  await writeJson(join(PUBLIC_DATA, "survival.json"), model);
  await writeJson(join(PROCESSED_DATA, "survival.json"), model);
  for (const file of yearFiles) {
    await writeJson(join(PUBLIC_DATA, String(file.year), "survival.json"), file);
    await writeJson(join(PROCESSED_DATA, String(file.year), "survival.json"), file);
  }

  console.log("\n=== Stage-survival odds ===");
  console.log(`Model shipped: ${chosen}`);
  console.log(reason);
  console.log("\n2025 block-percentile deciles (lookup):");
  for (const row of deciles2025) {
    console.log(
      `  d${row.decile} ${row.label.padEnd(12)} n=${String(row.n).padStart(3)}  P(Q)=${String(row.pCuartos)}  P(S)=${row.pSemi.toFixed(3)}  P(F)=${row.pFinal.toFixed(3)}  spreadMed=${row.spreadMedian}`,
    );
  }
  console.log("\nBrier in-sample 2025  lookup/decile", inSampleLookup);
  console.log("Brier in-sample 2025  lookup+spread", inSampleLookupSpread);
  console.log("Brier in-sample 2025  logistic     ", inSampleLogistic);
  console.log("ECE  in-sample 2025   lookup+spread", eceLookup);
  console.log("ECE  in-sample 2025   logistic     ", eceLogistic);
  console.log("Brier LOBO 2025       lookup       ", lobo.lookup);
  console.log("Brier LOBO 2025       logistic     ", lobo.logistic);
  console.log("Walk-forward 2024→2025 lookup      ", walkLookup);
  console.log("Walk-forward 2024→2025 logistic    ", walkLogistic);
  console.log("\nLogistic coefficients (2025, L2 λ=0.5):");
  for (const [gate, packed] of Object.entries(model.logistic.gates)) {
    console.log(`  ${gate} intercept=${packed.intercept}`, packed.coefficients);
  }
  console.log("\nWildcards (unmatched later-stage IDs):", model.wildcards);

  if (clas26) {
    const top = couples26.filter((c) => c.decile === 9);
    const bottom = couples26.filter((c) => c.decile <= 4);
    const sampleTop = top.sort((a, b) => b.standingPct - a.standingPct)[0];
    const sampleBot = bottom.sort((a, b) => a.standingPct - b.standingPct)[0];
    if (sampleTop) {
      const p = applyChosen(sampleTop, deciles2025);
      console.log(
        `\nUI check top:    http://localhost:5173/2026/pareja/${sampleTop.row.blockId}/${sampleTop.row.coupleId}`,
        `P(Q)=${p.pCuartos} P(S)=${p.pSemi} P(F)=${p.pFinal}`,
        sampleTop.row.dancer1,
        "&",
        sampleTop.row.dancer2,
      );
    }
    if (sampleBot) {
      const p = applyChosen(sampleBot, deciles2025);
      console.log(
        `UI check bottom: http://localhost:5173/2026/pareja/${sampleBot.row.blockId}/${sampleBot.row.coupleId}`,
        `P(Q)=${p.pCuartos} P(S)=${p.pSemi} P(F)=${p.pFinal}`,
        sampleBot.row.dancer1,
        "&",
        sampleBot.row.dancer2,
      );
    }
    console.log("Rankings:         http://localhost:5173/2026/rankings");
  }

  return model;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  generateSurvival().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

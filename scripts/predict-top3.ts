/**
 * Private 2026 podium forecast.
 *
 * The output is deliberately written outside public/data. Historical labels are
 * sparse, so every learned model must beat the semifinal-rank baseline before
 * it can be selected.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Category, Dataset, ScoreRow, Stage } from "../src/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_ROOT = join(ROOT, "data", "processed");
const OUTPUT = join(ROOT, ".private", "top3-forecast.json");
const HISTORICAL_YEARS = [2024, 2025] as const;
const CATEGORIES: Category[] = ["pista", "escenario"];
const SIMULATIONS = 2_000;

export const SAFE_FEATURE_NAMES = [
  "semifinalPercentile",
  "judgeNormalizedPercentile",
  "consistencyPercentile",
  "trend",
  "priorStagePercentile",
  "samePairPriorSemi",
  "samePairPriorFinal",
  "partnerPriorSemi",
  "partnerPriorFinal",
] as const;

type FeatureName = (typeof SAFE_FEATURE_NAMES)[number];
type FeatureVector = Record<FeatureName, number>;
type ModelName = "semifinal-rank" | "constrained-ensemble" | "regularized-logistic";

export interface HistoryIndex {
  semiPairs: Set<string>;
  finalPairs: Set<string>;
  semiPeople: Set<string>;
  finalPeople: Set<string>;
}

interface Example {
  year: number;
  category: Category;
  coupleId: number;
  dancer1: string;
  dancer2: string;
  features: FeatureVector;
  top3: boolean;
  finalRank: number | null;
}

interface EventExamples {
  year: number;
  category: Category;
  candidates: Example[];
  actualPodiumIds: number[];
  residuals: number[];
}

interface Metrics {
  hits: number;
  medals: number;
  hitRate: number;
  ndcgAt3: number;
  brier: number;
}

interface FittedLogistic {
  means: number[];
  scales: number[];
  weights: number[];
  intercept: number;
}

export interface ModelValidation {
  model: ModelName;
  leaveEventOut: Metrics;
  walkForward2024to2025: Metrics;
}

interface ScoredExample extends Example {
  score: number;
}

interface PodiumPrediction {
  rank: 1 | 2 | 3;
  coupleId: number;
  dancer1: string;
  dancer2: string;
  score: number;
  top3SelectionFrequency: number;
  firstPlaceFrequency: number;
  evidence: string[];
}

interface CategoryForecastReady {
  status: "ready";
  cutoffStage: "semifinal";
  candidateCount: number;
  podium: PodiumPrediction[];
  alternates: Array<{
    rank: number;
    coupleId: number;
    dancer1: string;
    dancer2: string;
    score: number;
    top3SelectionFrequency: number;
  }>;
}

interface CategoryForecastPending {
  status: "pending";
  reason: string;
}

interface ForecastFile {
  generatedAt: string;
  targetYear: 2026;
  private: true;
  experimental: true;
  selectedModel: ModelName;
  selectionReason: string;
  training: {
    years: number[];
    events: number;
    candidateRows: number;
    positiveLabels: number;
    historicalBaselineHits: string;
  };
  validation: ModelValidation[];
  uncertainty: {
    method: string;
    simulations: number;
    caveat: string;
  };
  categories: Record<Category, CategoryForecastReady | CategoryForecastPending>;
}

function round(n: number, digits = 4): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? "th"
      : value % 10 === 1
        ? "st"
        : value % 10 === 2
          ? "nd"
          : value % 10 === 3
            ? "rd"
            : "th";
  return `${value}${suffix}`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function percentileFromRank(rank: number, count: number): number {
  if (count <= 1) return 1;
  return clamp01(1 - (rank - 1) / (count - 1));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 1;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2))) || 1;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - index) + sorted[hi]! * (index - lo);
}

export function judgeIqr(row: Pick<ScoreRow, "judges">): number {
  const kept = row.judges
    .filter((judge) => !judge.dropped)
    .map((judge) => judge.score)
    .sort((a, b) => a - b);
  return quantile(kept, 0.75) - quantile(kept, 0.25);
}

function percentileAmong(value: number, population: number[]): number {
  if (population.length <= 1) return 1;
  const below = population.filter((candidate) => candidate < value).length;
  const equal = population.filter((candidate) => candidate === value).length;
  return clamp01((below + Math.max(0, equal - 1) / 2) / (population.length - 1));
}

function foldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

export function personKey(value: string): string {
  const tokens = foldName(value).split(/\s+/).filter((token) => token.length >= 2);
  return tokens.length ? `${tokens[0]}|${tokens[tokens.length - 1]}` : "";
}

function pairKey(row: Pick<ScoreRow, "dancer1" | "dancer2">): string {
  return [personKey(row.dancer1), personKey(row.dancer2)].sort().join("&&");
}

function emptyHistory(): HistoryIndex {
  return {
    semiPairs: new Set(),
    finalPairs: new Set(),
    semiPeople: new Set(),
    finalPeople: new Set(),
  };
}

function addRowsToHistory(
  history: HistoryIndex,
  rows: ScoreRow[],
  stage: "semifinal" | "final",
): void {
  const pairs = stage === "semifinal" ? history.semiPairs : history.finalPairs;
  const people = stage === "semifinal" ? history.semiPeople : history.finalPeople;
  for (const row of rows) {
    pairs.add(pairKey(row));
    people.add(personKey(row.dancer1));
    people.add(personKey(row.dancer2));
  }
}

function directory(year: number, category: Category): string {
  return join(DATA_ROOT, String(year), category === "escenario" ? "escenario" : "");
}

async function loadDataset(
  year: number,
  category: Category,
  stage: Stage,
): Promise<Dataset | null> {
  try {
    return JSON.parse(
      await readFile(join(directory(year, category), `results-${stage}.json`), "utf8"),
    ) as Dataset;
  } catch {
    return null;
  }
}

function previousStagePercentiles(dataset: Dataset | null): Map<number, number> {
  const result = new Map<number, number>();
  if (!dataset) return result;
  const blockSizes = new Map<string, number>();
  for (const row of dataset.rows) {
    blockSizes.set(row.blockId, (blockSizes.get(row.blockId) ?? 0) + 1);
  }
  for (const row of dataset.rows) {
    result.set(
      row.coupleId,
      percentileFromRank(row.rankInBlock, blockSizes.get(row.blockId) ?? dataset.rows.length),
    );
  }
  return result;
}

function judgeNormalizedScores(rows: ScoreRow[]): Map<number, number> {
  const byJudge = new Map<string, number[]>();
  for (const row of rows) {
    for (const judge of row.judges) {
      const scores = byJudge.get(judge.name) ?? [];
      scores.push(judge.score);
      byJudge.set(judge.name, scores);
    }
  }
  const stats = new Map(
    [...byJudge.entries()].map(([name, scores]) => [
      name,
      { mean: mean(scores), scale: stdev(scores) },
    ]),
  );
  return new Map(
    rows.map((row) => [
      row.coupleId,
      mean(
        row.judges.map((judge) => {
          const stat = stats.get(judge.name)!;
          return (judge.score - stat.mean) / stat.scale;
        }),
      ),
    ]),
  );
}

export function extractSafeFeatures(input: {
  row: ScoreRow;
  semifinalRows: ScoreRow[];
  previousPercentiles: Map<number, number>;
  history: HistoryIndex;
}): FeatureVector {
  const { row, semifinalRows, previousPercentiles, history } = input;
  const finalists = semifinalRows.filter((candidate) => candidate.classified);
  const normalized = judgeNormalizedScores(semifinalRows);
  const normalizedPopulation = finalists.map((candidate) => normalized.get(candidate.coupleId) ?? 0);
  const consistencyPopulation = finalists.map((candidate) => -judgeIqr(candidate));
  const semifinalPercentile = percentileFromRank(row.rankOverall, semifinalRows.length);
  const priorStagePercentile = previousPercentiles.get(row.coupleId) ?? 0.5;
  const people = [personKey(row.dancer1), personKey(row.dancer2)];
  const pair = pairKey(row);
  return {
    semifinalPercentile,
    judgeNormalizedPercentile: percentileAmong(
      normalized.get(row.coupleId) ?? 0,
      normalizedPopulation,
    ),
    consistencyPercentile: percentileAmong(-judgeIqr(row), consistencyPopulation),
    trend: clamp01((semifinalPercentile - priorStagePercentile + 1) / 2),
    priorStagePercentile,
    samePairPriorSemi: history.semiPairs.has(pair) ? 1 : 0,
    samePairPriorFinal: history.finalPairs.has(pair) ? 1 : 0,
    partnerPriorSemi: people.some((person) => history.semiPeople.has(person)) ? 1 : 0,
    partnerPriorFinal: people.some((person) => history.finalPeople.has(person)) ? 1 : 0,
  };
}

export function labelSemifinalRows(
  semifinalRows: ScoreRow[],
  finalRows: ScoreRow[],
): Array<{ coupleId: number; top3: boolean; finalRank: number | null }> {
  const finals = new Map(finalRows.map((row) => [row.coupleId, row.rankOverall]));
  return semifinalRows
    .filter((row) => row.classified)
    .map((row) => {
      const finalRank = finals.get(row.coupleId) ?? null;
      return { coupleId: row.coupleId, top3: finalRank !== null && finalRank <= 3, finalRank };
    });
}

async function historyBefore(year: number): Promise<HistoryIndex> {
  const history = emptyHistory();
  for (const priorYear of HISTORICAL_YEARS) {
    if (priorYear >= year) continue;
    for (const category of CATEGORIES) {
      const [semi, final] = await Promise.all([
        loadDataset(priorYear, category, "semifinal"),
        loadDataset(priorYear, category, "final"),
      ]);
      if (semi) addRowsToHistory(history, semi.rows, "semifinal");
      if (final) addRowsToHistory(history, final.rows, "final");
    }
  }
  return history;
}

async function buildEvent(
  year: number,
  category: Category,
  requireFinal: boolean,
): Promise<EventExamples | null> {
  const [semifinal, final, cuartos, clas, history] = await Promise.all([
    loadDataset(year, category, "semifinal"),
    loadDataset(year, category, "final"),
    loadDataset(year, category, "cuartos"),
    loadDataset(year, category, "clasificatoria"),
    historyBefore(year),
  ]);
  if (!semifinal || (requireFinal && !final)) return null;
  const previous = previousStagePercentiles(cuartos ?? clas);
  const labels = new Map(
    labelSemifinalRows(semifinal.rows, final?.rows ?? []).map((label) => [
      label.coupleId,
      label,
    ]),
  );
  const candidates = semifinal.rows
    .filter((row) => row.classified)
    .map((row): Example => {
      const label = labels.get(row.coupleId);
      return {
        year,
        category,
        coupleId: row.coupleId,
        dancer1: row.dancer1,
        dancer2: row.dancer2,
        features: extractSafeFeatures({
          row,
          semifinalRows: semifinal.rows,
          previousPercentiles: previous,
          history,
        }),
        top3: label?.top3 ?? false,
        finalRank: label?.finalRank ?? null,
      };
    });
  const finalCount = final?.rows.length ?? 0;
  const residuals = candidates
    .filter((candidate) => candidate.finalRank !== null)
    .map(
      (candidate) =>
        percentileFromRank(candidate.finalRank!, finalCount) -
        candidate.features.semifinalPercentile,
    );
  return {
    year,
    category,
    candidates,
    actualPodiumIds: (final?.rows ?? [])
      .filter((row) => row.rankOverall <= 3)
      .sort((a, b) => a.rankOverall - b.rankOverall)
      .map((row) => row.coupleId),
    residuals,
  };
}

function baselineScore(example: Example): number {
  return example.features.semifinalPercentile;
}

function ensembleScore(example: Example): number {
  const f = example.features;
  const history =
    0.35 * f.samePairPriorFinal +
    0.25 * f.partnerPriorFinal +
    0.25 * f.samePairPriorSemi +
    0.15 * f.partnerPriorSemi;
  return (
    0.68 * f.semifinalPercentile +
    0.12 * f.judgeNormalizedPercentile +
    0.07 * f.consistencyPercentile +
    0.05 * f.trend +
    0.05 * f.priorStagePercentile +
    0.03 * history
  );
}

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function fitLogistic(examples: Example[], lambda = 2): FittedLogistic {
  const matrix = examples.map((example) =>
    SAFE_FEATURE_NAMES.map((name) => example.features[name]),
  );
  const means = SAFE_FEATURE_NAMES.map((_, index) => mean(matrix.map((row) => row[index]!)));
  const scales = SAFE_FEATURE_NAMES.map(
    (_, index) => stdev(matrix.map((row) => row[index]!)),
  );
  const x = matrix.map((row) =>
    row.map((value, index) => (value - means[index]!) / scales[index]!),
  );
  const positiveRate = Math.max(1e-4, mean(examples.map((example) => Number(example.top3))));
  let intercept = Math.log(positiveRate / (1 - positiveRate));
  const weights = SAFE_FEATURE_NAMES.map(() => 0);
  for (let iteration = 0; iteration < 1_500; iteration++) {
    const grad = weights.map(() => 0);
    let interceptGrad = 0;
    for (let i = 0; i < examples.length; i++) {
      const prediction = sigmoid(
        intercept + x[i]!.reduce((sum, value, j) => sum + value * weights[j]!, 0),
      );
      const error = prediction - Number(examples[i]!.top3);
      interceptGrad += error;
      for (let j = 0; j < weights.length; j++) grad[j]! += error * x[i]![j]!;
    }
    const rate = 0.08 / (1 + iteration / 500);
    intercept -= rate * interceptGrad / examples.length;
    for (let j = 0; j < weights.length; j++) {
      weights[j]! -=
        rate * (grad[j]! / examples.length + (lambda / examples.length) * weights[j]!);
    }
  }
  return { means, scales, weights, intercept };
}

function logisticScore(model: FittedLogistic, example: Example): number {
  const z = SAFE_FEATURE_NAMES.reduce((sum, name, index) => {
    const value = (example.features[name] - model.means[index]!) / model.scales[index]!;
    return sum + value * model.weights[index]!;
  }, model.intercept);
  return sigmoid(z);
}

function dcgAt3(ranked: ScoredExample[]): number {
  return ranked.slice(0, 3).reduce((sum, example, index) => {
    const relevance = example.finalRank && example.finalRank <= 3 ? 4 - example.finalRank : 0;
    return sum + (2 ** relevance - 1) / Math.log2(index + 2);
  }, 0);
}

function metricsFor(
  events: EventExamples[],
  scores: Map<string, number>,
): Metrics {
  let hits = 0;
  let medals = 0;
  let ndcg = 0;
  const probabilities: Array<{ prediction: number; actual: number }> = [];
  const idealDcg = (2 ** 3 - 1) + (2 ** 2 - 1) / Math.log2(3) + (2 - 1) / Math.log2(4);
  for (const event of events) {
    const ranked = event.candidates
      .map((example) => ({
        ...example,
        score: scores.get(exampleKey(example)) ?? 0,
      }))
      .sort((a, b) => b.score - a.score || a.coupleId - b.coupleId);
    const predicted = new Set(ranked.slice(0, 3).map((example) => example.coupleId));
    hits += event.actualPodiumIds.filter((id) => predicted.has(id)).length;
    medals += event.actualPodiumIds.length;
    ndcg += dcgAt3(ranked) / idealDcg;
    for (const example of ranked) {
      probabilities.push({ prediction: clamp01(example.score), actual: Number(example.top3) });
    }
  }
  return {
    hits,
    medals,
    hitRate: round(medals ? hits / medals : 0),
    ndcgAt3: round(events.length ? ndcg / events.length : 0),
    brier: round(
      mean(
        probabilities.map(
          ({ prediction, actual }) => (prediction - actual) ** 2,
        ),
      ),
    ),
  };
}

function exampleKey(example: Pick<Example, "year" | "category" | "coupleId">): string {
  return `${example.year}:${example.category}:${example.coupleId}`;
}

function staticScores(
  events: EventExamples[],
  score: (example: Example) => number,
): Map<string, number> {
  return new Map(
    events.flatMap((event) =>
      event.candidates.map((example) => [exampleKey(example), score(example)] as const),
    ),
  );
}

function heldOutLogisticScores(events: EventExamples[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const heldOut of events) {
    const train = events
      .filter((event) => event !== heldOut)
      .flatMap((event) => event.candidates);
    const model = fitLogistic(train);
    for (const example of heldOut.candidates) {
      result.set(exampleKey(example), logisticScore(model, example));
    }
  }
  return result;
}

function walkForwardMetrics(
  events: EventExamples[],
  model: ModelName,
): Metrics {
  const train = events.filter((event) => event.year === 2024);
  const test = events.filter((event) => event.year === 2025);
  let scores: Map<string, number>;
  if (model === "semifinal-rank") scores = staticScores(test, baselineScore);
  else if (model === "constrained-ensemble") scores = staticScores(test, ensembleScore);
  else {
    const fit = fitLogistic(train.flatMap((event) => event.candidates));
    scores = staticScores(test, (example) => logisticScore(fit, example));
  }
  return metricsFor(test, scores);
}

export function chooseModel(validation: ModelValidation[]): {
  model: ModelName;
  reason: string;
} {
  const baseline = validation.find((entry) => entry.model === "semifinal-rank")!;
  const eligible = validation.filter(
    (entry) =>
      entry.model !== "semifinal-rank" &&
      entry.leaveEventOut.hits >= baseline.leaveEventOut.hits + 2 &&
      entry.leaveEventOut.ndcgAt3 >= baseline.leaveEventOut.ndcgAt3 &&
      entry.walkForward2024to2025.hits > baseline.walkForward2024to2025.hits,
  );
  if (!eligible.length) {
    return {
      model: "semifinal-rank",
      reason:
        "No learned candidate cleared the predeclared improvement threshold; using the stronger and less overfit semifinal-rank baseline.",
    };
  }
  eligible.sort(
    (a, b) =>
      b.leaveEventOut.hits - a.leaveEventOut.hits ||
      b.leaveEventOut.ndcgAt3 - a.leaveEventOut.ndcgAt3,
  );
  return {
    model: eligible[0]!.model,
    reason:
      "Selected after exceeding the baseline by at least two held-out medals and also improving the 2024→2025 walk-forward result.",
  };
}

function validationReport(events: EventExamples[]): ModelValidation[] {
  return [
    {
      model: "semifinal-rank",
      leaveEventOut: metricsFor(events, staticScores(events, baselineScore)),
      walkForward2024to2025: walkForwardMetrics(events, "semifinal-rank"),
    },
    {
      model: "constrained-ensemble",
      leaveEventOut: metricsFor(events, staticScores(events, ensembleScore)),
      walkForward2024to2025: walkForwardMetrics(events, "constrained-ensemble"),
    },
    {
      model: "regularized-logistic",
      leaveEventOut: metricsFor(events, heldOutLogisticScores(events)),
      walkForward2024to2025: walkForwardMetrics(events, "regularized-logistic"),
    },
  ];
}

function selectedScoreFunction(
  model: ModelName,
  historical: EventExamples[],
): (example: Example) => number {
  if (model === "semifinal-rank") return baselineScore;
  if (model === "constrained-ensemble") return ensembleScore;
  const fit = fitLogistic(historical.flatMap((event) => event.candidates));
  return (example) => logisticScore(fit, example);
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function simulationFrequencies(
  ranked: ScoredExample[],
  residuals: number[],
): Map<number, { top3: number; first: number }> {
  const result = new Map(
    ranked.map((example) => [example.coupleId, { top3: 0, first: 0 }]),
  );
  const rng = createRng(20260830);
  const scoreRanks = new Map(
    ranked.map((example, index) => [
      example.coupleId,
      percentileFromRank(index + 1, ranked.length),
    ]),
  );
  const noise = residuals.length ? residuals : [0];
  for (let simulation = 0; simulation < SIMULATIONS; simulation++) {
    const simulated = ranked
      .map((example) => ({
        id: example.coupleId,
        score:
          scoreRanks.get(example.coupleId)! +
          noise[Math.floor(rng() * noise.length)]! +
          (rng() - 0.5) * 0.015,
      }))
      .sort((a, b) => b.score - a.score || a.id - b.id);
    for (const candidate of simulated.slice(0, 3)) result.get(candidate.id)!.top3++;
    result.get(simulated[0]!.id)!.first++;
  }
  return new Map(
    [...result.entries()].map(([id, value]) => [
      id,
      { top3: value.top3 / SIMULATIONS, first: value.first / SIMULATIONS },
    ]),
  );
}

function evidenceFor(example: Example): string[] {
  const f = example.features;
  const evidence = [
    `Semifinal standing: top ${Math.max(1, Math.round((1 - f.semifinalPercentile) * 100 + 1))}%`,
    `Judge-normalized strength: ${ordinal(Math.round(f.judgeNormalizedPercentile * 100))} percentile`,
    `Judge agreement: ${ordinal(Math.round(f.consistencyPercentile * 100))} percentile`,
  ];
  if (f.samePairPriorFinal) evidence.push("Same pair reached a prior final");
  else if (f.partnerPriorFinal) evidence.push("At least one partner reached a prior final");
  return evidence;
}

function categoryForecast(
  current: EventExamples,
  historical: EventExamples[],
  model: ModelName,
): CategoryForecastReady {
  const score = selectedScoreFunction(model, historical);
  const ranked = current.candidates
    .map((example) => ({ ...example, score: score(example) }))
    .sort((a, b) => b.score - a.score || a.coupleId - b.coupleId);
  const residuals = historical.flatMap((event) => event.residuals);
  const frequencies = simulationFrequencies(ranked, residuals);
  return {
    status: "ready",
    cutoffStage: "semifinal",
    candidateCount: ranked.length,
    podium: ranked.slice(0, 3).map((example, index) => ({
      rank: (index + 1) as 1 | 2 | 3,
      coupleId: example.coupleId,
      dancer1: example.dancer1,
      dancer2: example.dancer2,
      score: round(example.score),
      top3SelectionFrequency: round(frequencies.get(example.coupleId)!.top3),
      firstPlaceFrequency: round(frequencies.get(example.coupleId)!.first),
      evidence: evidenceFor(example),
    })),
    alternates: ranked.slice(3, 8).map((example, index) => ({
      rank: index + 4,
      coupleId: example.coupleId,
      dancer1: example.dancer1,
      dancer2: example.dancer2,
      score: round(example.score),
      top3SelectionFrequency: round(frequencies.get(example.coupleId)!.top3),
    })),
  };
}

export async function generateForecast(outputPath = OUTPUT): Promise<ForecastFile> {
  const historical = (
    await Promise.all(
      HISTORICAL_YEARS.flatMap((year) =>
        CATEGORIES.map((category) => buildEvent(year, category, true)),
      ),
    )
  ).filter((event): event is EventExamples => event !== null);
  const validation = validationReport(historical);
  const selected = chooseModel(validation);
  const categories = {} as ForecastFile["categories"];
  for (const category of CATEGORIES) {
    const current = await buildEvent(2026, category, false);
    categories[category] = current
      ? categoryForecast(current, historical, selected.model)
      : {
          status: "pending",
          reason: "No published 2026 semifinal dataset yet; prediction intentionally withheld.",
        };
  }
  const baseline = validation.find((entry) => entry.model === "semifinal-rank")!;
  const forecast: ForecastFile = {
    generatedAt: new Date().toISOString(),
    targetYear: 2026,
    private: true,
    experimental: true,
    selectedModel: selected.model,
    selectionReason: selected.reason,
    training: {
      years: [...HISTORICAL_YEARS],
      events: historical.length,
      candidateRows: historical.reduce((sum, event) => sum + event.candidates.length, 0),
      positiveLabels: historical.reduce(
        (sum, event) => sum + event.candidates.filter((example) => example.top3).length,
        0,
      ),
      historicalBaselineHits: `${baseline.leaveEventOut.hits}/${baseline.leaveEventOut.medals}`,
    },
    validation,
    uncertainty: {
      method:
        "Deterministic empirical simulation of historical semifinal-to-final percentile movement.",
      simulations: SIMULATIONS,
      caveat:
        "Selection frequencies measure model stability under historical movement, not calibrated probabilities of winning.",
    },
    categories,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(forecast, null, 2)}\n`, "utf8");
  return forecast;
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
  generateForecast()
    .then((forecast) => {
      console.log(`Private forecast written to ${OUTPUT}`);
      console.log(`Selected model: ${forecast.selectedModel}`);
      for (const category of CATEGORIES) {
        const result = forecast.categories[category];
        if (result.status === "pending") {
          console.log(`${category}: pending semifinal`);
          continue;
        }
        console.log(
          `${category}: ${result.podium
            .map((pick) => `${pick.rank}. #${pick.coupleId} ${pick.dancer1} & ${pick.dancer2}`)
            .join(" | ")}`,
        );
      }
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

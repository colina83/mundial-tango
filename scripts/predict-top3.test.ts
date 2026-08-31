import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ScoreRow } from "../src/types.ts";
import {
  SAFE_FEATURE_NAMES,
  chooseModel,
  extractSafeFeatures,
  generateForecast,
  judgeIqr,
  labelSemifinalRows,
  percentileFromRank,
  personKey,
  type HistoryIndex,
  type ModelValidation,
} from "./predict-top3.ts";

function row(input: {
  id: number;
  rank: number;
  classified?: boolean;
  scores?: number[];
  dancer1?: string;
  dancer2?: string;
}): ScoreRow {
  const scores = input.scores ?? [8, 8.2, 8.4, 8.6, 8.8];
  return {
    coupleId: input.id,
    round: "1",
    dancer1: input.dancer1 ?? `Dancer ${input.id} A`,
    dancer2: input.dancer2 ?? `Dancer ${input.id} B`,
    judges: scores.map((score, index) => ({
      name: `Judge ${index}`,
      score,
      dropped: false,
    })),
    average: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    officialAverage: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    rankInBlock: input.rank,
    rankOverall: input.rank,
    classified: input.classified ?? true,
    cutoffDelta: 0,
    spread: Math.max(...scores) - Math.min(...scores),
    blockId: "_",
    averageMismatch: false,
  };
}

function emptyHistory(): HistoryIndex {
  return {
    semiPairs: new Set(),
    finalPairs: new Set(),
    semiPeople: new Set(),
    finalPeople: new Set(),
  };
}

function metrics(hits: number, ndcgAt3: number) {
  return { hits, medals: 12, hitRate: hits / 12, ndcgAt3, brier: 0.1 };
}

test("rank percentiles are scale-independent", () => {
  assert.equal(percentileFromRank(1, 40), 1);
  assert.equal(percentileFromRank(40, 40), 0);
  assert.equal(percentileFromRank(1, 1), 1);
});

test("judge IQR ignores scores dropped by trimmed scoring", () => {
  const candidate = row({ id: 1, rank: 1, scores: [1, 8, 8.2, 8.4, 10] });
  candidate.judges[0]!.dropped = true;
  candidate.judges[4]!.dropped = true;
  assert.ok(Math.abs(judgeIqr(candidate) - 0.2) < 1e-9);
});

test("safe features ignore future-enriched result fields", () => {
  const semifinalRows = [
    row({ id: 1, rank: 1, scores: [9, 9.1, 9.2] }),
    row({ id: 2, rank: 2, scores: [8, 8.1, 8.2] }),
  ];
  const first = semifinalRows[0]!;
  const base = extractSafeFeatures({
    row: first,
    semifinalRows,
    previousPercentiles: new Map([[1, 0.8]]),
    history: emptyHistory(),
  });
  first.overall = 0;
  first.lastStageReached = "final";
  first.stageStandings = [{ stage: "final", average: 10, percentile: 100 }];
  const afterLeakFields = extractSafeFeatures({
    row: first,
    semifinalRows,
    previousPercentiles: new Map([[1, 0.8]]),
    history: emptyHistory(),
  });
  assert.deepEqual(afterLeakFields, base);
  assert.ok(!SAFE_FEATURE_NAMES.includes("overall" as never));
  assert.ok(!SAFE_FEATURE_NAMES.includes("lastStageReached" as never));
});

test("final wildcards do not create mislabeled semifinal examples", () => {
  const semifinal = [row({ id: 1, rank: 1 }), row({ id: 2, rank: 2 })];
  const final = [
    row({ id: 99, rank: 1 }),
    row({ id: 1, rank: 2 }),
    row({ id: 2, rank: 5 }),
  ];
  const labels = labelSemifinalRows(semifinal, final);
  assert.deepEqual(
    labels.map(({ coupleId, top3, finalRank }) => ({ coupleId, top3, finalRank })),
    [
      { coupleId: 1, top3: true, finalRank: 2 },
      { coupleId: 2, top3: false, finalRank: 5 },
    ],
  );
});

test("name matching normalizes accents and case", () => {
  assert.equal(personKey("María Pérez"), personKey("MARIA PEREZ"));
});

test("learned model must clear the predeclared baseline threshold", () => {
  const validation: ModelValidation[] = [
    {
      model: "semifinal-rank",
      leaveEventOut: metrics(8, 0.7),
      walkForward2024to2025: metrics(5, 0.7),
    },
    {
      model: "constrained-ensemble",
      leaveEventOut: metrics(9, 0.8),
      walkForward2024to2025: metrics(6, 0.8),
    },
    {
      model: "regularized-logistic",
      leaveEventOut: metrics(10, 0.75),
      walkForward2024to2025: metrics(6, 0.75),
    },
  ];
  assert.equal(chooseModel(validation).model, "regularized-logistic");
  validation[2]!.leaveEventOut.hits = 9;
  assert.equal(chooseModel(validation).model, "semifinal-rank");
});

test("forecast is deterministic for categories with semifinal results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pulso-top3-"));
  const firstPath = join(directory, "first.json");
  const secondPath = join(directory, "second.json");
  try {
    const first = await generateForecast(firstPath);
    const second = await generateForecast(secondPath);
    assert.equal(first.categories.pista.status, "ready");
    assert.equal(first.categories.escenario.status, "ready");
    assert.deepEqual(first.categories.pista, second.categories.pista);
    assert.deepEqual(first.categories.escenario, second.categories.escenario);
    assert.deepEqual(first.validation, second.validation);
    const saved = await readFile(firstPath, "utf8");
    assert.doesNotThrow(() => JSON.parse(saved));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * Cross-stage overall score: mean of within-stage rank percentiles (0–100).
 * Does not average raw marks — clasificatoria / cuartos / semi / final use different scales.
 *
 * Join key: coupleId. Wildcards who skip earlier stages still score from the stages they have.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Dataset, Stage, StageStanding } from "../src/types.ts";
import { writeYearOutputs } from "./year-io.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROCESSED_DIR = join(ROOT, "data", "processed");
const PUBLIC_DATA_DIR = join(ROOT, "public", "data");

const STAGE_ORDER: Stage[] = ["clasificatoria", "cuartos", "semifinal", "final"];

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Rank 1 of n → 100; last place → 0. Ties share the same rankOverall percentile. */
export function rankPercentile(rank: number, n: number): number {
  if (n <= 1) return 100;
  return round1((1 - (rank - 1) / (n - 1)) * 100);
}

export function attachOverallScores(datasets: Dataset[]): void {
  const byCouple = new Map<number, Map<Stage, StageStanding>>();

  for (const ds of datasets) {
    const n = ds.rows.length;
    for (const row of ds.rows) {
      const percentile = rankPercentile(row.rankOverall, n);
      row.stagePercentile = percentile;
      let stages = byCouple.get(row.coupleId);
      if (!stages) {
        stages = new Map();
        byCouple.set(row.coupleId, stages);
      }
      stages.set(ds.stage, {
        stage: ds.stage,
        average: row.average,
        percentile,
      });
    }
  }

  for (const ds of datasets) {
    for (const row of ds.rows) {
      const stages = byCouple.get(row.coupleId);
      const standings = stages
        ? [...stages.values()].sort(
            (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage),
          )
        : [];
      row.stageStandings = standings;
      if (!standings.length) {
        row.overall = undefined;
        row.lastStageReached = undefined;
        continue;
      }
      const sum = standings.reduce((acc, s) => acc + s.percentile, 0);
      row.overall = round1(sum / standings.length);
      row.lastStageReached = standings[standings.length - 1]!.stage;
    }
  }
}

async function loadYearDatasets(year: number): Promise<Dataset[] | null> {
  const manifestPath = join(PUBLIC_DATA_DIR, String(year), "manifest.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return null;
  }
  const manifest = JSON.parse(raw) as { stages: { stage: Stage }[] };
  const datasets: Dataset[] = [];
  for (const entry of manifest.stages) {
    const file = join(PUBLIC_DATA_DIR, String(year), `results-${entry.stage}.json`);
    const ds = JSON.parse(await readFile(file, "utf8")) as Dataset;
    datasets.push(ds);
  }
  return datasets.length ? datasets : null;
}

async function patchYear(year: number): Promise<void> {
  const datasets = await loadYearDatasets(year);
  if (!datasets) {
    console.log(`[overall] ${year}: no manifest — skip.`);
    return;
  }
  attachOverallScores(datasets);
  const scoring = datasets[0]!.scoring ?? (year === 2026 ? "trimmed" : "simple");
  await writeYearOutputs(
    PROCESSED_DIR,
    PUBLIC_DATA_DIR,
    year,
    scoring,
    datasets,
    year === 2026,
  );
  const n = new Set(datasets.flatMap((d) => d.rows.map((r) => r.coupleId))).size;
  console.log(
    `[overall] ${year}: ${n} couples across ${datasets.map((d) => d.stage).join(", ")}`,
  );
}

async function main(): Promise<void> {
  for (const year of [2026, 2025, 2024]) {
    await patchYear(year);
  }
  console.log("Overall scores written (survival files untouched).");
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
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PickCandidate } from "../../src/lib/picks.ts";
import type { Category, Dataset, StageManifest } from "../../src/types.ts";

export interface CandidatePool {
  stage: string;
  candidates: PickCandidate[];
}

const cache = new Map<Category, Promise<CandidatePool>>();

async function load(category: Category): Promise<CandidatePool> {
  const root = join(process.cwd(), "public", "data", "2026");
  const directory = category === "escenario" ? join(root, "escenario") : root;
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  ) as StageManifest;
  const latest = manifest.stages.at(-1);
  if (!latest) throw new Error(`No published stages for ${category}.`);
  const dataset = JSON.parse(
    await readFile(join(directory, `results-${latest.stage}.json`), "utf8"),
  ) as Dataset;
  const unique = new Map<number, PickCandidate>();
  const eligibleRows = dataset.rows.filter((row) => row.classified);
  for (const row of eligibleRows.length ? eligibleRows : dataset.rows) {
    unique.set(row.coupleId, {
      coupleId: row.coupleId,
      dancer1: row.dancer1,
      dancer2: row.dancer2,
    });
  }
  return {
    stage: latest.stage,
    candidates: [...unique.values()].sort((a, b) => a.coupleId - b.coupleId),
  };
}

export function getCandidatePool(category: Category): Promise<CandidatePool> {
  const existing = cache.get(category);
  if (existing) return existing;
  const pending = load(category);
  cache.set(category, pending);
  return pending;
}

export function clearCandidatePoolCache(): void {
  cache.clear();
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AverageMismatch,
  BlockSummary,
  CatalogYear,
  Dataset,
  ScoreRow,
  Scoring,
  Stage,
  StageManifest,
  YearCatalog,
} from "../src/types.ts";
import type { ParsedBlock } from "./parse-pdf.ts";
import { attachOverallRanks, qualifyBlock } from "./qualify.ts";

export async function mergeCatalog(
  publicDataDir: string,
  entry: CatalogYear,
): Promise<YearCatalog> {
  let catalog: YearCatalog = { updatedAt: new Date().toISOString(), years: [] };
  try {
    catalog = JSON.parse(
      await readFile(join(publicDataDir, "catalog.json"), "utf8"),
    ) as YearCatalog;
  } catch {
    /* first write */
  }
  const years = [...(catalog.years ?? []).filter((y) => y.year !== entry.year), entry];
  years.sort((a, b) => b.year - a.year);
  const next: YearCatalog = { updatedAt: new Date().toISOString(), years };
  await mkdir(publicDataDir, { recursive: true });
  await writeFile(join(publicDataDir, "catalog.json"), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function catalogEntryFrom(
  year: number,
  status: CatalogYear["status"],
  scoring: Scoring,
  complete: boolean,
  datasets: Dataset[],
): CatalogYear {
  const stages = datasets.map((d) => d.stage);
  const rowCounts: CatalogYear["rowCounts"] = {};
  for (const d of datasets) rowCounts[d.stage] = d.rows.length;
  const hasBlocks = datasets.some((d) => d.blocks.some((b) => b.id !== "_"));
  return { year, status, scoring, complete, hasBlocks, stages, rowCounts };
}

export async function writeYearOutputs(
  processedDir: string,
  publicDataDir: string,
  year: number,
  scoring: Scoring,
  datasets: Dataset[],
  alsoLegacy: boolean,
): Promise<StageManifest> {
  const yearPublic = join(publicDataDir, String(year));
  const yearProcessed = join(processedDir, String(year));
  await mkdir(yearPublic, { recursive: true });
  await mkdir(yearProcessed, { recursive: true });

  const manifest: StageManifest = {
    updatedAt: new Date().toISOString(),
    year,
    scoring,
    stages: datasets.map((d) => ({
      stage: d.stage,
      generatedAt: d.generatedAt,
      rowCount: d.rows.length,
    })),
  };

  for (const dataset of datasets) {
    const json = `${JSON.stringify(dataset, null, 2)}\n`;
    const name = `results-${dataset.stage}.json`;
    await writeFile(join(yearProcessed, name), json);
    await writeFile(join(yearPublic, name), json);
    if (alsoLegacy) {
      await writeFile(join(processedDir, name), json);
      await writeFile(join(publicDataDir, name), json);
      if (dataset.stage === "clasificatoria") {
        await writeFile(join(processedDir, "results.json"), json);
        await writeFile(join(publicDataDir, "results.json"), json);
      }
    }
  }

  const man = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(yearPublic, "manifest.json"), man);
  await writeFile(join(yearProcessed, "manifest.json"), man);
  if (alsoLegacy) {
    await writeFile(
      join(publicDataDir, "manifest.json"),
      `${JSON.stringify({ updatedAt: manifest.updatedAt, stages: manifest.stages }, null, 2)}\n`,
    );
  }
  return manifest;
}

export const DISCLAIMER =
  "Compañero extraoficial de fans. No afiliado a Tango BA ni al Mundial de Baile. Fuente: Tango BA.";

export const SOURCE_CATEGORY_PAGE = "https://tangoba.org/category/resultados/";

export function buildDataset(
  stage: Stage,
  sourcePage: string,
  sourceCategoryPage: string,
  blocks: ParsedBlock[],
  year: number,
  scoring: Scoring,
): Dataset {
  const rows: ScoreRow[] = [];
  const mismatches: AverageMismatch[] = [];
  const summaries: BlockSummary[] = [];

  const ordered = [...blocks]
    .filter((b) => b.couples.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  const unique: ParsedBlock[] = [];
  const seenIds = new Set<string>();
  for (const block of ordered.sort((a, b) => b.couples.length - a.couples.length)) {
    if (seenIds.has(block.id)) continue;
    seenIds.add(block.id);
    unique.push(block);
  }
  unique.sort((a, b) => a.id.localeCompare(b.id));

  for (const block of unique) {
    const qualified = qualifyBlock(block.couples);
    for (const couple of block.couples) {
      const mismatch =
        Math.abs(couple.average - couple.officialAverage) > 0.002;
      if (mismatch) {
        mismatches.push({
          coupleId: couple.coupleId,
          blockId: block.id,
          computed: couple.average,
          official: couple.officialAverage,
        });
      }
      const rankInBlock = qualified.ranks.get(couple.coupleId) ?? 0;
      const classified = couple.average >= qualified.cutoff;
      rows.push({
        coupleId: couple.coupleId,
        round: couple.round,
        dancer1: couple.dancer1,
        dancer2: couple.dancer2,
        judges: couple.judges,
        average: couple.average,
        officialAverage: couple.officialAverage,
        rankInBlock,
        rankOverall: 0,
        classified,
        cutoffDelta: Math.round((couple.average - qualified.cutoff) * 1000) / 1000,
        spread: couple.spread,
        blockId: block.id,
        averageMismatch: mismatch,
        originStage: stage,
      });
    }
    summaries.push({
      id: block.id,
      date: block.date,
      dateLabel: block.dateLabel,
      judges: block.judges,
      sourcePdf: {
        filename: block.filename,
        url: block.url,
        sha256: block.sha256,
      },
      cutoff: qualified.cutoff,
      classifiedCount: qualified.classifiedCount,
      coupleCount: block.couples.length,
    });
  }

  attachOverallRanks(rows);

  return {
    generatedAt: new Date().toISOString(),
    year,
    stage,
    category: "pista",
    scoring,
    sourcePage,
    sourceCategoryPage,
    sourceLabel: "Tango BA",
    disclaimer: DISCLAIMER,
    blocks: summaries,
    rows,
    mismatches,
  };
}

export function sourcePageFor(year: number, stage: Stage): string {
  const pages: Record<string, string> = {
    "2026-clasificatoria":
      "https://tangoba.org/resultados-clasificatoria-tango-de-pista-2026/",
    "2026-cuartos": "https://tangoba.org/resultados-cuartos-final-tango-de-pista-2026/",
    "2026-semifinal": "https://tangoba.org/resultados-semifinal-tango-de-pista-2026/",
    "2026-final": "https://tangoba.org/resultados-final-tango-de-pista-2026/",
    "2025-clasificatoria":
      "https://tangoba.org/resultados-clasificatoria-tango-de-pista-2025/",
    "2025-cuartos": "https://tangoba.org/resultados-cuartos-tango-de-pista/",
    "2025-semifinal": "https://tangoba.org/resultados-semifinal-tango-de-pista-2025/",
    "2025-final": "https://tangoba.org/resultados-finales-tango-pista-2025/",
    "2024-clasificatoria": "https://tangoba.org/resultados-clasificatoria-tango-de-pista/",
    "2024-semifinal": "https://tangoba.org/resultados-semifinal-tango-de-pista/",
    "2024-final":
      "https://tangoba.org/resultados-finales-tango-escenario-y-tango-pista/",
  };
  return pages[`${year}-${stage}`] ?? "https://tangoba.org/category/resultados/";
}

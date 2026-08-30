import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AverageMismatch,
  BlockSummary,
  CatalogYear,
  Category,
  Dataset,
  ScoreRow,
  Scoring,
  Stage,
  StageManifest,
  YearCatalog,
} from "../src/types.ts";
import type { ParsedBlock } from "./parse-pdf.ts";
import { attachOverallRanks, qualifyBlock, qualifyFromHighlights } from "./qualify.ts";

function catalogKey(entry: { year: number; category?: Category }): string {
  return `${entry.year}:${entry.category ?? "pista"}`;
}

export function yearOutputDir(baseDir: string, year: number, category: Category = "pista"): string {
  const yearDir = join(baseDir, String(year));
  return category === "escenario" ? join(yearDir, "escenario") : yearDir;
}

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
  const key = catalogKey(entry);
  const years = [
    ...(catalog.years ?? []).filter((y) => catalogKey(y) !== key),
    { ...entry, category: entry.category ?? "pista" },
  ];
  years.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return (a.category ?? "pista").localeCompare(b.category ?? "pista");
  });
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
  category: Category = "pista",
): CatalogYear {
  const stages = datasets.map((d) => d.stage);
  const rowCounts: CatalogYear["rowCounts"] = {};
  for (const d of datasets) rowCounts[d.stage] = d.rows.length;
  const hasBlocks = datasets.some((d) => d.blocks.some((b) => b.id !== "_"));
  return { year, category, status, scoring, complete, hasBlocks, stages, rowCounts };
}

export async function writeYearOutputs(
  processedDir: string,
  publicDataDir: string,
  year: number,
  scoring: Scoring,
  datasets: Dataset[],
  alsoLegacy: boolean,
  category: Category = "pista",
): Promise<StageManifest> {
  const yearPublic = yearOutputDir(publicDataDir, year, category);
  const yearProcessed = yearOutputDir(processedDir, year, category);
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
    if (alsoLegacy && category === "pista") {
      await writeFile(join(processedDir, name), json);
      await writeFile(join(publicDataDir, name), json);
      if (dataset.stage === "clasificatoria") {
        await writeFile(join(processedDir, "results.json"), json);
        await writeFile(join(publicDataDir, "results.json"), json);
      }
    }
  }

  const written = new Set(datasets.map((d) => d.stage));
  for (const stage of ["clasificatoria", "cuartos", "semifinal", "final"] as const) {
    if (written.has(stage)) continue;
    const name = `results-${stage}.json`;
    await unlink(join(yearPublic, name)).catch(() => undefined);
    await unlink(join(yearProcessed, name)).catch(() => undefined);
    if (alsoLegacy && category === "pista") {
      await unlink(join(processedDir, name)).catch(() => undefined);
      await unlink(join(publicDataDir, name)).catch(() => undefined);
    }
  }

  const man = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(yearPublic, "manifest.json"), man);
  await writeFile(join(yearProcessed, "manifest.json"), man);
  if (alsoLegacy && category === "pista") {
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
  category: Category = "pista",
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
    const useHighlights = year === 2026 && block.highlightsDetected;
    const qualified = useHighlights
      ? qualifyFromHighlights(block.couples, (c) => c.highlighted)
      : stage === "final" && year === 2026
        ? qualifyFromHighlights(block.couples, () => true)
        : qualifyBlock(block.couples);
    if (year === 2026 && !useHighlights && stage !== "final") {
      console.warn(
        `[${year} ${category} ${stage} ${block.id}] No PDF row highlights found — falling back to top-50% cutoff.`,
      );
    }
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
      const classified = useHighlights
        ? couple.highlighted
        : stage === "final" && year === 2026
          ? true
          : couple.average >= qualified.cutoff;
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
    category,
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

export function sourcePageFor(
  year: number,
  stage: Stage,
  category: Category = "pista",
): string {
  const pages: Record<string, string> = {
    "pista-2026-clasificatoria":
      "https://tangoba.org/resultados-clasificatoria-tango-de-pista-2026/",
    "pista-2026-cuartos":
      "https://tangoba.org/resultados-cuartos-de-final-tango-de-pista-2026/",
    "pista-2026-semifinal": "https://tangoba.org/resultados-semifinal-tango-de-pista-2026/",
    "pista-2026-final": "https://tangoba.org/resultados-final-tango-de-pista-2026/",
    "pista-2025-clasificatoria":
      "https://tangoba.org/resultados-clasificatoria-tango-de-pista-2025/",
    "pista-2025-cuartos": "https://tangoba.org/resultados-cuartos-tango-de-pista/",
    "pista-2025-semifinal": "https://tangoba.org/resultados-semifinal-tango-de-pista-2025/",
    "pista-2025-final": "https://tangoba.org/resultados-finales-tango-pista-2025/",
    "pista-2024-clasificatoria": "https://tangoba.org/resultados-clasificatoria-tango-de-pista/",
    "pista-2024-semifinal": "https://tangoba.org/resultados-semifinal-tango-de-pista/",
    "pista-2024-final":
      "https://tangoba.org/resultados-finales-tango-escenario-y-tango-pista/",
    "escenario-2026-clasificatoria":
      "https://tangoba.org/resultados-clasificatoria-tango-escenario-2026/",
    "escenario-2026-cuartos":
      "https://tangoba.org/resultados-cuartos-de-final-tango-escenario-2026/",
    "escenario-2026-semifinal":
      "https://tangoba.org/resultados-semifinal-tango-escenario-2026/",
    "escenario-2026-final": "https://tangoba.org/resultados-final-tango-escenario-2026/",
    "escenario-2025-clasificatoria":
      "https://tangoba.org/resultados-clasificatoria-tango-escenario-2025/",
    "escenario-2025-cuartos":
      "https://tangoba.org/resultados-clasificatoria-tango-escenario-copy/",
    "escenario-2025-semifinal":
      "https://tangoba.org/resultados-semifinal-tango-escenario-2025/",
    "escenario-2025-final": "https://tangoba.org/resultados-final-tango-escenario-2025/",
    "escenario-2024-clasificatoria":
      "https://tangoba.org/resultados-clasificatoria-tango-escenario/",
    "escenario-2024-semifinal":
      "https://tangoba.org/resultados-semifinal-tango-escenario/",
    "escenario-2024-final":
      "https://tangoba.org/resultados-finales-tango-escenario-y-tango-pista/",
  };
  return pages[`${category}-${year}-${stage}`] ?? "https://tangoba.org/category/resultados/";
}

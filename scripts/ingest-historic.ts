/**
 * One-shot local ingest for completed 2024 and 2025 archives.
 * Reads PDFs already harvested under data/raw/{category}/{year}/ — no network.
 */
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Category, Dataset, Stage } from "../src/types.ts";
import { parsePdfFile } from "./parse-pdf.ts";
import { applyAdvancement } from "./qualify.ts";
import {
  SOURCE_CATEGORY_PAGE,
  buildDataset,
  catalogEntryFrom,
  mergeCatalog,
  sourcePageFor,
  writeYearOutputs,
} from "./year-io.ts";
import { attachOverallScores } from "./overall.ts";
import { generateSurvival } from "./survival.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_ROOT = join(ROOT, "data", "raw");
const PROCESSED_DIR = join(ROOT, "data", "processed");
const PUBLIC_DATA_DIR = join(ROOT, "public", "data");

type HistoricYear = 2024 | 2025;

interface StageFiles {
  stage: Stage;
  files: string[];
}

const PISTA_STAGES: Record<HistoricYear, StageFiles[]> = {
  2025: [
    {
      stage: "clasificatoria",
      files: [
        "clasificatoria-A.pdf",
        "clasificatoria-B.pdf",
        "clasificatoria-C.pdf",
        "clasificatoria-D.pdf",
      ],
    },
    { stage: "cuartos", files: ["cuartos-A.pdf", "cuartos-B.pdf"] },
    { stage: "semifinal", files: ["semifinal.pdf"] },
    { stage: "final", files: ["final.pdf"] },
  ],
  2024: [
    { stage: "clasificatoria", files: ["clasificatoria.pdf"] },
    { stage: "semifinal", files: ["semifinal.pdf"] },
    { stage: "final", files: ["final.pdf"] },
  ],
};

const ESCENARIO_STAGES: Record<HistoricYear, StageFiles[]> = {
  2025: [
    {
      stage: "clasificatoria",
      files: [
        "clasificatoria-A.pdf",
        "clasificatoria-B.pdf",
        "clasificatoria-C.pdf",
        "clasificatoria-D.pdf",
      ],
    },
    { stage: "cuartos", files: ["cuartos-A.pdf", "cuartos-B.pdf"] },
    { stage: "semifinal", files: ["semifinal.pdf"] },
    { stage: "final", files: ["final.pdf"] },
  ],
  2024: [
    { stage: "clasificatoria", files: ["clasificatoria.pdf"] },
    { stage: "semifinal", files: ["semifinal.pdf"] },
    { stage: "final", files: ["final.pdf"] },
  ],
};

interface SourcesFile {
  years?: Record<
    string,
    {
      pdfs?: { file: string; url: string; stage: string }[];
    }
  >;
}

async function pdfUrlMap(
  year: HistoricYear,
  category: Category,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const sourcesPath = join(RAW_ROOT, category, "sources.json");
  try {
    const raw = await import("node:fs/promises").then((fs) =>
      fs.readFile(sourcesPath, "utf8"),
    );
    const sources = JSON.parse(raw) as SourcesFile;
    for (const pdf of sources.years?.[String(year)]?.pdfs ?? []) {
      const name = pdf.file.replace(`${year}/`, "");
      map.set(name, pdf.url);
    }
  } catch {
    /* sources.json optional for URLs */
  }
  return map;
}

async function ingestYear(
  year: HistoricYear,
  category: Category,
): Promise<Dataset[]> {
  const dir = join(RAW_ROOT, category, String(year));
  const specs = category === "escenario" ? ESCENARIO_STAGES[year] : PISTA_STAGES[year];
  let existing: Set<string>;
  try {
    existing = new Set(
      (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".pdf")),
    );
  } catch {
    console.warn(`[${category} ${year}] No raw dir ${dir} — skip year.`);
    return [];
  }
  const urls = await pdfUrlMap(year, category);
  const datasets: Dataset[] = [];

  console.log(`\n=== ${year} ${category} historic (local PDFs only) ===`);

  for (const spec of specs) {
    const parsed = [];
    for (const name of spec.files) {
      if (!existing.has(name)) {
        console.warn(`[${year} ${category} ${spec.stage}] Missing ${name} — skip file.`);
        continue;
      }
      const block = await parsePdfFile(join(dir, name), {
        year,
        stage: spec.stage,
        scoring: "simple",
        category,
        officialUrl: urls.get(name) ?? null,
      });
      console.log(
        `[${year} ${category} ${spec.stage}] Block ${block.id}: ${block.couples.length} couples, ${block.judges.length} judges (${name})`,
      );
      parsed.push(block);
    }
    if (!parsed.length) {
      console.log(`[${year} ${category} ${spec.stage}] No PDFs — skipping stage.`);
      continue;
    }
    const dataset = buildDataset(
      spec.stage,
      sourcePageFor(year, spec.stage, category),
      SOURCE_CATEGORY_PAGE,
      parsed,
      year,
      "simple",
      category,
    );
    datasets.push(dataset);
  }

  if (!datasets.length) return [];

  applyAdvancement(datasets);
  attachOverallScores(datasets);
  await writeYearOutputs(
    PROCESSED_DIR,
    PUBLIC_DATA_DIR,
    year,
    "simple",
    datasets,
    false,
    category,
  );
  await mergeCatalog(
    PUBLIC_DATA_DIR,
    catalogEntryFrom(
      year,
      "archive",
      "simple",
      true,
      datasets,
      category,
    ),
  );

  for (const d of datasets) {
    const inCount = d.rows.filter((r) => r.classified).length;
    const mismatches = d.mismatches.length;
    console.log(
      `[${year} ${category} ${d.stage}] ${d.rows.length} couples · ${inCount} qualified · ${d.blocks.length} block(s) · ${mismatches} avg mismatch(es)`,
    );
  }
  return datasets;
}

async function main(): Promise<void> {
  const years: HistoricYear[] = [2025, 2024];
  for (const year of years) {
    await ingestYear(year, "pista");
    await ingestYear(year, "escenario");
  }
  try {
    await generateSurvival("pista");
  } catch (err) {
    console.warn("Pista survival odds not updated:", err);
  }
  try {
    await generateSurvival("escenario");
  } catch (err) {
    console.warn("Escenario survival odds not updated:", err);
  }
  console.log("\nHistoric ingest complete (no remote fetch).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

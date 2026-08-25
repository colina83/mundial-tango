import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AverageMismatch,
  BlockSummary,
  Dataset,
  ScoreRow,
  Stage,
  StageEntry,
  StageManifest,
} from "../src/types.ts";
import { parsePdfFile } from "./parse-pdf.ts";
import { attachOverallRanks, qualifyBlock } from "./qualify.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = join(ROOT, "data", "raw");
const PROCESSED_DIR = join(ROOT, "data", "processed");
const PUBLIC_DATA_DIR = join(ROOT, "public", "data");

const USER_AGENT =
  "mundial-tango-unofficial/0.1 (fan companion of Tango BA Mundial de Baile 2026; not affiliated; +https://tangoba.org)";

const PDF_HREF_RE = /href=["']([^"']+\.pdf)["']/gi;

/**
 * Stage source configuration.
 * Cuartos/semifinal/final URLs are best-guess placeholders based on the clasificatoria URL
 * pattern (https://tangoba.org/resultados-{stage}-tango-de-pista-2026/).
 * Update these once Tango BA publishes the real URLs.
 */
export const STAGE_SOURCES: {
  stage: Stage;
  sourcePage: string;
  sourceCategoryPage: string;
}[] = [
  {
    stage: "clasificatoria",
    sourcePage:
      "https://tangoba.org/resultados-clasificatoria-tango-de-pista-2026/",
    sourceCategoryPage: "https://tangoba.org/category/resultados/",
  },
  {
    // TODO: update to real URL once Tango BA publishes cuartos results
    stage: "cuartos",
    sourcePage:
      "https://tangoba.org/resultados-cuartos-final-tango-de-pista-2026/",
    sourceCategoryPage: "https://tangoba.org/category/resultados/",
  },
  {
    // TODO: update to real URL once Tango BA publishes semifinal results
    stage: "semifinal",
    sourcePage:
      "https://tangoba.org/resultados-semifinal-tango-de-pista-2026/",
    sourceCategoryPage: "https://tangoba.org/category/resultados/",
  },
  {
    // TODO: update to real URL once Tango BA publishes final results
    stage: "final",
    sourcePage:
      "https://tangoba.org/resultados-final-tango-de-pista-2026/",
    sourceCategoryPage: "https://tangoba.org/category/resultados/",
  },
];

// Keep the original constants for backwards compatibility
export const SOURCE_PAGE = STAGE_SOURCES[0]!.sourcePage;
export const SOURCE_CATEGORY_PAGE = STAGE_SOURCES[0]!.sourceCategoryPage;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function absUrl(href: string, base: string): string {
  return new URL(href, base).toString();
}

function isSkippablePdf(url: string): boolean {
  const u = url.toLowerCase();
  if (u.includes("/2025/") || u.includes("2025") || u.includes("cbc25")) {
    return true;
  }
  return false;
}

function isLikelyResultsPdf(url: string): boolean {
  const u = url.toLowerCase();
  if (isSkippablePdf(url)) return false;
  return (
    u.includes("2026") &&
    (u.includes("clasificator") ||
      u.includes("cuartos") ||
      u.includes("semifinal") ||
      u.includes("final") ||
      u.includes("jurados") ||
      u.includes("pista") ||
      u.includes("escenario") ||
      u.includes("resultado"))
  );
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

function collectPdfUrls(html: string, pageUrl: string, strict: boolean): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(PDF_HREF_RE)) {
    const href = match[1];
    if (!href) continue;
    const url = absUrl(href, pageUrl);
    if (strict ? isLikelyResultsPdf(url) : !isSkippablePdf(url)) {
      urls.add(url);
    }
  }
  return [...urls];
}

async function downloadPdf(url: string, destPath: string): Promise<boolean> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/pdf",
    },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  await writeFile(destPath, buf);
  return true;
}

const SOURCE_INDEX_PATH = join(PROCESSED_DIR, "source-index.json");

/**
 * Stage-aware source index.
 * Keys are namespaced as "{stage}::{url}" to avoid collisions between stages
 * while remaining backwards-compatible with legacy keys (which have no "::" prefix).
 */
type SourceIndex = Record<string, { sha256: string; filename?: string }>;

async function readSourceIndex(): Promise<SourceIndex> {
  try {
    const raw = await readFile(SOURCE_INDEX_PATH, "utf8");
    return JSON.parse(raw) as SourceIndex;
  } catch {
    return {};
  }
}

async function writeSourceIndex(index: SourceIndex): Promise<void> {
  await writeFile(SOURCE_INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
}

/** Build a namespaced key for the source index for a given stage + URL. */
function indexKey(stage: Stage, url: string): string {
  return `${stage}::${url}`;
}

/**
 * Discover PDF links for a stage. Returns an empty set if the page 404s or
 * has no discoverable PDFs — the caller skips the stage gracefully.
 */
async function discoverStagePdfs(
  stage: Stage,
  sourcePage: string,
  sourceCategoryPage: string,
): Promise<Set<string>> {
  const found = new Set<string>();
  const pages = [
    { url: sourcePage, strict: false },
    { url: sourceCategoryPage, strict: true },
  ];
  for (const page of pages) {
    try {
      const html = await fetchText(page.url);
      for (const pdfUrl of collectPdfUrls(html, page.url, page.strict)) {
        found.add(pdfUrl);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("-> 404")) {
        console.log(
          `[${stage}] Source page not yet available (404): ${page.url} — skipping.`,
        );
      } else {
        console.warn(`[${stage}] Could not read ${page.url}:`, err);
      }
    }
    await sleep(800);
  }
  return found;
}

/**
 * Download/cache PDFs for a single stage. Returns the list of newly downloaded
 * filenames (empty if nothing changed).
 */
async function syncStagePdfs(
  stage: Stage,
  pdfUrls: Set<string>,
  index: SourceIndex,
): Promise<{ downloaded: string[]; stageRawDir: string }> {
  const stageRawDir = join(RAW_DIR, stage);
  await mkdir(stageRawDir, { recursive: true });

  const existing = await readdir(stageRawDir);
  const existingHashes = new Set<string>();
  for (const name of existing.filter((n) => n.toLowerCase().endsWith(".pdf"))) {
    const buf = new Uint8Array(await readFile(join(stageRawDir, name)));
    existingHashes.add(sha256(buf));
  }

  const downloaded: string[] = [];

  for (const pdfUrl of pdfUrls) {
    const filename = decodeURIComponent(basename(new URL(pdfUrl).pathname));
    const dest = join(stageRawDir, filename);
    const key = indexKey(stage, pdfUrl);
    const known = index[key];
    if (known && existingHashes.has(known.sha256)) {
      console.log(`[${stage}] Cached ${filename}`);
      continue;
    }
    if (existing.includes(filename)) {
      const buf = new Uint8Array(await readFile(dest));
      const hash = sha256(buf);
      existingHashes.add(hash);
      index[key] = { sha256: hash, filename };
      continue;
    }
    console.log(`[${stage}] Downloading ${pdfUrl}`);
    const tmp = join(stageRawDir, `.tmp-${filename}`);
    await downloadPdf(pdfUrl, tmp);
    const buf = new Uint8Array(await readFile(tmp));
    const hash = sha256(buf);
    const { unlink } = await import("node:fs/promises");
    await unlink(tmp).catch(() => undefined);
    index[key] = { sha256: hash, filename };
    if (existingHashes.has(hash)) {
      console.log(`[${stage}]   skip (same hash already in data/raw/${stage})`);
      continue;
    }
    await writeFile(dest, buf);
    existingHashes.add(hash);
    downloaded.push(filename);
    await sleep(800);
  }

  return { downloaded, stageRawDir };
}

function buildDataset(
  stage: Stage,
  sourcePage: string,
  sourceCategoryPage: string,
  blocks: Awaited<ReturnType<typeof parsePdfFile>>[],
): Dataset {
  const rows: ScoreRow[] = [];
  const mismatches: AverageMismatch[] = [];
  const summaries: BlockSummary[] = [];

  const ordered = [...blocks].sort((a, b) => a.id.localeCompare(b.id));

  for (const block of ordered) {
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
    year: 2026,
    stage,
    category: "pista",
    sourcePage,
    sourceCategoryPage,
    sourceLabel: "Tango BA",
    disclaimer:
      "Compañero extraoficial de fans. No afiliado a Tango BA ni al Mundial de Baile. Fuente: Tango BA.",
    blocks: summaries,
    rows,
    mismatches,
  };
}

async function ingestStage(
  stageConf: (typeof STAGE_SOURCES)[number],
  fetchRemote: boolean,
  index: SourceIndex,
): Promise<Dataset | null> {
  const { stage, sourcePage, sourceCategoryPage } = stageConf;
  console.log(`\n[${stage}] === Processing stage ===`);

  let stageRawDir = join(RAW_DIR, stage);

  if (fetchRemote) {
    const pdfUrls = await discoverStagePdfs(stage, sourcePage, sourceCategoryPage);
    if (pdfUrls.size === 0) {
      console.log(
        `[${stage}] No PDFs discovered — stage not yet published. Skipping.`,
      );

      // Check if we already have local PDFs for this stage from a prior run
      try {
        const existing = await readdir(stageRawDir);
        const localPdfs = existing.filter((n) => n.toLowerCase().endsWith(".pdf"));
        if (localPdfs.length === 0) return null;
        console.log(
          `[${stage}] Using ${localPdfs.length} cached local PDF(s) from prior ingest.`,
        );
      } catch {
        return null;
      }
    } else {
      const { downloaded, stageRawDir: dir } = await syncStagePdfs(
        stage,
        pdfUrls,
        index,
      );
      stageRawDir = dir;
      if (downloaded.length) {
        // Only log "detected for the first time" if previous dataset didn't exist
        const existingDataset = join(PROCESSED_DIR, `results-${stage}.json`);
        try {
          await readFile(existingDataset);
          console.log(`[${stage}] New PDFs: ${downloaded.join(", ")}`);
        } catch {
          console.log(
            `[${stage}] *** ${stage} results detected for the first time! New PDFs: ${downloaded.join(", ")}`,
          );
        }
      } else {
        console.log(`[${stage}] No new remote PDFs.`);
      }
    }
  } else {
    console.log(`[${stage}] Offline ingest — using data/raw/${stage} only.`);
  }

  let pdfs: string[];
  try {
    pdfs = (await readdir(stageRawDir)).filter((n) =>
      n.toLowerCase().endsWith(".pdf"),
    );
  } catch {
    // Dir doesn't exist yet for this stage
    pdfs = [];
  }

  if (!pdfs.length) {
    console.log(`[${stage}] No PDFs available — skipping.`);
    return null;
  }

  const parsed = [];
  for (const name of pdfs) {
    const block = await parsePdfFile(join(stageRawDir, name));
    console.log(
      `[${stage}] Block ${block.id}: ${block.couples.length} couples, ${block.judges.length} judges (${name})`,
    );
    parsed.push(block);
  }

  const dataset = buildDataset(stage, sourcePage, sourceCategoryPage, parsed);
  const json = `${JSON.stringify(dataset, null, 2)}\n`;
  await writeFile(join(PROCESSED_DIR, `results-${stage}.json`), json);
  await writeFile(join(PUBLIC_DATA_DIR, `results-${stage}.json`), json);
  console.log(`[${stage}] Written results-${stage}.json`);

  // Update source index with parsed PDF hashes
  for (const block of parsed) {
    if (block.url) {
      const key = indexKey(stage, block.url);
      index[key] = { sha256: block.sha256, filename: block.filename };
    }
  }

  return dataset;
}

async function main(): Promise<void> {
  const fetchRemote = !process.argv.includes("--offline");
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(PROCESSED_DIR, { recursive: true });
  await mkdir(PUBLIC_DATA_DIR, { recursive: true });

  const index = await readSourceIndex();
  const manifest: StageManifest = {
    updatedAt: new Date().toISOString(),
    stages: [],
  };

  // Summary for logging
  const stageResults: Record<string, "new" | "unchanged" | "unavailable"> = {};

  for (const stageConf of STAGE_SOURCES) {
    const dataset = await ingestStage(stageConf, fetchRemote, index);
    if (dataset) {
      const entry: StageEntry = {
        stage: dataset.stage,
        generatedAt: dataset.generatedAt,
        rowCount: dataset.rows.length,
      };
      manifest.stages.push(entry);
      stageResults[stageConf.stage] = "new";
    } else {
      stageResults[stageConf.stage] = "unavailable";
    }
  }

  await writeSourceIndex(index);

  // Write manifest
  await writeFile(
    join(PUBLIC_DATA_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`\nManifest written with ${manifest.stages.length} stage(s): ${manifest.stages.map((s) => s.stage).join(", ")}`);

  // Also keep backwards-compatible results.json pointing to clasificatoria
  const clasifDataset = manifest.stages.find((s) => s.stage === "clasificatoria");
  if (clasifDataset) {
    const clasifJson = await readFile(
      join(PROCESSED_DIR, "results-clasificatoria.json"),
      "utf8",
    );
    await writeFile(join(PROCESSED_DIR, "results.json"), clasifJson);
    await writeFile(join(PUBLIC_DATA_DIR, "results.json"), clasifJson);
    console.log("Backwards-compatible results.json updated from clasificatoria dataset.");
  }

  // Summary log
  console.log("\n=== Ingest summary ===");
  for (const [stage, status] of Object.entries(stageResults)) {
    const icon = status === "unavailable" ? "⏭" : "✓";
    console.log(`  ${icon} ${stage}: ${status}`);
  }

  // Self-check for clasificatoria
  const clasifFile = manifest.stages.find((s) => s.stage === "clasificatoria");
  if (clasifFile) {
    const clasifData = JSON.parse(
      await readFile(join(PROCESSED_DIR, "results-clasificatoria.json"), "utf8"),
    ) as { rows: { coupleId: number; average: number; officialAverage: number; classified: boolean; blockId: string }[] };
    const couple139 = clasifData.rows.find((r) => r.coupleId === 139);
    if (!couple139 || couple139.average !== 7.78) {
      throw new Error(
        `Couple 139 check failed: expected truncated average 7.780, got ${couple139?.average}`,
      );
    }
    console.log(
      `\nCouple 139 check: avg=${couple139.average} official=${couple139.officialAverage} classified=${couple139.classified} block=${couple139.blockId}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

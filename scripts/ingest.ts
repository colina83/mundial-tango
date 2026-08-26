import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dataset, Stage } from "../src/types.ts";
import { parsePdfFile } from "./parse-pdf.ts";
import {
  buildDataset,
  catalogEntryFrom,
  mergeCatalog,
  writeYearOutputs,
} from "./year-io.ts";
import { attachOverallScores } from "./overall.ts";
import { generateSurvival } from "./survival.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = join(ROOT, "data", "raw");
const PROCESSED_DIR = join(ROOT, "data", "processed");
const PUBLIC_DATA_DIR = join(ROOT, "public", "data");

const USER_AGENT =
  "mundial-tango-unofficial/0.1 (fan companion of Tango BA Mundial de Baile 2026; not affiliated; +https://tangoba.org)";

const PDF_HREF_RE = /href=["']([^"']+\.pdf)["']/gi;
const PAGE_HREF_RE = /href=["']([^"']+)["']/gi;

/**
 * Keywords that must appear in an article/page link for it to be considered a
 * results page for that stage (matched case-insensitively against the URL path).
 * The "final" stage additionally excludes paths containing "semifinal" in
 * collectStagePageLinks, so a simple "final" keyword is safe here.
 */
const STAGE_LINK_KEYWORDS: Record<Stage, string[]> = {
  clasificatoria: ["clasificator"],
  cuartos: ["cuartos"],
  semifinal: ["semifinal"],
  final: ["final"],
};

/**
 * Discovery pages that are scanned for article links pointing at result pages.
 * These are scraped to perform two-hop discovery: index page → result page → PDFs.
 */
const DISCOVERY_PAGES = [
  "https://tangoba.org/category/resultados/",
  "https://tangoba.org/festival-mundial/actividades-del-mundial/",
];

/**
 * Stage source configuration.
 * Cuartos/semifinal/final URLs are best-guess placeholders based on the clasificatoria URL
 * pattern (https://tangoba.org/resultados-{stage}-tango-de-pista-2026/).
 * The ingest pipeline also performs two-hop discovery from DISCOVERY_PAGES so that
 * the real URLs are found automatically once Tango BA publishes each stage's results.
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
    stage: "cuartos",
    sourcePage:
      "https://tangoba.org/resultados-cuartos-final-tango-de-pista-2026/",
    sourceCategoryPage: "https://tangoba.org/category/resultados/",
  },
  {
    stage: "semifinal",
    sourcePage:
      "https://tangoba.org/resultados-semifinal-tango-de-pista-2026/",
    sourceCategoryPage: "https://tangoba.org/category/resultados/",
  },
  {
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

/**
 * Collect all hrefs from an HTML page that look like Tango BA result page links
 * for the given stage (i.e., contain one of the stage's link keywords).
 * Filters out PDFs (handled separately), off-domain links, and anchor-only links.
 */
function collectStagePageLinks(html: string, pageUrl: string, stage: Stage): string[] {
  const base = new URL(pageUrl);
  const keywords = STAGE_LINK_KEYWORDS[stage];
  const links = new Set<string>();
  for (const match of html.matchAll(PAGE_HREF_RE)) {
    const href = match[1];
    if (!href || href.startsWith("#")) continue;
    // Skip PDF links — those are handled by collectPdfUrls
    if (href.toLowerCase().endsWith(".pdf")) continue;
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    // Same domain only
    if (url.hostname !== base.hostname) continue;
    const path = url.pathname.toLowerCase();
    // For the "final" stage, exclude paths that actually refer to "semifinal"
    if (stage === "final" && path.includes("semifinal")) continue;
    if (keywords.some((kw) => path.includes(kw))) {
      links.add(url.toString());
    }
  }
  return [...links];
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
 * Discover PDF links for a stage using a two-hop strategy:
 *   1. Try the hardcoded sourcePage directly.
 *   2. Scan DISCOVERY_PAGES for article links matching this stage's keywords,
 *      then follow each discovered link to collect PDFs.
 * Returns an empty set if no PDFs are found — the caller skips the stage gracefully.
 */
async function discoverStagePdfs(
  stage: Stage,
  sourcePage: string,
  sourceCategoryPage: string,
): Promise<Set<string>> {
  const found = new Set<string>();

  // --- Hop 1a: try the hardcoded sourcePage directly ---
  try {
    const html = await fetchText(sourcePage);
    for (const pdfUrl of collectPdfUrls(html, sourcePage, false)) {
      found.add(pdfUrl);
    }
    console.log(`[${stage}] sourcePage OK — found ${found.size} PDF(s) so far.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("-> 404")) {
      console.log(
        `[${stage}] Source page not yet available (404): ${sourcePage} — will rely on discovery pages.`,
      );
    } else {
      console.warn(`[${stage}] Could not read ${sourcePage}:`, err);
    }
  }
  await sleep(800);

  // --- Hop 1b: scan discovery pages for article links matching this stage ---
  const discoveryUrls = [
    ...DISCOVERY_PAGES,
    // Also include sourceCategoryPage in case it differs from the defaults
    ...(DISCOVERY_PAGES.includes(sourceCategoryPage) ? [] : [sourceCategoryPage]),
  ];

  const linkedResultPages = new Set<string>();
  for (const discoveryUrl of discoveryUrls) {
    try {
      const html = await fetchText(discoveryUrl);
      // Collect direct PDF links (strict mode — must look like a results PDF)
      for (const pdfUrl of collectPdfUrls(html, discoveryUrl, true)) {
        found.add(pdfUrl);
      }
      // Collect article/page links that match this stage's keywords
      for (const link of collectStagePageLinks(html, discoveryUrl, stage)) {
        if (link !== sourcePage) {
          linkedResultPages.add(link);
        }
      }
      console.log(
        `[${stage}] Discovery scan of ${discoveryUrl}: ${linkedResultPages.size} result page link(s) found.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("-> 404")) {
        console.log(
          `[${stage}] Discovery page not available (404): ${discoveryUrl} — skipping.`,
        );
      } else {
        console.warn(`[${stage}] Could not read discovery page ${discoveryUrl}:`, err);
      }
    }
    await sleep(800);
  }

  // --- Hop 2: follow discovered result-page links to find PDFs ---
  for (const resultPage of linkedResultPages) {
    try {
      const html = await fetchText(resultPage);
      const before = found.size;
      for (const pdfUrl of collectPdfUrls(html, resultPage, false)) {
        found.add(pdfUrl);
      }
      console.log(
        `[${stage}] Followed ${resultPage}: +${found.size - before} PDF(s).`,
      );
    } catch (err) {
      console.warn(`[${stage}] Could not read discovered result page ${resultPage}:`, err);
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

  const dataset = buildDataset(stage, sourcePage, sourceCategoryPage, parsed, 2026, "trimmed");
  console.log(`[${stage}] Parsed ${dataset.rows.length} couples.`);

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
  const datasets: Dataset[] = [];

  // Summary for logging
  const stageResults: Record<string, "new" | "unchanged" | "unavailable"> = {};

  for (const stageConf of STAGE_SOURCES) {
    const dataset = await ingestStage(stageConf, fetchRemote, index);
    if (dataset) {
      datasets.push(dataset);
      stageResults[stageConf.stage] = "new";
    } else {
      stageResults[stageConf.stage] = "unavailable";
    }
  }

  await writeSourceIndex(index);

  attachOverallScores(datasets);
  const manifest = await writeYearOutputs(
    PROCESSED_DIR,
    PUBLIC_DATA_DIR,
    2026,
    "trimmed",
    datasets,
    true,
  );
  await mergeCatalog(
    PUBLIC_DATA_DIR,
    catalogEntryFrom(2026, "live", "trimmed", false, datasets),
  );
  console.log(`\nManifest written with ${manifest.stages.length} stage(s): ${manifest.stages.map((s) => s.stage).join(", ")}`);

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

  try {
    await generateSurvival();
  } catch (err) {
    console.warn("Survival odds not updated:", err);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

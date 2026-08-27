import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Category, Dataset, Stage } from "../src/types.ts";
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

export interface StageSource {
  category: Category;
  stage: Stage;
  sourcePage: string;
  sourceCategoryPage: string;
}

const SOURCE_CATEGORY_PAGE = "https://tangoba.org/category/resultados/";

/**
 * Stage source configuration per category.
 * Later-stage URLs are best-guess placeholders; two-hop discovery fills in
 * the real links once Tango BA publishes each stage.
 */
export const STAGE_SOURCES: StageSource[] = [
  {
    category: "pista",
    stage: "clasificatoria",
    sourcePage:
      "https://tangoba.org/resultados-clasificatoria-tango-de-pista-2026/",
    sourceCategoryPage: SOURCE_CATEGORY_PAGE,
  },
  {
    category: "pista",
    stage: "cuartos",
    sourcePage:
      "https://tangoba.org/resultados-cuartos-final-tango-de-pista-2026/",
    sourceCategoryPage: SOURCE_CATEGORY_PAGE,
  },
  {
    category: "pista",
    stage: "semifinal",
    sourcePage:
      "https://tangoba.org/resultados-semifinal-tango-de-pista-2026/",
    sourceCategoryPage: SOURCE_CATEGORY_PAGE,
  },
  {
    category: "pista",
    stage: "final",
    sourcePage: "https://tangoba.org/resultados-final-tango-de-pista-2026/",
    sourceCategoryPage: SOURCE_CATEGORY_PAGE,
  },
  {
    category: "escenario",
    stage: "clasificatoria",
    sourcePage:
      "https://tangoba.org/resultados-clasificatoria-tango-escenario-2026/",
    sourceCategoryPage: SOURCE_CATEGORY_PAGE,
  },
  {
    category: "escenario",
    stage: "cuartos",
    sourcePage: "https://tangoba.org/resultados-cuartos-tango-escenario-2026/",
    sourceCategoryPage: SOURCE_CATEGORY_PAGE,
  },
  {
    category: "escenario",
    stage: "semifinal",
    sourcePage:
      "https://tangoba.org/resultados-semifinal-tango-escenario-2026/",
    sourceCategoryPage: SOURCE_CATEGORY_PAGE,
  },
  {
    category: "escenario",
    stage: "final",
    sourcePage: "https://tangoba.org/resultados-final-tango-escenario-2026/",
    sourceCategoryPage: SOURCE_CATEGORY_PAGE,
  },
];

export const PISTA_SOURCES = STAGE_SOURCES.filter((s) => s.category === "pista");
export const ESCENARIO_SOURCES = STAGE_SOURCES.filter(
  (s) => s.category === "escenario",
);

// Keep the original constants for backwards compatibility
export const SOURCE_PAGE = PISTA_SOURCES[0]!.sourcePage;
export { SOURCE_CATEGORY_PAGE };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function absUrl(href: string, base: string): string {
  return new URL(href, base).toString();
}

function isSharedJunkPdf(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("catalogo") ||
    u.includes("catálogo") ||
    u.includes("reglamento") ||
    u.includes("regulations") ||
    u.includes("rules-and") ||
    u.includes("rules_and") ||
    (u.includes("rules") && !u.includes("jurados")) ||
    u.includes("/campeonato/") ||
    u.includes("cbc-") ||
    u.includes("cbc26") ||
    u.includes("cbc25")
  );
}

/** Combined pista+escenario sheets cannot be assigned to either category. */
function isCombinedCategoryPdf(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes("pista") && u.includes("escenario");
}

export function isSkippablePdf(
  urlOrFilename: string,
  category: Category = "pista",
): boolean {
  const u = urlOrFilename.toLowerCase();
  if (u.includes("/2025/") || u.includes("2025") || u.includes("cbc25")) {
    return true;
  }
  if (isSharedJunkPdf(u) || isCombinedCategoryPdf(u)) return true;
  if (category === "pista") {
    return u.includes("escenario");
  }
  return !u.includes("escenario");
}

export function isLikelyResultsPdf(
  url: string,
  category: Category = "pista",
): boolean {
  const u = url.toLowerCase();
  if (isSkippablePdf(url, category)) return false;
  const looksLikeSheet =
    u.includes("jurados") ||
    u.includes("clasificator") ||
    u.includes("cuartos") ||
    u.includes("semifinal") ||
    (u.includes("final") &&
      (u.includes("pista") || u.includes("escenario") || u.includes("jurados"))) ||
    (u.includes("pista") && (u.includes("resultado") || u.includes("ronda"))) ||
    (u.includes("escenario") && (u.includes("resultado") || u.includes("ronda")));
  return u.includes("2026") && looksLikeSheet;
}

export function isStagePdfFilename(
  name: string,
  category: Category = "pista",
): boolean {
  return name.toLowerCase().endsWith(".pdf") && !isSkippablePdf(name, category);
}

function rawDirFor(category: Category, stage: Stage): string {
  return category === "escenario"
    ? join(RAW_DIR, "escenario", stage)
    : join(RAW_DIR, stage);
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

function collectPdfUrls(
  html: string,
  pageUrl: string,
  strict: boolean,
  category: Category,
): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(PDF_HREF_RE)) {
    const href = match[1];
    if (!href) continue;
    const url = absUrl(href, pageUrl);
    if (strict ? isLikelyResultsPdf(url, category) : !isSkippablePdf(url, category)) {
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
function collectStagePageLinks(
  html: string,
  pageUrl: string,
  stage: Stage,
  category: Category,
): string[] {
  const base = new URL(pageUrl);
  const keywords = STAGE_LINK_KEYWORDS[stage];
  const links = new Set<string>();
  for (const match of html.matchAll(PAGE_HREF_RE)) {
    const href = match[1];
    if (!href || href.startsWith("#")) continue;
    if (href.toLowerCase().endsWith(".pdf")) continue;
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (url.hostname !== base.hostname) continue;
    const path = url.pathname.toLowerCase();
    if (path.includes("/campeonato/") || path.includes("cbc-")) continue;
    const hasEscenario = path.includes("escenario");
    if (category === "pista" && hasEscenario) continue;
    if (category === "escenario" && !hasEscenario) continue;
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
 * Pista keys: "{stage}::{url}" (legacy).
 * Escenario keys: "escenario::{stage}::{url}".
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

function indexKey(category: Category, stage: Stage, url: string): string {
  return category === "escenario"
    ? `escenario::${stage}::${url}`
    : `${stage}::${url}`;
}

function logTag(category: Category, stage: Stage): string {
  return category === "pista" ? stage : `escenario/${stage}`;
}

/**
 * Discover PDF links for a stage using a two-hop strategy:
 *   1. Try the hardcoded sourcePage directly.
 *   2. Scan DISCOVERY_PAGES for article links matching this stage's keywords,
 *      then follow each discovered link to collect PDFs.
 * Returns an empty set if no PDFs are found — the caller skips the stage gracefully.
 */
async function discoverStagePdfs(
  category: Category,
  stage: Stage,
  sourcePage: string,
  sourceCategoryPage: string,
): Promise<Set<string>> {
  const found = new Set<string>();
  const tag = logTag(category, stage);

  try {
    const html = await fetchText(sourcePage);
    for (const pdfUrl of collectPdfUrls(html, sourcePage, true, category)) {
      found.add(pdfUrl);
    }
    console.log(`[${tag}] sourcePage OK — found ${found.size} PDF(s) so far.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("-> 404")) {
      console.log(
        `[${tag}] Source page not yet available (404): ${sourcePage} — will rely on discovery pages.`,
      );
    } else {
      console.warn(`[${tag}] Could not read ${sourcePage}:`, err);
    }
  }
  await sleep(800);

  const discoveryUrls = [
    ...DISCOVERY_PAGES,
    ...(DISCOVERY_PAGES.includes(sourceCategoryPage) ? [] : [sourceCategoryPage]),
  ];

  const linkedResultPages = new Set<string>();
  for (const discoveryUrl of discoveryUrls) {
    try {
      const html = await fetchText(discoveryUrl);
      for (const pdfUrl of collectPdfUrls(html, discoveryUrl, true, category)) {
        found.add(pdfUrl);
      }
      for (const link of collectStagePageLinks(html, discoveryUrl, stage, category)) {
        if (link !== sourcePage) {
          linkedResultPages.add(link);
        }
      }
      console.log(
        `[${tag}] Discovery scan of ${discoveryUrl}: ${linkedResultPages.size} result page link(s) found.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("-> 404")) {
        console.log(
          `[${tag}] Discovery page not available (404): ${discoveryUrl} — skipping.`,
        );
      } else {
        console.warn(`[${tag}] Could not read discovery page ${discoveryUrl}:`, err);
      }
    }
    await sleep(800);
  }

  for (const resultPage of linkedResultPages) {
    try {
      const html = await fetchText(resultPage);
      const before = found.size;
      for (const pdfUrl of collectPdfUrls(html, resultPage, true, category)) {
        found.add(pdfUrl);
      }
      console.log(
        `[${tag}] Followed ${resultPage}: +${found.size - before} PDF(s).`,
      );
    } catch (err) {
      console.warn(`[${tag}] Could not read discovered result page ${resultPage}:`, err);
    }
    await sleep(800);
  }

  return found;
}

async function syncStagePdfs(
  category: Category,
  stage: Stage,
  pdfUrls: Set<string>,
  index: SourceIndex,
): Promise<{ downloaded: string[]; stageRawDir: string }> {
  const tag = logTag(category, stage);
  const stageRawDir = rawDirFor(category, stage);
  await mkdir(stageRawDir, { recursive: true });

  const existing = await readdir(stageRawDir);
  const existingHashes = new Set<string>();
  for (const name of existing.filter((n) => isStagePdfFilename(n, category))) {
    const buf = new Uint8Array(await readFile(join(stageRawDir, name)));
    existingHashes.add(sha256(buf));
  }

  const downloaded: string[] = [];

  for (const pdfUrl of pdfUrls) {
    const filename = decodeURIComponent(basename(new URL(pdfUrl).pathname));
    if (isSkippablePdf(pdfUrl, category) || isSkippablePdf(filename, category)) {
      console.log(`[${tag}] Skipping excluded PDF ${filename}`);
      continue;
    }
    const dest = join(stageRawDir, filename);
    const key = indexKey(category, stage, pdfUrl);
    const known = index[key];
    if (known && existingHashes.has(known.sha256)) {
      console.log(`[${tag}] Cached ${filename}`);
      continue;
    }
    if (existing.includes(filename)) {
      const buf = new Uint8Array(await readFile(dest));
      const hash = sha256(buf);
      existingHashes.add(hash);
      index[key] = { sha256: hash, filename };
      continue;
    }
    console.log(`[${tag}] Downloading ${pdfUrl}`);
    const tmp = join(stageRawDir, `.tmp-${filename}`);
    await downloadPdf(pdfUrl, tmp);
    const buf = new Uint8Array(await readFile(tmp));
    const hash = sha256(buf);
    const { unlink } = await import("node:fs/promises");
    await unlink(tmp).catch(() => undefined);
    index[key] = { sha256: hash, filename };
    if (existingHashes.has(hash)) {
      console.log(`[${tag}]   skip (same hash already in ${stageRawDir})`);
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
  stageConf: StageSource,
  fetchRemote: boolean,
  index: SourceIndex,
): Promise<Dataset | null> {
  const { category, stage, sourcePage, sourceCategoryPage } = stageConf;
  const tag = logTag(category, stage);
  console.log(`\n[${tag}] === Processing stage ===`);

  let stageRawDir = rawDirFor(category, stage);

  if (fetchRemote) {
    const pdfUrls = await discoverStagePdfs(
      category,
      stage,
      sourcePage,
      sourceCategoryPage,
    );
    if (pdfUrls.size === 0) {
      console.log(
        `[${tag}] No PDFs discovered — stage not yet published. Skipping.`,
      );

      try {
        const existing = await readdir(stageRawDir);
        const localPdfs = existing.filter((n) => isStagePdfFilename(n, category));
        if (localPdfs.length === 0) return null;
        console.log(
          `[${tag}] Using ${localPdfs.length} cached local PDF(s) from prior ingest.`,
        );
      } catch {
        return null;
      }
    } else {
      const { downloaded, stageRawDir: dir } = await syncStagePdfs(
        category,
        stage,
        pdfUrls,
        index,
      );
      stageRawDir = dir;
      if (downloaded.length) {
        const existingDataset = join(
          category === "escenario"
            ? join(PROCESSED_DIR, "2026", "escenario")
            : PROCESSED_DIR,
          `results-${stage}.json`,
        );
        try {
          await readFile(existingDataset);
          console.log(`[${tag}] New PDFs: ${downloaded.join(", ")}`);
        } catch {
          console.log(
            `[${tag}] *** ${stage} results detected for the first time! New PDFs: ${downloaded.join(", ")}`,
          );
        }
      } else {
        console.log(`[${tag}] No new remote PDFs.`);
      }
    }
  } else {
    console.log(`[${tag}] Offline ingest — using ${stageRawDir} only.`);
  }

  let pdfs: string[];
  try {
    pdfs = (await readdir(stageRawDir)).filter((n) =>
      isStagePdfFilename(n, category),
    );
  } catch {
    pdfs = [];
  }

  if (!pdfs.length) {
    console.log(`[${tag}] No PDFs available — skipping.`);
    return null;
  }

  const parsed = [];
  for (const name of pdfs) {
    const block = await parsePdfFile(join(stageRawDir, name), {
      year: 2026,
      stage,
      scoring: "trimmed",
      category,
    });
    if (block.couples.length === 0) {
      console.log(`[${tag}] Skip empty PDF (not a score sheet): ${name}`);
      continue;
    }
    console.log(
      `[${tag}] Block ${block.id}: ${block.couples.length} couples, ${block.judges.length} judges (${name})`,
    );
    parsed.push(block);
  }

  if (!parsed.length) {
    console.log(`[${tag}] No usable score-sheet PDFs — skipping.`);
    return null;
  }

  const dataset = buildDataset(
    stage,
    sourcePage,
    sourceCategoryPage,
    parsed,
    2026,
    "trimmed",
    category,
  );
  console.log(`[${tag}] Parsed ${dataset.rows.length} couples.`);

  for (const block of parsed) {
    if (block.url) {
      const key = indexKey(category, stage, block.url);
      index[key] = { sha256: block.sha256, filename: block.filename };
    }
  }

  return dataset;
}

async function ingestCategory(
  category: Category,
  sources: StageSource[],
  fetchRemote: boolean,
  index: SourceIndex,
): Promise<void> {
  const datasets: Dataset[] = [];
  const stageResults: Record<string, "new" | "unchanged" | "unavailable"> = {};

  for (const stageConf of sources) {
    const dataset = await ingestStage(stageConf, fetchRemote, index);
    if (dataset) {
      datasets.push(dataset);
      stageResults[stageConf.stage] = "new";
    } else {
      stageResults[stageConf.stage] = "unavailable";
    }
  }

  if (!datasets.length) {
    console.log(`\n[${category}] No datasets — skipping write.`);
    return;
  }

  attachOverallScores(datasets);
  const manifest = await writeYearOutputs(
    PROCESSED_DIR,
    PUBLIC_DATA_DIR,
    2026,
    "trimmed",
    datasets,
    category === "pista",
    category,
  );
  await mergeCatalog(
    PUBLIC_DATA_DIR,
    catalogEntryFrom(2026, "live", "trimmed", false, datasets, category),
  );
  console.log(
    `\n[${category}] Manifest written with ${manifest.stages.length} stage(s): ${manifest.stages.map((s) => s.stage).join(", ")}`,
  );

  console.log(`\n=== ${category} ingest summary ===`);
  for (const [stage, status] of Object.entries(stageResults)) {
    const icon = status === "unavailable" ? "⏭" : "✓";
    console.log(`  ${icon} ${stage}: ${status}`);
  }

  if (category === "pista") {
    const clasifFile = manifest.stages.find((s) => s.stage === "clasificatoria");
    if (clasifFile) {
      const clasifData = JSON.parse(
        await readFile(join(PROCESSED_DIR, "results-clasificatoria.json"), "utf8"),
      ) as {
        rows: {
          coupleId: number;
          average: number;
          officialAverage: number;
          classified: boolean;
          blockId: string;
        }[];
      };
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
}

async function main(): Promise<void> {
  const fetchRemote = !process.argv.includes("--offline");
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(PROCESSED_DIR, { recursive: true });
  await mkdir(PUBLIC_DATA_DIR, { recursive: true });

  const index = await readSourceIndex();

  await ingestCategory("pista", PISTA_SOURCES, fetchRemote, index);
  await ingestCategory("escenario", ESCENARIO_SOURCES, fetchRemote, index);

  await writeSourceIndex(index);

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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

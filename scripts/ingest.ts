import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AverageMismatch, BlockSummary, Dataset, ScoreRow } from "../src/types.ts";
import { parsePdfFile } from "./parse-pdf.ts";
import { attachOverallRanks, qualifyBlock } from "./qualify.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = join(ROOT, "data", "raw");
const PROCESSED_DIR = join(ROOT, "data", "processed");
const PUBLIC_DATA_DIR = join(ROOT, "public", "data");

export const SOURCE_PAGE =
  "https://tangoba.org/resultados-clasificatoria-tango-de-pista-2026/";
export const SOURCE_CATEGORY_PAGE = "https://tangoba.org/category/resultados/";

const USER_AGENT =
  "mundial-tango-unofficial/0.1 (fan companion of Tango BA Mundial de Baile 2026; not affiliated; +https://tangoba.org)";

const PDF_HREF_RE = /href=["']([^"']+\.pdf)["']/gi;

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

const SOURCE_INDEX = join(PROCESSED_DIR, "source-index.json");

type SourceIndex = Record<string, { sha256: string; filename?: string }>;

async function readSourceIndex(): Promise<SourceIndex> {
  try {
    const raw = await readFile(SOURCE_INDEX, "utf8");
    return JSON.parse(raw) as SourceIndex;
  } catch {
    return {};
  }
}

async function writeSourceIndex(index: SourceIndex): Promise<void> {
  await writeFile(SOURCE_INDEX, `${JSON.stringify(index, null, 2)}\n`);
}

async function syncRemotePdfs(fetchRemote: boolean): Promise<string[]> {
  if (!fetchRemote) return [];
  const downloaded: string[] = [];
  const existing = await readdir(RAW_DIR);
  const existingHashes = new Set<string>();
  for (const name of existing.filter((n) => n.toLowerCase().endsWith(".pdf"))) {
    const buf = new Uint8Array(await readFile(join(RAW_DIR, name)));
    existingHashes.add(sha256(buf));
  }
  const index = await readSourceIndex();

  const pages = [
    { url: SOURCE_PAGE, strict: false },
    { url: SOURCE_CATEGORY_PAGE, strict: true },
  ];

  const found = new Set<string>();
  for (const page of pages) {
    try {
      const html = await fetchText(page.url);
      for (const pdfUrl of collectPdfUrls(html, page.url, page.strict)) {
        found.add(pdfUrl);
      }
    } catch (err) {
      console.warn(`Could not read ${page.url}:`, err);
    }
    await sleep(800);
  }

  for (const pdfUrl of found) {
    const filename = decodeURIComponent(basename(new URL(pdfUrl).pathname));
    const dest = join(RAW_DIR, filename);
    const known = index[pdfUrl];
    if (known && existingHashes.has(known.sha256)) {
      console.log("Cached", filename);
      continue;
    }
    if (existing.includes(filename)) {
      const buf = new Uint8Array(await readFile(dest));
      const hash = sha256(buf);
      existingHashes.add(hash);
      index[pdfUrl] = { sha256: hash, filename };
      continue;
    }
    console.log("Downloading", pdfUrl);
    const tmp = join(RAW_DIR, `.tmp-${filename}`);
    await downloadPdf(pdfUrl, tmp);
    const buf = new Uint8Array(await readFile(tmp));
    const hash = sha256(buf);
    const { unlink } = await import("node:fs/promises");
    await unlink(tmp).catch(() => undefined);
    index[pdfUrl] = { sha256: hash, filename };
    if (existingHashes.has(hash)) {
      console.log("  skip (same hash already in data/raw)");
      continue;
    }
    await writeFile(dest, buf);
    existingHashes.add(hash);
    downloaded.push(filename);
    await sleep(800);
  }

  await writeSourceIndex(index);
  return downloaded;
}

function buildDataset(blocks: Awaited<ReturnType<typeof parsePdfFile>>[]): Dataset {
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
    stage: "clasificatoria",
    category: "pista",
    sourcePage: SOURCE_PAGE,
    sourceCategoryPage: SOURCE_CATEGORY_PAGE,
    sourceLabel: "Tango BA",
    disclaimer:
      "Compañero extraoficial de fans. No afiliado a Tango BA ni al Mundial de Baile. Fuente: Tango BA.",
    blocks: summaries,
    rows,
    mismatches,
  };
}

async function main(): Promise<void> {
  const fetchRemote = !process.argv.includes("--offline");
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(PROCESSED_DIR, { recursive: true });
  await mkdir(PUBLIC_DATA_DIR, { recursive: true });

  if (fetchRemote) {
    try {
      const downloaded = await syncRemotePdfs(true);
      if (downloaded.length) console.log("New PDFs:", downloaded.join(", "));
      else console.log("No new remote PDFs.");
    } catch (err) {
      console.warn("Remote sync failed, continuing with local PDFs:", err);
    }
  } else {
    console.log("Offline ingest — using data/raw only.");
  }

  const pdfs = (await readdir(RAW_DIR)).filter((n) =>
    n.toLowerCase().endsWith(".pdf"),
  );
  if (!pdfs.length) throw new Error("No PDFs in data/raw");

  const parsed = [];
  for (const name of pdfs) {
    const block = await parsePdfFile(join(RAW_DIR, name));
    console.log(
      `Block ${block.id}: ${block.couples.length} couples, ${block.judges.length} judges (${name})`,
    );
    parsed.push(block);
  }

  const dataset = buildDataset(parsed);
  const json = `${JSON.stringify(dataset, null, 2)}\n`;
  await writeFile(join(PROCESSED_DIR, "results.json"), json);
  await writeFile(join(PUBLIC_DATA_DIR, "results.json"), json);

  const index = await readSourceIndex();
  for (const block of parsed) {
    if (block.url) {
      index[block.url] = { sha256: block.sha256, filename: block.filename };
    }
  }
  await writeSourceIndex(index);

  const couple139 = dataset.rows.find((r) => r.coupleId === 139);
  if (!couple139 || couple139.average !== 7.78) {
    throw new Error(
      `Couple 139 check failed: expected truncated average 7.780, got ${couple139?.average}`,
    );
  }
  console.log(
    `Couple 139 check: avg=${couple139.average} official=${couple139.officialAverage} classified=${couple139.classified} block=${couple139.blockId}`,
  );

  for (const block of dataset.blocks) {
    const pct = ((block.classifiedCount / block.coupleCount) * 100).toFixed(1);
    console.log(
      `  ${block.id} cutoff=${block.cutoff.toFixed(3)} classified=${block.classifiedCount}/${block.coupleCount} (${pct}%)`,
    );
  }
  console.log(`Mismatches vs printed PROMEDIO: ${dataset.mismatches.length}`);
  if (dataset.mismatches.length) {
    console.log(dataset.mismatches.slice(0, 12));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

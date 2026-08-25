import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { getDocumentProxy } from "unpdf";
import type { BlockId } from "../src/types.ts";
import { truncatedAverage } from "./qualify.ts";

export const KNOWN_JURIES: Record<BlockId, string[]> = {
  A: [
    "Demián García",
    "Carla Marano",
    "Pablo Inza",
    "Silvina Valz",
    "Hernán Alvarez Prieto",
  ],
  B: [
    "Verónica Alvarenga",
    "Roberto Zuccarino",
    "Sandra Messina",
    "Bárbara Ferreyra",
    "Aoniken Quiroga",
  ],
  C: [
    "Demián García",
    "Carla Marano",
    "Pablo Inza",
    "Silvina Valz",
    "Hernán Alvarez Prieto",
  ],
  D: [
    "Verónica Alvarenga",
    "Roberto Zuccarino",
    "Sandra Messina",
    "Bárbara Ferreyra",
    "Lucas Paez",
  ],
};

export const OFFICIAL_PDF_URLS: Record<string, string> = {
  "pista-clasificatorias-2026-23-08-A.pdf":
    "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Pista-Clasificatorias-2026-23_8-A-Copia-de-JURADOS-_-RONDAS-TODAS-238-A-1.pdf",
  "pista-clasificatorias-2026-23-08-B.pdf":
    "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Pista-Clasificatorias-2026-23_8-B-Copia-de-JURADOS-_-RONDAS-TODAS-23_8-B-1.pdf",
  "pista-clasificatorias-2026-24-08-C.pdf":
    "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Pista-Clasificatorias-2026-24_8-C-Copia-de-JURADOS-_-RONDAS-TODAS-248-C.pdf",
  "pista-clasificatorias-2026-24-08-D.pdf":
    "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Pista-Clasificatorias-2026-24_8-D-Copia-de-JURADOS-_-RONDAS-TODAS-248-D.pdf",
};

const MONTHS: Record<string, number> = {
  ENERO: 1,
  FEBRERO: 2,
  MARZO: 3,
  ABRIL: 4,
  MAYO: 5,
  JUNIO: 6,
  JULIO: 7,
  AGOSTO: 8,
  SEPTIEMBRE: 9,
  OCTUBRE: 10,
  NOVIEMBRE: 11,
  DICIEMBRE: 12,
};

const TITLE_RE =
  /CLASIFICATORIAS?\s*[-–]\s*(\d{1,2})\s+DE\s+([A-ZÁÉÍÓÚÑ]+)\s+([A-D])/i;

export interface ParsedCouple {
  coupleId: number;
  round: string;
  dancer1: string;
  dancer2: string;
  scores: number[];
  officialAverage: number;
  judges: { name: string; score: number; dropped: boolean }[];
  average: number;
  spread: number;
}

export interface ParsedBlock {
  id: BlockId;
  date: string;
  dateLabel: string;
  judges: string[];
  filename: string;
  url: string | null;
  sha256: string;
  couples: ParsedCouple[];
}

interface TextItem {
  str: string;
  x: number;
  y: number;
}

function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function clusterRows(items: TextItem[], yTol = 3.6): TextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextItem[][] = [];
  for (const item of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0]!.y - item.y) <= yTol) {
      last.push(item);
    } else {
      rows.push([item]);
    }
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

function parseScore(token: string): number | null {
  const normalized = token.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return n;
}

function looksLikeHeader(row: TextItem[]): boolean {
  const text = row.map((i) => i.str).join(" ").toUpperCase();
  return text.includes("RONDA") && text.includes("PAREJA");
}

function extractJudgesFromHeader(row: TextItem[]): string[] {
  const names: string[] = [];
  for (const item of row) {
    const s = item.str.trim();
    if (
      /^(RONDA|PAREJA|PROMEDIO|Nombre y Apellido|z)$/i.test(s) ||
      item.x < 400
    ) {
      continue;
    }
    names.push(s);
  }
  const split: string[] = [];
  for (const name of names) {
    const known = Object.values(KNOWN_JURIES)
      .flat()
      .find((j) => name.includes(j) && name !== j);
    if (known && name.length > known.length + 3) {
      const rest = name.replace(known, "").trim();
      if (rest) {
        split.push(known, rest);
        continue;
      }
    }
    split.push(name);
  }
  return split;
}

function isRoundToken(str: string): boolean {
  return /^\d+[A-Z]?$/i.test(str.trim());
}

function splitDancers(nameItems: TextItem[]): { dancer1: string; dancer2: string } | null {
  if (nameItems.length === 0) return null;
  if (nameItems.length === 1) {
    const parts = nameItems[0]!.str.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const mid = Math.ceil(parts.length / 2);
    return { dancer1: parts.slice(0, mid).join(" "), dancer2: parts.slice(mid).join(" ") };
  }
  if (nameItems.length === 2) {
    return {
      dancer1: nameItems[0]!.str.trim(),
      dancer2: nameItems[1]!.str.trim(),
    };
  }
  let gapAt = 0;
  let bestGap = -1;
  for (let i = 0; i < nameItems.length - 1; i++) {
    const gap = nameItems[i + 1]!.x - nameItems[i]!.x;
    if (gap > bestGap) {
      bestGap = gap;
      gapAt = i;
    }
  }
  return {
    dancer1: nameItems
      .slice(0, gapAt + 1)
      .map((i) => i.str.trim())
      .join(" "),
    dancer2: nameItems
      .slice(gapAt + 1)
      .map((i) => i.str.trim())
      .join(" "),
  };
}

function parseDataRow(
  row: TextItem[],
  judges: string[],
): ParsedCouple | null {
  const tokens = row.filter((i) => i.str.trim() && i.str.trim() !== "z");
  if (tokens.length < 6) return null;

  const roundTok = tokens.find((t) => t.x < 92 && isRoundToken(t.str));
  const coupleTok = tokens.find(
    (t) => t.x >= 88 && t.x < 150 && /^\d+$/.test(t.str.trim()),
  );
  if (!roundTok || !coupleTok || roundTok === coupleTok) return null;

  const round = roundTok.str.trim();
  const coupleId = Number(coupleTok.str.trim());
  if (!Number.isInteger(coupleId) || coupleId <= 0) return null;

  const numericFromEnd: { item: TextItem; n: number }[] = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const item = tokens[i]!;
    if (item === roundTok || item === coupleTok) break;
    const n = parseScore(item.str);
    if (n === null) break;
    numericFromEnd.unshift({ item, n });
  }

  if (numericFromEnd.length < 4) return null;

  const last = numericFromEnd[numericFromEnd.length - 1]!;
  const hasOfficial =
    last.item.x > 720 || /^\d+\.\d{3}$/.test(last.item.str.replace(",", "."));
  const officialAverage = hasOfficial ? last.n : NaN;
  const scores = (hasOfficial ? numericFromEnd.slice(0, -1) : numericFromEnd).map(
    (t) => t.n,
  );
  if (scores.length < 3 || scores.length > 9) return null;
  if (scores.some((s) => s < 4 || s > 10)) return null;

  const scoreXs = new Set(
    (hasOfficial ? numericFromEnd.slice(0, -1) : numericFromEnd).map(
      (t) => t.item,
    ),
  );
  const nameItems = tokens.filter(
    (t) => t !== roundTok && t !== coupleTok && !scoreXs.has(t) && t !== last.item,
  );
  const namesSplit = splitDancers(nameItems);
  if (!namesSplit?.dancer1 || !namesSplit.dancer2) return null;

  const { average, dropped } = truncatedAverage(scores);
  const names =
    judges.length === scores.length
      ? judges
      : scores.map((_, i) => judges[i] ?? `Jurado ${i + 1}`);

  return {
    coupleId,
    round,
    dancer1: namesSplit.dancer1,
    dancer2: namesSplit.dancer2,
    scores,
    officialAverage: Number.isFinite(officialAverage)
      ? officialAverage
      : average,
    judges: scores.map((score, i) => ({
      name: names[i]!,
      score,
      dropped: dropped[i]!,
    })),
    average,
    spread: roundSpread(scores),
  };
}

function roundSpread(scores: number[]): number {
  return Math.round((Math.max(...scores) - Math.min(...scores)) * 1000) / 1000;
}

export async function parsePdfFile(filePath: string): Promise<ParsedBlock> {
  const buf = await readFile(filePath);
  const bytes = new Uint8Array(buf);
  const digest = sha256(bytes);
  const doc = await getDocumentProxy(bytes);
  const filename = basename(filePath);

  let blockId: BlockId | null = null;
  let date = "2026-08-23";
  let dateLabel = "23 de agosto";
  let judges: string[] = [];
  const couples: ParsedCouple[] = [];
  const seen = new Set<number>();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const raw of content.items as Array<{
      str?: string;
      transform?: number[];
    }>) {
      const str = raw.str?.trim();
      if (!str || !raw.transform) continue;
      items.push({ str, x: raw.transform[4]!, y: raw.transform[5]! });
    }

    const rows = clusterRows(items);
    for (const row of rows) {
      const joined = row.map((i) => i.str).join(" ");
      const title = joined.match(TITLE_RE);
      if (title) {
        const day = title[1]!.padStart(2, "0");
        const monthName = title[2]!.toUpperCase().normalize("NFD").replace(
          /\p{M}/gu,
          "",
        );
        const month = MONTHS[monthName] ?? 8;
        blockId = title[3]!.toUpperCase() as BlockId;
        date = `2026-${String(month).padStart(2, "0")}-${day}`;
        dateLabel = `${Number(day)} de ${title[2]!.toLowerCase()}`;
        judges = KNOWN_JURIES[blockId] ?? judges;
      }

      if (looksLikeHeader(row)) {
        const parsedJudges = extractJudgesFromHeader(row);
        if (!blockId && parsedJudges.length) {
          judges = parsedJudges;
        } else if (parsedJudges.length >= 5 && !judges.length) {
          judges = parsedJudges;
        }
        continue;
      }

      if (!blockId) continue;
      const parsed = parseDataRow(row, KNOWN_JURIES[blockId] ?? judges);
      if (!parsed) continue;
      if (seen.has(parsed.coupleId)) continue;
      seen.add(parsed.coupleId);
      couples.push(parsed);
    }
  }

  if (!blockId) {
    const fromName = filename.match(/-([A-D])(?:\.pdf)?$/i);
    if (fromName) blockId = fromName[1]!.toUpperCase() as BlockId;
  }
  if (!blockId) {
    throw new Error(`Could not detect block for ${filename}`);
  }

  judges = KNOWN_JURIES[blockId] ?? judges;

  return {
    id: blockId,
    date,
    dateLabel,
    judges,
    filename,
    url: OFFICIAL_PDF_URLS[filename] ?? null,
    sha256: digest,
    couples,
  };
}

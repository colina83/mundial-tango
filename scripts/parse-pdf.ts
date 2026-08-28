import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { getDocumentProxy } from "unpdf";
import type { BlockId, Category, Scoring, Stage } from "../src/types.ts";
import { scoreAverage } from "./qualify.ts";

export const KNOWN_JURIES: Record<Exclude<BlockId, "_">, string[]> = {
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
  "Jurados-_-Escenario-Clasificatorias-2026-25_8-A-Copia-de-JURADOS-_-RONDAS-TODAS-258-A.pdf":
    "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Escenario-Clasificatorias-2026-25_8-A-Copia-de-JURADOS-_-RONDAS-TODAS-258-A.pdf",
  "Jurados-_-Escenario-Clasificatorias-2026-25_8-B-Copia-de-JURADOS-_-RONDAS-TODAS-258-B.pdf":
    "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Escenario-Clasificatorias-2026-25_8-B-Copia-de-JURADOS-_-RONDAS-TODAS-258-B.pdf",
  "Jurados-_-Escenario-Clasificatorias-2026-26_8-C-Copia-de-JURADOS-_-RONDAS-TODAS-268-C.pdf":
    "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Escenario-Clasificatorias-2026-26_8-C-Copia-de-JURADOS-_-RONDAS-TODAS-268-C.pdf",
  "Jurados-_-Escenario-Clasificatorias-2026-26_8-D-Copia-de-JURADOS-_-RONDAS-TODAS-268-D-1.pdf":
    "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Escenario-Clasificatorias-2026-26_8-D-Copia-de-JURADOS-_-RONDAS-TODAS-268-D-1.pdf",
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
  /(CLASIFICATORIAS?|CUARTOS|SEMIS?|FINAL)\s*[-–]?\s*(\d{1,2})\s+DE\s+([A-ZÁÉÍÓÚÑ]+)(?:\s+([A-D]))?/i;

const HEADER_SKIP =
  /^(RONDA|PAREJA|PROMEDIO|Nombre y Apellido|z|NOTA:|\*| \*\*|País de representación)$/i;

export interface ParsePdfOptions {
  year: number;
  stage: Stage;
  scoring: Scoring;
  category?: Category;
  officialUrl?: string | null;
  defaultDate?: string;
}

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

interface JudgeColumn {
  x: number;
  name: string;
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

export function tidyName(s: string): string {
  return s
    .replace(/([ÁÉÍÓÚáéíóúÑñ])\s+([a-zA-Z])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeHeader(row: TextItem[]): boolean {
  const text = row.map((i) => i.str).join(" ").toUpperCase();
  if (text.includes("RONDA") && text.includes("PAREJA")) return true;
  if (text.includes("PAREJA") && text.includes("PROMEDIO")) return true;
  if (text.includes("NOMBRE Y APELLIDO") && text.includes("PROMEDIO")) return true;
  return false;
}

function rowHasRound(row: TextItem[]): boolean {
  return row.some((i) => /^RONDA$/i.test(i.str.trim()));
}

function isRoundToken(str: string): boolean {
  return /^\d+[A-Z]?$/i.test(str.trim());
}

function splitMergedJudge(name: string): string[] {
  const cleaned = tidyName(name);
  const twoPlusTwo =
    /^([A-ZÁÉÍÓÚÑ][\p{L}'-]+ [A-ZÁÉÍÓÚÑ][\p{L}'-]+) ([A-ZÁÉÍÓÚÑ][\p{L}'-]+ [A-ZÁÉÍÓÚÑ][\p{L}'-]+)$/u.exec(
      cleaned,
    );
  if (twoPlusTwo) return [twoPlusTwo[1]!, twoPlusTwo[2]!];
  return [cleaned];
}

function splitDancers(nameItems: TextItem[]): { dancer1: string; dancer2: string } | null {
  const cleaned = nameItems
    .map((i) => ({ ...i, str: tidyName(i.str) }))
    .filter((i) => i.str);
  if (cleaned.length === 0) return null;
  if (cleaned.length === 1) {
    const parts = cleaned[0]!.str.split(/\s+/);
    if (parts.length < 2) return null;
    const mid = Math.ceil(parts.length / 2);
    return { dancer1: parts.slice(0, mid).join(" "), dancer2: parts.slice(mid).join(" ") };
  }
  if (cleaned.length === 2) {
    return {
      dancer1: cleaned[0]!.str,
      dancer2: cleaned[1]!.str,
    };
  }
  let gapAt = 0;
  let bestGap = -1;
  for (let i = 0; i < cleaned.length - 1; i++) {
    const gap = cleaned[i + 1]!.x - cleaned[i]!.x;
    if (gap > bestGap) {
      bestGap = gap;
      gapAt = i;
    }
  }
  return {
    dancer1: cleaned
      .slice(0, gapAt + 1)
      .map((i) => i.str)
      .join(" "),
    dancer2: cleaned
      .slice(gapAt + 1)
      .map((i) => i.str)
      .join(" "),
  };
}

function clusterJudgeColumns(items: TextItem[], xTol = 22): JudgeColumn[] {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const cols: TextItem[][] = [];
  for (const item of sorted) {
    const last = cols[cols.length - 1];
    if (last && Math.abs(last[0]!.x - item.x) <= xTol) {
      last.push(item);
    } else {
      cols.push([item]);
    }
  }
  const result: JudgeColumn[] = [];
  for (const col of cols) {
    const ordered = [...col].sort((a, b) => b.y - a.y);
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const item of ordered) {
      const t = tidyName(item.str);
      if (!t || HEADER_SKIP.test(t) || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      parts.push(t);
    }
    if (!parts.length) continue;
    const merged = tidyName(parts.join(" ")).replace(/^final tango pista\s+/i, "");
    const split = splitMergedJudge(merged);
    const x = col.reduce((s, i) => s + i.x, 0) / col.length;
    if (split.length === 1) {
      result.push({ x, name: split[0]! });
    } else {
      result.push({ x, name: split[0]! }, { x: x + 18, name: split[1]! });
    }
  }
  return result;
}

function extractJudgeColumns(
  pageItems: TextItem[],
  headerRow: TextItem[],
  firstDataY: number | null,
): JudgeColumn[] {
  const nameHeaders = headerRow.filter((i) => /nombre/i.test(i.str));
  const pais = headerRow.find((i) => /pa[ií]s/i.test(i.str));
  const promedio = headerRow.find((i) => /promedio/i.test(i.str));
  const rightmostName = nameHeaders.length
    ? Math.max(...nameHeaders.map((i) => i.x))
    : 200;
  const leftBound = pais ? pais.x + 50 : rightmostName + 40;
  const rightBound = promedio ? promedio.x - 8 : Infinity;
  const yFloor = firstDataY !== null ? firstDataY + 2 : -Infinity;
  const nota = pageItems.find((i) => /^NOTA/i.test(i.str.trim()));
  const yCeil = nota ? nota.y - 18 : Infinity;
  const candidates = pageItems.filter((i) => {
    if (i.y <= yFloor || i.y >= yCeil) return false;
    if (i.x < leftBound || i.x >= rightBound) return false;
    const s = i.str.trim();
    if (!s || HEADER_SKIP.test(s)) return false;
    if (
      /simifinalistas|suplentes|resaltadas|amarillo|corresponde|jurados|^filas$|^resultados$|^nota:?$|final tango|mundial de tango|puntajes/i.test(
        s,
      )
    ) {
      return false;
    }
    if (parseScore(s) !== null) return false;
    return true;
  });
  return clusterJudgeColumns(candidates);
}

function assignJudgeNames(
  scoreXs: number[],
  columns: JudgeColumn[],
  fallback: string[],
  preferFallbackOrder: boolean,
): string[] {
  if (preferFallbackOrder && fallback.length === scoreXs.length) return fallback;
  if (columns.length) {
    const unused = [...columns];
    return scoreXs.map((x, i) => {
      if (!unused.length) return fallback[i] ?? `Jurado ${i + 1}`;
      let bestI = 0;
      let bestD = Infinity;
      for (let j = 0; j < unused.length; j++) {
        const d = Math.abs(unused[j]!.x - x);
        if (d < bestD) {
          bestD = d;
          bestI = j;
        }
      }
      const [col] = unused.splice(bestI, 1);
      return col?.name || fallback[i] || `Jurado ${i + 1}`;
    });
  }
  return scoreXs.map((_, i) => fallback[i] ?? `Jurado ${i + 1}`);
}

function parseDataRow(
  row: TextItem[],
  judgeColumns: JudgeColumn[],
  fallbackJudges: string[],
  scoring: Scoring,
  hasRoundColumn: boolean,
  preferFallbackOrder = false,
): ParsedCouple | null {
  const tokens = row.filter((i) => i.str.trim() && i.str.trim() !== "z");
  if (tokens.length < 4) return null;

  let round = "—";
  let coupleTok: TextItem | undefined;
  let roundTok: TextItem | undefined;

  if (hasRoundColumn) {
    roundTok = tokens.find((t) => t.x < 92 && isRoundToken(t.str));
    coupleTok = tokens.find(
      (t) => t.x >= 78 && t.x < 160 && /^\d+$/.test(t.str.trim()),
    );
    if (!roundTok || !coupleTok || roundTok === coupleTok) return null;
    round = roundTok.str.trim();
  } else {
    coupleTok = tokens.find((t) => t.x < 120 && /^\d+$/.test(t.str.trim()));
    if (!coupleTok) return null;
  }

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
    last.item.x > 600 || /^\d+[.,]\d{3}$/.test(last.item.str.trim());
  const officialAverage = hasOfficial ? last.n : NaN;
  const scoreToks = hasOfficial ? numericFromEnd.slice(0, -1) : numericFromEnd;
  const scores = scoreToks.map((t) => t.n);
  if (scores.length < 3 || scores.length > 12) return null;
  if (scores.some((s) => s < 4 || s > 10.001)) return null;

  const scoreItemSet = new Set(scoreToks.map((t) => t.item));
  if (hasOfficial) scoreItemSet.add(last.item);

  const nameItems = tokens.filter((t) => {
    if (t === roundTok || t === coupleTok || scoreItemSet.has(t)) return false;
    if (/pa[ií]s|represent/i.test(t.str)) return false;
    if (
      /^(argentina|agentina|russia|brasil|brazil|japon|japón|chile|uruguay|colombia|france|italia|italy|españa|spain|usa|méxico|mexico|perú|peru|alemania|germany|china|corea|korea)$/i.test(
        t.str.trim(),
      )
    ) {
      return false;
    }
    return true;
  });

  const namesSplit = splitDancers(nameItems);
  if (!namesSplit?.dancer1 || !namesSplit.dancer2) return null;

  const { average, dropped } = scoreAverage(scores, scoring);
  const names = assignJudgeNames(
    scoreToks.map((t) => t.item.x),
    judgeColumns,
    fallbackJudges,
    preferFallbackOrder,
  );

  return {
    coupleId,
    round,
    dancer1: namesSplit.dancer1,
    dancer2: namesSplit.dancer2,
    scores,
    officialAverage: Number.isFinite(officialAverage) ? officialAverage : average,
    judges: scores.map((score, i) => ({
      name: names[i] ?? `Jurado ${i + 1}`,
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

function blockFromFilename(filename: string): BlockId | null {
  const fromName = filename.match(/-([A-D])(?:\.pdf)?$/i);
  if (fromName) return fromName[1]!.toUpperCase() as BlockId;
  return null;
}

function defaultDateFor(
  year: number,
  stage: Stage,
  category: Category,
): { date: string; dateLabel: string } {
  const map: Record<string, { date: string; dateLabel: string }> = {
    "pista-2026-clasificatoria": { date: "2026-08-23", dateLabel: "23 de agosto" },
    "escenario-2026-clasificatoria": { date: "2026-08-25", dateLabel: "25 de agosto" },
    "pista-2025-clasificatoria": { date: "2025-08-23", dateLabel: "23 de agosto" },
    "escenario-2025-clasificatoria": { date: "2025-08-25", dateLabel: "25 de agosto" },
    "pista-2025-cuartos": { date: "2025-08-27", dateLabel: "27 de agosto" },
    "escenario-2025-cuartos": { date: "2025-08-28", dateLabel: "28 de agosto" },
    "pista-2025-semifinal": { date: "2025-08-29", dateLabel: "29 de agosto" },
    "escenario-2025-semifinal": { date: "2025-08-30", dateLabel: "30 de agosto" },
    "pista-2025-final": { date: "2025-09-01", dateLabel: "1 de septiembre" },
    "escenario-2025-final": { date: "2025-09-03", dateLabel: "3 de septiembre" },
    "pista-2024-clasificatoria": { date: "2024-08-20", dateLabel: "20 de agosto" },
    "escenario-2024-clasificatoria": { date: "2024-08-22", dateLabel: "22 de agosto" },
    "pista-2024-semifinal": { date: "2024-08-24", dateLabel: "24 de agosto" },
    "pista-2024-final": { date: "2024-08-28", dateLabel: "28 de agosto" },
    "escenario-2024-final": { date: "2024-08-28", dateLabel: "28 de agosto" },
  };
  return (
    map[`${category}-${year}-${stage}`] ??
    map[`pista-${year}-${stage}`] ?? { date: `${year}-08-01`, dateLabel: String(year) }
  );
}

export async function parsePdfFile(
  filePath: string,
  options?: Partial<ParsePdfOptions>,
): Promise<ParsedBlock> {
  const year = options?.year ?? 2026;
  const stage = options?.stage ?? "clasificatoria";
  const category: Category = options?.category ?? "pista";
  const scoring: Scoring = options?.scoring ?? (year === 2026 ? "trimmed" : "simple");
  const useKnownJuries = category === "pista" && year === 2026;

  const buf = await readFile(filePath);
  const bytes = new Uint8Array(buf);
  const digest = sha256(bytes);
  const doc = await getDocumentProxy(bytes);
  const filename = basename(filePath);

  const fallback = defaultDateFor(year, stage, category);
  let blockId: BlockId | null = blockFromFilename(filename);
  let date = options?.defaultDate ?? fallback.date;
  let dateLabel = fallback.dateLabel;
  let judgeColumns: JudgeColumn[] = [];
  let fallbackJudges: string[] = [];
  let hasRoundColumn = false;
  const couples: ParsedCouple[] = [];
  const seen = new Set<number>();

  const known =
    useKnownJuries && blockId && blockId !== "_"
      ? KNOWN_JURIES[blockId]
      : undefined;
  if (known) fallbackJudges = known;

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
    let headerRow: TextItem[] | null = null;
    let firstDataY: number | null = null;

    for (const row of rows) {
      const joined = row.map((i) => i.str).join(" ");
      const title = joined.match(TITLE_RE);
      if (title) {
        const day = title[2]!.padStart(2, "0");
        const monthName = title[3]!.toUpperCase().normalize("NFD").replace(
          /\p{M}/gu,
          "",
        );
        const month = MONTHS[monthName] ?? Number(date.slice(5, 7));
        if (title[4]) blockId = title[4]!.toUpperCase() as BlockId;
        date = `${year}-${String(month).padStart(2, "0")}-${day}`;
        dateLabel = `${Number(day)} de ${title[3]!.toLowerCase()}`;
        if (useKnownJuries && blockId && blockId !== "_") {
          fallbackJudges = KNOWN_JURIES[blockId] ?? fallbackJudges;
        }
      }
      if (looksLikeHeader(row)) {
        headerRow = row;
        if (rowHasRound(row)) hasRoundColumn = true;
      }
    }

    if (!hasRoundColumn) {
      hasRoundColumn = items.some((i) => /^RONDA$/i.test(i.str));
    }

    // Probe a data row to get firstDataY for judge extraction (page 1).
    if (p === 1 && headerRow) {
      for (const row of rows) {
        if (looksLikeHeader(row)) continue;
        const probe = parseDataRow(
          row,
          [],
          fallbackJudges,
          scoring,
          hasRoundColumn,
          useKnownJuries,
        );
        if (probe) {
          firstDataY = row[0]!.y;
          break;
        }
      }
      judgeColumns = extractJudgeColumns(items, headerRow, firstDataY);
      if (!judgeColumns.length) {
        judgeColumns = extractJudgeColumns(headerRow, headerRow, null);
      }
      if (useKnownJuries && blockId && blockId !== "_" && KNOWN_JURIES[blockId]) {
        fallbackJudges = KNOWN_JURIES[blockId];
      } else if (judgeColumns.length) {
        fallbackJudges = judgeColumns.map((c) => c.name);
      }
    }

    for (const row of rows) {
      if (looksLikeHeader(row)) continue;
      const parsed = parseDataRow(
        row,
        judgeColumns,
        useKnownJuries && blockId && blockId !== "_"
          ? (KNOWN_JURIES[blockId] ?? fallbackJudges)
          : fallbackJudges,
        scoring,
        hasRoundColumn,
        useKnownJuries,
      );
      if (!parsed) continue;
      if (seen.has(parsed.coupleId)) continue;
      seen.add(parsed.coupleId);
      couples.push(parsed);
    }
  }

  if (!blockId) {
    blockId = stage === "clasificatoria" || stage === "cuartos" ? "A" : "_";
    if (year === 2024) blockId = "_";
    if (stage === "semifinal" || stage === "final") blockId = "_";
  }

  const scoreCounts = new Map<number, number>();
  for (const c of couples) {
    scoreCounts.set(c.scores.length, (scoreCounts.get(c.scores.length) ?? 0) + 1);
  }
  let modalCount = 0;
  let modalN = 0;
  for (const [n, count] of scoreCounts) {
    if (count > modalCount) {
      modalCount = count;
      modalN = n;
    }
  }
  if (scoring === "simple" && modalN >= 5) {
    for (const couple of couples) {
      if (couple.scores.length >= modalN) continue;
      const sum = couple.scores.reduce((a, b) => a + b, 0);
      const padded = Math.round((sum / modalN) * 1000) / 1000;
      couple.average = padded;
      while (couple.judges.length < modalN) {
        couple.judges.push({
          name: `Jurado ${couple.judges.length + 1}`,
          score: 0,
          dropped: false,
        });
      }
    }
  }

  const full = couples.find((c) => c.scores.length >= modalN) ?? couples[0];
  const fromRow = full?.judges
    .map((j) => j.name)
    .filter((n) => !n.startsWith("Jurado"));
  const judges =
    useKnownJuries && blockId !== "_"
      ? (KNOWN_JURIES[blockId] ?? fallbackJudges)
      : fromRow?.length
        ? fromRow
        : fallbackJudges;

  return {
    id: blockId,
    date,
    dateLabel,
    judges,
    filename,
    url: options?.officialUrl ?? OFFICIAL_PDF_URLS[filename] ?? null,
    sha256: digest,
    couples,
  };
}

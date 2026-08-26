import type { ScoreRow } from "../types";

export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export function formatAverage(n: number): string {
  return n.toFixed(3);
}

export function formatDelta(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(3)}`;
}

/** Within-stage / composite percentile 0–100. */
export function formatOverall(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(1);
}

export function formatIngestTime(iso: string, locale: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function coupleName(row: ScoreRow): string {
  return `${row.dancer1} & ${row.dancer2}`;
}

export function matchesQuery(row: ScoreRow, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  if (String(row.coupleId).includes(q)) return true;
  if (fold(row.dancer1).includes(q)) return true;
  if (fold(row.dancer2).includes(q)) return true;
  if (fold(`${row.dancer1} ${row.dancer2}`).includes(q)) return true;
  if (fold(`${row.dancer1} & ${row.dancer2}`).includes(q)) return true;
  return false;
}

export function isDangerZone(
  rankInBlock: number,
  classified: boolean,
  coupleCount: number,
): boolean {
  const cutoffRank = Math.max(1, Math.ceil(coupleCount / 2));
  const band = Math.max(3, Math.round(cutoffRank * 0.1));
  if (classified) return rankInBlock > cutoffRank - band;
  return rankInBlock <= cutoffRank + band;
}

export function uniqueRounds(rows: ScoreRow[]): string[] {
  return [...new Set(rows.map((r) => r.round))].sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    return a.localeCompare(b, "en", { numeric: true });
  });
}

export function formatBlockDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

export function topThree(rows: ScoreRow[], blockId: ScoreRow["blockId"]): ScoreRow[] {
  return rows
    .filter((r) => r.blockId === blockId)
    .sort((a, b) => {
      if (b.average !== a.average) return b.average - a.average;
      return a.coupleId - b.coupleId;
    })
    .slice(0, 3);
}

import type { Category, Dataset, Stage, StageManifest, TrackedYear } from "../types";

export const TRACKED_YEARS: TrackedYear[] = [2026, 2025, 2024];

export function isTrackedYear(n: number): n is TrackedYear {
  return TRACKED_YEARS.includes(n as TrackedYear);
}

/** Pin/watchlist is for the live championship only. */
export function hasWatchlist(year: number): boolean {
  return year === 2026;
}

/** Cross-stage table is useful once more than one round exists, or always for the live year. */
export function hasFullCompetition(
  manifest: StageManifest | null | undefined,
  year?: number,
): boolean {
  if (year === 2026) return true;
  return (manifest?.stages.length ?? 0) > 1;
}

export const CATEGORIES: Category[] = ["pista", "escenario"];

export function isCategory(value: string | null | undefined): value is Category {
  return value === "pista" || value === "escenario";
}

export function yearPath(year: number, rest = "", category: Category = "pista"): string {
  const tail = rest.startsWith("/") ? rest : rest ? `/${rest}` : "";
  return `/${year}/${category}${tail}`;
}

export function hasDistinctBlocks(data: Dataset): boolean {
  return usableBlocks(data).some((b) => b.id !== "_");
}

/** Drop empty leftover blocks (catalog/rules/escenario PDFs parsed as Block A). */
export function usableBlocks(data: Dataset) {
  const byId = new Map<string, (typeof data.blocks)[number]>();
  for (const block of data.blocks) {
    if (block.coupleCount <= 0) continue;
    const prev = byId.get(block.id);
    if (!prev || block.coupleCount > prev.coupleCount) byId.set(block.id, block);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export const STAGE_ORDER: Stage[] = ["clasificatoria", "cuartos", "semifinal", "final"];

export function isStage(value: string | null | undefined): value is Stage {
  return !!value && (STAGE_ORDER as readonly string[]).includes(value);
}

export function visibleStages(year: number): Stage[] {
  if (year === 2024) return ["clasificatoria", "semifinal", "final"];
  return ["clasificatoria", "cuartos", "semifinal", "final"];
}

/**
 * Stages that actually have results. A later stage with the same couple
 * count as an earlier one is leftover ingest (cuartos PDFs saved as final).
 */
export function publishedStages(
  entries: { stage: Stage; rowCount: number }[] | null | undefined,
): Stage[] {
  const byStage = new Map((entries ?? []).map((s) => [s.stage, s.rowCount]));
  const out: Stage[] = [];
  const usedCounts = new Set<number>();
  for (const stage of STAGE_ORDER) {
    const n = byStage.get(stage) ?? 0;
    if (n <= 0) continue;
    if (usedCounts.has(n)) continue;
    usedCounts.add(n);
    out.push(stage);
  }
  return out;
}

export function publishedStagesFromCatalog(entry: {
  stages: Stage[];
  rowCounts?: Partial<Record<Stage, number>>;
}): Stage[] {
  return publishedStages(
    entry.stages.map((stage) => ({
      stage,
      rowCount: entry.rowCounts?.[stage] ?? 0,
    })),
  );
}

export function latestPublishedStage(
  year: number,
  entries: { stage: Stage; rowCount: number }[] | null | undefined,
): Stage {
  const allowed = new Set(visibleStages(year));
  const pub = publishedStages(entries).filter((s) => allowed.has(s));
  return pub[pub.length - 1] ?? "clasificatoria";
}

export function stageLabelKey(
  stage: Stage,
): "stageClasificatoria" | "stageCuartos" | "stageSemifinal" | "stageFinal" {
  if (stage === "cuartos") return "stageCuartos";
  if (stage === "semifinal") return "stageSemifinal";
  if (stage === "final") return "stageFinal";
  return "stageClasificatoria";
}

export function hasRealRounds(data: Dataset): boolean {
  return data.rows.some((r) => r.round && r.round !== "—");
}

export function isTrimmedScoring(data: Dataset): boolean {
  if (data.scoring) return data.scoring === "trimmed";
  return data.year === 2026;
}

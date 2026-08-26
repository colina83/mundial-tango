import type { Dataset, Stage, StageManifest, TrackedYear } from "../types";

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

export function yearPath(year: number, rest = ""): string {
  const tail = rest.startsWith("/") ? rest : rest ? `/${rest}` : "";
  return `/${year}${tail}`;
}

export function hasDistinctBlocks(data: Dataset): boolean {
  return data.blocks.some((b) => b.id !== "_");
}

export const STAGE_ORDER: Stage[] = ["clasificatoria", "cuartos", "semifinal", "final"];

export function isStage(value: string | null | undefined): value is Stage {
  return !!value && (STAGE_ORDER as readonly string[]).includes(value);
}

export function visibleStages(year: number): Stage[] {
  if (year === 2024) return ["clasificatoria", "semifinal", "final"];
  return ["clasificatoria", "cuartos", "semifinal", "final"];
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

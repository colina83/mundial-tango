import type { CoupleSurvival, Stage, SurvivalBestStage, YearSurvivalFile } from "../types";

export const SURVIVAL_DISCLAIMER =
  "Based on 2024–2025 couples with similar clasificatoria standing. Not a prediction of the champion.";

export function survivalByCoupleId(file: YearSurvivalFile | null): Map<number, CoupleSurvival> {
  const map = new Map<number, CoupleSurvival>();
  if (!file) return map;
  for (const row of file.couples) map.set(row.coupleId, row);
  return map;
}

export function formatSurvivalPct(p: number | null): string {
  if (p === null) return "—";
  return `${Math.round(p * 100)}%`;
}

export function survivalGates(file: YearSurvivalFile | null, year: number): Stage[] {
  if (file?.gates.length) return file.gates;
  if (year === 2024) return ["semifinal", "final"];
  return ["cuartos", "semifinal", "final"];
}

export function priorStageLabel(best: SurvivalBestStage): string {
  if (best === "final") return "finalist";
  if (best === "semifinal") return "semi";
  if (best === "cuartos") return "cuartos";
  return "clasificatoria only";
}

export function standingPhrase(
  kind: CoupleSurvival["standingKind"],
  decile: number,
  blockWord: string,
  fieldWord: string,
): string {
  const head = kind === "block" ? blockWord : fieldWord;
  if (decile === 9) return `${head} top 10%`;
  if (decile === 0) return `${head} bottom 10%`;
  return `${head} ${decile * 10}–${decile * 10 + 10}%`;
}

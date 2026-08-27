import type { BlockId, Category, Dataset, Stage } from "../types";
import { STAGE_ORDER } from "./year";

export interface StageCell {
  average: number;
  rank: number;
  percentile: number;
  blockId: BlockId;
}

export interface JourneyRow {
  coupleId: number;
  dancer1: string;
  dancer2: string;
  blockId: BlockId;
  overall: number | undefined;
  lastStageReached: Stage | undefined;
  byStage: Partial<Record<Stage, StageCell>>;
  champion: boolean;
}

const STAGE_PREF: Stage[] = ["clasificatoria", "cuartos", "semifinal", "final"];

export async function loadYearDatasets(
  year: number,
  stages: Stage[],
  category: Category = "pista",
): Promise<Dataset[]> {
  const out: Dataset[] = [];
  const prefix =
    category === "escenario"
      ? `${import.meta.env.BASE_URL}data/${year}/escenario`
      : `${import.meta.env.BASE_URL}data/${year}`;
  for (const stage of stages) {
    const yearUrl = `${prefix}/results-${stage}.json`;
    let res = await fetch(yearUrl);
    if (!res.ok && year === 2026 && category === "pista") {
      res = await fetch(`${import.meta.env.BASE_URL}data/results-${stage}.json`);
      if (!res.ok && stage === "clasificatoria") {
        res = await fetch(`${import.meta.env.BASE_URL}data/results.json`);
      }
    }
    if (!res.ok) continue;
    out.push((await res.json()) as Dataset);
  }
  return out;
}

export function buildJourneys(datasets: Dataset[]): JourneyRow[] {
  const byId = new Map<number, JourneyRow>();

  const ordered = [...datasets].sort(
    (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage),
  );

  for (const ds of ordered) {
    const n = ds.rows.length;
    for (const row of ds.rows) {
      let journey = byId.get(row.coupleId);
      if (!journey) {
        journey = {
          coupleId: row.coupleId,
          dancer1: row.dancer1,
          dancer2: row.dancer2,
          blockId: row.blockId,
          overall: row.overall,
          lastStageReached: row.lastStageReached,
          byStage: {},
          champion: false,
        };
        byId.set(row.coupleId, journey);
      }
      const percentile =
        row.stagePercentile ??
        (n <= 1 ? 100 : Math.round((1 - (row.rankOverall - 1) / (n - 1)) * 1000) / 10);
      journey.byStage[ds.stage] = {
        average: row.average,
        rank: row.rankOverall,
        percentile,
        blockId: row.blockId,
      };
      if (row.overall != null) journey.overall = row.overall;
      if (row.lastStageReached) journey.lastStageReached = row.lastStageReached;
    }
  }

  const finalDs = ordered.find((d) => d.stage === "final");
  const champId = finalDs?.rows.find((r) => r.rankOverall === 1)?.coupleId;

  for (const journey of byId.values()) {
    if (champId != null && journey.coupleId === champId) journey.champion = true;
    const nameSource =
      STAGE_PREF.map((s) => {
        const cell = journey.byStage[s];
        if (!cell) return null;
        const ds = ordered.find((d) => d.stage === s);
        return ds?.rows.find((r) => r.coupleId === journey.coupleId) ?? null;
      }).find(Boolean) ?? null;
    if (nameSource) {
      journey.dancer1 = nameSource.dancer1;
      journey.dancer2 = nameSource.dancer2;
    }
    const firstBlock =
      STAGE_PREF.map((s) => journey.byStage[s]?.blockId).find((id) => id && id !== "_") ??
      journey.blockId;
    journey.blockId = firstBlock;
    if (!journey.lastStageReached) {
      const danced = STAGE_ORDER.filter((s) => journey.byStage[s]);
      journey.lastStageReached = danced[danced.length - 1];
    }
  }

  return [...byId.values()];
}

export function dossierPath(year: number, row: JourneyRow, category: Category = "pista"): string {
  const stage = row.lastStageReached ?? "clasificatoria";
  const block = row.byStage[stage]?.blockId ?? row.blockId;
  return `/${year}/${category}/pareja/${block}/${row.coupleId}?stage=${stage}`;
}

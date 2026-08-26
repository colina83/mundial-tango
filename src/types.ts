export type Stage = "clasificatoria" | "cuartos" | "semifinal" | "final";
export type Category = "pista" | "escenario";
export type BlockId = "A" | "B" | "C" | "D" | "_";
export type Scoring = "trimmed" | "simple";
export type YearStatus = "live" | "archive";

export const TRACKED_YEARS = [2026, 2025, 2024] as const;
export type TrackedYear = (typeof TRACKED_YEARS)[number];

export interface JudgeScore {
  name: string;
  score: number;
  dropped: boolean;
}

/** One stage this couple actually danced, with within-stage percentile 0–100. */
export interface StageStanding {
  stage: Stage;
  average: number;
  percentile: number;
}

export interface ScoreRow {
  coupleId: number;
  round: string;
  dancer1: string;
  dancer2: string;
  judges: JudgeScore[];
  average: number;
  officialAverage: number;
  rankInBlock: number;
  rankOverall: number;
  classified: boolean;
  cutoffDelta: number;
  spread: number;
  blockId: BlockId;
  averageMismatch: boolean;
  /** Stage from which this couple originated (for cross-stage journey tracking). */
  originStage?: Stage;
  /** Within-stage rank percentile 0–100 among everyone in this stage this year. */
  stagePercentile?: number;
  /** Mean of within-stage percentiles across stages this couple danced. */
  overall?: number;
  lastStageReached?: Stage;
  /** Per-stage average + percentile for every round they danced (dossier). */
  stageStandings?: StageStanding[];
}

export interface SourcePdf {
  filename: string;
  url: string | null;
  sha256: string;
}

export interface BlockSummary {
  id: BlockId;
  date: string;
  dateLabel: string;
  judges: string[];
  sourcePdf: SourcePdf;
  cutoff: number;
  classifiedCount: number;
  coupleCount: number;
}

export interface AverageMismatch {
  coupleId: number;
  blockId: BlockId;
  computed: number;
  official: number;
}

export interface Dataset {
  generatedAt: string;
  year: number;
  stage: Stage;
  category: Category;
  scoring: Scoring;
  sourcePage: string;
  sourceCategoryPage: string;
  sourceLabel: string;
  disclaimer: string;
  blocks: BlockSummary[];
  rows: ScoreRow[];
  mismatches: AverageMismatch[];
}

export interface StageEntry {
  stage: Stage;
  generatedAt: string;
  /** Number of result rows available for this stage. */
  rowCount: number;
}

/** Manifest file written to public/data/{year}/manifest.json listing all available stages. */
export interface StageManifest {
  updatedAt: string;
  year: number;
  scoring: Scoring;
  stages: StageEntry[];
}

export interface CatalogYear {
  year: number;
  status: YearStatus;
  scoring: Scoring;
  complete: boolean;
  hasBlocks: boolean;
  stages: Stage[];
  rowCounts: Partial<Record<Stage, number>>;
}

/** Landing catalog at public/data/catalog.json */
export interface YearCatalog {
  updatedAt: string;
  years: CatalogYear[];
}

export type SurvivalModelKind = "lookup" | "logistic";
export type SurvivalMatch = "samePair" | "onePartner" | "none" | "collision";
export type SurvivalBestStage = "final" | "semifinal" | "cuartos" | "clasificatoria";
export type SpreadBand = "low" | "high";
export type StandingKind = "block" | "overall";

export interface SurvivalPrior {
  match: SurvivalMatch;
  year?: number;
  best?: SurvivalBestStage;
}

export interface SurvivalRealized {
  cuartos?: boolean;
  semifinal: boolean;
  final: boolean;
}

export interface CoupleSurvival {
  coupleId: number;
  blockId: BlockId;
  pCuartos: number | null;
  pSemi: number;
  pFinal: number;
  ciCuartos: [number, number] | null;
  ciSemi: [number, number];
  ciFinal: [number, number];
  cohortN: number;
  decile: number;
  standingKind: StandingKind;
  percentile: number;
  spread: number;
  spreadBand: SpreadBand | null;
  prior: SurvivalPrior;
  why: string;
  realized?: SurvivalRealized;
}

export interface YearSurvivalFile {
  year: number;
  generatedAt: string;
  model: SurvivalModelKind;
  disclaimer: string;
  gates: Stage[];
  couples: CoupleSurvival[];
}

export interface SurvivalBandRates {
  n: number;
  pCuartos: number | null;
  pSemi: number;
  pFinal: number;
}

export interface SurvivalDecileRow {
  decile: number;
  label: string;
  n: number;
  pCuartos: number | null;
  pSemi: number;
  pFinal: number;
  spreadMedian: number;
  low: SurvivalBandRates;
  high: SurvivalBandRates;
}

export interface GateScores {
  cuartos?: number;
  semifinal: number;
  final: number;
}

export interface SurvivalBacktest {
  chosen: SurvivalModelKind;
  reason: string;
  inSample2025: {
    lookup: GateScores;
    lookupSpread: GateScores;
    logistic: GateScores;
    eceLookup: GateScores;
    eceLogistic: GateScores;
  };
  leaveOneBlockOut2025: { lookup: GateScores; logistic: GateScores };
  walkForward2024to2025: {
    lookup: GateScores;
    logistic: GateScores;
    note: string;
  };
}

export interface SurvivalLogisticGate {
  intercept: number;
  coefficients: Record<string, number>;
  mean: Record<string, number>;
  sd: Record<string, number>;
}

export interface SurvivalModelFile {
  generatedAt: string;
  model: SurvivalModelKind;
  disclaimer: string;
  trainingYears: number[];
  deciles2025: SurvivalDecileRow[];
  deciles2024: SurvivalDecileRow[];
  logistic: {
    shipped: boolean;
    features: string[];
    gates: Partial<Record<"cuartos" | "semifinal" | "final", SurvivalLogisticGate>>;
  };
  backtest: SurvivalBacktest;
  wildcards: Record<string, { stage: Stage; unmatched: number; clasAdvanced: number }[]>;
}

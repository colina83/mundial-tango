export type Stage = "clasificatoria" | "cuartos" | "semifinal" | "final";
export type Category = "pista" | "escenario";
export type BlockId = "A" | "B" | "C" | "D";

export interface JudgeScore {
  name: string;
  score: number;
  dropped: boolean;
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

/** Manifest file written to public/data/manifest.json listing all available stages. */
export interface StageManifest {
  updatedAt: string;
  stages: StageEntry[];
}

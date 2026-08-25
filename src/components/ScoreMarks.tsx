import { useI18n } from "../context/I18nContext";
import type { ScoreRow } from "../types";

export function ScoreMarks({ row }: { row: ScoreRow }) {
  const { t } = useI18n();
  return (
    <div className="marks" aria-label={t("marks")}>
      {row.judges.map((j) => (
        <div
          key={j.name}
          className={`mark ${j.dropped ? "is-dropped" : ""}`}
          title={`${j.name}: ${j.score.toFixed(2)}`}
        >
          <span className="mark-judge">{j.name.split(" ")[0]}</span>
          <span className="mark-score">{j.score.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

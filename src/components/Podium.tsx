import { Link } from "react-router-dom";
import { useI18n } from "../context/I18nContext";
import { coupleName, formatAverage, topThree } from "../lib/format";
import type { BlockId, ScoreRow } from "../types";

const PLACE_KEYS = ["firstPlace", "secondPlace", "thirdPlace"] as const;

export function BlockPodium({
  blockId,
  rows,
  dateLabel,
}: {
  blockId: BlockId;
  rows: ScoreRow[];
  dateLabel?: string;
}) {
  const { t } = useI18n();
  const top = topThree(rows, blockId);
  const ordered = [top[1], top[0], top[2]];
  const places = [2, 1, 3];

  return (
    <article className="podium-block">
      <header className="podium-head">
        <h2>
          {t("block")} {blockId}
        </h2>
        {dateLabel && <span className="date-label">{dateLabel}</span>}
      </header>
      <div className="podium" aria-label={`${t("podium")} ${blockId}`}>
        {ordered.map((row, i) => {
          const place = places[i]!;
          if (!row) return <div key={place} className={`podium-place place-${place} is-empty`} />;
          return (
            <Link
              key={row.coupleId}
              to={`/pareja/${row.blockId}/${row.coupleId}`}
              className={`podium-place place-${place}`}
            >
              <span className="place-medal">{PLACE_KEYS[place - 1] ? t(PLACE_KEYS[place - 1]) : place}</span>
              <strong className="place-num">#{row.coupleId}</strong>
              <span className="place-names">{coupleName(row)}</span>
              <span className="place-avg">{formatAverage(row.average)}</span>
            </Link>
          );
        })}
      </div>
    </article>
  );
}

export function PodiumGrid({
  rows,
  blocks,
  stageLabel,
}: {
  rows: ScoreRow[];
  blocks: { id: BlockId; date?: string }[];
  stageLabel?: string;
}) {
  const { t, lang } = useI18n();
  const locale = lang === "es" ? "es-AR" : "en-GB";
  return (
    <section className="podium-section">
      <div className="podium-section-head">
        <h2>
          {t("podium")}
          {stageLabel && <span className="podium-stage-label"> · {stageLabel}</span>}
        </h2>
        <p className="muted">{t("podiumHint")}</p>
      </div>
      <div className="podium-grid">
        {blocks.map((block) => (
          <BlockPodium
            key={block.id}
            blockId={block.id}
            rows={rows}
            dateLabel={
              block.date
                ? new Intl.DateTimeFormat(locale, {
                    day: "numeric",
                    month: "short",
                  }).format(new Date(`${block.date}T12:00:00`))
                : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}

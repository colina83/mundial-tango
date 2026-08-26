import { Link } from "react-router-dom";
import { CoupleCard } from "../components/CoupleCard";
import { PodiumGrid } from "../components/Podium";
import { useData } from "../context/DataContext";
import { useI18n } from "../context/I18nContext";
import { useWatchlist } from "../context/WatchlistContext";
import {
  formatAverage,
  formatBlockDate,
  formatIngestTime,
} from "../lib/format";
import { classifiedTotal } from "../lib/stats";
import { hasDistinctBlocks, hasWatchlist, isTrimmedScoring, usableBlocks, yearPath } from "../lib/year";
import type { ScoreRow } from "../types";

export function Dashboard() {
  const { data, activeStage, year } = useData();
  const { t, lang } = useI18n();
  const { pins } = useWatchlist();
  if (!data) return null;

  const stageLabel: Record<string, string> = {
    clasificatoria: t("stageClasificatoria"),
    cuartos: t("stageCuartos"),
    semifinal: t("stageSemifinal"),
    final: t("stageFinal"),
  };

  const locale = lang === "es" ? "es-AR" : "en-GB";
  const showBlocks = hasDistinctBlocks(data);
  const trimmed = isTrimmedScoring(data);
  const showWatchlist = hasWatchlist(year);
  const base = yearPath(year);
  const blocks = usableBlocks(data);

  const watchRows = pins
    .filter((p) => p.year === year)
    .map((p) =>
      data.rows.find((r) => r.coupleId === p.coupleId && r.blockId === p.blockId),
    )
    .filter((r): r is ScoreRow => Boolean(r))
    .slice(0, 4);

  const inCount = classifiedTotal(data);

  const top5AllRounds = [...data.rows]
    .sort((a, b) => b.average - a.average)
    .slice(0, 5);

  const howTo =
    year === 2024 ? t("howToScore2024") : year === 2025 ? t("howToScore2025") : t("howToScore");

  return (
    <div className="page dashboard">
      <section className="hero-panel">
        <div className="hero-kicker">{t("liveStage")}</div>
        <h1>
          {stageLabel[activeStage] ?? t("stageClasificatoria")}
          <span> · {t("categoryPista")}</span>
        </h1>
        <p className="lede">{howTo}</p>
        <dl className="hero-meta">
          <div>
            <dt>{t("lastIngest")}</dt>
            <dd>{formatIngestTime(data.generatedAt, locale)}</dd>
          </div>
          <div>
            <dt>{t("classified")}</dt>
            <dd>
              {inCount} {t("of")} {data.rows.length}
            </dd>
          </div>
        </dl>
      </section>

      <PodiumGrid
        rows={data.rows}
        blocks={blocks.map((b) => ({ id: b.id, date: b.date }))}
        stageLabel={stageLabel[activeStage] ?? t("stageClasificatoria")}
        overall={!showBlocks}
      />

      {showBlocks && (
        <section className="block-grid">
          {blocks.map((block) => (
            <article key={block.id} className="panel block-card">
              <header>
                <h2>
                  {t("block")} {block.id}
                </h2>
                <a
                  href={block.sourcePdf.url ?? data.sourcePage}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("officialPdf")}
                </a>
              </header>
              <p className="date-label">{formatBlockDate(block.date, locale)}</p>
              <p className="cutoff-big">
                <span>{t("cutoff")}</span>
                {formatAverage(block.cutoff)}
              </p>
              <p className="classified-line">
                <strong>{block.classifiedCount}</strong> {t("classified")} {t("of")}{" "}
                {block.coupleCount}
              </p>
              <dl className="block-stats">
                {(() => {
                  const blockRows = data.rows.filter((r) => r.blockId === block.id);
                  const topScore = blockRows.length
                    ? Math.max(...blockRows.map((r) => r.average))
                    : null;
                  const lowestScore = blockRows.length
                    ? Math.min(...blockRows.map((r) => r.average))
                    : null;
                  return (
                    <>
                      <div>
                        <dt>{t("topScoreCutoff")}</dt>
                        <dd>{topScore !== null ? formatAverage(topScore) : "—"}</dd>
                      </div>
                      <div>
                        <dt>{t("lowestScore")}</dt>
                        <dd>{lowestScore !== null ? formatAverage(lowestScore) : "—"}</dd>
                      </div>
                    </>
                  );
                })()}
              </dl>
              <Link className="text-link" to={`${base}/rankings?block=${block.id}`}>
                {t("navRankings")} {block.id} →
              </Link>
            </article>
          ))}
        </section>
      )}

      <section className={showWatchlist ? "two-col" : undefined}>
        <article className="panel">
          <h2>{t("top5AllRounds")}</h2>
          <p className="muted">{t("top5Hint")}</p>
          <div className="card-list">
            {top5AllRounds.map((row) => {
              const count =
                data.blocks.find((b) => b.id === row.blockId)?.coupleCount ?? 0;
              return (
                <CoupleCard
                  key={`${row.blockId}-${row.coupleId}`}
                  row={row}
                  coupleCount={count}
                  showBoxplot={false}
                />
              );
            })}
          </div>
        </article>
        {showWatchlist && (
          <article className="panel">
            <h2>{t("watchPreview")}</h2>
            {watchRows.length === 0 ? (
              <div className="empty">
                <p>{t("watchEmpty")}</p>
                <Link className="btn" to={`${base}/rankings`}>
                  {t("watchCta")}
                </Link>
              </div>
            ) : (
              <div className="card-list">
                {watchRows.map((row) => {
                  const count =
                    data.blocks.find((b) => b.id === row.blockId)?.coupleCount ?? 0;
                  return (
                    <CoupleCard
                      key={`${row.blockId}-${row.coupleId}`}
                      row={row}
                      coupleCount={count}
                    />
                  );
                })}
                <Link className="text-link" to={`${base}/watchlist`}>
                  {t("navWatchlist")} →
                </Link>
              </div>
            )}
          </article>
        )}
      </section>
      <p className="footer-note">{trimmed ? t("footerNote") : t("footerNoteSimple")}</p>
      {year === 2026 && <p className="footer-note muted">{t("laterStages2026")}</p>}
    </div>
  );
}

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
  isDangerZone,
} from "../lib/format";
import { classifiedTotal } from "../lib/stats";
import type { ScoreRow } from "../types";

export function Dashboard() {
  const { data } = useData();
  const { t, lang } = useI18n();
  const { pins } = useWatchlist();
  if (!data) return null;

  const locale = lang === "es" ? "es-AR" : "en-GB";
  const watchRows = pins
    .map((p) =>
      data.rows.find((r) => r.coupleId === p.coupleId && r.blockId === p.blockId),
    )
    .filter((r): r is ScoreRow => Boolean(r))
    .slice(0, 4);

  const danger = data.blocks.flatMap((block) => {
    const rows = data.rows
      .filter((r) => r.blockId === block.id)
      .filter((r) => isDangerZone(r.rankInBlock, r.classified, block.coupleCount))
      .sort((a, b) => a.rankInBlock - b.rankInBlock);
    return rows;
  });

  const inCount = classifiedTotal(data);

  return (
    <div className="page dashboard">
      <section className="hero-panel">
        <div className="hero-kicker">{t("liveStage")}</div>
        <h1>
          {t("stageClasificatoria")}
          <span> · {t("categoryPista")}</span>
        </h1>
        <p className="lede">{t("howToScore")}</p>
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
        <p className="muted tiny">{t("ingestHint")}</p>
      </section>

      <PodiumGrid
        rows={data.rows}
        blocks={data.blocks.map((b) => ({ id: b.id, date: b.date }))}
      />

      <section className="block-grid">
        {data.blocks.map((block) => (
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
            <ul className="judge-chips">
              {block.judges.map((j) => (
                <li key={j}>{j}</li>
              ))}
            </ul>
            <Link className="text-link" to={`/rankings?block=${block.id}`}>
              {t("navRankings")} {block.id} →
            </Link>
          </article>
        ))}
      </section>

      <section className="two-col">
        <article className="panel">
          <h2>{t("dangerZone")}</h2>
          <p className="muted">{t("dangerHint")}</p>
          <div className="card-list">
            {danger.slice(0, 8).map((row) => {
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
          </div>
        </article>
        <article className="panel">
          <h2>{t("watchPreview")}</h2>
          {watchRows.length === 0 ? (
            <div className="empty">
              <p>{t("watchEmpty")}</p>
              <Link className="btn" to="/rankings">
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
              <Link className="text-link" to="/watchlist">
                {t("navWatchlist")} →
              </Link>
            </div>
          )}
        </article>
      </section>
      <p className="footer-note">{t("footerNote")}</p>
      <p className="footer-note muted">{t("laterStages")}</p>
    </div>
  );
}

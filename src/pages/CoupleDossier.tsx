import { Link, useParams } from "react-router-dom";
import { ScoreBoxplot } from "../components/ScoreBoxplot";
import { ScoreMarks } from "../components/ScoreMarks";
import { useData } from "../context/DataContext";
import { useI18n } from "../context/I18nContext";
import { useWatchlist } from "../context/WatchlistContext";
import {
  formatAverage,
  formatDelta,
  isDangerZone,
} from "../lib/format";
import type { BlockId } from "../types";

export function CoupleDossier() {
  const { blockId, coupleId } = useParams();
  const { data } = useData();
  const { t } = useI18n();
  const { isPinned, toggle } = useWatchlist();

  if (!data) return null;
  const row = data.rows.find(
    (r) => r.blockId === blockId && String(r.coupleId) === coupleId,
  );
  if (!row) {
    return (
      <div className="page">
        <div className="empty">
          <p>{t("coupleNotFound")}</p>
          <Link className="btn" to="/rankings">
            {t("backRankings")}
          </Link>
        </div>
      </div>
    );
  }

  const block = data.blocks.find((b) => b.id === row.blockId);
  const danger = block
    ? isDangerZone(row.rankInBlock, row.classified, block.coupleCount)
    : false;
  const pinned = isPinned(row.coupleId, row.blockId as BlockId);

  return (
    <div className="page dossier">
      <Link className="text-link" to="/rankings">
        ← {t("backRankings")}
      </Link>
      <section className="panel dossier-hero">
        <div className="dossier-id">
          <span className="block-flag">{t("block")} {row.blockId}</span>
          <h1>#{row.coupleId}</h1>
        </div>
        <p className="dossier-names">
          <span>{row.dancer1}</span>
          <span className="amp">&</span>
          <span>{row.dancer2}</span>
        </p>
        <div className="badges">
          {row.classified ? (
            <span className="badge badge-pink">{t("classifiedBadge")}</span>
          ) : (
            <span className="badge">{t("outBadge")}</span>
          )}
          {danger && <span className="badge badge-danger">{t("dangerBadge")}</span>}
          {row.averageMismatch && (
            <span className="badge badge-danger">{t("mismatch")}</span>
          )}
        </div>
        <button
          type="button"
          className={`pin-btn ${pinned ? "is-on" : ""}`}
          onClick={() => toggle(row.coupleId, row.blockId)}
        >
          {pinned ? t("unpin") : t("pin")}
        </button>
      </section>

      <section className="panel">
        <h2>{t("marks")}</h2>
        <p className="muted">{t("droppedHint")}</p>
        <ScoreBoxplot row={row} size="hero" />
        <ScoreMarks row={row} />
        <p className="avg-xl">{formatAverage(row.average)}</p>
        <p className="muted tiny">
          {t("keptMarks")} · PROMEDIO {formatAverage(row.officialAverage)}
        </p>
      </section>

      <section className="stat-pills">
        <article className="panel">
          <h3>{t("rankInBlock")}</h3>
          <p className="big">
            {row.rankInBlock}
            <span>/{block?.coupleCount ?? "—"}</span>
          </p>
        </article>
        <article className="panel">
          <h3>{t("rankOverall")}</h3>
          <p className="big">
            {row.rankOverall}
            <span>/{data.rows.length}</span>
          </p>
        </article>
        <article className="panel">
          <h3>{t("vsCutoff")}</h3>
          <p className={`big ${row.cutoffDelta >= 0 ? "delta-up" : "delta-down"}`}>
            {formatDelta(row.cutoffDelta)}
          </p>
          <p className="muted tiny">
            {row.cutoffDelta >= 0 ? t("aboveCutoff") : t("belowCutoff")} ·{" "}
            {t("cutoff")} {formatAverage(block?.cutoff ?? 0)}
          </p>
        </article>
        <article className="panel">
          <h3>
            {t("round")} {row.round}
          </h3>
          <p className="muted">
            {t("spread")} {row.spread.toFixed(2)}
          </p>
        </article>
      </section>

      {block?.sourcePdf.url && (
        <a
          className="btn"
          href={block.sourcePdf.url}
          target="_blank"
          rel="noreferrer"
        >
          {t("officialPdf")} · {t("source")}
        </a>
      )}
    </div>
  );
}

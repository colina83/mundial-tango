import { Link, useParams } from "react-router-dom";
import { ScoreBoxplot } from "../components/ScoreBoxplot";
import { ScoreMarks } from "../components/ScoreMarks";
import { Seo } from "../components/Seo";
import { SurvivalPanel } from "../components/SurvivalPanel";
import { useData } from "../context/DataContext";
import { useI18n } from "../context/I18nContext";
import { useWatchlist } from "../context/WatchlistContext";
import {
  formatAverage,
  formatDelta,
  formatOverall,
  isDangerZone,
} from "../lib/format";
import { survivalGates } from "../lib/survival";
import {
  hasDistinctBlocks,
  hasWatchlist,
  isTrimmedScoring,
  stageLabelKey,
  yearPath,
} from "../lib/year";
import type { BlockId } from "../types";

export function CoupleDossier() {
  const { blockId, coupleId } = useParams();
  const { data, year, category, survival, survivalById } = useData();
  const { t } = useI18n();
  const { isPinned, toggle } = useWatchlist();
  const base = yearPath(year, "", category);

  if (!data) return null;
  const row = data.rows.find(
    (r) => r.blockId === blockId && String(r.coupleId) === coupleId,
  );
  if (!row) {
    return (
      <div className="page">
        <div className="empty">
          <p>{t("coupleNotFound")}</p>
          <Link className="btn" to={`${base}/rankings`}>
            {t("backRankings")}
          </Link>
        </div>
      </div>
    );
  }

  const block = data.blocks.find((b) => b.id === row.blockId);
  const danger = block
    ? isDangerZone(row.rankInBlock, row.classified, block.classifiedCount)
    : false;
  const showPin = hasWatchlist(year);
  const pinned = showPin && isPinned(row.coupleId, row.blockId as BlockId, year, category);
  const showBlock = hasDistinctBlocks(data);
  const trimmed = isTrimmedScoring(data);
  const survivalRow = survivalById.get(row.coupleId);
  const gates = survivalGates(survival, year);

  return (
    <div className="page dossier">
      <Seo
        view="couple"
        year={year}
        category={category}
        stage={data.stage}
        coupleId={row.coupleId}
        dancer1={row.dancer1}
        dancer2={row.dancer2}
      />
      <Link className="text-link" to={`${base}/rankings`}>
        ← {t("backRankings")}
      </Link>
      <section className="panel dossier-hero">
        <div className="dossier-id">
          {showBlock && <span className="block-flag">{t("block")} {row.blockId}</span>}
          <strong>#{row.coupleId}</strong>
        </div>
        <h1 className="dossier-names">
          <span>{row.dancer1}</span>
          <span className="amp">&</span>
          <span>{row.dancer2}</span>
        </h1>
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
        {showPin && (
          <button
            type="button"
            className={`pin-btn ${pinned ? "is-on" : ""}`}
            onClick={() => toggle(row.coupleId, row.blockId, year, category)}
          >
            {pinned ? t("unpin") : t("pin")}
          </button>
        )}
      </section>

      {survivalRow && <SurvivalPanel row={survivalRow} gates={gates} />}

      {row.stageStandings && row.stageStandings.length > 0 && (
        <section className="panel overall-panel">
          <h2>{t("overall")}</h2>
          <p className="muted tiny">{t("overallHint")}</p>
          <table className="overall-breakdown">
            <thead>
              <tr>
                <th>{t("liveStage")}</th>
                <th>{t("average")}</th>
                <th>{t("percentile")}</th>
              </tr>
            </thead>
            <tbody>
              {row.stageStandings.map((s) => (
                <tr key={s.stage}>
                  <td>{t(stageLabelKey(s.stage))}</td>
                  <td className="num">{formatAverage(s.average)}</td>
                  <td className="num">{formatOverall(s.percentile)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{t("overall")}</th>
                <td />
                <th className="num">{formatOverall(row.overall)}</th>
              </tr>
            </tfoot>
          </table>
          {row.lastStageReached && (
            <p className="muted tiny">
              {t("lastStage")}: {t(stageLabelKey(row.lastStageReached))}
            </p>
          )}
        </section>
      )}

      <section className="panel">
        <h2>{t("marks")}</h2>
        <p className="muted">{trimmed ? t("droppedHint") : t("droppedHintSimple")}</p>
        <ScoreBoxplot row={row} size="hero" />
        <ScoreMarks row={row} />
        <p className="avg-xl">{formatAverage(row.average)}</p>
        <p className="muted tiny">
          {t("keptMarks")} · PROMEDIO {formatAverage(row.officialAverage)}
        </p>
      </section>

      <section className="stat-pills">
        <article className="panel">
          <h3>{showBlock ? t("rankInBlock") : t("rankOverall")}</h3>
          <p className="big">
            {showBlock ? row.rankInBlock : row.rankOverall}
            <span>/{block?.coupleCount ?? data.rows.length}</span>
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
            {row.round && row.round !== "—"
              ? `${t("round")} ${row.round}`
              : t("spread")}
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

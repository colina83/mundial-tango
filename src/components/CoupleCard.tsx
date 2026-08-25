import { Link } from "react-router-dom";
import { ScoreBoxplot } from "./ScoreBoxplot";
import { useI18n } from "../context/I18nContext";
import { useWatchlist } from "../context/WatchlistContext";
import { coupleName, formatAverage, formatDelta, isDangerZone } from "../lib/format";
import type { ScoreRow } from "../types";

export function CoupleCard({
  row,
  coupleCount,
  showBlock = true,
}: {
  row: ScoreRow;
  coupleCount: number;
  showBlock?: boolean;
}) {
  const { t } = useI18n();
  const { isPinned, toggle } = useWatchlist();
  const pinned = isPinned(row.coupleId, row.blockId);
  const danger = isDangerZone(row.rankInBlock, row.classified, coupleCount);

  return (
    <article className={`couple-card ${row.classified ? "is-in" : "is-out"}`}>
      <div className="couple-card-top">
        <Link to={`/pareja/${row.blockId}/${row.coupleId}`} className="couple-num">
          {row.coupleId}
        </Link>
        <div className="badges">
          {showBlock && <span className="badge"> {row.blockId}</span>}
          {row.classified ? (
            <span className="badge badge-pink">{t("classifiedBadge")}</span>
          ) : (
            <span className="badge">{t("outBadge")}</span>
          )}
          {danger && <span className="badge badge-danger">{t("dangerBadge")}</span>}
        </div>
      </div>
      <Link to={`/pareja/${row.blockId}/${row.coupleId}`} className="couple-names">
        {coupleName(row)}
      </Link>
      <div className="couple-meta">
        <span>
          {t("average")} <strong>{formatAverage(row.average)}</strong>
        </span>
        <span>
          {t("rank")} {row.rankInBlock}/{coupleCount}
        </span>
        <span>
          {t("spread")} <strong>{row.spread.toFixed(2)}</strong>
        </span>
        <span className={row.cutoffDelta >= 0 ? "delta-up" : "delta-down"}>
          {formatDelta(row.cutoffDelta)}
        </span>
      </div>
      <ScoreBoxplot row={row} size="card" />
      <button
        type="button"
        className={`pin-btn ${pinned ? "is-on" : ""}`}
        onClick={() => toggle(row.coupleId, row.blockId)}
      >
        {pinned ? t("unpin") : t("pin")}
      </button>
    </article>
  );
}

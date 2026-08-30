import { Link } from "react-router-dom";
import { ScoreBoxplot } from "./ScoreBoxplot";
import { useData } from "../context/DataContext";
import { useI18n } from "../context/I18nContext";
import { useWatchlist } from "../context/WatchlistContext";
import { coupleName, formatAverage, formatDelta, formatOverall, isDangerZone } from "../lib/format";
import { hasDistinctBlocks, hasWatchlist, yearPath } from "../lib/year";
import type { ScoreRow } from "../types";

export function CoupleCard({
  row,
  coupleCount,
  showBlock,
  showBoxplot = true,
}: {
  row: ScoreRow;
  coupleCount: number;
  showBlock?: boolean;
  showBoxplot?: boolean;
}) {
  const { t } = useI18n();
  const { year, data, category } = useData();
  const { isPinned, toggle } = useWatchlist();
  const showPin = hasWatchlist(year);
  const pinned = showPin && isPinned(row.coupleId, row.blockId, year, category);
  const classifiedCount =
    data?.blocks.find((b) => b.id === row.blockId)?.classifiedCount ?? coupleCount;
  const danger = isDangerZone(row.rankInBlock, row.classified, classifiedCount);
  const withBlock = showBlock ?? (data ? hasDistinctBlocks(data) : true);
  const href = `${yearPath(year, "", category)}/pareja/${row.blockId}/${row.coupleId}`;

  return (
    <article className={`couple-card ${row.classified ? "is-in" : "is-out"}`}>
      <div className="couple-card-top">
        <Link to={href} className="couple-num">
          {row.coupleId}
        </Link>
        <div className="badges">
          {withBlock && <span className="badge"> {row.blockId}</span>}
          {row.classified ? (
            <span className="badge badge-pink">{t("classifiedBadge")}</span>
          ) : (
            <span className="badge">{t("outBadge")}</span>
          )}
          {danger && <span className="badge badge-danger">{t("dangerBadge")}</span>}
        </div>
      </div>
      <Link to={href} className="couple-names">
        {coupleName(row)}
      </Link>
      <div className="couple-meta">
        <span>
          {t("average")} <strong>{formatAverage(row.average)}</strong>
        </span>
        {row.overall != null && (
          <span>
            {t("overall")} <strong>{formatOverall(row.overall)}</strong>
          </span>
        )}
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
      {showBoxplot && <ScoreBoxplot row={row} size="card" />}
      {showPin && (
        <button
          type="button"
          className={`pin-btn ${pinned ? "is-on" : ""}`}
          onClick={() => toggle(row.coupleId, row.blockId, year, category)}
        >
          {pinned ? t("unpin") : t("pin")}
        </button>
      )}
    </article>
  );
}

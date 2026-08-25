import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CoupleCard } from "../components/CoupleCard";
import { PodiumGrid } from "../components/Podium";
import { ScoreBoxplot } from "../components/ScoreBoxplot";
import { useData } from "../context/DataContext";
import { useI18n } from "../context/I18nContext";
import { useWatchlist } from "../context/WatchlistContext";
import {
  formatAverage,
  formatDelta,
  matchesQuery,
  uniqueRounds,
} from "../lib/format";
import type { BlockId, ScoreRow } from "../types";

type SortKey = "average" | "couple" | "spread";

export function Rankings() {
  const { data } = useData();
  const { t } = useI18n();
  const { isPinned, toggle } = useWatchlist();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");

  const block = (params.get("block") ?? "all") as BlockId | "all";
  const round = params.get("round") ?? "all";
  const classifiedOnly = params.get("in") === "1";
  const sort = (params.get("sort") ?? "average") as SortKey;

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === "all" || value === "") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.rows;
    if (block !== "all") list = list.filter((r) => r.blockId === block);
    if (round !== "all") list = list.filter((r) => r.round === round);
    if (classifiedOnly) list = list.filter((r) => r.classified);
    list = list.filter((r) => matchesQuery(r, query));
    const copy = [...list];
    copy.sort((a, b) => {
      if (sort === "couple") return a.coupleId - b.coupleId;
      if (sort === "spread") return b.spread - a.spread;
      if (b.average !== a.average) return b.average - a.average;
      return a.coupleId - b.coupleId;
    });
    return copy;
  }, [data, block, round, classifiedOnly, query, sort]);

  if (!data) return null;
  const rounds = uniqueRounds(
    block === "all" ? data.rows : data.rows.filter((r) => r.blockId === block),
  );
  const countFor = (row: ScoreRow) =>
    data.blocks.find((b) => b.id === row.blockId)?.coupleCount ?? 0;

  return (
    <div className="page rankings">
      <PodiumGrid
        rows={data.rows}
        blocks={
          block === "all"
            ? data.blocks.map((b) => ({ id: b.id, date: b.date }))
            : data.blocks
                .filter((b) => b.id === block)
                .map((b) => ({ id: b.id, date: b.date }))
        }
      />
      <div className="sticky-search">
        <input
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          type="search"
        />
        <div className="filters">
          <select
            value={block}
            onChange={(e) => setFilter("block", e.target.value)}
            aria-label={t("block")}
          >
            <option value="all">{t("allBlocks")}</option>
            {data.blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {t("block")} {b.id}
              </option>
            ))}
          </select>
          <select
            value={round}
            onChange={(e) => setFilter("round", e.target.value)}
            aria-label={t("round")}
          >
            <option value="all">{t("allRounds")}</option>
            {rounds.map((r) => (
              <option key={r} value={r}>
                {t("round")} {r}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setFilter("sort", e.target.value)}
            aria-label={t("sortAverage")}
          >
            <option value="average">{t("sortAverage")}</option>
            <option value="couple">{t("sortCouple")}</option>
            <option value="spread">{t("sortSpread")}</option>
          </select>
          <label className="check">
            <input
              type="checkbox"
              checked={classifiedOnly}
              onChange={(e) => setFilter("in", e.target.checked ? "1" : "")}
            />
            {t("classifiedOnly")}
          </label>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">{t("noResults")}</div>
      ) : (
        <>
          <div className="mobile-cards">
            {rows.map((row) => (
              <CoupleCard
                key={`${row.blockId}-${row.coupleId}`}
                row={row}
                coupleCount={countFor(row)}
              />
            ))}
          </div>
          <div className="desktop-table wrap">
            <table className="rank-table">
              <thead>
                <tr>
                  <th>{t("couple")}</th>
                  <th>{t("block")}</th>
                  <th>{t("dancers")}</th>
                  <th>{t("average")}</th>
                  <th>{t("marksSpread")}</th>
                  <th>{t("spread")}</th>
                  <th>{t("rank")}</th>
                  <th>{t("vsCutoff")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const pinned = isPinned(row.coupleId, row.blockId);
                  return (
                    <tr
                      key={`${row.blockId}-${row.coupleId}`}
                      className={row.classified ? "is-in" : ""}
                    >
                      <td>
                        <Link
                          className="couple-num"
                          to={`/pareja/${row.blockId}/${row.coupleId}`}
                        >
                          {row.coupleId}
                        </Link>
                      </td>
                      <td>{row.blockId}</td>
                      <td>
                        <Link to={`/pareja/${row.blockId}/${row.coupleId}`}>
                          {row.dancer1}
                          <span className="amp"> & </span>
                          {row.dancer2}
                        </Link>
                      </td>
                      <td className="num">{formatAverage(row.average)}</td>
                      <td className="boxplot-cell">
                        <ScoreBoxplot row={row} size="row" />
                      </td>
                      <td className="num">{row.spread.toFixed(2)}</td>
                      <td className="num">
                        {row.rankInBlock}
                        <span className="muted">/{countFor(row)}</span>
                      </td>
                      <td
                        className={`num ${row.cutoffDelta >= 0 ? "delta-up" : "delta-down"}`}
                      >
                        {formatDelta(row.cutoffDelta)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`pin-btn tiny ${pinned ? "is-on" : ""}`}
                          onClick={() => toggle(row.coupleId, row.blockId)}
                        >
                          {pinned ? "★" : "☆"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

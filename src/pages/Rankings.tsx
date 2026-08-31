import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Seo } from "../components/Seo";
import { CoupleCard } from "../components/CoupleCard";
import { ScoreBoxplot } from "../components/ScoreBoxplot";
import { SurvivalTicks } from "../components/SurvivalPanel";
import { useData } from "../context/DataContext";
import { useI18n } from "../context/I18nContext";
import { useWatchlist } from "../context/WatchlistContext";
import type { MessageKey } from "../i18n";
import {
  formatAverage,
  formatDelta,
  formatOverall,
  matchesQuery,
  uniqueRounds,
} from "../lib/format";
import {
  defaultSortDir,
  defaultSortKey,
  isSortKey,
  parseSortDir,
  sortRows,
  type SortKey,
} from "../lib/rank-sort";
import { hasDistinctBlocks, hasRealRounds, hasWatchlist, usableBlocks, yearPath } from "../lib/year";
import { survivalGates } from "../lib/survival";
import type { BlockId, ScoreRow } from "../types";

const SORT_LABEL: Record<SortKey, MessageKey> = {
  overall: "sortOverall",
  average: "sortAverage",
  couple: "sortCouple",
  dancers: "sortNames",
  block: "sortBlock",
  round: "sortRound",
  marks: "sortMarks",
  spread: "sortSpread",
  survival: "sortSurvival",
  rank: "sortRank",
  cutoff: "sortCutoff",
  classified: "sortClassified",
};

function SortHeader({
  label,
  column,
  active,
  dir,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  active: boolean;
  dir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const ariaSort = active ? (dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th className={className} aria-sort={ariaSort}>
      <button type="button" className="th-sort" onClick={() => onSort(column)}>
        {label}
        {active && <span className="sort-ind">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

export function Rankings() {
  const { data, year, category, activeStage, survival, survivalById } = useData();
  const { t } = useI18n();
  const { isPinned, toggle } = useWatchlist();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");

  const showBlocks = data ? hasDistinctBlocks(data) : false;
  const showRounds = data ? hasRealRounds(data) : false;
  const showSurvival = year === 2026 && !!survival;
  const showWatchlist = hasWatchlist(year);
  const blocks = data ? usableBlocks(data) : [];
  const showOverall = data?.rows.some((r) => r.overall != null) ?? false;
  const survivalStageGates = survivalGates(survival, year);
  const block = (params.get("block") ?? "all") as BlockId | "all";
  const round = params.get("round") ?? "all";
  const classifiedOnly = params.get("in") === "1";
  const rawSort = params.get("sort");
  const sort: SortKey = isSortKey(rawSort) ? rawSort : defaultSortKey(year, showOverall);
  const dir = parseSortDir(params.get("dir"), sort);
  const base = yearPath(year, "", category);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === "all" || value === "") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const setSort = (key: SortKey, nextDir?: "asc" | "desc") => {
    const next = new URLSearchParams(params);
    next.set("sort", key);
    next.set("dir", nextDir ?? defaultSortDir(key));
    setParams(next, { replace: true });
  };

  const onHeaderSort = (key: SortKey) => {
    if (sort === key) setSort(key, dir === "asc" ? "desc" : "asc");
    else setSort(key);
  };

  const sortOptions = useMemo(() => {
    const keys: SortKey[] = ["overall", "average", "couple", "dancers"];
    if (showBlocks) keys.push("block");
    if (showRounds) keys.push("round");
    keys.push("marks", "spread");
    if (showSurvival) keys.push("survival");
    keys.push("rank", "cutoff", "classified");
    if (!showOverall) return keys.filter((k) => k !== "overall");
    return keys;
  }, [showBlocks, showRounds, showSurvival, showOverall]);

  const activeSort = sortOptions.includes(sort)
    ? sort
    : defaultSortKey(year, showOverall);

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.rows;
    if (showBlocks && block !== "all") list = list.filter((r) => r.blockId === block);
    if (showRounds && round !== "all") list = list.filter((r) => r.round === round);
    if (classifiedOnly) list = list.filter((r) => r.classified);
    list = list.filter((r) => matchesQuery(r, query));
    return sortRows(list, activeSort, dir, survivalById);
  }, [
    data,
    block,
    round,
    classifiedOnly,
    query,
    activeSort,
    dir,
    showBlocks,
    showRounds,
    survivalById,
  ]);

  if (!data) return null;
  const rounds = uniqueRounds(
    block === "all" ? data.rows : data.rows.filter((r) => r.blockId === block),
  );
  const countFor = (row: ScoreRow) =>
    blocks.find((b) => b.id === row.blockId)?.coupleCount ?? 0;

  return (
    <div className="page rankings">
      <Seo view="rankings" year={year} category={category} stage={activeStage} />
      <header className="section-heading">
        <h1>
          {t("navRankings")} · {category === "pista" ? t("categoryPista") : t("categoryEscenario")} {year}
        </h1>
      </header>
      <div className="sticky-search">
        <input
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          type="search"
        />
        <div className="filters">
          {showBlocks && (
            <select
              value={block}
              onChange={(e) => setFilter("block", e.target.value)}
              aria-label={t("block")}
            >
              <option value="all">{t("allBlocks")}</option>
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {t("block")} {b.id}
                </option>
              ))}
            </select>
          )}
          {showRounds && (
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
          )}
          <select
            value={activeSort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label={t("sortBy")}
          >
            {sortOptions.map((key) => (
              <option key={key} value={key}>
                {t(SORT_LABEL[key])}
              </option>
            ))}
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
                  <SortHeader
                    label={t("couple")}
                    column="couple"
                    active={activeSort === "couple"}
                    dir={dir}
                    onSort={onHeaderSort}
                  />
                  {showBlocks && (
                    <SortHeader
                      label={t("block")}
                      column="block"
                      active={activeSort === "block"}
                      dir={dir}
                      onSort={onHeaderSort}
                    />
                  )}
                  {showRounds && (
                    <SortHeader
                      label={t("round")}
                      column="round"
                      active={activeSort === "round"}
                      dir={dir}
                      onSort={onHeaderSort}
                    />
                  )}
                  <SortHeader
                    label={t("dancers")}
                    column="dancers"
                    active={activeSort === "dancers"}
                    dir={dir}
                    onSort={onHeaderSort}
                  />
                  <SortHeader
                    label={t("average")}
                    column="average"
                    active={activeSort === "average"}
                    dir={dir}
                    onSort={onHeaderSort}
                  />
                  <SortHeader
                    label={t("marksSpread")}
                    column="marks"
                    active={activeSort === "marks"}
                    dir={dir}
                    onSort={onHeaderSort}
                  />
                  <SortHeader
                    label={t("spread")}
                    column="spread"
                    active={activeSort === "spread"}
                    dir={dir}
                    onSort={onHeaderSort}
                  />
                  {showOverall && (
                    <SortHeader
                      label={t("overall")}
                      column="overall"
                      active={activeSort === "overall"}
                      dir={dir}
                      onSort={onHeaderSort}
                    />
                  )}
                  {showSurvival && (
                    <SortHeader
                      label={t("survivalOdds")}
                      column="survival"
                      active={activeSort === "survival"}
                      dir={dir}
                      onSort={onHeaderSort}
                      className="surv-col"
                    />
                  )}
                  <SortHeader
                    label={t("rank")}
                    column="rank"
                    active={activeSort === "rank"}
                    dir={dir}
                    onSort={onHeaderSort}
                  />
                  <SortHeader
                    label={t("vsCutoff")}
                    column="cutoff"
                    active={activeSort === "cutoff"}
                    dir={dir}
                    onSort={onHeaderSort}
                  />
                  <SortHeader
                    label={t("sortClassified")}
                    column="classified"
                    active={activeSort === "classified"}
                    dir={dir}
                    onSort={onHeaderSort}
                  />
                  {showWatchlist && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const pinned = showWatchlist && isPinned(row.coupleId, row.blockId, year, category);
                  const surv = survivalById.get(row.coupleId);
                  return (
                    <tr
                      key={`${row.blockId}-${row.coupleId}`}
                      className={row.classified ? "is-in" : ""}
                    >
                      <td>
                        <Link
                          className="couple-num"
                          to={`${base}/pareja/${row.blockId}/${row.coupleId}`}
                        >
                          {row.coupleId}
                        </Link>
                      </td>
                      {showBlocks && <td>{row.blockId}</td>}
                      {showRounds && <td className="num">{row.round}</td>}
                      <td>
                        <Link to={`${base}/pareja/${row.blockId}/${row.coupleId}`}>
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
                      {showOverall && (
                        <td className="num">{formatOverall(row.overall)}</td>
                      )}
                      {showSurvival && (
                        <td className="surv-cell">
                          {surv ? (
                            <SurvivalTicks row={surv} gates={survivalStageGates} />
                          ) : null}
                        </td>
                      )}
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
                        {row.classified ? (
                          <span className="badge badge-pink">{t("classifiedBadge")}</span>
                        ) : (
                          <span className="badge">{t("outBadge")}</span>
                        )}
                      </td>
                      {showWatchlist && (
                        <td>
                          <button
                            type="button"
                            className={`pin-btn tiny ${pinned ? "is-on" : ""}`}
                            onClick={() => toggle(row.coupleId, row.blockId, year, category)}
                          >
                            {pinned ? "★" : "☆"}
                          </button>
                        </td>
                      )}
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

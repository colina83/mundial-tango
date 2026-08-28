import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useI18n } from "../context/I18nContext";
import { fold, formatAverage, formatOverall } from "../lib/format";
import {
  buildJourneys,
  dossierPath,
  loadYearDatasets,
  type JourneyRow,
} from "../lib/journey";
import { STAGE_ORDER, stageLabelKey, visibleStages } from "../lib/year";
import type { Stage } from "../types";

type SortKey = "couple" | "dancers" | "overall" | "last" | Stage;
type SortDir = "asc" | "desc";

function matchesJourney(row: JourneyRow, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  if (String(row.coupleId).includes(q)) return true;
  if (fold(row.dancer1).includes(q)) return true;
  if (fold(row.dancer2).includes(q)) return true;
  if (fold(`${row.dancer1} ${row.dancer2}`).includes(q)) return true;
  if (fold(`${row.dancer1} & ${row.dancer2}`).includes(q)) return true;
  return false;
}

function lastStageIndex(row: JourneyRow): number {
  if (!row.lastStageReached) return -1;
  return STAGE_ORDER.indexOf(row.lastStageReached);
}

function cmp(a: JourneyRow, b: JourneyRow, key: SortKey): number {
  if (key === "couple") return a.coupleId - b.coupleId;
  if (key === "dancers") {
    const d1 = fold(a.dancer1).localeCompare(fold(b.dancer1));
    if (d1 !== 0) return d1;
    return fold(a.dancer2).localeCompare(fold(b.dancer2));
  }
  if (key === "overall") return (a.overall ?? -1) - (b.overall ?? -1);
  if (key === "last") return lastStageIndex(a) - lastStageIndex(b);
  const av = a.byStage[key]?.average ?? -1;
  const bv = b.byStage[key]?.average ?? -1;
  return av - bv;
}

function TrajectorySpark({
  stages,
  row,
  large,
}: {
  stages: Stage[];
  row: JourneyRow;
  large?: boolean;
}) {
  const w = large ? 320 : 88;
  const h = large ? 88 : 28;
  const pad = large ? 8 : 3;
  const pts = stages
    .map((stage, i) => {
      const cell = row.byStage[stage];
      if (!cell) return null;
      const x = pad + (i / Math.max(1, stages.length - 1)) * (w - pad * 2);
      const y = pad + (1 - cell.percentile / 100) * (h - pad * 2);
      return { x, y, stage };
    })
    .filter((p): p is { x: number; y: number; stage: Stage } => p != null);
  if (pts.length === 0) return <span className="muted">—</span>;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg
      className={`traj-spark ${large ? "is-large" : ""}`}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-hidden
    >
      <line x1={pad} x2={w - pad} y1={pad} y2={pad} className="traj-guide" />
      <path d={d} className={row.champion ? "traj-line champ" : "traj-line"} />
      {pts.map((p) => (
        <circle key={p.stage} cx={p.x} cy={p.y} r={large ? 3.5 : 2} className="traj-dot" />
      ))}
    </svg>
  );
}

export function FullCompetition() {
  const { year, category, manifest } = useData();
  const { t } = useI18n();
  const [rows, setRows] = useState<JourneyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("overall");
  const [dir, setDir] = useState<SortDir>("desc");

  const stages = useMemo(() => {
    const available = new Set(manifest?.stages.map((s) => s.stage) ?? []);
    return visibleStages(year).filter((s) => available.has(s));
  }, [manifest, year]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    loadYearDatasets(year, stages, category)
      .then((datasets) => {
        if (!cancelled) setRows(buildJourneys(datasets));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [year, category, stages.join("|")]);

  const champion = rows?.find((r) => r.champion);
  const hasFinal = stages.includes("final");
  const leaderKicker = hasFinal ? t("fullLeader") : t("fullLeaderSoFar");

  const visible = useMemo(() => {
    if (!rows) return [];
    const filtered = rows.filter((r) => matchesJourney(r, query));
    const sign = dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const d = cmp(a, b, sort);
      if (d !== 0) return d * sign;
      return a.coupleId - b.coupleId;
    });
  }, [rows, query, sort, dir]);

  const onHeader = (key: SortKey) => {
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir(key === "couple" || key === "dancers" ? "asc" : "desc");
    }
  };

  const sortMark = (key: SortKey) =>
    sort === key ? (dir === "asc" ? " ▲" : " ▼") : "";

  if (error) {
    return (
      <div className="page">
        <div className="empty">{t("loadError")}</div>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="page">
        <div className="state-card">
          <p>{t("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page full-comp">
      <h1>{t("fullTitle")}</h1>
      <p className="muted">{t("fullHint")}</p>

      {champion && (
        <section className="panel champion-panel">
          <p className="champ-kicker">{leaderKicker}</p>
          <p className="muted tiny">{t("fullLeaderByAverage")}</p>
          <div className="champ-head">
            <Link className="couple-num" to={dossierPath(year, champion, category)}>
              #{champion.coupleId}
            </Link>
            <h2>
              {champion.dancer1} <span className="amp">&</span> {champion.dancer2}
            </h2>
          </div>
          <p className="muted tiny">{t("fullChampionPath")}</p>
          <TrajectorySpark stages={stages} row={champion} large />
          <div className="champ-stages">
            {stages.map((stage) => {
              const cell = champion.byStage[stage];
              return (
                <div key={stage} className={`champ-stage ${cell ? "has" : "miss"}`}>
                  <span className="champ-stage-label">{t(stageLabelKey(stage))}</span>
                  {cell ? (
                    <>
                      <strong>{formatAverage(cell.average)}</strong>
                      <span className="muted">
                        {t("fullRank").replace("{n}", String(cell.rank))} · {formatOverall(cell.percentile)}
                      </span>
                    </>
                  ) : (
                    <span className="muted">{t("fullDidNotDance")}</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="filters">
        <input
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          type="search"
        />
        <span className="muted tiny">
          {t("fullCount").replace("{n}", String(visible.length))}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="empty">{t("noResults")}</div>
      ) : (
        <div className="desktop-table wrap always-table">
          <table className="rank-table journey-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="th-sort" onClick={() => onHeader("couple")}>
                    {t("couple")}
                    {sortMark("couple")}
                  </button>
                </th>
                <th>
                  <button type="button" className="th-sort" onClick={() => onHeader("dancers")}>
                    {t("dancers")}
                    {sortMark("dancers")}
                  </button>
                </th>
                {stages.map((stage) => (
                  <th key={stage}>
                    <button type="button" className="th-sort" onClick={() => onHeader(stage)}>
                      {t(stageLabelKey(stage))}
                      {sortMark(stage)}
                    </button>
                  </th>
                ))}
                <th>
                  <button type="button" className="th-sort" onClick={() => onHeader("overall")}>
                    {t("overall")}
                    {sortMark("overall")}
                  </button>
                </th>
                <th>
                  <button type="button" className="th-sort" onClick={() => onHeader("last")}>
                    {t("lastStage")}
                    {sortMark("last")}
                  </button>
                </th>
                <th>{t("fullChampionPath")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.coupleId} className={row.champion ? "is-champion" : ""}>
                  <td>
                    <Link className="couple-num" to={dossierPath(year, row, category)}>
                      {row.coupleId}
                    </Link>
                  </td>
                  <td>
                    <Link to={dossierPath(year, row, category)}>
                      {row.dancer1}
                      <span className="amp"> & </span>
                      {row.dancer2}
                    </Link>
                  </td>
                  {stages.map((stage) => {
                    const cell = row.byStage[stage];
                    return (
                      <td key={stage} className={`num stage-cell ${cell ? "has" : "miss"}`}>
                        {cell ? (
                          <>
                            <span className="stage-avg">{formatAverage(cell.average)}</span>
                            <span className="stage-rank muted">
                              {t("fullRank").replace("{n}", String(cell.rank))}
                            </span>
                          </>
                        ) : (
                          t("fullDidNotDance")
                        )}
                      </td>
                    );
                  })}
                  <td className="num">{formatOverall(row.overall)}</td>
                  <td>
                    {row.lastStageReached ? t(stageLabelKey(row.lastStageReached)) : "—"}
                  </td>
                  <td>
                    <TrajectorySpark stages={stages} row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

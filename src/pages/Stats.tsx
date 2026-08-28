import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useI18n } from "../context/I18nContext";
import { formatAverage } from "../lib/format";
import { JudgeMarkHeatmap } from "../components/JudgeMarkHeatmap";
import { histogram, judgeStats, roundStats, topSpread } from "../lib/stats";
import { hasDistinctBlocks, hasRealRounds, isTrimmedScoring, usableBlocks, yearPath } from "../lib/year";
import type { BlockId } from "../types";

const PINK = "#f778ba";
const BLUE = "#58a6ff";
const GRID = "#30363d";
const TEXT = "#8b949e";

export function Stats() {
  const { data, year, category } = useData();
  const { t } = useI18n();
  const [block, setBlock] = useState<BlockId | "all">("all");
  const showBlocks = data ? hasDistinctBlocks(data) : false;
  const base = yearPath(year, "", category);
  const rows = useMemo(() => {
    if (!data) return [];
    return block === "all" ? data.rows : data.rows.filter((r) => r.blockId === block);
  }, [data, block]);
  const hist = useMemo(() => histogram(rows, 0.05), [rows]);
  const judges = useMemo(() => judgeStats(rows), [rows]);
  const rounds = useMemo(() => roundStats(rows).slice(0, 12), [rows]);
  const spread = useMemo(() => topSpread(rows, 10), [rows]);

  if (!data) return null;
  const blocks = usableBlocks(data);
  const cutoffs =
    block === "all" ? blocks : blocks.filter((b) => b.id === block);

  return (
    <div className="page stats">
      {showBlocks && (
        <div className="filters">
          <select
            value={block}
            onChange={(e) => setBlock(e.target.value as BlockId | "all")}
          >
            <option value="all">{t("allBlocks")}</option>
            {blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {t("block")} {b.id}
              </option>
            ))}
          </select>
        </div>
      )}

      <JudgeMarkHeatmap
        rows={rows}
        stage={data.stage}
        showDropped={isTrimmedScoring(data)}
      />

      <section className="panel chart-panel">
        <h2>{t("histogram")}</h2>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={hist} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: TEXT, fontSize: 10 }} interval={3} />
              <YAxis tick={{ fill: TEXT, fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "#161b22", border: `1px solid ${GRID}` }}
                labelStyle={{ color: "#e6edf3" }}
              />
              {cutoffs.map((b) => (
                <ReferenceLine
                  key={b.id}
                  x={closestLabel(hist, b.cutoff)}
                  stroke={PINK}
                  strokeDasharray="3 3"
                />
              ))}
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {hist.map((bin) => (
                  <Cell
                    key={bin.label}
                    fill={
                      cutoffs.some((c) => bin.start >= c.cutoff - 0.0001)
                        ? PINK
                        : BLUE
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ul className="cutoff-legend">
          {cutoffs.map((b) => (
            <li key={b.id}>
              {t("block")} {b.id}: {t("cutoff")} {formatAverage(b.cutoff)}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel chart-panel">
        <h2>{t("judgeLeniency")}</h2>
        <div className="chart-box tall">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={judges}
              layout="vertical"
              margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
            >
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" domain={["auto", "auto"]} tick={{ fill: TEXT, fontSize: 10 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={128}
                tick={{ fill: "#e6edf3", fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{ background: "#161b22", border: `1px solid ${GRID}` }}
              />
              <Bar dataKey="mean" fill={BLUE} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <h2>{t("controversy")}</h2>
          <ol className="rank-ol">
            {spread.map((row) => (
              <li key={`${row.blockId}-${row.coupleId}`}>
                <Link to={`${base}/pareja/${row.blockId}/${row.coupleId}`}>
                  <strong>#{row.coupleId}</strong> {row.dancer1} & {row.dancer2}
                </Link>
                <span>{row.spread.toFixed(2)}</span>
              </li>
            ))}
          </ol>
        </section>
        {hasRealRounds(data) && (
        <section className="panel">
          <h2>{t("hotRounds")}</h2>
          <ol className="rank-ol">
            {rounds.map((r) => (
              <li key={r.round}>
                <span>
                  {t("round")} {r.round}
                  <em>
                    {" "}
                    · {r.count} {t("couples")}
                  </em>
                </span>
                <span>{formatAverage(r.mean)}</span>
              </li>
            ))}
          </ol>
        </section>
        )}
      </div>
    </div>
  );
}

function closestLabel(
  hist: { start: number; label: string }[],
  cutoff: number,
): string | undefined {
  if (!hist.length) return undefined;
  let best = hist[0]!;
  for (const bin of hist) {
    if (Math.abs(bin.start - cutoff) < Math.abs(best.start - cutoff)) best = bin;
  }
  return best.label;
}

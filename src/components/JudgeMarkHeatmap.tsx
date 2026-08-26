import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "../context/I18nContext";
import {
  contrastText,
  coupleHeatLabel,
  formatRho,
  heatmapCells,
  judgeNamesFromRows,
  rhoFill,
  scoreFill,
  shortJudgeName,
  spearmanMatrix,
  stageScoreDomain,
  topByStageRank,
  type HeatCell,
  type SpearmanCell,
} from "../lib/judge-heatmap";
import type { ScoreRow, Stage } from "../types";

const GRID = "#30363d";
const TEXT = "#8b949e";
const TIP_STYLE = { background: "#161b22", border: `1px solid ${GRID}` } as const;

type PairBar = {
  key: string;
  label: string;
  rho: number;
  n: number;
  judgeA: string;
  judgeB: string;
};

function pairBars(cells: SpearmanCell[], judges: readonly string[]): PairBar[] {
  const seen = new Set<string>();
  const out: PairBar[] = [];
  for (const cell of cells) {
    if (cell.judgeA === cell.judgeB || cell.rho == null) continue;
    const a = judges.indexOf(cell.judgeA);
    const b = judges.indexOf(cell.judgeB);
    if (a < 0 || b < 0 || a >= b) continue;
    const key = `${cell.judgeA}|${cell.judgeB}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: `${cell.shortA} · ${cell.shortB}`,
      rho: cell.rho,
      n: cell.n,
      judgeA: cell.judgeA,
      judgeB: cell.judgeB,
    });
  }
  return out.sort((x, y) => Math.abs(y.rho) - Math.abs(x.rho)).slice(0, 12);
}

export function JudgeMarkHeatmap({
  rows,
  stage,
  showDropped,
}: {
  rows: ScoreRow[];
  stage: Stage;
  showDropped: boolean;
}) {
  const { t } = useI18n();
  const [lo, hi] = stageScoreDomain(stage);
  const top = useMemo(() => topByStageRank(rows), [rows]);
  const judges = useMemo(() => judgeNamesFromRows(top), [top]);
  const cells = useMemo(() => heatmapCells(top, judges), [top, judges]);
  const corr = useMemo(() => spearmanMatrix(top, judges), [top, judges]);
  const pairs = useMemo(() => pairBars(corr, judges), [corr, judges]);
  const shorts = useMemo(() => judges.map((n) => shortJudgeName(n, judges)), [judges]);
  const hasEmpty = cells.some((c) => c.score == null);
  const [tip, setTip] = useState<HeatCell | SpearmanCell | PairBar | null>(null);

  if (!top.length || !judges.length) return null;

  const scaleLabel = (t("scoreScale") ?? "Scale {lo}–{hi}")
    .replace("{lo}", String(lo))
    .replace("{hi}", String(hi));

  return (
    <section className="panel chart-panel">
      <h2>{t("top10JudgeMarks")}</h2>
      <p className="muted tiny">{t("top10JudgeMarksHint")}</p>
      {hasEmpty && <p className="muted tiny">{t("mixedJudgePanels")}</p>}

      <div className="heatmap-scroll">
        <table className="judge-heat">
          <thead>
            <tr>
              <th />
              {judges.map((name, i) => (
                <th key={name} title={name}>
                  {shorts[i]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {top.map((row) => (
              <tr key={`${row.blockId}-${row.coupleId}`}>
                <th className="heat-row" scope="row">
                  {coupleHeatLabel(row)}
                </th>
                {judges.map((name) => {
                  const cell = cells.find(
                    (c) =>
                      c.coupleId === row.coupleId &&
                      c.blockId === row.blockId &&
                      c.judgeName === name,
                  );
                  if (!cell) return <td key={name} className="is-empty" />;
                  if (cell.score == null) {
                    return (
                      <td
                        key={name}
                        className="is-empty"
                        title={`${cell.coupleName} · ${cell.judgeName}`}
                        onMouseEnter={() => setTip(cell)}
                        onMouseLeave={() => setTip(null)}
                      />
                    );
                  }
                  const fill = scoreFill(cell.score, lo, hi);
                  const drop =
                    showDropped && cell.dropped != null
                      ? cell.dropped
                        ? t("dropped")
                        : t("kept")
                      : "";
                  return (
                    <td
                      key={name}
                      style={{ background: fill, color: contrastText(fill) }}
                      className={cell.dropped ? "is-dropped" : undefined}
                      title={[
                        `#${cell.coupleId} ${cell.coupleName}`,
                        cell.judgeName,
                        cell.score.toFixed(2),
                        drop,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      onMouseEnter={() => setTip(cell)}
                      onMouseLeave={() => setTip(null)}
                    >
                      {cell.score.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="heat-legend" aria-hidden="true">
        <span>{scaleLabel}</span>
        <i className="heat-legend-bar" />
      </div>

      {pairs.length > 0 && (
        <>
          <h3 className="heat-subhead">{t("judgeSpearman")}</h3>
          <p className="muted tiny">{t("judgeSpearmanHint")}</p>
          <div className="heatmap-scroll">
            <table className="judge-heat corr-heat">
              <thead>
                <tr>
                  <th />
                  {shorts.map((s, i) => (
                    <th key={judges[i]} title={judges[i]}>
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {judges.map((rowJudge, ri) => (
                  <tr key={rowJudge}>
                    <th className="heat-row" scope="row" title={rowJudge}>
                      {shorts[ri]}
                    </th>
                    {judges.map((colJudge) => {
                      const cell = corr.find(
                        (c) => c.judgeA === rowJudge && c.judgeB === colJudge,
                      );
                      if (!cell || cell.rho == null) {
                        return <td key={colJudge} className="is-empty" />;
                      }
                      const fill = rhoFill(cell.rho);
                      return (
                        <td
                          key={colJudge}
                          style={{ background: fill, color: contrastText(fill) }}
                          onMouseEnter={() => setTip(cell)}
                          onMouseLeave={() => setTip(null)}
                        >
                          {formatRho(cell.rho)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="chart-box corr-bars">
            <ResponsiveContainer width="100%" height={Math.max(180, pairs.length * 28)}>
              <BarChart
                data={pairs}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
              >
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis
                  type="number"
                  domain={[-1, 1]}
                  tick={{ fill: TEXT, fontSize: 10 }}
                  ticks={[-1, 0, 1]}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={120}
                  tick={{ fill: "#e6edf3", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={TIP_STYLE}
                  content={(props) => {
                    const p = props.payload?.[0]?.payload as PairBar | undefined;
                    if (!props.active || !p) return null;
                    return (
                      <div className="heat-tip">
                        <strong>
                          {p.judgeA} · {p.judgeB}
                        </strong>
                        <div>
                          {t("spearmanRho")} {formatRho(p.rho)}
                        </div>
                        <div className="muted tiny">
                          {(t("spearmanN") ?? "n={n} couples").replace("{n}", String(p.n))}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="rho" radius={[0, 3, 3, 0]}>
                  {pairs.map((p) => (
                    <Cell key={p.key} fill={rhoFill(p.rho)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {tip && (
        <div className="heat-tip heat-tip-inline" role="status">
          {"score" in tip ? (
            <HeatTipText cell={tip} showDropped={showDropped} />
          ) : "rho" in tip ? (
            <CorrTipText cell={tip} />
          ) : null}
        </div>
      )}
    </section>
  );
}

function HeatTipText({
  cell,
  showDropped,
}: {
  cell: HeatCell;
  showDropped: boolean;
}) {
  const { t } = useI18n();
  let mark = t("noJudgeMark");
  if (cell.score != null) {
    mark = cell.score.toFixed(2);
    if (showDropped && cell.dropped != null) {
      mark += ` · ${cell.dropped ? t("dropped") : t("kept")}`;
    }
  }
  return (
    <>
      <strong>
        #{cell.coupleId} {cell.coupleName}
      </strong>
      <div>{cell.judgeName}</div>
      <div>{mark}</div>
    </>
  );
}

function CorrTipText({
  cell,
}: {
  cell: Pick<SpearmanCell, "judgeA" | "judgeB" | "rho" | "n">;
}) {
  const { t } = useI18n();
  return (
    <>
      <strong>
        {cell.judgeA} · {cell.judgeB}
      </strong>
      <div>
        {t("spearmanRho")} {formatRho(cell.rho)}
      </div>
      <div className="muted tiny">{(t("spearmanN") ?? "n={n} couples").replace("{n}", String(cell.n))}</div>
    </>
  );
}

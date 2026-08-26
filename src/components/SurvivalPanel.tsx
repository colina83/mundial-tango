import { useI18n } from "../context/I18nContext";
import {
  formatSurvivalPct,
  priorStageLabel,
  standingPhrase,
} from "../lib/survival";
import type { CoupleSurvival, Stage } from "../types";

const GATE_ORDER: Stage[] = ["cuartos", "semifinal", "final"];

export function SurvivalPanel({
  row,
  gates,
}: {
  row: CoupleSurvival;
  gates: Stage[];
}) {
  const { t } = useI18n();
  const visible = GATE_ORDER.filter((g) => gates.includes(g));
  const pFor = (g: Stage): number | null => {
    if (g === "cuartos") return row.pCuartos;
    if (g === "semifinal") return row.pSemi;
    return row.pFinal;
  };
  const realizedFor = (g: Stage): boolean | undefined => {
    if (!row.realized) return undefined;
    if (g === "cuartos") return row.realized.cuartos;
    if (g === "semifinal") return row.realized.semifinal;
    return row.realized.final;
  };
  const labelFor = (g: Stage): string => {
    if (g === "cuartos") return t("stageCuartos");
    if (g === "semifinal") return t("stageSemifinal");
    return t("stageFinal");
  };

  const prior =
    row.prior.match === "samePair" && row.prior.year && row.prior.best
      ? t("survivalSamePair")
          .replace("{year}", String(row.prior.year))
          .replace("{stage}", priorStageLabel(row.prior.best))
      : row.prior.match === "onePartner" && row.prior.year && row.prior.best
        ? t("survivalOnePartner")
            .replace("{year}", String(row.prior.year))
            .replace("{stage}", priorStageLabel(row.prior.best))
        : row.prior.match === "collision"
          ? t("survivalCollision")
          : null;

  const standing = standingPhrase(
    row.standingKind,
    row.decile,
    t("survivalBlock"),
    t("survivalField"),
  );
  const whyParts = [
    standing,
    `${t("spread")} ${row.spread.toFixed(2)}`,
    row.spreadBand ? t(row.spreadBand === "high" ? "survivalHighSpread" : "survivalLowSpread") : null,
    prior,
  ].filter(Boolean);

  return (
    <section className="panel survival-panel">
      <h2>{t("survivalTitle")}</h2>
      <p className="muted tiny">{t("survivalDisclaimer")}</p>
      <ul className="survival-gates">
        {visible.map((gate) => {
          const p = pFor(gate) ?? 0;
          const realized = realizedFor(gate);
          return (
            <li key={gate}>
              <div className="survival-gate-head">
                <span>{labelFor(gate)}</span>
                <strong>{formatSurvivalPct(pFor(gate))}</strong>
              </div>
              <div className="survival-bar" aria-hidden="true">
                <i style={{ width: `${Math.round(p * 100)}%` }} />
              </div>
              {realized !== undefined && (
                <span className={`survival-realized ${realized ? "is-yes" : "is-no"}`}>
                  {realized ? t("survivalReached") : t("survivalMissed")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="survival-why">{whyParts.join(" · ")}</p>
      <p className="muted tiny">
        {t("survivalCohort").replace("{n}", String(row.cohortN))}
      </p>
    </section>
  );
}

export function SurvivalTicks({
  row,
  gates,
}: {
  row: CoupleSurvival;
  gates: Stage[];
}) {
  const { t } = useI18n();
  const visible = GATE_ORDER.filter((g) => gates.includes(g));
  const values = visible.map((g) => {
    if (g === "cuartos") return row.pCuartos ?? 0;
    if (g === "semifinal") return row.pSemi;
    return row.pFinal;
  });
  const title = visible
    .map((g, i) => {
      const name =
        g === "cuartos"
          ? t("stageCuartos")
          : g === "semifinal"
            ? t("stageSemifinal")
            : t("stageFinal");
      return `${name} ${formatSurvivalPct(values[i] ?? 0)}`;
    })
    .join(" · ");

  return (
    <span className="surv-ticks" title={title} aria-label={title}>
      {values.map((p, i) => (
        <i
          key={visible[i]}
          style={{ height: `${Math.round(p * 100)}%` }}
          data-empty={p < 0.02 ? "1" : "0"}
        />
      ))}
    </span>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../context/I18nContext";
import { yearPath } from "../lib/year";
import type { CatalogYear, Stage, YearCatalog } from "../types";

const STAGE_ORDER: Stage[] = ["clasificatoria", "cuartos", "semifinal", "final"];

export function YearLanding() {
  const { t, lang, setLang } = useI18n();
  const [catalog, setCatalog] = useState<YearCatalog | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}data/catalog.json`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<YearCatalog>;
      })
      .then((json) => {
        if (!cancelled) setCatalog(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const years = mergeYears(catalog?.years ?? []);

  return (
    <div className="app-shell is-gate">
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">
            <span className="brand-text">
              <span className="pulso-wordmark">{t("brand")}</span>
            </span>
          </span>
          <div className="topbar-actions">
            <span className="pill">{t("unofficial")}</span>
            <div className="lang-toggle" role="group" aria-label={t("language")}>
              <button
                type="button"
                className={lang === "en" ? "is-active" : ""}
                onClick={() => setLang("en")}
              >
                EN
              </button>
              <button
                type="button"
                className={lang === "es" ? "is-active" : ""}
                onClick={() => setLang("es")}
              >
                ES
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="main year-gate">
        <p className="year-gate-kicker">{t("categoryPista")}</p>
        <h1 className="year-gate-title">{t("pickEdition")}</h1>
        <p className="lede">{t("source")} · {t("notAffiliated")}</p>
        {error && <p className="muted">{t("loadError")}</p>}
        <div className="year-cards">
          {years.map((entry) => (
            <YearCard key={entry.year} entry={entry} featured={entry.year === 2026} />
          ))}
        </div>
      </main>
    </div>
  );
}

function YearCard({ entry, featured }: { entry: CatalogYear; featured: boolean }) {
  const { t } = useI18n();
  const stageLabel: Record<Stage, string> = {
    clasificatoria: t("stageClasificatoria"),
    cuartos: t("stageCuartos"),
    semifinal: t("stageSemifinal"),
    final: t("stageFinal"),
  };
  const expected = entry.year === 2024
    ? (["clasificatoria", "semifinal", "final"] as Stage[])
    : STAGE_ORDER;
  const present = new Set(entry.stages);

  return (
    <Link
      to={yearPath(entry.year)}
      className={`year-card ${featured ? "is-featured" : "is-archive"}`}
    >
      <div className="year-card-top">
        <span className="year-card-year">{entry.year}</span>
        {featured ? (
          <span className="badge badge-pink">{t("liveNow")}</span>
        ) : (
          <span className="badge">{t("archive")}</span>
        )}
        {entry.complete && (
          <span className="badge badge-pink">{t("complete")}</span>
        )}
      </div>
      <p className="year-card-meta">
        {entry.scoring === "trimmed" ? t("scoringTrimmedLabel") : t("scoringSimpleLabel")}
        {" · "}
        {entry.hasBlocks ? t("blocksAD") : t("combinedField")}
      </p>
      <ul className="year-ticks">
        {expected.map((stage) => {
          const on = present.has(stage);
          const count = entry.rowCounts?.[stage];
          return (
            <li key={stage} className={on ? "is-on" : "is-off"}>
              <span aria-hidden="true">{on ? "✓" : "○"}</span>
              {stageLabel[stage]}
              {on && count != null && (
                <em>
                  {count} {t("couples")}
                </em>
              )}
            </li>
          );
        })}
      </ul>
    </Link>
  );
}

function mergeYears(fromCatalog: CatalogYear[]): CatalogYear[] {
  const byYear = new Map(fromCatalog.map((y) => [y.year, y]));
  const fallback: CatalogYear[] = [
    {
      year: 2026,
      status: "live",
      scoring: "trimmed",
      complete: false,
      hasBlocks: true,
      stages: ["clasificatoria"],
      rowCounts: {},
    },
    {
      year: 2025,
      status: "archive",
      scoring: "simple",
      complete: true,
      hasBlocks: true,
      stages: ["clasificatoria", "cuartos", "semifinal", "final"],
      rowCounts: {},
    },
    {
      year: 2024,
      status: "archive",
      scoring: "simple",
      complete: true,
      hasBlocks: false,
      stages: ["clasificatoria", "semifinal", "final"],
      rowCounts: {},
    },
  ];
  return fallback.map((f) => byYear.get(f.year) ?? f);
}

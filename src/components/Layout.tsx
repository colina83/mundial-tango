import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../context/I18nContext";
import { useData } from "../context/DataContext";
import type { Category, Stage } from "../types";
import { yearPath, visibleStages, hasWatchlist, hasFullCompetition, CATEGORIES } from "../lib/year";

export function Layout() {
  const { t, lang, setLang } = useI18n();
  const { data, loading, error, reload, manifest, activeStage, setActiveStage, year, category } =
    useData();
  const navigate = useNavigate();
  const location = useLocation();

  const availableStages = new Set(
    manifest?.stages.filter((s) => s.rowCount > 0).map((s) => s.stage) ?? ["clasificatoria"],
  );
  const allStages = visibleStages(year);
  // For the live year, only show stage tabs that already have data; for archive years show all.
  const stages = year === 2026
    ? allStages.filter((s) => availableStages.has(s))
    : allStages;
  const showWatchlist = hasWatchlist(year);
  const showFull = hasFullCompetition(manifest, year);
  const hideStageBar = location.pathname.includes("/full");

  const stageLabel: Record<Stage, string> = {
    clasificatoria: t("stageClasificatoria"),
    cuartos: t("stageCuartos"),
    semifinal: t("stageSemifinal"),
    final: t("stageFinal"),
  };

  const chipLabel = year === 2026 ? `${year} ${t("liveNow")}` : String(year);
  const base = yearPath(year, "", category);

  function switchCategory(next: Category) {
    if (next === category) return;
    const from = `/${year}/${category}`;
    const to = `/${year}/${next}`;
    const nextPath = location.pathname.startsWith(from)
      ? `${to}${location.pathname.slice(from.length)}`
      : to;
    navigate(`${nextPath}${location.search}`);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <span className="brand-text">
              <span className="pulso-wordmark">{t("brand")}</span>
            </span>
          </NavLink>
          <nav className="top-nav" aria-label={t("navPrimary")}>
            <NavLink to={base} end>
              {t("navDashboard")}
            </NavLink>
            <NavLink to={`${base}/rankings`}>{t("navRankings")}</NavLink>
            <NavLink to={`${base}/stats`}>{t("navStats")}</NavLink>
            {showWatchlist && (
              <NavLink to={`${base}/watchlist`}>{t("navWatchlist")}</NavLink>
            )}
            {showFull && <NavLink to={`${base}/full`}>{t("navFull")}</NavLink>}
          </nav>
          <div className="topbar-actions">
            <div className="cat-toggle" role="group" aria-label={t("categorySwitch")}>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={category === cat ? "is-active" : ""}
                  onClick={() => switchCategory(cat)}
                >
                  {cat === "pista" ? t("categoryPistaShort") : t("categoryEscenarioShort")}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="year-chip"
              onClick={() => navigate("/")}
              title={t("backToYears")}
            >
              {chipLabel}
            </button>
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

      {!hideStageBar && (
      <div className="stage-bar" role="tablist" aria-label={t("liveStage")}>
        {stages.map((stage) => {
          const available = availableStages.has(stage);
          return (
            <button
              key={stage}
              type="button"
              role="tab"
              aria-selected={activeStage === stage}
              aria-disabled={!available}
              disabled={!available}
              className={[
                "stage-tab",
                activeStage === stage ? "is-active" : "",
                !available ? "is-disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => available && setActiveStage(stage)}
              title={available ? stageLabel[stage] : `${stageLabel[stage]} — ${t("comingSoon")}`}
            >
              {stageLabel[stage]}
            </button>
          );
        })}
      </div>
      )}

      <div className="event-header">
        <span>
          {t("appName")} {year} – {t("resultsWord")}
        </span>
      </div>

      <div className="source-bar">
        <span>
          {t("source")} · {t("notAffiliated")}
        </span>
        {data && (
          <a href={data.sourcePage} target="_blank" rel="noreferrer">
            {t("officialPage")}
          </a>
        )}
      </div>

      <main className="main">
        {loading && (
          <div className="state-card">
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
            <p>{t("loading")}</p>
          </div>
        )}
        {error && (
          <div className="state-card">
            <p>{t("loadError")}</p>
            <button type="button" className="btn" onClick={reload}>
              {t("retry")}
            </button>
          </div>
        )}
        {!loading && !error && data && <Outlet />}
      </main>

      <nav className="bottom-nav" aria-label={t("navMobile")}>
        <NavLink to={base} end>
          <HomeIcon />
          {t("navDashboard")}
        </NavLink>
        <NavLink to={`${base}/rankings`}>
          <ListIcon />
          {t("navRankings")}
        </NavLink>
        <NavLink to={`${base}/stats`}>
          <ChartIcon />
          {t("navStats")}
        </NavLink>
        {showWatchlist && (
          <NavLink to={`${base}/watchlist`}>
            <PinIcon />
            {t("navWatchlist")}
          </NavLink>
        )}
        {showFull && (
          <NavLink to={`${base}/full`}>
            <GridIcon />
            {t("navFull")}
          </NavLink>
        )}
      </nav>
    </div>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z" />
      <circle cx="12" cy="10" r="2" />
    </svg>
  );
}

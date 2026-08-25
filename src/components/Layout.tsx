import { NavLink, Outlet } from "react-router-dom";
import { useI18n } from "../context/I18nContext";
import { useData } from "../context/DataContext";

export function Layout() {
  const { t, lang, setLang } = useI18n();
  const { data, loading, error, reload } = useData();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <img
              className="brand-logo"
              src={`${import.meta.env.BASE_URL}pulso-logo.svg`}
              alt=""
              width={28}
              height={28}
            />
            <span className="brand-text">
              <span className="pulso-wordmark">{t("brand")}</span>
              <strong>{t("appName")}</strong>
              <em>{t("tagline")}</em>
            </span>
          </NavLink>
          <nav className="top-nav" aria-label={t("navPrimary")}>
            <NavLink to="/" end>
              {t("navDashboard")}
            </NavLink>
            <NavLink to="/rankings">{t("navRankings")}</NavLink>
            <NavLink to="/stats">{t("navStats")}</NavLink>
            <NavLink to="/watchlist">{t("navWatchlist")}</NavLink>
          </nav>
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
        <NavLink to="/" end>
          <HomeIcon />
          {t("navDashboard")}
        </NavLink>
        <NavLink to="/rankings">
          <ListIcon />
          {t("navRankings")}
        </NavLink>
        <NavLink to="/stats">
          <ChartIcon />
          {t("navStats")}
        </NavLink>
        <NavLink to="/watchlist">
          <PinIcon />
          {t("navWatchlist")}
        </NavLink>
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

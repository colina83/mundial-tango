import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { Layout } from "./components/Layout";
import { DataProvider } from "./context/DataContext";
import { I18nProvider } from "./context/I18nContext";
import { PicksProvider } from "./context/PicksContext";
import { WatchlistProvider } from "./context/WatchlistContext";
import { hasPicks, hasWatchlist, isCategory, isTrackedYear } from "./lib/year";
import { CoupleDossier } from "./pages/CoupleDossier";
import { Dashboard } from "./pages/Dashboard";
import { FullCompetition } from "./pages/FullCompetition";
import { Picks } from "./pages/Picks";
import { Rankings } from "./pages/Rankings";
import { WatchlistPage } from "./pages/Watchlist";
import { YearLanding } from "./pages/YearLanding";
import type { Category } from "./types";

const Stats = lazy(async () => {
  const mod = await import("./pages/Stats");
  return { default: mod.Stats };
});

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

function YearShell() {
  const { year, category } = useParams();
  const location = useLocation();
  const y = Number(year);
  if (!isTrackedYear(y)) return <Navigate to="/" replace />;
  if (!isCategory(category)) {
    const rest = location.pathname.replace(new RegExp(`^/${year}`), "");
    return <Navigate to={`/${year}/pista${rest}${location.search}`} replace />;
  }
  return (
    <DataProvider year={y} category={category}>
      <Layout />
    </DataProvider>
  );
}

function YearIndexRedirect() {
  const { year } = useParams();
  return <Navigate to={`/${year}/pista`} replace />;
}

function LegacyParejaRedirect() {
  const { blockId, coupleId } = useParams();
  return <Navigate to={`/2026/pista/pareja/${blockId}/${coupleId}`} replace />;
}

function WatchlistGate() {
  const { year, category } = useParams();
  const y = Number(year);
  const cat: Category = isCategory(category) ? category : "pista";
  if (!hasWatchlist(y)) {
    return <Navigate to={Number.isFinite(y) ? `/${y}/${cat}` : "/"} replace />;
  }
  return <WatchlistPage />;
}

function PicksGate() {
  const { year, category } = useParams();
  const y = Number(year);
  const cat: Category = isCategory(category) ? category : "pista";
  if (!hasPicks(y)) {
    return <Navigate to={Number.isFinite(y) ? `/${y}/${cat}` : "/"} replace />;
  }
  return <Picks />;
}

export default function App() {
  return (
    <I18nProvider>
      <PicksProvider>
        <WatchlistProvider>
          <BrowserRouter basename={basename === "/" ? undefined : basename}>
            <Routes>
            <Route path="/" element={<YearLanding />} />
            <Route path="rankings" element={<Navigate to="/2026/pista/rankings" replace />} />
            <Route path="stats" element={<Navigate to="/2026/pista/stats" replace />} />
            <Route path="picks" element={<Navigate to="/2026/pista/picks" replace />} />
            <Route path="watchlist" element={<Navigate to="/2026/pista/watchlist" replace />} />
            <Route path="pareja/:blockId/:coupleId" element={<LegacyParejaRedirect />} />
            <Route path=":year/:category" element={<YearShell />}>
              <Route index element={<Dashboard />} />
              <Route path="rankings" element={<Rankings />} />
              <Route path="full" element={<FullCompetition />} />
              <Route path="pareja/:blockId/:coupleId" element={<CoupleDossier />} />
              <Route
                path="stats"
                element={
                  <Suspense fallback={<div className="state-card">…</div>}>
                    <Stats />
                  </Suspense>
                }
              />
              <Route path="watchlist" element={<WatchlistGate />} />
              <Route path="picks" element={<PicksGate />} />
            </Route>
            <Route path=":year" element={<YearIndexRedirect />} />
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
          <Analytics />
        </WatchlistProvider>
      </PicksProvider>
    </I18nProvider>
  );
}

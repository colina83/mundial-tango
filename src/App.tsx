import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useParams,
} from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { Layout } from "./components/Layout";
import { DataProvider } from "./context/DataContext";
import { I18nProvider } from "./context/I18nContext";
import { WatchlistProvider } from "./context/WatchlistContext";
import { hasWatchlist, isTrackedYear } from "./lib/year";
import { CoupleDossier } from "./pages/CoupleDossier";
import { Dashboard } from "./pages/Dashboard";
import { FullCompetition } from "./pages/FullCompetition";
import { Rankings } from "./pages/Rankings";
import { WatchlistPage } from "./pages/Watchlist";
import { YearLanding } from "./pages/YearLanding";

const Stats = lazy(async () => {
  const mod = await import("./pages/Stats");
  return { default: mod.Stats };
});

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

function YearShell() {
  const { year } = useParams();
  const y = Number(year);
  if (!isTrackedYear(y)) return <Navigate to="/" replace />;
  return (
    <DataProvider year={y}>
      <Layout />
    </DataProvider>
  );
}

function LegacyParejaRedirect() {
  const { blockId, coupleId } = useParams();
  return <Navigate to={`/2026/pareja/${blockId}/${coupleId}`} replace />;
}

function WatchlistGate() {
  const { year } = useParams();
  const y = Number(year);
  if (!hasWatchlist(y)) return <Navigate to={Number.isFinite(y) ? `/${y}` : "/"} replace />;
  return <WatchlistPage />;
}

export default function App() {
  return (
    <I18nProvider>
      <WatchlistProvider>
        <BrowserRouter basename={basename === "/" ? undefined : basename}>
          <Routes>
            <Route path="/" element={<YearLanding />} />
            <Route path="rankings" element={<Navigate to="/2026/rankings" replace />} />
            <Route path="stats" element={<Navigate to="/2026/stats" replace />} />
            <Route path="watchlist" element={<Navigate to="/2026/watchlist" replace />} />
            <Route path="pareja/:blockId/:coupleId" element={<LegacyParejaRedirect />} />
            <Route path=":year" element={<YearShell />}>
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
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Analytics />
      </WatchlistProvider>
    </I18nProvider>
  );
}

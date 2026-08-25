import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DataProvider } from "./context/DataContext";
import { I18nProvider } from "./context/I18nContext";
import { WatchlistProvider } from "./context/WatchlistContext";
import { CoupleDossier } from "./pages/CoupleDossier";
import { Dashboard } from "./pages/Dashboard";
import { Rankings } from "./pages/Rankings";
import { WatchlistPage } from "./pages/Watchlist";

const Stats = lazy(async () => {
  const mod = await import("./pages/Stats");
  return { default: mod.Stats };
});

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

export default function App() {
  return (
    <I18nProvider>
      <WatchlistProvider>
        <DataProvider>
          <BrowserRouter basename={basename === "/" ? undefined : basename}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="rankings" element={<Rankings />} />
                <Route path="pareja/:blockId/:coupleId" element={<CoupleDossier />} />
                <Route
                  path="stats"
                  element={
                    <Suspense fallback={<div className="state-card">…</div>}>
                      <Stats />
                    </Suspense>
                  }
                />
                <Route path="watchlist" element={<WatchlistPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </DataProvider>
      </WatchlistProvider>
    </I18nProvider>
  );
}

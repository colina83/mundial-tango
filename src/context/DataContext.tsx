import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Dataset, Stage, StageManifest } from "../types";

type DataValue = {
  data: Dataset | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  manifest: StageManifest | null;
  activeStage: Stage;
  setActiveStage: (stage: Stage) => void;
};

const DataContext = createContext<DataValue | null>(null);

async function loadManifest(): Promise<StageManifest | null> {
  try {
    const url = `${import.meta.env.BASE_URL}data/manifest.json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json() as Promise<StageManifest>;
  } catch {
    return null;
  }
}

async function loadDataset(stage: Stage): Promise<Dataset> {
  const url = `${import.meta.env.BASE_URL}data/results-${stage}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    // Fall back to legacy results.json for clasificatoria
    if (stage === "clasificatoria") {
      const fallback = await fetch(`${import.meta.env.BASE_URL}data/results.json`);
      if (!fallback.ok) throw new Error(`${fallback.status} ${fallback.statusText}`);
      return fallback.json() as Promise<Dataset>;
    }
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<Dataset>;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [manifest, setManifest] = useState<StageManifest | null>(null);
  const [activeStage, setActiveStageState] = useState<Stage>("clasificatoria");

  // Load manifest once on mount
  useEffect(() => {
    loadManifest().then(setManifest).catch(() => setManifest(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadDataset(activeStage)
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick, activeStage]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const setActiveStage = useCallback((stage: Stage) => {
    setActiveStageState(stage);
  }, []);

  const value = useMemo(
    () => ({ data, loading, error, reload, manifest, activeStage, setActiveStage }),
    [data, loading, error, reload, manifest, activeStage, setActiveStage],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}

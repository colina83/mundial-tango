import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import type {
  CoupleSurvival,
  Dataset,
  Stage,
  StageManifest,
  YearCatalog,
  YearSurvivalFile,
} from "../types";
import { survivalByCoupleId } from "../lib/survival";
import { isStage, visibleStages } from "../lib/year";

type DataValue = {
  year: number;
  data: Dataset | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  catalog: YearCatalog | null;
  manifest: StageManifest | null;
  survival: YearSurvivalFile | null;
  survivalById: Map<number, CoupleSurvival>;
  activeStage: Stage;
  setActiveStage: (stage: Stage) => void;
};

const DataContext = createContext<DataValue | null>(null);

async function loadCatalog(): Promise<YearCatalog | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/catalog.json`);
    if (!res.ok) return null;
    return res.json() as Promise<YearCatalog>;
  } catch {
    return null;
  }
}

async function loadManifest(year: number): Promise<StageManifest | null> {
  try {
    const url = `${import.meta.env.BASE_URL}data/${year}/manifest.json`;
    const res = await fetch(url);
    if (!res.ok) {
      if (year === 2026) {
        const fallback = await fetch(`${import.meta.env.BASE_URL}data/manifest.json`);
        if (!fallback.ok) return null;
        const legacy = (await fallback.json()) as StageManifest;
        return { ...legacy, year: 2026, scoring: legacy.scoring ?? "trimmed" };
      }
      return null;
    }
    return res.json() as Promise<StageManifest>;
  } catch {
    return null;
  }
}

async function loadSurvival(year: number): Promise<YearSurvivalFile | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${year}/survival.json`);
    if (!res.ok) return null;
    return res.json() as Promise<YearSurvivalFile>;
  } catch {
    return null;
  }
}

async function loadDataset(year: number, stage: Stage): Promise<Dataset> {
  const yearUrl = `${import.meta.env.BASE_URL}data/${year}/results-${stage}.json`;
  const res = await fetch(yearUrl);
  if (res.ok) return res.json() as Promise<Dataset>;
  if (year === 2026) {
    const legacy = await fetch(`${import.meta.env.BASE_URL}data/results-${stage}.json`);
    if (legacy.ok) return legacy.json() as Promise<Dataset>;
    if (stage === "clasificatoria") {
      const fallback = await fetch(`${import.meta.env.BASE_URL}data/results.json`);
      if (!fallback.ok) throw new Error(`${fallback.status} ${fallback.statusText}`);
      return fallback.json() as Promise<Dataset>;
    }
  }
  throw new Error(`${res.status} ${res.statusText}`);
}

export function DataProvider({
  year,
  children,
}: {
  year: number;
  children: ReactNode;
}) {
  const [data, setData] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [catalog, setCatalog] = useState<YearCatalog | null>(null);
  const [manifest, setManifest] = useState<StageManifest | null>(null);
  const [survival, setSurvival] = useState<YearSurvivalFile | null>(null);
  const [params, setParams] = useSearchParams();
  const [activeStage, setActiveStageState] = useState<Stage>(() => {
    const requested = params.get("stage");
    return isStage(requested) ? requested : "clasificatoria";
  });

  useEffect(() => {
    loadCatalog().then(setCatalog).catch(() => setCatalog(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSurvival(null);
    loadManifest(year)
      .then((m) => {
        if (cancelled) return;
        setManifest(m);
        const stages = m?.stages.map((s) => s.stage) ?? [];
        const allowed = visibleStages(year).filter((s) => stages.includes(s));
        const requested = params.get("stage");
        const fromUrl = isStage(requested) && allowed.includes(requested) ? requested : null;
        setActiveStageState((current) =>
          fromUrl ?? (allowed.includes(current) ? current : (allowed[0] ?? "clasificatoria")),
        );
      })
      .catch(() => {
        if (!cancelled) setManifest(null);
      });
    loadSurvival(year)
      .then((s) => {
        if (!cancelled) setSurvival(s);
      })
      .catch(() => {
        if (!cancelled) setSurvival(null);
      });
    return () => {
      cancelled = true;
    };
  }, [year]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadDataset(year, activeStage)
      .then((json) => {
        if (!cancelled) {
          if (!json.scoring) {
            json.scoring = json.year === 2026 ? "trimmed" : "simple";
          }
          setData(json);
        }
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
  }, [tick, activeStage, year]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const setActiveStage = useCallback(
    (stage: Stage) => {
      setActiveStageState(stage);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("stage", stage);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const survivalById = useMemo(() => survivalByCoupleId(survival), [survival]);

  const value = useMemo(
    () => ({
      year,
      data,
      loading,
      error,
      reload,
      catalog,
      manifest,
      survival,
      survivalById,
      activeStage,
      setActiveStage,
    }),
    [
      year,
      data,
      loading,
      error,
      reload,
      catalog,
      manifest,
      survival,
      survivalById,
      activeStage,
      setActiveStage,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}

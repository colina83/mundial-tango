import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BlockId, Category } from "../types";

const STORAGE_KEY = "mundial-tango.watchlist.v3";
const LEGACY_V2 = "mundial-tango.watchlist.v2";
const LEGACY_V1 = "mundial-tango.watchlist.v1";

export type Pin = {
  coupleId: number;
  blockId: BlockId;
  year: number;
  category: Category;
};

type WatchValue = {
  pins: Pin[];
  isPinned: (
    coupleId: number,
    blockId: BlockId,
    year: number,
    category?: Category,
  ) => boolean;
  toggle: (
    coupleId: number,
    blockId: BlockId,
    year: number,
    category?: Category,
  ) => void;
};

const WatchContext = createContext<WatchValue | null>(null);

function withCategory(p: Partial<Pin> & { coupleId: number; blockId: BlockId }): Pin {
  return {
    coupleId: p.coupleId,
    blockId: p.blockId,
    year: typeof p.year === "number" ? p.year : 2026,
    category: p.category === "escenario" ? "escenario" : "pista",
  };
}

function readPins(): Pin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_V2);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Pin>[];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (p) =>
            typeof p?.coupleId === "number" &&
            typeof p?.blockId === "string",
        )
        .map((p) => withCategory(p as Pin));
    }
    const legacy = localStorage.getItem(LEGACY_V1);
    if (!legacy) return [];
    const parsed = JSON.parse(legacy) as { coupleId: number; blockId: BlockId }[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => typeof p?.coupleId === "number" && typeof p?.blockId === "string")
      .map((p) => withCategory({ ...p, year: 2026, category: "pista" }));
  } catch {
    return [];
  }
}

function pinKey(
  coupleId: number,
  blockId: BlockId,
  year: number,
  category: Category,
): string {
  return `${year}-${category}-${blockId}-${coupleId}`;
}

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [pins, setPins] = useState<Pin[]>(readPins);

  const persist = useCallback((next: Pin[]) => {
    setPins(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<WatchValue>(
    () => ({
      pins,
      isPinned: (coupleId, blockId, year, category = "pista") =>
        pins.some(
          (p) =>
            pinKey(p.coupleId, p.blockId, p.year, p.category) ===
            pinKey(coupleId, blockId, year, category),
        ),
      toggle: (coupleId, blockId, year, category = "pista") => {
        const key = pinKey(coupleId, blockId, year, category);
        const exists = pins.some(
          (p) => pinKey(p.coupleId, p.blockId, p.year, p.category) === key,
        );
        persist(
          exists
            ? pins.filter(
                (p) => pinKey(p.coupleId, p.blockId, p.year, p.category) !== key,
              )
            : [{ coupleId, blockId, year, category }, ...pins],
        );
      },
    }),
    [pins, persist],
  );

  return <WatchContext.Provider value={value}>{children}</WatchContext.Provider>;
}

export function useWatchlist(): WatchValue {
  const ctx = useContext(WatchContext);
  if (!ctx) throw new Error("useWatchlist must be used within WatchlistProvider");
  return ctx;
}

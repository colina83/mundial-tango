import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BlockId } from "../types";

const STORAGE_KEY = "mundial-tango.watchlist.v2";
const LEGACY_KEY = "mundial-tango.watchlist.v1";

export type Pin = { coupleId: number; blockId: BlockId; year: number };

type WatchValue = {
  pins: Pin[];
  isPinned: (coupleId: number, blockId: BlockId, year: number) => boolean;
  toggle: (coupleId: number, blockId: BlockId, year: number) => void;
};

const WatchContext = createContext<WatchValue | null>(null);

function readPins(): Pin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Pin[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (p) =>
          typeof p?.coupleId === "number" &&
          typeof p?.blockId === "string" &&
          typeof p?.year === "number",
      );
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return [];
    const parsed = JSON.parse(legacy) as { coupleId: number; blockId: BlockId }[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => typeof p?.coupleId === "number" && typeof p?.blockId === "string")
      .map((p) => ({ ...p, year: 2026 }));
  } catch {
    return [];
  }
}

function pinKey(coupleId: number, blockId: BlockId, year: number): string {
  return `${year}-${blockId}-${coupleId}`;
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
      isPinned: (coupleId, blockId, year) =>
        pins.some(
          (p) => pinKey(p.coupleId, p.blockId, p.year) === pinKey(coupleId, blockId, year),
        ),
      toggle: (coupleId, blockId, year) => {
        const key = pinKey(coupleId, blockId, year);
        const exists = pins.some(
          (p) => pinKey(p.coupleId, p.blockId, p.year) === key,
        );
        persist(
          exists
            ? pins.filter((p) => pinKey(p.coupleId, p.blockId, p.year) !== key)
            : [{ coupleId, blockId, year }, ...pins],
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

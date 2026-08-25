import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BlockId } from "../types";

const STORAGE_KEY = "mundial-tango.watchlist.v1";

export type Pin = { coupleId: number; blockId: BlockId };

type WatchValue = {
  pins: Pin[];
  isPinned: (coupleId: number, blockId: BlockId) => boolean;
  toggle: (coupleId: number, blockId: BlockId) => void;
};

const WatchContext = createContext<WatchValue | null>(null);

function readPins(): Pin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Pin[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p) =>
        typeof p?.coupleId === "number" &&
        typeof p?.blockId === "string",
    );
  } catch {
    return [];
  }
}

function pinKey(coupleId: number, blockId: BlockId): string {
  return `${blockId}-${coupleId}`;
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
      isPinned: (coupleId, blockId) =>
        pins.some((p) => pinKey(p.coupleId, p.blockId) === pinKey(coupleId, blockId)),
      toggle: (coupleId, blockId) => {
        const key = pinKey(coupleId, blockId);
        const exists = pins.some((p) => pinKey(p.coupleId, p.blockId) === key);
        persist(
          exists
            ? pins.filter((p) => pinKey(p.coupleId, p.blockId) !== key)
            : [{ coupleId, blockId }, ...pins],
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

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Category } from "../types";

const STORAGE_KEY = "mundial-tango.picks.v1";

export interface PickEntry {
  coupleId: number;
  rank: 1 | 2 | 3;
  /** Names of the two dancers, stored for the community board display. */
  dancer1: string;
  dancer2: string;
}

export interface VoterInfo {
  firstName: string;
  lastName: string;
  country: string;
  tangoComm: string;
}

export interface VoteRecord {
  year: number;
  category: Category;
  voter: VoterInfo;
  picks: PickEntry[];
}

interface StoredData {
  sessionId: string;
  votes: VoteRecord[];
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function readStored(): StoredData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredData>;
      if (parsed && typeof parsed.sessionId === "string" && Array.isArray(parsed.votes)) {
        return parsed as StoredData;
      }
    }
  } catch {
    /* ignore */
  }
  return { sessionId: generateId(), votes: [] };
}

type PicksValue = {
  sessionId: string;
  votes: VoteRecord[];
  hasPicked: (year: number, category: Category) => boolean;
  myPicks: (year: number, category: Category) => VoteRecord | undefined;
  submitPicks: (year: number, category: Category, picks: PickEntry[], voter: VoterInfo) => void;
  clearPicks: (year: number, category: Category) => void;
};

const PicksContext = createContext<PicksValue | null>(null);

export function PicksProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredData>(readStored);

  const persist = useCallback((next: StoredData) => {
    setStored(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<PicksValue>(
    () => ({
      sessionId: stored.sessionId,
      votes: stored.votes,
      hasPicked: (year, category) =>
        stored.votes.some((v) => v.year === year && v.category === category),
      myPicks: (year, category) =>
        stored.votes.find((v) => v.year === year && v.category === category),
      submitPicks: (year, category, picks, voter) => {
        const without = stored.votes.filter(
          (v) => !(v.year === year && v.category === category),
        );
        persist({
          ...stored,
          votes: [...without, { year, category, voter, picks }],
        });
      },
      clearPicks: (year, category) => {
        persist({
          ...stored,
          votes: stored.votes.filter(
            (v) => !(v.year === year && v.category === category),
          ),
        });
      },
    }),
    [stored, persist],
  );

  return <PicksContext.Provider value={value}>{children}</PicksContext.Provider>;
}

export function usePicks(): PicksValue {
  const ctx = useContext(PicksContext);
  if (!ctx) throw new Error("usePicks must be used within PicksProvider");
  return ctx;
}

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type {
  BallotConfirmation,
  BallotInput,
  PicksSnapshot,
} from "../lib/picks";

const CACHE_KEY = "mundial-tango.top3.confirmations.v1";

export class PicksApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function cacheConfirmation(ballot: BallotConfirmation): void {
  try {
    const current = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<
      string,
      BallotConfirmation
    >;
    current[`${ballot.year}:${ballot.category}`] = ballot;
    localStorage.setItem(CACHE_KEY, JSON.stringify(current));
  } catch {
    /* Browser storage is a convenience; the server remains authoritative. */
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = (isJson ? await response.json().catch(() => ({})) : {}) as {
    code?: string;
    error?: string;
  };
  if (!response.ok || !isJson) {
    throw new PicksApiError(
      body.code ?? "request_failed",
      body.error ?? "Top 3 is temporarily unavailable.",
      response.status,
    );
  }
  return body as T;
}

type PicksContextValue = {
  getSnapshot: (year: number, category: BallotInput["category"]) => Promise<PicksSnapshot>;
  submit: (ballot: BallotInput) => Promise<BallotConfirmation>;
};

const PicksContext = createContext<PicksContextValue | null>(null);

export function PicksProvider({ children }: { children: ReactNode }) {
  const value = useMemo<PicksContextValue>(
    () => ({
      getSnapshot: (year, category) =>
        request<PicksSnapshot>(`/api/picks?year=${year}&category=${category}`),
      submit: async (ballot) => {
        const result = await request<{ ballot: BallotConfirmation }>("/api/picks", {
          method: "POST",
          body: JSON.stringify(ballot),
        });
        cacheConfirmation(result.ballot);
        return result.ballot;
      },
    }),
    [],
  );
  return <PicksContext.Provider value={value}>{children}</PicksContext.Provider>;
}

export function usePicks(): PicksContextValue {
  const value = useContext(PicksContext);
  if (!value) throw new Error("usePicks must be used within PicksProvider.");
  return value;
}

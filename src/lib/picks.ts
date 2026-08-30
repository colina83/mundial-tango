import type { Category } from "../types";

export type PickRank = 1 | 2 | 3;

export interface VoterInput {
  firstName: string;
  lastName: string;
  country: string;
  community: string;
}

export interface PickSelection {
  rank: PickRank;
  coupleId: number;
  dancer1?: string;
  dancer2?: string;
}

export interface PickCandidate {
  coupleId: number;
  dancer1: string;
  dancer2: string;
}

export interface BallotInput {
  year: number;
  category: Category;
  voter: VoterInput;
  picks: PickSelection[];
  turnstileToken: string;
}

export interface BallotConfirmation {
  year: number;
  category: Category;
  voter: VoterInput;
  picks: Required<PickSelection>[];
  updatedAt: string;
}

export interface LeaderboardEntry extends PickCandidate {
  points: number;
  first: number;
  second: number;
  third: number;
}

export interface PicksSnapshot {
  year: number;
  category: Category;
  candidates: PickCandidate[];
  candidateStage: string;
  leaderboard: LeaderboardEntry[];
  ballotCount: number;
  updatedAt: string | null;
  closed: boolean;
  closesAt: string | null;
  myBallot: BallotConfirmation | null;
}

export function aggregatePicks(
  ballots: Array<{ picks: Required<PickSelection>[] }>,
): LeaderboardEntry[] {
  const byCouple = new Map<number, LeaderboardEntry>();
  for (const ballot of ballots) {
    for (const pick of ballot.picks) {
      const entry = byCouple.get(pick.coupleId) ?? {
        coupleId: pick.coupleId,
        dancer1: pick.dancer1,
        dancer2: pick.dancer2,
        points: 0,
        first: 0,
        second: 0,
        third: 0,
      };
      if (pick.rank === 1) {
        entry.first += 1;
        entry.points += 3;
      } else if (pick.rank === 2) {
        entry.second += 1;
        entry.points += 2;
      } else {
        entry.third += 1;
        entry.points += 1;
      }
      byCouple.set(pick.coupleId, entry);
    }
  }
  return [...byCouple.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.first - a.first ||
      b.second - a.second ||
      a.coupleId - b.coupleId,
  );
}

export function assignNextPick(
  slots: Array<PickCandidate | null>,
  candidate: PickCandidate,
): Array<PickCandidate | null> {
  if (slots.some((slot) => slot?.coupleId === candidate.coupleId)) return slots;
  const empty = slots.findIndex((slot) => slot === null);
  if (empty < 0) return slots;
  return slots.map((slot, index) => (index === empty ? candidate : slot));
}

export function movePick(
  slots: Array<PickCandidate | null>,
  index: number,
  direction: -1 | 1,
): Array<PickCandidate | null> {
  const target = index + direction;
  if (target < 0 || target >= slots.length) return slots;
  const next = [...slots];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

import { createHmac, timingSafeEqual } from "node:crypto";
import type { PickCandidate, PickSelection, VoterInput } from "../../src/lib/picks.ts";
import type { Category } from "../../src/types.ts";

const MAX_NAME = 60;
const MAX_COMMUNITY = 80;

export class BallotError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function normalizeText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, max);
}

export function validateCategory(value: unknown): Category {
  if (value === "pista" || value === "escenario") return value;
  throw new BallotError("invalid_category", "Invalid category.");
}

export function validateVoter(value: unknown): VoterInput {
  const voter = (value ?? {}) as Partial<VoterInput>;
  const next = {
    firstName: normalizeText(voter.firstName, MAX_NAME),
    lastName: normalizeText(voter.lastName, MAX_NAME),
    country: normalizeText(voter.country, MAX_NAME).toUpperCase(),
    community: normalizeText(voter.community, MAX_COMMUNITY),
  };
  if (!next.firstName || !next.lastName || !/^[A-Z]{2}$/.test(next.country)) {
    throw new BallotError("missing_fields", "Name, last name, and country are required.");
  }
  return next;
}

export function validatePicks(
  value: unknown,
  candidates: PickCandidate[],
): Required<PickSelection>[] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new BallotError("invalid_picks", "Exactly three picks are required.");
  }
  const allowed = new Map(candidates.map((candidate) => [candidate.coupleId, candidate]));
  const ranks = new Set<number>();
  const coupleIds = new Set<number>();
  const picks = value.map((raw) => {
    const pick = raw as Partial<PickSelection>;
    if (pick.rank !== 1 && pick.rank !== 2 && pick.rank !== 3) {
      throw new BallotError("invalid_picks", "Ranks must be first, second, and third.");
    }
    const candidate = allowed.get(Number(pick.coupleId));
    if (!candidate) {
      throw new BallotError("ineligible_couple", "A selected couple is no longer eligible.");
    }
    ranks.add(pick.rank);
    coupleIds.add(candidate.coupleId);
    return {
      rank: pick.rank,
      coupleId: candidate.coupleId,
      dancer1: candidate.dancer1,
      dancer2: candidate.dancer2,
    };
  });
  if (ranks.size !== 3 || coupleIds.size !== 3) {
    throw new BallotError("duplicate_pick", "Each podium position needs a different couple.");
  }
  return picks.sort((a, b) => a.rank - b.rank);
}

export function validateBallotShape(
  value: unknown,
  candidates: PickCandidate[],
): {
  year: number;
  category: Category;
  voter: VoterInput;
  picks: Required<PickSelection>[];
  turnstileToken: string;
} {
  const body = (value ?? {}) as {
    year?: number;
    category?: Category;
    voter?: VoterInput;
    picks?: PickSelection[];
    turnstileToken?: string;
  };
  if (Number(body.year) !== 2026) {
    throw new BallotError("invalid_year", "Top 3 is available for 2026 only.");
  }
  return {
    year: 2026,
    category: validateCategory(body.category),
    voter: validateVoter(body.voter),
    picks: validatePicks(body.picks, candidates),
    turnstileToken: normalizeText(body.turnstileToken, 2048),
  };
}

export function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function identityKey(voter: VoterInput): string {
  return [voter.firstName, voter.lastName, voter.country, voter.community]
    .map((part) =>
      part
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLocaleLowerCase("es")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim(),
    )
    .join("|");
}

export function safeTokenEquals(token: string, expectedHash: string, secret: string): boolean {
  const actual = Buffer.from(hmac(token, secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

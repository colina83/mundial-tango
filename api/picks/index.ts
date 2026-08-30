import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { aggregatePicks, type BallotConfirmation, type PickSelection } from "../../src/lib/picks";
import type { Category } from "../../src/types";
import { getCandidatePool } from "../../server/picks/candidates";
import {
  findBallotByToken,
  insertBallot,
  listBallots,
  recentIpBallotCount,
  updateBallot,
  type BallotRow,
} from "../../server/picks/db";
import {
  BallotError,
  hmac,
  identityKey,
  validateBallotShape,
  validateCategory,
} from "../../server/picks/validation";

const COOKIE_PREFIX = "pulso_top3";

interface VercelRequest extends IncomingMessage {
  body?: unknown;
  query: Record<string, string | string[] | undefined>;
}

interface VercelResponse extends ServerResponse {
  status(code: number): VercelResponse;
  json(value: unknown): VercelResponse;
}

export interface PicksDependencies {
  candidatePool: typeof getCandidatePool;
  findByToken: typeof findBallotByToken;
  insert: typeof insertBallot;
  list: typeof listBallots;
  recentIpCount: typeof recentIpBallotCount;
  update: typeof updateBallot;
  verifySecurity: typeof verifyTurnstile;
}

function envSecret(): string {
  const secret = process.env.PICKS_HASH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("PICKS_HASH_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function scalar(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const at = part.indexOf("=");
        return at < 0
          ? [decodeURIComponent(part), ""]
          : [decodeURIComponent(part.slice(0, at)), decodeURIComponent(part.slice(at + 1))];
      }),
  );
}

function cookieName(year: number, category: Category): string {
  return `${COOKIE_PREFIX}_${year}_${category}`;
}

function setEditCookie(
  res: VercelResponse,
  year: number,
  category: Category,
  token: string,
): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${cookieName(year, category)}=${encodeURIComponent(token)}; Path=/api/picks; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
  );
}

function requestIp(req: VercelRequest): string {
  return (
    scalar(req.headers["x-forwarded-for"])?.split(",")[0]?.trim() ||
    scalar(req.headers["x-real-ip"]) ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

function parsePicks(value: BallotRow["picks"]): Required<PickSelection>[] {
  return (typeof value === "string" ? JSON.parse(value) : value) as Required<PickSelection>[];
}

function confirmation(row: BallotRow): BallotConfirmation {
  return {
    year: row.year,
    category: row.category,
    voter: {
      firstName: row.voter_first_name,
      lastName: row.voter_last_name,
      country: row.voter_country.trim(),
      community: row.voter_community,
    },
    picks: parsePicks(row.picks),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function closeTime(category: Category): string | null {
  const value = process.env[`PICKS_CLOSE_AT_${category.toUpperCase()}`]?.trim();
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function isClosed(category: Category): boolean {
  const closesAt = closeTime(category);
  return closesAt ? Date.now() >= new Date(closesAt).getTime() : false;
}

export async function verifyTurnstile(token: string, ip: string): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret && process.env.NODE_ENV !== "production") return;
  if (!secret) throw new Error("TURNSTILE_SECRET_KEY is not configured.");
  if (!token) throw new BallotError("turnstile_required", "Please complete the security check.");
  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body },
  );
  const result = (await response.json()) as { success?: boolean };
  if (!result.success) {
    throw new BallotError("turnstile_failed", "The security check could not be verified.");
  }
}

async function getSnapshot(
  req: VercelRequest,
  category: Category,
  deps: PicksDependencies,
) {
  const year = 2026;
  const secret = envSecret();
  const [{ stage, candidates }, ballots] = await Promise.all([
    deps.candidatePool(category),
    deps.list(year, category),
  ]);
  const token = parseCookies(req.headers.cookie)[cookieName(year, category)];
  const tokenHash = token ? hmac(token, secret) : null;
  const own = tokenHash
    ? ballots.find((ballot) => ballot.edit_token_hash === tokenHash) ?? null
    : null;
  const updatedAt = ballots.length
    ? new Date(
        Math.max(...ballots.map((ballot) => new Date(ballot.updated_at).getTime())),
      ).toISOString()
    : null;
  return {
    year,
    category,
    candidates,
    candidateStage: stage,
    leaderboard: aggregatePicks(
      ballots.map((ballot) => ({ picks: parsePicks(ballot.picks) })),
    ),
    ballotCount: ballots.length,
    updatedAt,
    closed: isClosed(category),
    closesAt: closeTime(category),
    myBallot: own ? confirmation(own) : null,
  };
}

async function mutate(
  req: VercelRequest,
  res: VercelResponse,
  editing: boolean,
  deps: PicksDependencies,
) {
  const raw = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as Record<
    string,
    unknown
  >;
  const category = validateCategory(raw?.category);
  if (isClosed(category)) {
    throw new BallotError("picks_closed", "Top 3 selections are closed.", 409);
  }
  const pool = await deps.candidatePool(category);
  const secret = envSecret();
  let existing: BallotRow | null = null;
  let candidates = pool.candidates;
  if (editing) {
    const token = parseCookies(req.headers.cookie)[cookieName(2026, category)];
    if (!token) throw new BallotError("edit_token_missing", "This ballot cannot be edited.", 401);
    existing = await deps.findByToken(2026, category, hmac(token, secret));
    if (!existing) throw new BallotError("edit_token_invalid", "This ballot cannot be edited.", 401);
    const byId = new Map(candidates.map((candidate) => [candidate.coupleId, candidate]));
    for (const pick of parsePicks(existing.picks)) {
      byId.set(pick.coupleId, {
        coupleId: pick.coupleId,
        dancer1: pick.dancer1,
        dancer2: pick.dancer2,
      });
    }
    candidates = [...byId.values()];
  }
  const input = validateBallotShape(raw, candidates);
  const ip = requestIp(req);
  await deps.verifySecurity(input.turnstileToken, ip);
  const identityHash = hmac(identityKey(input.voter), secret);
  const ipHash = hmac(ip, secret);

  if (editing) {
    const updated = await deps.update({
      id: existing!.id,
      year: input.year,
      category,
      voter: input.voter,
      picks: input.picks,
      identityHash,
      ipHash,
    });
    return res.status(200).json({ ballot: confirmation(updated) });
  }

  const limit = Math.max(1, Number(process.env.PICKS_IP_DAILY_LIMIT ?? 3));
  if ((await deps.recentIpCount(input.year, category, ipHash)) >= limit) {
    throw new BallotError(
      "rate_limited",
      "Too many ballots were submitted from this network today.",
      429,
    );
  }
  const editToken = randomBytes(32).toString("base64url");
  const created = await deps.insert({
    year: input.year,
    category,
    voter: input.voter,
    picks: input.picks,
    identityHash,
    ipHash,
    editTokenHash: hmac(editToken, secret),
  });
  setEditCookie(res, input.year, category, editToken);
  return res.status(201).json({ ballot: confirmation(created) });
}

export function createPicksHandler(overrides: Partial<PicksDependencies> = {}) {
  const deps: PicksDependencies = {
    candidatePool: getCandidatePool,
    findByToken: findBallotByToken,
    insert: insertBallot,
    list: listBallots,
    recentIpCount: recentIpBallotCount,
    update: updateBallot,
    verifySecurity: verifyTurnstile,
    ...overrides,
  };
  return async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (process.env.PICKS_ENABLED === "false") {
        return res.status(503).json({ code: "disabled", error: "Top 3 is temporarily unavailable." });
      }
      if (req.method === "GET") {
        if (Number(scalar(req.query.year)) !== 2026) {
          throw new BallotError("invalid_year", "Top 3 is available for 2026 only.");
        }
        const category = validateCategory(scalar(req.query.category));
        return res.status(200).json(await getSnapshot(req, category, deps));
      }
      if (req.method === "POST") return await mutate(req, res, false, deps);
      if (req.method === "PATCH") return await mutate(req, res, true, deps);
      res.setHeader("Allow", "GET, POST, PATCH");
      return res.status(405).json({ code: "method_not_allowed", error: "Method not allowed." });
    } catch (error) {
      if (error instanceof BallotError) {
        return res.status(error.status).json({ code: error.code, error: error.message });
      }
      const dbError = error as { code?: string };
      if (dbError.code === "23505") {
        return res.status(409).json({
          code: "duplicate_ballot",
          error: "A ballot for this person and category already exists.",
        });
      }
      console.error("Top 3 API error", error);
      return res.status(500).json({ code: "server_error", error: "Top 3 is temporarily unavailable." });
    }
  };
}

export default createPicksHandler();

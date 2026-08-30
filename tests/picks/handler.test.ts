import assert from "node:assert/strict";
import test from "node:test";
import type { PickCandidate } from "../../src/lib/picks.ts";
import type { BallotRow } from "../../server/picks/db.ts";
import {
  createPicksHandler,
  type PicksDependencies,
} from "../../api/picks/index.ts";

process.env.PICKS_HASH_SECRET = "test-secret-that-is-definitely-long-enough";
delete process.env.PICKS_ENABLED;

const candidates: PickCandidate[] = [
  { coupleId: 10, dancer1: "A", dancer2: "B" },
  { coupleId: 20, dancer1: "C", dancer2: "D" },
  { coupleId: 30, dancer1: "E", dancer2: "F" },
];

function response() {
  const state: {
    status: number;
    body: unknown;
    headers: Record<string, string>;
  } = { status: 200, body: null, headers: {} };
  const res = {
    setHeader(name: string, value: string) {
      state.headers[name] = value;
      return res;
    },
    status(code: number) {
      state.status = code;
      return res;
    },
    json(value: unknown) {
      state.body = value;
      return res;
    },
  };
  return { res, state };
}

function request(
  method: string,
  body?: unknown,
  cookie?: string,
) {
  return {
    method,
    body,
    query: { year: "2026", category: "pista" },
    headers: {
      cookie,
      "x-forwarded-for": "203.0.113.10",
    },
    socket: { remoteAddress: "203.0.113.10" },
  };
}

function validBody() {
  return {
    year: 2026,
    category: "pista",
    voter: {
      firstName: "Ada",
      lastName: "Lovelace",
      country: "AR",
      community: "Test community",
    },
    picks: [
      { rank: 1, coupleId: 10 },
      { rank: 2, coupleId: 20 },
      { rank: 3, coupleId: 30 },
    ],
    turnstileToken: "verified",
  };
}

function repository() {
  const ballots: BallotRow[] = [];
  const deps: PicksDependencies = {
    candidatePool: async () => ({ stage: "semifinal", candidates }),
    findByToken: async () => ballots[0] ?? null,
    insert: async (input) => {
      const row: BallotRow = {
        id: "ballot-1",
        year: input.year,
        category: input.category,
        voter_first_name: input.voter.firstName,
        voter_last_name: input.voter.lastName,
        voter_country: input.voter.country,
        voter_community: input.voter.community,
        picks: input.picks,
        identity_hash: input.identityHash,
        ip_hash: input.ipHash,
        edit_token_hash: input.editTokenHash,
        created_at: "2026-08-30T00:00:00Z",
        updated_at: "2026-08-30T00:00:00Z",
      };
      ballots.push(row);
      return row;
    },
    list: async () => ballots,
    recentIpCount: async () => 0,
    update: async (input) => {
      const row = ballots[0]!;
      row.voter_first_name = input.voter.firstName;
      row.voter_last_name = input.voter.lastName;
      row.voter_country = input.voter.country;
      row.voter_community = input.voter.community;
      row.picks = input.picks;
      row.identity_hash = input.identityHash;
      row.ip_hash = input.ipHash;
      row.updated_at = "2026-08-30T01:00:00Z";
      return row;
    },
    verifySecurity: async () => undefined,
  };
  return { ballots, deps };
}

test("POST creates one ballot, sets an HttpOnly cookie, and GET aggregates it", async () => {
  const { deps } = repository();
  const handler = createPicksHandler(deps);
  const posted = response();
  await handler(request("POST", validBody()) as never, posted.res as never);
  assert.equal(posted.state.status, 201);
  assert.match(posted.state.headers["Set-Cookie"] ?? "", /HttpOnly; SameSite=Lax/);

  const loaded = response();
  await handler(request("GET") as never, loaded.res as never);
  assert.equal(loaded.state.status, 200);
  const snapshot = loaded.state.body as {
    ballotCount: number;
    leaderboard: Array<{ coupleId: number; points: number }>;
  };
  assert.equal(snapshot.ballotCount, 1);
  assert.deepEqual(
    snapshot.leaderboard.map((entry) => [entry.coupleId, entry.points]),
    [
      [10, 3],
      [20, 2],
      [30, 1],
    ],
  );
});

test("PATCH requires the anonymous edit cookie", async () => {
  const { deps } = repository();
  const handler = createPicksHandler(deps);
  const result = response();
  await handler(request("PATCH", validBody()) as never, result.res as never);
  assert.equal(result.state.status, 401);
  assert.equal((result.state.body as { code: string }).code, "edit_token_missing");
});

test("network rate limit blocks a fourth new ballot", async () => {
  const { deps } = repository();
  deps.recentIpCount = async () => 3;
  const handler = createPicksHandler(deps);
  const result = response();
  await handler(request("POST", validBody()) as never, result.res as never);
  assert.equal(result.state.status, 429);
  assert.equal((result.state.body as { code: string }).code, "rate_limited");
});

test("database identity uniqueness becomes a generic duplicate response", async () => {
  const { deps } = repository();
  deps.insert = async () => {
    throw Object.assign(new Error("unique"), { code: "23505" });
  };
  const handler = createPicksHandler(deps);
  const result = response();
  await handler(request("POST", validBody()) as never, result.res as never);
  assert.equal(result.state.status, 409);
  assert.equal((result.state.body as { code: string }).code, "duplicate_ballot");
});

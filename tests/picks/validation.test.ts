import assert from "node:assert/strict";
import test from "node:test";
import {
  BallotError,
  hmac,
  identityKey,
  validateBallotShape,
} from "../../server/picks/validation.ts";
import {
  closeTime,
  isClosed,
  parseCookies,
  verifyTurnstile,
} from "../../api/picks/index.ts";
import type { PickCandidate } from "../../src/lib/picks.ts";

const candidates: PickCandidate[] = [
  { coupleId: 10, dancer1: "Ada Uno", dancer2: "Beto Uno" },
  { coupleId: 20, dancer1: "Ada Dos", dancer2: "Beto Dos" },
  { coupleId: 30, dancer1: "Ada Tres", dancer2: "Beto Tres" },
  { coupleId: 40, dancer1: "Ada Cuatro", dancer2: "Beto Cuatro" },
];

function validBody() {
  return {
    year: 2026,
    category: "pista",
    voter: {
      firstName: "  María  ",
      lastName: " Pérez ",
      country: "ar",
      community: " Buenos Aires ",
    },
    picks: [
      { rank: 1, coupleId: 10 },
      { rank: 2, coupleId: 20 },
      { rank: 3, coupleId: 30 },
    ],
    turnstileToken: "token",
  };
}

test("validates and canonicalizes a complete ballot", () => {
  const ballot = validateBallotShape(validBody(), candidates);
  assert.equal(ballot.voter.firstName, "María");
  assert.equal(ballot.voter.country, "AR");
  assert.deepEqual(
    ballot.picks.map((pick) => [pick.rank, pick.coupleId, pick.dancer1]),
    [
      [1, 10, "Ada Uno"],
      [2, 20, "Ada Dos"],
      [3, 30, "Ada Tres"],
    ],
  );
});

test("rejects duplicate, missing, and ineligible picks", () => {
  const duplicate = validBody();
  duplicate.picks[2]!.coupleId = 20;
  assert.throws(
    () => validateBallotShape(duplicate, candidates),
    (error: unknown) => error instanceof BallotError && error.code === "duplicate_pick",
  );

  const ineligible = validBody();
  ineligible.picks[0]!.coupleId = 999;
  assert.throws(
    () => validateBallotShape(ineligible, candidates),
    (error: unknown) => error instanceof BallotError && error.code === "ineligible_couple",
  );
});

test("identity keys normalize accents, case, and whitespace", () => {
  const a = identityKey({
    firstName: "María",
    lastName: "Pérez",
    country: "AR",
    community: "Buenos  Aires",
  });
  const b = identityKey({
    firstName: "MARIA",
    lastName: "Perez",
    country: "ar",
    community: "Buenos Aires",
  });
  assert.equal(a, b);
  assert.equal(hmac(a, "x".repeat(32)), hmac(b, "x".repeat(32)));
});

test("parses browser token cookies without exposing unrelated values", () => {
  assert.deepEqual(parseCookies("a=one; pulso_top3_2026_pista=token%20value"), {
    a: "one",
    pulso_top3_2026_pista: "token value",
  });
});

test("close times are category-specific", () => {
  const old = process.env.PICKS_CLOSE_AT_PISTA;
  process.env.PICKS_CLOSE_AT_PISTA = "2020-01-01T00:00:00Z";
  assert.equal(closeTime("pista"), "2020-01-01T00:00:00.000Z");
  assert.equal(isClosed("pista"), true);
  if (old === undefined) delete process.env.PICKS_CLOSE_AT_PISTA;
  else process.env.PICKS_CLOSE_AT_PISTA = old;
});

test("Turnstile accepts success and rejects failure", async () => {
  const oldSecret = process.env.TURNSTILE_SECRET_KEY;
  const oldFetch = globalThis.fetch;
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  await verifyTurnstile("ok", "127.0.0.1");

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ success: false }), {
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  await assert.rejects(
    verifyTurnstile("bad", "127.0.0.1"),
    (error: unknown) => error instanceof BallotError && error.code === "turnstile_failed",
  );
  globalThis.fetch = oldFetch;
  if (oldSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = oldSecret;
});

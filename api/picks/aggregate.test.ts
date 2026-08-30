import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregatePicks,
  assignNextPick,
  movePick,
  type PickCandidate,
  type PickSelection,
} from "../../src/lib/picks.ts";

function ballot(ids: [number, number, number], names = "Couple") {
  return {
    picks: ids.map((coupleId, index) => ({
      rank: (index + 1) as 1 | 2 | 3,
      coupleId,
      dancer1: `${names} ${coupleId}A`,
      dancer2: `${names} ${coupleId}B`,
    })) as Required<PickSelection>[],
  };
}

test("community ranking scores first 3, second 2, and third 1", () => {
  const ranking = aggregatePicks([
    ballot([10, 20, 30]),
    ballot([20, 10, 30]),
    ballot([10, 30, 20]),
  ]);
  assert.deepEqual(
    ranking.map((entry) => ({
      id: entry.coupleId,
      points: entry.points,
      first: entry.first,
      second: entry.second,
      third: entry.third,
    })),
    [
      { id: 10, points: 8, first: 2, second: 1, third: 0 },
      { id: 20, points: 6, first: 1, second: 1, third: 1 },
      { id: 30, points: 4, first: 0, second: 1, third: 2 },
    ],
  );
});

test("community ranking stays category-local when passed category-local ballots", () => {
  const pista = aggregatePicks([ballot([10, 20, 30], "Pista")]);
  const escenario = aggregatePicks([ballot([40, 50, 60], "Escenario")]);
  assert.deepEqual(pista.map((entry) => entry.coupleId), [10, 20, 30]);
  assert.deepEqual(escenario.map((entry) => entry.coupleId), [40, 50, 60]);
});

test("picker assigns the next empty podium spot and prevents duplicates", () => {
  const first: PickCandidate = { coupleId: 10, dancer1: "A", dancer2: "B" };
  const second: PickCandidate = { coupleId: 20, dancer1: "C", dancer2: "D" };
  const one = assignNextPick([null, null, null], first);
  assert.deepEqual(one.map((pick) => pick?.coupleId ?? null), [10, null, null]);
  const two = assignNextPick(one, second);
  assert.deepEqual(two.map((pick) => pick?.coupleId ?? null), [10, 20, null]);
  assert.equal(assignNextPick(two, first), two);
});

test("picker reorders podium spots without losing a couple", () => {
  const slots: PickCandidate[] = [
    { coupleId: 10, dancer1: "A", dancer2: "B" },
    { coupleId: 20, dancer1: "C", dancer2: "D" },
    { coupleId: 30, dancer1: "E", dancer2: "F" },
  ];
  assert.deepEqual(
    movePick(slots, 1, -1).map((pick) => pick?.coupleId),
    [20, 10, 30],
  );
  assert.equal(movePick(slots, 0, -1), slots);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  clearCandidatePoolCache,
  getCandidatePool,
} from "../../server/picks/candidates.ts";

test("loads separate eligible candidate pools for Pista and Escenario", async () => {
  clearCandidatePoolCache();
  const [pista, escenario] = await Promise.all([
    getCandidatePool("pista"),
    getCandidatePool("escenario"),
  ]);
  assert.ok(pista.candidates.length > 0);
  assert.ok(escenario.candidates.length > 0);
  assert.notEqual(pista.stage, "");
  assert.notEqual(escenario.stage, "");
  assert.notDeepEqual(
    pista.candidates.map((candidate) => candidate.coupleId),
    escenario.candidates.map((candidate) => candidate.coupleId),
  );
  assert.equal(new Set(pista.candidates.map((candidate) => candidate.coupleId)).size, pista.candidates.length);
});

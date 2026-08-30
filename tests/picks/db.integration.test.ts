import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  getRedis,
  insertBallot,
  listBallots,
} from "../../server/picks/db.ts";

test(
  "creates and reads an immutable anonymous ballot",
  {
    skip:
      !process.env.TEST_UPSTASH_REDIS_REST_URL ||
      !process.env.TEST_UPSTASH_REDIS_REST_TOKEN,
  },
  async () => {
    process.env.UPSTASH_REDIS_REST_URL = process.env.TEST_UPSTASH_REDIS_REST_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = process.env.TEST_UPSTASH_REDIS_REST_TOKEN;
    const marker = randomUUID().replaceAll("-", "");
    const identityHash = marker.padEnd(64, "0");
    const ipHash = marker.padEnd(64, "1");
    const editTokenHash = marker.padEnd(64, "2");
    const created = await insertBallot({
      year: 2026,
      category: "pista",
      voter: {
        firstName: "Integration",
        lastName: "Test",
        country: "AR",
        community: "",
      },
      picks: [
        { rank: 1, coupleId: 1, dancer1: "A", dancer2: "B" },
        { rank: 2, coupleId: 2, dancer1: "C", dancer2: "D" },
        { rank: 3, coupleId: 3, dancer1: "E", dancer2: "F" },
      ],
      identityHash,
      ipHash,
      editTokenHash,
    });
    try {
      const rows = await listBallots(2026, "pista");
      const loaded = rows.find((row) => row.id === created.id);
      assert.equal(loaded?.voter_country.trim(), "AR");
      assert.equal(loaded?.picks[0]!.coupleId, 1);
    } finally {
      const redis = getRedis();
      await redis.del(
        `top3:ballot:2026:pista:${created.id}`,
        `top3:identity:2026:pista:${identityHash}`,
        `top3:ip:2026:pista:${ipHash}`,
      );
      await redis.srem("top3:index:2026:pista", created.id);
    }
  },
);

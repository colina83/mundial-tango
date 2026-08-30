import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { Category } from "../../src/types.ts";
import type { PickSelection, VoterInput } from "../../src/lib/picks.ts";

export interface BallotRow {
  id: string;
  year: number;
  category: Category;
  voter_first_name: string;
  voter_last_name: string;
  voter_country: string;
  voter_community: string;
  picks: Required<PickSelection>[];
  identity_hash: string;
  ip_hash: string;
  edit_token_hash: string;
  created_at: string;
  updated_at: string;
}

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("Upstash Redis REST credentials are not configured.");
  }
  client = new Redis({ url, token });
  return client;
}

function indexKey(year: number, category: Category): string {
  return `top3:index:${year}:${category}`;
}

function ballotKey(year: number, category: Category, id: string): string {
  return `top3:ballot:${year}:${category}:${id}`;
}

function tokenKey(year: number, category: Category, hash: string): string {
  return `top3:token:${year}:${category}:${hash}`;
}

function identityKey(year: number, category: Category, hash: string): string {
  return `top3:identity:${year}:${category}:${hash}`;
}

function ipKey(year: number, category: Category, hash: string): string {
  return `top3:ip:${year}:${category}:${hash}`;
}

function duplicateError(): Error & { code: string } {
  return Object.assign(new Error("Duplicate ballot identity."), { code: "23505" });
}

export async function listBallots(
  year: number,
  category: Category,
): Promise<BallotRow[]> {
  const redis = getRedis();
  const ids = await redis.smembers<string[]>(indexKey(year, category));
  const ballots = await Promise.all(
    ids.map((id) => redis.get<BallotRow>(ballotKey(year, category, id))),
  );
  return ballots
    .filter((ballot): ballot is BallotRow => ballot !== null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function findBallotByToken(
  year: number,
  category: Category,
  tokenHash: string,
): Promise<BallotRow | null> {
  const redis = getRedis();
  const id = await redis.get<string>(tokenKey(year, category, tokenHash));
  return id ? redis.get<BallotRow>(ballotKey(year, category, id)) : null;
}

export async function recentIpBallotCount(
  year: number,
  category: Category,
  ipHash: string,
): Promise<number> {
  const redis = getRedis();
  return redis.zcount(ipKey(year, category, ipHash), Date.now() - 86_400_000, "+inf");
}

export async function insertBallot(input: {
  year: number;
  category: Category;
  voter: VoterInput;
  picks: Required<PickSelection>[];
  identityHash: string;
  ipHash: string;
  editTokenHash: string;
}): Promise<BallotRow> {
  const redis = getRedis();
  const id = randomUUID();
  const identity = identityKey(input.year, input.category, input.identityHash);
  const claimed = await redis.set(identity, id, { nx: true });
  if (claimed !== "OK") throw duplicateError();
  const now = new Date().toISOString();
  const row: BallotRow = {
    id,
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
    created_at: now,
    updated_at: now,
  };
  try {
    await redis.set(ballotKey(input.year, input.category, id), row);
    await redis.sadd(indexKey(input.year, input.category), id);
    await redis.set(tokenKey(input.year, input.category, input.editTokenHash), id);
    const rateKey = ipKey(input.year, input.category, input.ipHash);
    await redis.zadd(rateKey, { score: Date.now(), member: id });
    await redis.expire(rateKey, 172800);
    return row;
  } catch (error) {
    await Promise.all([
      redis.del(identity),
      redis.del(ballotKey(input.year, input.category, id)),
      redis.del(tokenKey(input.year, input.category, input.editTokenHash)),
      redis.srem(indexKey(input.year, input.category), id),
      redis.zrem(ipKey(input.year, input.category, input.ipHash), id),
    ]);
    throw error;
  }
}

export async function updateBallot(input: {
  id: string;
  year: number;
  category: Category;
  voter: VoterInput;
  picks: Required<PickSelection>[];
  identityHash: string;
  ipHash: string;
}): Promise<BallotRow> {
  const redis = getRedis();
  const key = ballotKey(input.year, input.category, input.id);
  const existing = await redis.get<BallotRow>(key);
  if (!existing) throw new Error("Ballot not found.");
  if (existing.identity_hash !== input.identityHash) {
    const nextIdentity = identityKey(input.year, input.category, input.identityHash);
    const claimed = await redis.set(nextIdentity, input.id, { nx: true });
    if (claimed !== "OK") throw duplicateError();
    try {
      const row: BallotRow = {
        ...existing,
        voter_first_name: input.voter.firstName,
        voter_last_name: input.voter.lastName,
        voter_country: input.voter.country,
        voter_community: input.voter.community,
        picks: input.picks,
        identity_hash: input.identityHash,
        ip_hash: input.ipHash,
        updated_at: new Date().toISOString(),
      };
      await redis.set(key, row);
      const oldIdentity = identityKey(input.year, input.category, existing.identity_hash);
      if ((await redis.get<string>(oldIdentity)) === input.id) await redis.del(oldIdentity);
      return row;
    } catch (error) {
      await redis.del(nextIdentity);
      throw error;
    }
  }
  const row: BallotRow = {
    ...existing,
    voter_first_name: input.voter.firstName,
    voter_last_name: input.voter.lastName,
    voter_country: input.voter.country,
    voter_community: input.voter.community,
    picks: input.picks,
    identity_hash: input.identityHash,
    ip_hash: input.ipHash,
    updated_at: new Date().toISOString(),
  };
  await redis.set(key, row);
  return row;
}

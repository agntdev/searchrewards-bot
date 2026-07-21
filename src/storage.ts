/**
 * Persistent storage layer for durable domain data (Users, Wallets, Referrals, Withdrawals).
 * Uses Redis (via the toolkit's RedisSessionStorage pattern) for persistence.
 * Falls back to in-memory if REDIS_URL is not set (development/testing).
 */

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
};

let redisClient: RedisLike | null = null;

async function getRedis(): Promise<RedisLike> {
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL;
  if (!url) {
    // In-memory fallback for dev/testing
    const store = new Map<string, string>();
    redisClient = {
      async get(key) { return store.get(key) ?? null; },
      async set(key, value) { store.set(key, value); },
      async del(key) { store.delete(key); },
      async keys(pattern) {
        const prefix = pattern.replace("*", "");
        return [...store.keys()].filter(k => k.startsWith(prefix));
      },
    };
    return redisClient;
  }

  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const ioredis: any = require("ioredis");
  const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
  const client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  redisClient = {
    async get(key) { return client.get(key); },
    async set(key, value) { return client.set(key, value); },
    async del(key) { return client.del(key); },
    async keys(pattern) { return client.keys(pattern); },
  };
  return redisClient;
}

// ─── Data Types ────────────────────────────────────────────────

export interface User {
  id: string;           // Telegram user ID as string
  name: string;
  username?: string;
  referrer_id?: string;
  registration_date: string; // ISO date
}

export interface Wallet {
  user_id: string;
  balance: number;      // in cents (e.g., 100 = $1.00)
  pending_withdrawals: number; // cents
}

export interface Referral {
  referrer_id: string;
  referee_id: string;
  first_search_date?: string;
  credited: boolean;
}

export interface WithdrawalRequest {
  id: string;
  user_id: string;
  amount: number;       // cents
  method: string;
  account_details: string;
  status: "pending" | "approved" | "rejected" | "paid";
  created_at: string;
}

// ─── Index Records ─────────────────────────────────────────────

// We maintain explicit index records to avoid keyspace scans:
// - User index: sr:users → string[] of user IDs
// - Referrer index: sr:referrer:{referrerId} → string[] of referee IDs
// - Pending withdrawals: sr:withdrawals:pending → string[] of withdrawal IDs

// ─── User Functions ────────────────────────────────────────────

export async function getUser(userId: string): Promise<User | null> {
  const redis = await getRedis();
  const raw = await redis.get(`sr:user:${userId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveUser(user: User): Promise<void> {
  const redis = await getRedis();
  await redis.set(`sr:user:${user.id}`, JSON.stringify(user));

  // Update user index
  const indexRaw = await redis.get("sr:users");
  const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
  if (!index.includes(user.id)) {
    index.push(user.id);
    await redis.set("sr:users", JSON.stringify(index));
  }
}

export async function getAllUserIds(): Promise<string[]> {
  const redis = await getRedis();
  const indexRaw = await redis.get("sr:users");
  return indexRaw ? JSON.parse(indexRaw) : [];
}

export async function getUserCount(): Promise<number> {
  const ids = await getAllUserIds();
  return ids.length;
}

// ─── Wallet Functions ──────────────────────────────────────────

export async function getWallet(userId: string): Promise<Wallet> {
  const redis = await getRedis();
  const raw = await redis.get(`sr:wallet:${userId}`);
  if (raw) return JSON.parse(raw);
  // Default wallet
  return { user_id: userId, balance: 0, pending_withdrawals: 0 };
}

export async function saveWallet(wallet: Wallet): Promise<void> {
  const redis = await getRedis();
  await redis.set(`sr:wallet:${wallet.user_id}`, JSON.stringify(wallet));
}

export async function creditBalance(userId: string, cents: number): Promise<void> {
  const wallet = await getWallet(userId);
  wallet.balance += cents;
  await saveWallet(wallet);
}

// ─── Referral Functions ────────────────────────────────────────

export async function getReferral(referrerId: string, refereeId: string): Promise<Referral | null> {
  const redis = await getRedis();
  const raw = await redis.get(`sr:referral:${referrerId}:${refereeId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveReferral(referral: Referral): Promise<void> {
  const redis = await getRedis();
  await redis.set(
    `sr:referral:${referral.referrer_id}:${referral.referee_id}`,
    JSON.stringify(referral),
  );

  // Update referrer index
  const indexRaw = await redis.get(`sr:referrer:${referral.referrer_id}`);
  const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
  if (!index.includes(referral.referee_id)) {
    index.push(referral.referee_id);
    await redis.set(`sr:referrer:${referral.referrer_id}`, JSON.stringify(index));
  }
}

export async function getRefereeIdsForReferrer(referrerId: string): Promise<string[]> {
  const redis = await getRedis();
  const indexRaw = await redis.get(`sr:referrer:${referrerId}`);
  return indexRaw ? JSON.parse(indexRaw) : [];
}

export async function getReferralCountForReferrer(referrerId: string): Promise<number> {
  const ids = await getRefereeIdsForReferrer(referrerId);
  return ids.length;
}

// ─── Withdrawal Functions ──────────────────────────────────────

export async function getWithdrawal(id: string): Promise<WithdrawalRequest | null> {
  const redis = await getRedis();
  const raw = await redis.get(`sr:withdrawal:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveWithdrawal(withdrawal: WithdrawalRequest): Promise<void> {
  const redis = await getRedis();
  await redis.set(`sr:withdrawal:${withdrawal.id}`, JSON.stringify(withdrawal));

  // Update pending withdrawals index
  if (withdrawal.status === "pending") {
    const indexRaw = await redis.get("sr:withdrawals:pending");
    const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
    if (!index.includes(withdrawal.id)) {
      index.push(withdrawal.id);
      await redis.set("sr:withdrawals:pending", JSON.stringify(index));
    }
  }
}

export async function removeWithdrawalFromPending(id: string): Promise<void> {
  const redis = await getRedis();
  const indexRaw = await redis.get("sr:withdrawals:pending");
  const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
  const filtered = index.filter(wid => wid !== id);
  await redis.set("sr:withdrawals:pending", JSON.stringify(filtered));
}

export async function getPendingWithdrawalIds(): Promise<string[]> {
  const redis = await getRedis();
  const indexRaw = await redis.get("sr:withdrawals:pending");
  return indexRaw ? JSON.parse(indexRaw) : [];
}

export async function getPendingWithdrawals(): Promise<WithdrawalRequest[]> {
  const ids = await getPendingWithdrawalIds();
  const withdrawals: WithdrawalRequest[] = [];
  for (const id of ids) {
    const w = await getWithdrawal(id);
    if (w) withdrawals.push(w);
  }
  return withdrawals;
}

export async function getPendingWithdrawalsCount(): Promise<number> {
  const ids = await getPendingWithdrawalIds();
  return ids.length;
}

// ─── Settings (Admin-configurable) ─────────────────────────────

export interface BotSettings {
  referral_reward_cents: number;  // default 1 (=$0.01)
  min_withdrawal_cents: number;   // default 100 (=$1.00)
  max_withdrawal_cents: number;   // default 10000 (=$100.00)
  admin_chat_id?: string;         // Telegram chat ID for admin notifications
}

const DEFAULT_SETTINGS: BotSettings = {
  referral_reward_cents: 1,
  min_withdrawal_cents: 100,
  max_withdrawal_cents: 10000,
};

export async function getSettings(): Promise<BotSettings> {
  const redis = await getRedis();
  const raw = await redis.get("sr:settings");
  return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: Partial<BotSettings>): Promise<void> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  const redis = await getRedis();
  await redis.set("sr:settings", JSON.stringify(updated));
}

// ─── ID Generation ─────────────────────────────────────────────

export function generateWithdrawalId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `w-${timestamp}-${random}`;
}

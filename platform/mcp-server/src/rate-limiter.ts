/**
 * Sliding-window rate limiter using Redis INCR + TTL.
 *
 * Key format: rate_limit:{client_id}:{window_minute}
 * Each key counts requests within a 1-minute window and expires after 2 minutes.
 *
 * Config via environment:
 *   RATE_LIMIT_DEFAULT_RPM  — default requests-per-minute (default: 60)
 *   RATE_LIMIT_REDIS_URL    — Redis URL (default: redis://redis:6379/0)
 *   RATE_LIMIT_OVERRIDES    — JSON map of client_id → rpm override
 *                             e.g. '{"ci-bot": 120, "admin": 0}'  (0 = unlimited)
 */

import Redis from "ioredis";

const REDIS_URL = process.env.RATE_LIMIT_REDIS_URL ?? process.env.REDIS_URL ?? "redis://redis:6379/0";
const DEFAULT_RPM = parseInt(process.env.RATE_LIMIT_DEFAULT_RPM ?? "60", 10);
const WINDOW_SECONDS = 60;

// Parse per-client overrides once at startup
const CLIENT_OVERRIDES: Record<string, number> = (() => {
  try {
    const raw = process.env.RATE_LIMIT_OVERRIDES;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
})();

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(REDIS_URL, {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    _redis.on("error", () => {
      // Swallow — rate limiting degrades gracefully when Redis is unavailable
    });
  }
  return _redis;
}

export interface RateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  retry_after: number; // seconds until window resets
}

/**
 * Check and increment the sliding-window counter for `clientId`.
 * Returns `allowed=true` if under quota, `allowed=false` with `retry_after` if exceeded.
 * Falls back to allowing the request if Redis is unavailable.
 */
export async function checkRateLimit(clientId: string): Promise<RateLimitResult> {
  const rpm = CLIENT_OVERRIDES[clientId] ?? DEFAULT_RPM;

  // 0 = unlimited
  if (rpm === 0) {
    return { allowed: true, current: 0, limit: 0, retry_after: 0 };
  }

  const windowMinute = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const key = `rate_limit:${clientId}:${windowMinute}`;

  try {
    const redis = getRedis();
    const current = await redis.incr(key);
    if (current === 1) {
      // First request in this window — set TTL
      await redis.expire(key, WINDOW_SECONDS * 2);
    }

    const secondsIntoWindow = Math.floor(Date.now() / 1000) % WINDOW_SECONDS;
    const retry_after = WINDOW_SECONDS - secondsIntoWindow;

    if (current > rpm) {
      return { allowed: false, current, limit: rpm, retry_after };
    }
    return { allowed: true, current, limit: rpm, retry_after: 0 };
  } catch {
    // Redis unavailable — fail open (allow)
    return { allowed: true, current: 0, limit: rpm, retry_after: 0 };
  }
}

/**
 * Extract a client_id from tool arguments or fall back to env/default.
 * Priority: args.client_id → args.user_id → MCP_CLIENT_ID env → "anonymous"
 */
export function extractClientId(args: unknown): string {
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    if (typeof a.client_id === "string" && a.client_id) return a.client_id;
    if (typeof a.user_id === "string" && a.user_id) return a.user_id;
  }
  return process.env.MCP_CLIENT_ID ?? "anonymous";
}

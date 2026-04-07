import { config } from '../config.js';

// In-memory only — intentionally not persisted. Resets on restart, which is acceptable.
const limits = new Map(); // userId -> { count, resetAt }

export function checkRateLimit(userId) {
  const now = Date.now();
  const entry = limits.get(userId);

  if (!entry || now >= entry.resetAt) {
    // New window
    limits.set(userId, { count: 1, resetAt: now + config.rateLimitWindowMs });
    return { allowed: true };
  }

  if (entry.count >= config.rateLimitMax) {
    return { allowed: false };
  }

  entry.count++;
  return { allowed: true };
}

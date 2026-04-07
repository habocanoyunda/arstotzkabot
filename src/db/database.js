import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use Fly volume path in production, local path in development
const DB_PATH = process.env.FLY_APP_NAME ? '/data/bot.db' : join(__dirname, '../../bot.db');

let db;

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL'); // Better concurrency
  db.pragma('foreign_keys = ON');
  runMigrations();
  return db;
}

function runMigrations() {
  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  // Track applied migrations so we can add new ones safely later
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at INTEGER)`);

  for (const file of files) {
    const already = db.prepare('SELECT 1 FROM _migrations WHERE filename = ?').get(file);
    if (already) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)').run(file, Date.now());
    console.log(`[db] Applied migration: ${file}`);
  }
}

// --- guild_config ---

export function getGuildConfig(guildId) {
  return getDb().prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
}

export function upsertGuildConfig(guildId, judgeRoleId, historyRoleId) {
  getDb().prepare(`
    INSERT INTO guild_config (guild_id, judge_role_id, history_role_id, setup_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      judge_role_id = excluded.judge_role_id,
      history_role_id = excluded.history_role_id,
      setup_at = excluded.setup_at
  `).run(guildId, judgeRoleId, historyRoleId, Math.floor(Date.now() / 1000));
}

// --- case_log ---

export function insertCase({ guildId, targetUserId, judgeUserId, verdict, reasoning, evidence, durationMinutes }) {
  return getDb().prepare(`
    INSERT INTO case_log (guild_id, target_user_id, judge_user_id, verdict, reasoning, evidence, duration_minutes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, targetUserId, judgeUserId, verdict, reasoning, evidence ?? null, durationMinutes ?? null, Math.floor(Date.now() / 1000));
}

export function getCaseHistory(guildId, targetUserId, limit = 10) {
  return getDb().prepare(`
    SELECT * FROM case_log
    WHERE guild_id = ? AND target_user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(guildId, targetUserId, limit);
}

export function getCaseCount(guildId, targetUserId) {
  return getDb().prepare(`
    SELECT COUNT(*) as count FROM case_log WHERE guild_id = ? AND target_user_id = ?
  `).get(guildId, targetUserId).count;
}

// --- user_memory ---

export function getMemory(guildId, targetUserId) {
  return getDb().prepare('SELECT * FROM user_memory WHERE guild_id = ? AND target_user_id = ?').get(guildId, targetUserId);
}

export function setMemory(guildId, targetUserId, memoryText, setBy) {
  getDb().prepare(`
    INSERT INTO user_memory (guild_id, target_user_id, memory_text, set_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, target_user_id) DO UPDATE SET
      memory_text = excluded.memory_text,
      set_by = excluded.set_by,
      updated_at = excluded.updated_at
  `).run(guildId, targetUserId, memoryText, setBy, Math.floor(Date.now() / 1000));
}

export function clearMemory(guildId, targetUserId) {
  return getDb().prepare('DELETE FROM user_memory WHERE guild_id = ? AND target_user_id = ?').run(guildId, targetUserId);
}

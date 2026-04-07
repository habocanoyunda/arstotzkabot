CREATE TABLE IF NOT EXISTS guild_config (
  guild_id        TEXT PRIMARY KEY,
  judge_role_id   TEXT,
  history_role_id TEXT,
  setup_at        INTEGER
);

CREATE TABLE IF NOT EXISTS case_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT NOT NULL,
  target_user_id   TEXT NOT NULL,
  judge_user_id    TEXT NOT NULL,
  verdict          TEXT NOT NULL,
  reasoning        TEXT NOT NULL,
  evidence         TEXT,
  duration_minutes INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_memory (
  guild_id        TEXT NOT NULL,
  target_user_id  TEXT NOT NULL,
  memory_text     TEXT NOT NULL,
  set_by          TEXT NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (guild_id, target_user_id)
);

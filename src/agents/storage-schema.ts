export function ensureAgentStorageSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      instructions TEXT NOT NULL,
      profile TEXT NOT NULL,
      model TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      max_output_tokens INTEGER NOT NULL,
      temperature REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      coordinator_agent_id TEXT NOT NULL,
      member_agent_ids_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      max_rounds INTEGER NOT NULL,
      expected_input_tokens_per_call INTEGER NOT NULL,
      expected_output_tokens_per_call INTEGER NOT NULL,
      max_budget_usd REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      state_json TEXT NOT NULL,
      estimate_json TEXT NOT NULL,
      final_result TEXT,
      error TEXT,
      cancellation_requested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_status_created ON runs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_team_created ON runs(team_id, created_at);
  `);
}

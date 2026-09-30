export function ensureAgentStorageSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      instructions TEXT NOT NULL,
      profile TEXT NOT NULL,
      model TEXT,
      kind TEXT NOT NULL DEFAULT 'specialist',
      tool_policy TEXT NOT NULL DEFAULT 'none',
      allowed_plugin_ids_json TEXT NOT NULL DEFAULT '[]',
      max_tool_calls INTEGER NOT NULL DEFAULT 0,
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
      strategy TEXT NOT NULL DEFAULT 'legacy',
      max_parallel INTEGER NOT NULL DEFAULT 1,
      review_policy TEXT NOT NULL DEFAULT 'on_uncertainty',
      primary_context_tokens INTEGER NOT NULL DEFAULT 2500,
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
    CREATE TABLE IF NOT EXISTS run_capabilities (
      run_id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      base_url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runs_status_created ON runs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_team_created ON runs(team_id, created_at);
  `);

  // Existing AgentManager instances predate Agent v2. SQLite CREATE TABLE IF NOT
  // EXISTS does not add new columns, so migrate them conservatively in place.
  addColumn(sql, "agents", "kind TEXT NOT NULL DEFAULT 'specialist'");
  addColumn(sql, "agents", "tool_policy TEXT NOT NULL DEFAULT 'none'");
  addColumn(sql, "agents", "allowed_plugin_ids_json TEXT NOT NULL DEFAULT '[]'");
  addColumn(sql, "agents", "max_tool_calls INTEGER NOT NULL DEFAULT 0");
  addColumn(sql, "teams", "strategy TEXT NOT NULL DEFAULT 'legacy'");
  addColumn(sql, "teams", "max_parallel INTEGER NOT NULL DEFAULT 1");
  addColumn(sql, "teams", "review_policy TEXT NOT NULL DEFAULT 'on_uncertainty'");
  addColumn(sql, "teams", "primary_context_tokens INTEGER NOT NULL DEFAULT 2500");
}

function addColumn(sql: SqlStorage, table: string, definition: string): void {
  try {
    sql.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/duplicate column name|already exists/i.test(message)) throw error;
  }
}

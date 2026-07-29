import { agentFromRow, runFromRow, teamFromRow } from "./records";
import { ensureAgentStorageSchema } from "./storage-schema";
import type {
  AgentDefinition,
  AgentRecord,
  AgentRow,
  RunRecord,
  RunRow,
  RunStatus,
  TeamRecord,
  TeamRow,
} from "./types";
import { validateTeamMembers } from "./utils";

export class AgentRepository {
  constructor(private readonly sql: SqlStorage) {}

  ensureSchema(): void {
    ensureAgentStorageSchema(this.sql);
  }

  listAgents(includeDisabled: boolean): AgentRecord[] {
    const rows = this.rows<AgentRow>(
      `SELECT * FROM agents ${includeDisabled ? "" : "WHERE enabled = 1"} ORDER BY created_at ASC`,
    );
    return rows.map(agentFromRow);
  }

  insertAgent(agent: AgentDefinition): AgentRecord {
    const now = new Date().toISOString();
    const record: AgentRecord = {
      id: crypto.randomUUID(),
      ...agent,
      created_at: now,
      updated_at: now,
    };
    this.sql.exec(
      "INSERT INTO agents (id, name, role, instructions, profile, model, enabled, max_output_tokens, temperature, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      record.id,
      record.name,
      record.role,
      record.instructions,
      record.profile,
      record.model ?? null,
      record.enabled ? 1 : 0,
      record.max_output_tokens,
      record.temperature,
      now,
      now,
    );
    return record;
  }

  updateAgent(id: string, patch: Partial<AgentDefinition> & { model?: string | null }): AgentRecord {
    const current = this.requireAgent(id);
    const next: AgentRecord = {
      ...current,
      ...patch,
      model: patch.model === null ? undefined : patch.model ?? current.model,
      id,
      created_at: current.created_at,
      updated_at: new Date().toISOString(),
    };
    this.sql.exec(
      "UPDATE agents SET name = ?, role = ?, instructions = ?, profile = ?, model = ?, enabled = ?, max_output_tokens = ?, temperature = ?, updated_at = ? WHERE id = ?",
      next.name,
      next.role,
      next.instructions,
      next.profile,
      next.model ?? null,
      next.enabled ? 1 : 0,
      next.max_output_tokens,
      next.temperature,
      next.updated_at,
      id,
    );
    return next;
  }

  deleteAgent(id: string): void {
    this.requireAgent(id);
    const used = this.one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM teams WHERE member_agent_ids_json LIKE ?",
      `%${id}%`,
    );
    if ((used?.count ?? 0) > 0) {
      throw new Error("The agent is still assigned to a team. Remove it from the team or delete the team first.");
    }
    this.sql.exec("DELETE FROM agents WHERE id = ?", id);
  }

  requireAgent(id: string): AgentRecord {
    const row = this.one<AgentRow>("SELECT * FROM agents WHERE id = ?", id);
    if (!row) throw new Error(`Agent not found: ${id}`);
    return agentFromRow(row);
  }

  listTeams(includeDisabled: boolean): TeamRecord[] {
    const rows = this.rows<TeamRow>(
      `SELECT * FROM teams ${includeDisabled ? "" : "WHERE enabled = 1"} ORDER BY created_at ASC`,
    );
    return rows.map(teamFromRow);
  }

  insertTeam(input: Omit<TeamRecord, "id" | "created_at" | "updated_at">): TeamRecord {
    validateTeamMembers(input.coordinator_agent_id, input.member_agent_ids);
    for (const id of input.member_agent_ids) this.requireAgent(id);
    const now = new Date().toISOString();
    const team: TeamRecord = {
      id: crypto.randomUUID(),
      ...input,
      created_at: now,
      updated_at: now,
    };
    this.sql.exec(
      "INSERT INTO teams (id, name, description, coordinator_agent_id, member_agent_ids_json, enabled, max_rounds, expected_input_tokens_per_call, expected_output_tokens_per_call, max_budget_usd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      team.id,
      team.name,
      team.description,
      team.coordinator_agent_id,
      JSON.stringify(team.member_agent_ids),
      team.enabled ? 1 : 0,
      team.max_rounds,
      team.expected_input_tokens_per_call,
      team.expected_output_tokens_per_call,
      team.max_budget_usd,
      now,
      now,
    );
    return team;
  }

  updateTeam(id: string, patch: Partial<TeamRecord>): TeamRecord {
    const current = this.requireTeam(id);
    const next: TeamRecord = {
      ...current,
      ...patch,
      max_budget_usd: patch.max_budget_usd === undefined
        ? current.max_budget_usd
        : patch.max_budget_usd,
      id,
      created_at: current.created_at,
      updated_at: new Date().toISOString(),
    };
    validateTeamMembers(next.coordinator_agent_id, next.member_agent_ids);
    for (const agentId of next.member_agent_ids) this.requireAgent(agentId);
    this.sql.exec(
      "UPDATE teams SET name = ?, description = ?, coordinator_agent_id = ?, member_agent_ids_json = ?, enabled = ?, max_rounds = ?, expected_input_tokens_per_call = ?, expected_output_tokens_per_call = ?, max_budget_usd = ?, updated_at = ? WHERE id = ?",
      next.name,
      next.description,
      next.coordinator_agent_id,
      JSON.stringify(next.member_agent_ids),
      next.enabled ? 1 : 0,
      next.max_rounds,
      next.expected_input_tokens_per_call,
      next.expected_output_tokens_per_call,
      next.max_budget_usd,
      next.updated_at,
      id,
    );
    return next;
  }

  deleteTeam(id: string, deleteAgents: boolean): { deleted_agents: boolean } {
    const team = this.requireTeam(id);
    this.sql.exec("DELETE FROM teams WHERE id = ?", id);
    if (deleteAgents) {
      for (const agentId of team.member_agent_ids) {
        const used = this.one<{ count: number }>(
          "SELECT COUNT(*) AS count FROM teams WHERE member_agent_ids_json LIKE ?",
          `%${agentId}%`,
        );
        if ((used?.count ?? 0) === 0) this.sql.exec("DELETE FROM agents WHERE id = ?", agentId);
      }
    }
    return { deleted_agents: deleteAgents };
  }

  requireTeam(id: string): TeamRecord {
    const row = this.one<TeamRow>("SELECT * FROM teams WHERE id = ?", id);
    if (!row) throw new Error(`Agent team not found: ${id}`);
    return teamFromRow(row);
  }

  listRuns(limit: number, teamId?: string | null): RunRecord[] {
    const rows = teamId
      ? this.rows<RunRow>("SELECT * FROM runs WHERE team_id = ? ORDER BY created_at DESC LIMIT ?", teamId, limit)
      : this.rows<RunRow>("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", limit);
    return rows.map(runFromRow);
  }

  insertRun(run: RunRecord): void {
    this.sql.exec(
      "INSERT INTO runs (id, team_id, task, status, stage, state_json, estimate_json, final_result, error, cancellation_requested, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, NULL)",
      run.id,
      run.team_id,
      run.task,
      run.status,
      run.stage,
      JSON.stringify(run.state),
      JSON.stringify(run.estimate),
      run.created_at,
      run.updated_at,
    );
  }

  requireRun(id: string): RunRecord {
    const row = this.one<RunRow>("SELECT * FROM runs WHERE id = ?", id);
    if (!row) throw new Error(`Agent run not found: ${id}`);
    return runFromRow(row);
  }

  nextPendingRun(): RunRecord | null {
    const row = this.one<RunRow>(
      "SELECT * FROM runs WHERE status IN ('queued', 'running') ORDER BY created_at ASC LIMIT 1",
    );
    return row ? runFromRow(row) : null;
  }

  markRunRunning(id: string): void {
    this.sql.exec("UPDATE runs SET status = 'running', updated_at = ? WHERE id = ?", new Date().toISOString(), id);
  }

  requestRunCancellation(id: string): RunRecord {
    const run = this.requireRun(id);
    const now = new Date().toISOString();
    this.sql.exec("UPDATE runs SET cancellation_requested = 1, updated_at = ? WHERE id = ?", now, id);
    return { ...run, cancellation_requested: true, updated_at: now };
  }

  saveRun(run: RunRecord): void {
    run.updated_at = new Date().toISOString();
    this.sql.exec(
      "UPDATE runs SET status = ?, stage = ?, state_json = ?, final_result = ?, error = ?, cancellation_requested = ?, updated_at = ?, completed_at = ? WHERE id = ?",
      run.status,
      run.stage,
      JSON.stringify(run.state),
      run.final_result,
      run.error,
      run.cancellation_requested ? 1 : 0,
      run.updated_at,
      run.completed_at,
      run.id,
    );
  }

  finishRun(
    id: string,
    status: Extract<RunStatus, "failed" | "cancelled">,
    finalResult: string | null,
    error: string,
  ): void {
    const now = new Date().toISOString();
    this.sql.exec(
      "UPDATE runs SET status = ?, final_result = ?, error = ?, updated_at = ?, completed_at = ? WHERE id = ?",
      status,
      finalResult,
      error,
      now,
      now,
      id,
    );
  }

  pendingRunCount(): number {
    return this.one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM runs WHERE status IN ('queued', 'running')",
    )?.count ?? 0;
  }

  private rows<T>(query: string, ...params: unknown[]): T[] {
    return Array.from(this.sql.exec(query, ...params)) as T[];
  }

  private one<T>(query: string, ...params: unknown[]): T | null {
    return this.rows<T>(query, ...params)[0] ?? null;
  }
}

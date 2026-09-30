import type {
  AgentDefinition,
  AgentKind,
  AgentProfile,
  AgentToolPolicy,
  Priority,
} from "./types";

export type TaskCategory = "coding" | "research" | "content" | "operations" | "general";

export function proposalAgents(category: TaskCategory, priority: Priority): AgentDefinition[] {
  const premium = priority === "highest-quality";
  const cheap = priority === "lowest-cost" || priority === "lowest-latency";
  const lead: AgentProfile = premium ? "agentic" : cheap ? "balanced" : "reasoning";
  const specialist: AgentProfile = premium ? "reasoning" : cheap ? "fast" : "balanced";
  const coder: AgentProfile = premium ? "coding" : cheap ? "fast" : "balanced";
  const scout: AgentProfile = cheap ? "fast" : "balanced";

  const templates: Record<TaskCategory, AgentDefinition[]> = {
    coding: [
      agentDef("Engineering Lead", "Final architecture and decision synthesizer", "Resolve conflicts between evidence packets and produce concise implementation decisions only when synthesis is needed.", lead, "synthesizer"),
      agentDef("Code Scout", "Read-only code and evidence scout", "Find the smallest relevant set of code, logs, schemas, and recent evidence needed to answer the engineering task. Prefer evidence over commentary.", scout, "scout", "read_only", 5),
      agentDef("Implementation Specialist", "Bounded implementation and failure-mode specialist", "Analyze the selected evidence and produce concrete implementation decisions, edge cases, tests, and migration implications.", coder, "specialist"),
      agentDef("Critical Reviewer", "Independent security and correctness reviewer", "Challenge unsupported conclusions, contradictions, trust-boundary mistakes, and missing failure cases.", specialist, "reviewer"),
    ],
    research: [
      agentDef("Research Lead", "Final evidence synthesizer", "Combine verified evidence into a concise answer without overstating certainty.", lead, "synthesizer"),
      agentDef("Evidence Scout", "Read-only evidence collection specialist", "Find relevant primary evidence and return only what materially changes the answer.", scout, "scout", "read_only", 6),
      agentDef("Domain Specialist", "Subject-matter analyst", "Analyze selected evidence using domain-specific constraints and alternatives.", specialist, "specialist"),
      agentDef("Critical Reviewer", "Contradiction and uncertainty reviewer", "Check whether conclusions are actually supported and identify missing or conflicting evidence.", specialist, "reviewer"),
    ],
    content: [
      agentDef("Editorial Lead", "Final editor and synthesis owner", "Produce a compact publishable result only when multiple specialist outputs need merging.", lead, "synthesizer"),
      agentDef("Fact Scout", "Read-only fact and source scout", "Collect only facts, terminology, and source evidence needed for the requested content.", scout, "scout", "read_only", 4),
      agentDef("Writer", "Primary drafting specialist", "Produce audience-appropriate content from the supplied evidence without inventing unsupported facts.", specialist, "specialist"),
      agentDef("Fact Reviewer", "Accuracy and consistency reviewer", "Flag unsupported claims, ambiguity, contradictions, and important omissions.", specialist, "reviewer"),
    ],
    operations: [
      agentDef("Operations Lead", "Final operational decision synthesizer", "Resolve evidence into a concise operational recommendation only when synthesis is necessary.", lead, "synthesizer"),
      agentDef("Operations Scout", "Read-only system and workflow investigator", "Inspect available operational evidence, logs, states, and configurations without changing external systems.", scout, "scout", "read_only", 6),
      agentDef("Process Specialist", "Workflow and integration analyst", "Analyze bottlenecks, data contracts, idempotency, sequencing, and measurable operational improvements.", specialist, "specialist"),
      agentDef("Risk Reviewer", "Operational risk and rollback reviewer", "Check failure modes, approval gates, rollback, monitoring, and unsupported assumptions.", specialist, "reviewer"),
    ],
    general: [
      agentDef("Results Lead", "Final synthesis owner", "Merge evidence only when multiple specialist results require reconciliation.", lead, "synthesizer"),
      agentDef("Evidence Scout", "Read-only context and evidence scout", "Find the minimum relevant evidence needed to answer the task.", scout, "scout", "read_only", 4),
      agentDef("Primary Specialist", "Main bounded problem solver", "Solve the core task using only supplied or verified evidence.", specialist, "specialist"),
      agentDef("Critical Reviewer", "Independent critic", "Identify unsupported conclusions, hidden assumptions, contradictions, and missing evidence.", specialist, "reviewer"),
    ],
  };
  return templates[category];
}

export function taskCategory(task: string): TaskCategory {
  const value = task.toLowerCase();
  if (/\b(code|coding|program|software|api|bug|typescript|javascript|python|worker|database|deploy|architecture|repository)\b/.test(value)) return "coding";
  if (/\b(research|investigate|compare|evidence|market|study|sources|analysis)\b/.test(value)) return "research";
  if (/\b(write|article|content|copy|post|script|email|documentation|editorial)\b/.test(value)) return "content";
  if (/\b(operations|workflow|automation|process|integration|runbook|incident|migration|logs?)\b/.test(value)) return "operations";
  return "general";
}

export function proposalName(category: TaskCategory): string {
  return {
    coding: "Adaptive Engineering Team",
    research: "Adaptive Research Team",
    content: "Adaptive Editorial Team",
    operations: "Adaptive Operations Team",
    general: "Adaptive Agent Team",
  }[category];
}

export function expectedResults(category: TaskCategory): string[] {
  return {
    coding: ["Compact code evidence", "Bounded implementation analysis", "Conditional correctness review", "Small evidence packet for the primary model"],
    research: ["Primary evidence", "Bounded domain analysis", "Conditional uncertainty review", "Small evidence packet for the primary model"],
    content: ["Verified factual context", "Draft result", "Conditional fact review", "Compact publishable result"],
    operations: ["Relevant operational evidence", "Root-cause/process analysis", "Conditional risk review", "Compact next actions"],
    general: ["Relevant evidence", "Bounded specialist result", "Conditional critique", "Compact conclusion"],
  }[category];
}

function agentDef(
  name: string,
  role: string,
  instructions: string,
  profile: AgentProfile,
  kind: AgentKind,
  toolPolicy: AgentToolPolicy = "none",
  maxToolCalls = 0,
): AgentDefinition {
  return {
    name,
    role,
    instructions,
    profile,
    kind,
    tool_policy: toolPolicy,
    allowed_plugin_ids: [],
    max_tool_calls: maxToolCalls,
    enabled: true,
    max_output_tokens: kind === "scout" || kind === "reviewer" ? 768 : 1_024,
    temperature: 0.2,
  };
}

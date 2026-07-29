import type { AgentDefinition, AgentProfile, Priority } from "./types";

export type TaskCategory = "coding" | "research" | "content" | "operations" | "general";

export function proposalAgents(category: TaskCategory, priority: Priority): AgentDefinition[] {
  const premium = priority === "highest-quality";
  const cheap = priority === "lowest-cost" || priority === "lowest-latency";
  const coordinator: AgentProfile = premium ? "agentic" : cheap ? "balanced" : "reasoning";
  const specialist: AgentProfile = premium ? "reasoning" : cheap ? "fast" : "balanced";
  const coder: AgentProfile = premium ? "coding" : cheap ? "fast" : "balanced";

  const templates: Record<TaskCategory, AgentDefinition[]> = {
    coding: [
      agentDef("Lead Architect", "Senior coordinator and architecture owner", "Decompose the engineering task, define interfaces and acceptance criteria, and synthesize implementation guidance.", coordinator),
      agentDef("Implementation Specialist", "Primary implementation designer", "Produce concrete implementation steps, code-level decisions, edge cases, and migration considerations.", coder),
      agentDef("Test Engineer", "Verification and failure-mode specialist", "Design tests, negative cases, rollout checks, and observability requirements.", cheap ? "fast" : "balanced"),
      agentDef("Security Reviewer", "Security and reliability critic", "Identify trust boundaries, secret handling risks, abuse cases, and rollback requirements.", specialist),
      agentDef("Documentation Reviewer", "Clarity and operator-experience reviewer", "Check whether the result is understandable, operable, and documented for end users.", cheap ? "fast" : "balanced"),
    ],
    research: [
      agentDef("Research Lead", "Senior coordinator and synthesis owner", "Define research questions, evidence standards, and combine findings without overstating certainty.", coordinator),
      agentDef("Source Analyst", "Evidence collection and source-quality specialist", "Identify evidence needed, compare source quality, and distinguish facts from assumptions.", cheap ? "fast" : "balanced"),
      agentDef("Domain Specialist", "Subject-matter analyst", "Analyze the task using domain-specific concepts, constraints, and plausible alternatives.", specialist),
      agentDef("Critical Reviewer", "Contradiction and uncertainty reviewer", "Challenge conclusions, identify missing evidence, and test alternative explanations.", specialist),
      agentDef("Executive Synthesizer", "Decision-oriented summary specialist", "Turn the research into concise decisions, tradeoffs, and next actions.", cheap ? "fast" : "balanced"),
    ],
    content: [
      agentDef("Editorial Lead", "Senior editor and coordinator", "Define audience, structure, quality bar, and synthesize the final publishable result.", coordinator),
      agentDef("Researcher", "Fact and context specialist", "Identify factual support, examples, terminology, and claims needing qualification.", cheap ? "fast" : "balanced"),
      agentDef("Writer", "Primary drafting specialist", "Produce clear, audience-appropriate copy aligned with the requested outcome.", specialist),
      agentDef("Fact Checker", "Accuracy and consistency reviewer", "Find unsupported claims, inconsistencies, ambiguity, and missing caveats.", specialist),
      agentDef("Style Reviewer", "Tone, readability, and formatting reviewer", "Improve clarity, flow, concision, and adherence to the intended voice.", cheap ? "fast" : "balanced"),
    ],
    operations: [
      agentDef("Operations Coordinator", "Senior orchestration and decision owner", "Break down the operational goal, define sequencing, dependencies, and acceptance criteria.", coordinator),
      agentDef("Process Analyst", "Workflow and bottleneck specialist", "Map the process, identify bottlenecks, failure points, and measurable improvements.", specialist),
      agentDef("Integration Specialist", "Automation and systems specialist", "Design integration steps, data contracts, idempotency, and operational safeguards.", coder),
      agentDef("Risk Reviewer", "Operational risk and rollback specialist", "Identify failure modes, approval gates, rollback procedures, and monitoring requirements.", specialist),
      agentDef("QA Operator", "Runbook and validation specialist", "Create practical validation steps, runbooks, alerts, and completion checks.", cheap ? "fast" : "balanced"),
    ],
    general: [
      agentDef("Senior Coordinator", "Senior planner and synthesis owner", "Decompose the task, assign responsibilities, manage tradeoffs, and synthesize the final answer.", coordinator),
      agentDef("Primary Specialist", "Main subject-matter contributor", "Produce the central analysis or deliverable required by the task.", specialist),
      agentDef("Critical Reviewer", "Independent critic", "Identify weaknesses, hidden assumptions, contradictions, and missing considerations.", specialist),
      agentDef("Results Synthesizer", "Outcome and next-steps specialist", "Turn all contributions into a coherent result with explicit recommendations.", cheap ? "fast" : "balanced"),
    ],
  };
  return templates[category];
}

export function taskCategory(task: string): TaskCategory {
  const value = task.toLowerCase();
  if (/\b(code|coding|program|software|api|bug|typescript|javascript|python|worker|database|deploy|architecture)\b/.test(value)) return "coding";
  if (/\b(research|investigate|compare|evidence|market|study|sources|analysis)\b/.test(value)) return "research";
  if (/\b(write|article|content|copy|post|script|email|documentation|editorial)\b/.test(value)) return "content";
  if (/\b(operations|workflow|automation|process|integration|runbook|incident|migration)\b/.test(value)) return "operations";
  return "general";
}

export function proposalName(category: TaskCategory): string {
  return {
    coding: "Engineering Agent Team",
    research: "Research Agent Team",
    content: "Editorial Agent Team",
    operations: "Operations Agent Team",
    general: "General Agent Team",
  }[category];
}

export function expectedResults(category: TaskCategory): string[] {
  return {
    coding: ["Architecture and implementation plan", "Failure modes and test plan", "Security and rollout review", "Synthesized next actions"],
    research: ["Evidence map", "Independent domain analysis", "Critique and uncertainty register", "Decision-oriented synthesis"],
    content: ["Audience and structure plan", "Draft content", "Fact and consistency review", "Final edited result"],
    operations: ["Process map", "Integration and runbook plan", "Risk and rollback review", "Operational acceptance criteria"],
    general: ["Task decomposition", "Primary specialist result", "Independent critique", "Synthesized recommendation"],
  }[category];
}

function agentDef(
  name: string,
  role: string,
  instructions: string,
  profile: AgentProfile,
): AgentDefinition {
  return {
    name,
    role,
    instructions,
    profile,
    enabled: true,
    max_output_tokens: 1_024,
    temperature: 0.2,
  };
}

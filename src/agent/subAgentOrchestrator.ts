import { getSearchAgent } from "./searchAgent";

export type SubAgentRole = "architecture" | "implementation" | "tests" | "security" | "performance" | "custom";

export interface SubAgentTask {
  role: SubAgentRole;
  objective?: string;
  scope?: string;
}

export interface SubAgentFinding {
  role: SubAgentRole;
  objective: string;
  summary: string;
  files: string[];
  findings: Array<{ file: string; line: number; symbol?: string; score: number; excerpt: string }>;
  durationMs: number;
}

export interface SubAgentRunResult {
  goal: string;
  agents: SubAgentFinding[];
  relevantFiles: string[];
  durationMs: number;
  parallel: true;
}

const ROLE_GUIDANCE: Record<SubAgentRole, string> = {
  architecture: "Map architecture, module boundaries, dependencies, entry points, and data flow.",
  implementation: "Locate the exact implementation paths, symbols, callers, and integration points required for the change.",
  tests: "Find related tests, test conventions, fixtures, edge cases, and verification commands.",
  security: "Inspect authentication, authorization, input validation, secrets, trust boundaries, and unsafe data flow.",
  performance: "Inspect hot paths, repeated I/O, large-data behavior, caching, concurrency, and scalability risks.",
  custom: "Investigate the assigned objective and return concrete code locations and evidence."
};

export class SubAgentOrchestrator {
  async run(goal: string, tasks: SubAgentTask[], maxResultsPerAgent = 8): Promise<SubAgentRunResult> {
    const cleanGoal = goal.trim();
    if (!cleanGoal) throw new Error("Sub-agent orchestration requires a goal.");
    const selected = tasks.slice(0, 4);
    if (selected.length === 0) throw new Error("At least one sub-agent task is required.");
    const budget = Math.max(3, Math.min(maxResultsPerAgent, 15));
    const startedAt = Date.now();

    const agents = await Promise.all(selected.map(async (task): Promise<SubAgentFinding> => {
      const agentStartedAt = Date.now();
      const objective = task.objective?.trim() || ROLE_GUIDANCE[task.role] || ROLE_GUIDANCE.custom;
      const query = `${cleanGoal}\nSpecialist role: ${task.role}. ${objective}`;
      const results = await getSearchAgent().search({ query, recentFiles: task.scope ? [task.scope] : undefined, maxResults: budget });
      return {
        role: task.role,
        objective,
        summary: await getSearchAgent().summarizeResults(results),
        files: [...new Set(results.map((result) => result.uri))],
        findings: results.map((result) => ({
          file: result.uri,
          line: result.startLine,
          symbol: result.symbol,
          score: result.score,
          excerpt: result.snippet.split("\n")[0].slice(0, 240)
        })),
        durationMs: Date.now() - agentStartedAt
      };
    }));

    const rankedFiles = new Map<string, number>();
    for (const agent of agents) {
      for (const finding of agent.findings) rankedFiles.set(finding.file, (rankedFiles.get(finding.file) || 0) + finding.score);
    }
    const relevantFiles = [...rankedFiles.entries()].sort((a, b) => b[1] - a[1]).map(([file]) => file).slice(0, 24);
    return { goal: cleanGoal, agents, relevantFiles, durationMs: Date.now() - startedAt, parallel: true };
  }
}

let instance: SubAgentOrchestrator | undefined;
export function getSubAgentOrchestrator(): SubAgentOrchestrator {
  if (!instance) instance = new SubAgentOrchestrator();
  return instance;
}

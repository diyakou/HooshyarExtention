export interface IsolatedAgentContext {
  goal: string;
  scope?: string;
  project: {
    languages: string[];
    frameworks: string[];
  };
  relatedFiles: string[];
  budget: number;
}

export interface ContextIsolationInput {
  goal: string;
  scope?: string;
  languages?: readonly string[];
  frameworks?: readonly string[];
  relatedFiles?: readonly string[];
  budget?: number;
}

export function createIsolatedAgentContext(input: ContextIsolationInput): IsolatedAgentContext {
  const budget = Math.max(1, Math.min(input.budget ?? 12, 50));
  return {
    goal: input.goal.trim(),
    scope: input.scope?.trim() || undefined,
    project: {
      languages: [...new Set(input.languages || [])].slice(0, budget),
      frameworks: [...new Set(input.frameworks || [])].slice(0, budget)
    },
    relatedFiles: [...new Set(input.relatedFiles || [])].slice(0, budget),
    budget
  };
}

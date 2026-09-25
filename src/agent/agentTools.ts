import { getPlannerAgent, PlanStep } from "./planner";
import { getSearchAgent } from "./searchAgent";
import { getVerificationAgent } from "./verificationAgent";

export async function createPlanTool(input: { goal?: string; context?: string }): Promise<string> {
  const goal = input.goal?.trim();
  if (!goal) throw new Error("create_plan requires 'goal'.");
  const plan = await getPlannerAgent().createPlan(goal, input.context?.trim() || "");
  return JSON.stringify(plan, null, 2);
}

export async function getPlanTool(): Promise<string> {
  const plan = getPlannerAgent().getCurrentPlan();
  return JSON.stringify({ plan: plan || null }, null, 2);
}

export async function updatePlanStepTool(input: {
  stepId?: string;
  status?: PlanStep["status"];
  result?: string;
  error?: string;
  feedback?: string;
}): Promise<string> {
  const stepId = input.stepId?.trim();
  if (!stepId) throw new Error("update_plan_step requires 'stepId'.");
  if (input.feedback?.trim()) {
    const revision = await getPlannerAgent().revisePlan(stepId, input.feedback.trim());
    return JSON.stringify({ revision }, null, 2);
  }
  if (!input.status) throw new Error("update_plan_step requires either 'status' or 'feedback'.");
  await getPlannerAgent().updateStep(stepId, {
    status: input.status,
    result: input.result,
    error: input.error
  });
  return JSON.stringify({ step: getPlannerAgent().getCurrentPlan()?.steps.find((step) => step.id === stepId) }, null, 2);
}

export async function delegateSearchTool(input: { query?: string; scope?: string; maxResults?: number }): Promise<string> {
  const query = input.query?.trim();
  if (!query) throw new Error("delegate_search requires 'query'.");
  const results = await getSearchAgent().search({
    query,
    recentFiles: input.scope ? [input.scope] : undefined,
    maxResults: input.maxResults
  });
  return JSON.stringify({
    results,
    summary: await getSearchAgent().summarizeResults(results)
  }, null, 2);
}

export async function verifyChangesTool(input: { files?: string[] }): Promise<string> {
  const files = (input.files || []).map((file) => file.trim()).filter(Boolean);
  if (files.length === 0) throw new Error("verify_changes requires at least one file.");
  const result = await getVerificationAgent().verify(files);
  return JSON.stringify({
    passed: result.passed,
    summary: result.summary,
    suggestions: result.suggestions,
    diagnostics: result.diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      severity: diagnostic.severity,
      source: diagnostic.source,
      line: diagnostic.range.start.line + 1
    })),
    tests: result.testResults
  }, null, 2);
}

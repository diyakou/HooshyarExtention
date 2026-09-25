import * as vscode from "vscode";
import { logInfo, logDebug } from "../logger";

export interface PlanStep {
  id: string;
  description: string;
  dependencies: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
  status: 'planning' | 'executing' | 'completed' | 'failed';
}

export class PlannerAgent {
  private currentPlan?: Plan;

  async createPlan(goal: string, context: string): Promise<Plan> {
    logInfo(`Creating plan for goal: ${goal}`);

    // Parse goal and context to create structured plan
    const steps = await this.decompose(goal, context);

    this.currentPlan = {
      id: `plan-${Date.now()}`,
      goal,
      steps,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'planning'
    };

    await this.savePlan(this.currentPlan);
    return this.currentPlan;
  }

  async updateStep(stepId: string, update: Partial<PlanStep>): Promise<void> {
    if (!this.currentPlan) {
      throw new Error("No active plan");
    }

    const step = this.currentPlan.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step ${stepId} not found`);
    }

    Object.assign(step, update);
    this.currentPlan.updatedAt = Date.now();

    await this.savePlan(this.currentPlan);
    logDebug(`Updated step ${stepId}: ${step.status}`);
  }

  async revisePlan(stepId: string, feedback: string): Promise<PlanStep> {
    if (!this.currentPlan) throw new Error("No active plan");
    const step = this.currentPlan.steps.find((item) => item.id === stepId);
    if (!step) throw new Error(`Step ${stepId} not found`);
    step.status = "failed";
    step.error = feedback;
    const revision: PlanStep = {
      id: `revision-${this.currentPlan.steps.length + 1}`,
      description: `Revise ${step.description}: ${feedback}`,
      dependencies: [...step.dependencies],
      status: "pending"
    };
    this.currentPlan.steps.push(revision);
    this.currentPlan.status = "planning";
    this.currentPlan.updatedAt = Date.now();
    await this.savePlan(this.currentPlan);
    return revision;
  }

  async getNextStep(): Promise<PlanStep | undefined> {
    if (!this.currentPlan) return undefined;

    // Find next step with all dependencies completed
    for (const step of this.currentPlan.steps) {
      if (step.status !== 'pending') continue;

      const allDepsCompleted = step.dependencies.every(depId => {
        const dep = this.currentPlan!.steps.find(s => s.id === depId);
        return dep?.status === 'completed';
      });

      if (allDepsCompleted) {
        return step;
      }
    }

    return undefined;
  }

  getCurrentPlan(): Plan | undefined {
    return this.currentPlan;
  }

  async clearPlan(): Promise<void> {
    this.currentPlan = undefined;
    await this.deletePlanFile();
  }

  private async decompose(goal: string, _context: string): Promise<PlanStep[]> {
    // Simple heuristic decomposition
    const steps: PlanStep[] = [];

    // Pattern: "implement X" -> research, design, implement, test
    if (goal.toLowerCase().includes('implement') || goal.toLowerCase().includes('add')) {
      steps.push({
        id: 'step-1',
        description: `Research existing code related to: ${goal}`,
        dependencies: [],
        status: 'pending'
      });

      steps.push({
        id: 'step-2',
        description: `Design solution for: ${goal}`,
        dependencies: ['step-1'],
        status: 'pending'
      });

      steps.push({
        id: 'step-3',
        description: `Implement: ${goal}`,
        dependencies: ['step-2'],
        status: 'pending'
      });

      steps.push({
        id: 'step-4',
        description: `Test implementation`,
        dependencies: ['step-3'],
        status: 'pending'
      });
    }
    // Pattern: "fix X" -> identify, diagnose, fix, verify
    else if (goal.toLowerCase().includes('fix') || goal.toLowerCase().includes('bug')) {
      steps.push({
        id: 'step-1',
        description: `Identify location of bug: ${goal}`,
        dependencies: [],
        status: 'pending'
      });

      steps.push({
        id: 'step-2',
        description: `Diagnose root cause`,
        dependencies: ['step-1'],
        status: 'pending'
      });

      steps.push({
        id: 'step-3',
        description: `Apply fix`,
        dependencies: ['step-2'],
        status: 'pending'
      });

      steps.push({
        id: 'step-4',
        description: `Verify fix resolves issue`,
        dependencies: ['step-3'],
        status: 'pending'
      });
    }
    // Default: single-step plan
    else {
      steps.push({
        id: 'step-1',
        description: goal,
        dependencies: [],
        status: 'pending'
      });
    }

    return steps;
  }

  private async savePlan(plan: Plan): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    const hooshyarDir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.hooshyar');
    const planFile = vscode.Uri.joinPath(hooshyarDir, 'PLAN.md');

    try {
      await vscode.workspace.fs.createDirectory(hooshyarDir);
    } catch {
      // Directory already exists
    }

    const markdown = this.planToMarkdown(plan);
    await vscode.workspace.fs.writeFile(planFile, Buffer.from(markdown, 'utf-8'));
  }

  private async deletePlanFile(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    const planFile = vscode.Uri.joinPath(workspaceFolders[0].uri, '.hooshyar', 'PLAN.md');
    try {
      await vscode.workspace.fs.delete(planFile);
    } catch {
      // File doesn't exist
    }
  }

  private planToMarkdown(plan: Plan): string {
    let md = `# Plan: ${plan.goal}\n\n`;
    md += `**Status:** ${plan.status}\n`;
    md += `**Created:** ${new Date(plan.createdAt).toISOString()}\n`;
    md += `**Updated:** ${new Date(plan.updatedAt).toISOString()}\n\n`;
    md += `## Steps\n\n`;

    for (const step of plan.steps) {
      const checkbox = step.status === 'completed' ? '[x]' : '[ ]';
      md += `${checkbox} **${step.id}:** ${step.description}\n`;

      if (step.dependencies.length > 0) {
        md += `   - Dependencies: ${step.dependencies.join(', ')}\n`;
      }

      md += `   - Status: ${step.status}\n`;

      if (step.result) {
        md += `   - Result: ${step.result}\n`;
      }

      if (step.error) {
        md += `   - Error: ${step.error}\n`;
      }

      md += '\n';
    }

    return md;
  }
}

let globalPlanner: PlannerAgent | undefined;

export function getPlannerAgent(): PlannerAgent {
  if (!globalPlanner) {
    globalPlanner = new PlannerAgent();
  }
  return globalPlanner;
}

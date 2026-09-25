import * as vscode from "vscode";

export interface TaskTemplate {
  name: string;
  description: string;
  command: string;
  category: 'build' | 'test' | 'deploy' | 'custom';
  dependencies?: string[];
}

export const COMMON_TASK_TEMPLATES: TaskTemplate[] = [
  {
    name: 'Build',
    description: 'Build the project',
    command: 'npm run build',
    category: 'build'
  },
  {
    name: 'Test',
    description: 'Run all tests',
    command: 'npm test',
    category: 'test'
  },
  {
    name: 'Lint',
    description: 'Run linter',
    command: 'npm run lint',
    category: 'build'
  },
  {
    name: 'Format',
    description: 'Format code',
    command: 'npm run format',
    category: 'build'
  },
  {
    name: 'Dev Server',
    description: 'Start development server',
    command: 'npm run dev',
    category: 'build'
  }
];

export class TaskProvider implements vscode.TaskProvider {
  getDependencies(name: string): string[] {
    return [...(COMMON_TASK_TEMPLATES.find((template) => template.name === name)?.dependencies || [])];
  }

  async provideTasks(): Promise<vscode.Task[]> {
    const tasks: vscode.Task[] = [];
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      return tasks;
    }

    // Create tasks from templates
    for (const template of COMMON_TASK_TEMPLATES) {
      const task = new vscode.Task(
        { type: 'hooshyar', task: template.name, dependsOn: template.dependencies || [] },
        workspaceFolder,
        template.name,
        'Hooshyar',
        new vscode.ShellExecution(template.command)
      );

      task.group = this.getTaskGroup(template.category);
      tasks.push(task);
    }

    return tasks;
  }

  async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
    return task;
  }

  private getTaskGroup(category: string): vscode.TaskGroup {
    switch (category) {
      case 'build':
        return vscode.TaskGroup.Build;
      case 'test':
        return vscode.TaskGroup.Test;
      default:
        return vscode.TaskGroup.Build;
    }
  }
}

export function registerTaskProvider(context: vscode.ExtensionContext): void {
  const taskProvider = new TaskProvider();
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider('hooshyar', taskProvider)
  );
}

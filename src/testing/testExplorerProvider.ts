import * as vscode from "vscode";
import { getExecutionAgent } from "../agent/executionAgent";
import { DEFAULT_EXCLUDE_GLOB, getWorkspaceFolders } from "../workspaceUtils";
import { TestFrameworkDetector, TestFrameworkInfo } from "./testFrameworkDetector";
import { TestResultParser } from "./testResultParser";

interface DiscoveredTest {
  item: vscode.TestItem;
  framework: TestFrameworkInfo;
}

export class HooshyarTestExplorer implements vscode.Disposable {
  private readonly controller = vscode.tests.createTestController("hooshyar-tests", "Hooshyar Tests");
  private readonly detector = new TestFrameworkDetector();
  private readonly parser = new TestResultParser();
  private readonly discovered = new Map<string, DiscoveredTest>();

  constructor() {
    this.controller.refreshHandler = () => this.refresh();
    this.controller.createRunProfile("Run", vscode.TestRunProfileKind.Run, (request, token) => this.run(request, token), true);
    this.controller.createRunProfile("Debug", vscode.TestRunProfileKind.Debug, (request, token) => this.run(request, token), true);
  }

  async refresh(): Promise<void> {
    this.controller.items.replace([]);
    this.discovered.clear();
    for (const folder of getWorkspaceFolders()) {
      const framework = await this.detector.detect(folder.uri.fsPath);
      if (framework.framework === "unknown") continue;
      const root = this.controller.createTestItem(folder.name, folder.name, folder.uri);
      this.controller.items.add(root);
      const testFiles = await this.findTestFiles(framework);
      for (const uri of testFiles) {
        const id = uri.toString();
        const item = this.controller.createTestItem(id, vscode.workspace.asRelativePath(uri, false), uri);
        root.children.add(item);
        this.discovered.set(id, { item, framework });
      }
    }
  }

  private async findTestFiles(framework: TestFrameworkInfo): Promise<vscode.Uri[]> {
    const found = new Map<string, vscode.Uri>();
    for (const pattern of framework.patterns) {
      const files = await vscode.workspace.findFiles(pattern, DEFAULT_EXCLUDE_GLOB, 2_000);
      for (const file of files) found.set(file.toString(), file);
    }
    return [...found.values()];
  }

  private async run(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
    const run = this.controller.createTestRun(request);
    const selected = request.include && request.include.length > 0
      ? request.include
      : [...this.discovered.values()].map((entry) => entry.item);
    const executedFrameworks = new Set<string>();
    try {
      for (const item of selected) {
        if (token.isCancellationRequested) break;
        const discovered = this.discovered.get(item.id);
        if (!discovered) continue;
        run.enqueued(item);
        const frameworkKey = `${discovered.framework.framework}:${discovered.framework.command}`;
        if (executedFrameworks.has(frameworkKey)) {
          run.skipped(item);
          continue;
        }
        executedFrameworks.add(frameworkKey);
        const result = await getExecutionAgent().executeCommand(discovered.framework.command);
        const parsed = this.parser.parse(`${result.stdout}\n${result.stderr}`, discovered.framework.framework);
        const duration = Math.max(0, result.duration);
        if (result.success && parsed.failed === 0) {
          run.passed(item, duration);
        } else {
          run.failed(item, new vscode.TestMessage(result.stderr || result.summary), duration);
        }
      }
    } finally {
      run.end();
    }
  }

  dispose(): void {
    this.controller.dispose();
    this.discovered.clear();
  }
}

export function registerTestExplorer(context: vscode.ExtensionContext): HooshyarTestExplorer {
  const explorer = new HooshyarTestExplorer();
  context.subscriptions.push(explorer);
  void explorer.refresh();
  return explorer;
}

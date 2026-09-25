import * as vscode from "vscode";
import { getExecutionAgent, ExecutionResult } from "./executionAgent";
import { logInfo } from "../logger";
import { resolveWorkspaceUri } from "../workspaceUtils";

export interface VerificationResult {
  passed: boolean;
  testResults: ExecutionResult;
  diagnostics: vscode.Diagnostic[];
  summary: string;
  suggestions: string[];
}

export class VerificationAgent {
  async verify(files: string[]): Promise<VerificationResult> {
    logInfo(`VerificationAgent: Verifying ${files.length} files`);
    const diagnostics = this.collectDiagnostics(files);
    const testResults = await getExecutionAgent().runTests();
    const testsPassed =
      testResults.summary === "No test framework detected" ||
      testResults.summary === "Unable to detect test framework" ||
      testResults.success;
    const passed = diagnostics.every((diagnostic) => diagnostic.severity !== vscode.DiagnosticSeverity.Error) && testsPassed;
    return {
      passed,
      testResults,
      diagnostics,
      summary: this.generateSummary(diagnostics, testResults, passed),
      suggestions: this.generateSuggestions(diagnostics, testResults)
    };
  }

  private collectDiagnostics(files: string[]): vscode.Diagnostic[] {
    const allDiagnostics: vscode.Diagnostic[] = [];
    for (const file of files) {
      try {
        allDiagnostics.push(...vscode.languages.getDiagnostics(resolveWorkspaceUri(file).uri));
      } catch {
        // A verification request can include an already-deleted file.
      }
    }
    return allDiagnostics;
  }

  private generateSummary(diagnostics: vscode.Diagnostic[], testResults: ExecutionResult, passed: boolean): string {
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error);
    const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Warning);
    const lines = [passed ? "All checks passed." : "Verification failed.", `Diagnostics: ${errors.length} errors, ${warnings.length} warnings.`, `Tests: ${testResults.success ? "passed" : "failed"}.`];
    if (!testResults.success) lines.push(`Exit code: ${testResults.exitCode}.`);
    return lines.join("\n");
  }

  private generateSuggestions(diagnostics: vscode.Diagnostic[], testResults: ExecutionResult): string[] {
    const suggestions: string[] = [];
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error);
    if (errors.length > 0) suggestions.push(`Fix ${errors.length} diagnostic error(s) before proceeding.`);
    if (!testResults.success) suggestions.push("Review test failures and fix the implementation.");
    if (suggestions.length === 0) suggestions.push("All checks passed - changes look good.");
    return suggestions;
  }

  async applyQuickFixes(files: string[]): Promise<string[]> {
    const applied: string[] = [];
    for (const file of files) {
      let uri: vscode.Uri;
      try {
        uri = resolveWorkspaceUri(file).uri;
      } catch {
        continue;
      }
      for (const diagnostic of vscode.languages.getDiagnostics(uri)) {
        try {
          const kindValue =
            typeof (vscode.CodeActionKind?.QuickFix as any)?.value === "string"
              ? (vscode.CodeActionKind.QuickFix as any).value
              : typeof vscode.CodeActionKind?.QuickFix === "string"
              ? vscode.CodeActionKind.QuickFix
              : "quickfix";
          const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            "vscode.executeCodeActionProvider",
            uri,
            diagnostic.range,
            kindValue
          ) || [];
          const action = actions.find((candidate) => candidate.edit);
          if (action?.edit && await vscode.workspace.applyEdit(action.edit)) {
            applied.push(action.title);
          }
        } catch {
          // ignore quickfix provider errors to not disrupt file edits
        }
      }
    }
    return applied;
  }
}

let globalVerificationAgent: VerificationAgent | undefined;

export function getVerificationAgent(): VerificationAgent {
  globalVerificationAgent ??= new VerificationAgent();
  return globalVerificationAgent;
}

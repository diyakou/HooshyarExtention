import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import { logInfo, logDebug, logError } from "../logger";
import { TestFrameworkDetector } from "../testing/testFrameworkDetector";
import { TestResultParser, TestSuiteResult } from "../testing/testResultParser";

const execAsync = promisify(exec);

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  summary: string;
  testResults?: TestSuiteResult;
}

export class ExecutionAgent {
  private readonly maxOutputLength = 5000;
  private readonly testFrameworkDetector = new TestFrameworkDetector();
  private readonly testResultParser = new TestResultParser();

  async executeCommand(command: string, cwd?: string, timeout = 120000): Promise<ExecutionResult> {
    logInfo(`ExecutionAgent: Running command: ${command}`);
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        timeout,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      });

      const duration = Date.now() - startTime;
      const truncatedStdout = this.truncateOutput(stdout);
      const truncatedStderr = this.truncateOutput(stderr);

      const result: ExecutionResult = {
        success: true,
        stdout: truncatedStdout,
        stderr: truncatedStderr,
        exitCode: 0,
        duration,
        summary: this.summarizeOutput(truncatedStdout, truncatedStderr, true)
      };

      logDebug(`Command completed in ${duration}ms`);
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const stdout = error.stdout ? this.truncateOutput(error.stdout) : '';
      const stderr = error.stderr ? this.truncateOutput(error.stderr) : error.message;

      const result: ExecutionResult = {
        success: false,
        stdout,
        stderr,
        exitCode: error.code || 1,
        duration,
        summary: this.summarizeOutput(stdout, stderr, false)
      };

      logError(`Command failed: ${stderr}`);
      return result;
    }
  }

  private truncateOutput(output: string): string {
    if (output.length <= this.maxOutputLength) {
      return output;
    }

    const half = Math.floor(this.maxOutputLength / 2);
    return output.substring(0, half) + '\n\n... [output truncated] ...\n\n' + output.substring(output.length - half);
  }

  private summarizeOutput(stdout: string, stderr: string, success: boolean): string {
    let summary = success ? '✓ Command succeeded\n' : '✗ Command failed\n';

    if (stdout) {
      const lines = stdout.split('\n').filter(l => l.trim());
      if (lines.length > 0) {
        summary += `\nOutput (${lines.length} lines):\n`;
        summary += lines.slice(0, 5).map(l => `  ${l}`).join('\n');
        if (lines.length > 5) {
          summary += `\n  ... and ${lines.length - 5} more lines`;
        }
      }
    }

    if (stderr) {
      const lines = stderr.split('\n').filter(l => l.trim());
      if (lines.length > 0) {
        summary += `\n\nErrors/Warnings (${lines.length} lines):\n`;
        summary += lines.slice(0, 3).map(l => `  ${l}`).join('\n');
        if (lines.length > 3) {
          summary += `\n  ... and ${lines.length - 3} more lines`;
        }
      }
    }

    return summary;
  }

  async runTests(testCommand?: string): Promise<ExecutionResult> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return { success: false, stdout: "", stderr: "No workspace folder open", exitCode: 1, duration: 0, summary: "Unable to detect test framework" };
    }
    const framework = await this.testFrameworkDetector.detect(workspaceRoot);
    const command = testCommand || framework.command;
    if (!command) {
      return { success: true, stdout: "", stderr: "", exitCode: 0, duration: 0, summary: "No test framework detected" };
    }
    const result = await this.executeCommand(command);
    if (framework.framework !== "unknown") {
      result.testResults = this.testResultParser.parse(`${result.stdout}\n${result.stderr}`, framework.framework);
    }
    return result;
  }
}

let globalExecutionAgent: ExecutionAgent | undefined;

export function getExecutionAgent(): ExecutionAgent {
  if (!globalExecutionAgent) {
    globalExecutionAgent = new ExecutionAgent();
  }
  return globalExecutionAgent;
}

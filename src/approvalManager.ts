import * as vscode from "vscode";
import * as path from "path";

export type AutoApproveMode = "off" | "safe" | "all";

export interface ApprovalDecision {
  shouldAutoApprove: boolean;
  reason?: string;
}

/**
 * Manages automatic approval logic for file writes and commands
 */
export class ApprovalManager {
  /**
   * Determine if a file write operation should be auto-approved
   */
  public static shouldAutoApproveWrite(
    filePath: string,
    contentSize: number,
    isNewFile: boolean,
    activeEditorPath?: string
  ): ApprovalDecision {
    const config = vscode.workspace.getConfiguration("hooshyar");
    const requireApproval = config.get<boolean>("requireApprovalForWrites", true);
    if (!requireApproval) {
      return { shouldAutoApprove: true, reason: "Auto-approved: requireApprovalForWrites is disabled" };
    }

    const mode = config.get<AutoApproveMode>("autoApproveMode", "off");
    const sizeLimit = config.get<number>("autoApproveSizeLimit", 5000);

    // Mode: off - never auto-approve
    if (mode === "off") {
      return { shouldAutoApprove: false };
    }

    // Mode: all - always auto-approve (dangerous!)
    if (mode === "all") {
      return { 
        shouldAutoApprove: true, 
        reason: "Auto-approved: mode set to 'all'" 
      };
    }

    // Mode: safe - apply safety checks
    if (mode === "safe") {
      // Auto-approve new files that are small
      if (isNewFile && contentSize <= sizeLimit) {
        return { 
          shouldAutoApprove: true, 
          reason: `Auto-approved: new file under ${sizeLimit} bytes` 
        };
      }

      // Auto-approve edits to the currently open file if small
      if (activeEditorPath && this.isSameFile(filePath, activeEditorPath)) {
        if (contentSize <= sizeLimit) {
          return { 
            shouldAutoApprove: true, 
            reason: `Auto-approved: edit to active file under ${sizeLimit} bytes` 
          };
        } else {
          return { 
            shouldAutoApprove: false, 
            reason: `Manual approval required: edit size (${contentSize} bytes) exceeds limit` 
          };
        }
      }

      // Check if file is in a "safe" directory (tests, docs, etc.)
      if (this.isInSafeDirectory(filePath) && contentSize <= sizeLimit * 2) {
        return { 
          shouldAutoApprove: true, 
          reason: "Auto-approved: file in safe directory (tests/docs)" 
        };
      }

      // Check file extension safety
      if (this.isSafeFileExtension(filePath) && contentSize <= sizeLimit) {
        return { 
          shouldAutoApprove: true, 
          reason: "Auto-approved: safe file type" 
        };
      }

      return { 
        shouldAutoApprove: false, 
        reason: "Manual approval required: file not in safe category" 
      };
    }

    return { shouldAutoApprove: false };
  }

  /**
   * Determine if a shell command should be auto-approved
   */
  public static shouldAutoApproveCommand(command: string): ApprovalDecision {
    const config = vscode.workspace.getConfiguration("hooshyar");
    const autoApproveCommands = config.get<boolean>("autoApproveCommands", false);
    const requireApproval = config.get<boolean>("requireApprovalForCommands", true);
    if (autoApproveCommands || !requireApproval) {
      return {
        shouldAutoApprove: true,
        reason: "Auto-approved: command auto-approval is enabled"
      };
    }

    const mode = config.get<AutoApproveMode>("autoApproveMode", "off");

    // Mode: off - never auto-approve
    if (mode === "off") {
      return { shouldAutoApprove: false };
    }

    // Mode: all - always auto-approve (very dangerous for commands!)
    if (mode === "all") {
      return { 
        shouldAutoApprove: true, 
        reason: "Auto-approved: mode set to 'all' (autonomous)" 
      };
    }

    // Mode: safe - only auto-approve safe read-only commands
    if (mode === "safe") {
      const safeCommands = [
        "git status",
        "git diff",
        "git log",
        "git branch",
        "npm list",
        "npm outdated",
        "node --version",
        "python --version",
        "cargo --version",
        "go version",
        "ls",
        "dir",
        "pwd",
        "whoami",
        "where",
        "which",
        "echo"
      ];

      const trimmedCommand = command.trim().toLowerCase();
      
      // Check if command is in safe list
      for (const safe of safeCommands) {
        if (trimmedCommand === safe || trimmedCommand.startsWith(safe + " ")) {
          return { 
            shouldAutoApprove: true, 
            reason: `Auto-approved: safe read-only command (${safe})` 
          };
        }
      }

      // Check if it's a test or build command (usually safe)
      if (this.isTestCommand(command)) {
        return { 
          shouldAutoApprove: true, 
          reason: "Auto-approved: test/build command" 
        };
      }

      return { 
        shouldAutoApprove: false, 
        reason: "Manual approval required: potentially destructive command" 
      };
    }

    return { shouldAutoApprove: false };
  }

  /**
   * Check if two file paths refer to the same file
   */
  private static isSameFile(path1: string, path2: string): boolean {
    const normalize = (p: string) => path.normalize(p).toLowerCase().replace(/\\/g, "/");
    return normalize(path1) === normalize(path2) || 
           normalize(path1).endsWith(normalize(path2)) ||
           normalize(path2).endsWith(normalize(path1));
  }

  /**
   * Check if file is in a safe directory
   */
  private static isInSafeDirectory(filePath: string): boolean {
    const safeDirs = [
      "test/",
      "tests/",
      "__tests__/",
      "spec/",
      "docs/",
      "documentation/",
      "examples/",
      ".vscode/",
      "tmp/",
      "temp/"
    ];

    const normalizedPath = filePath.toLowerCase().replace(/\\/g, "/");
    return safeDirs.some(dir => normalizedPath.includes(dir));
  }

  /**
   * Check if file has a safe extension
   */
  private static isSafeFileExtension(filePath: string): boolean {
    const safeExtensions = [
      ".md",
      ".txt",
      ".json",
      ".yaml",
      ".yml",
      ".toml",
      ".ini",
      ".conf",
      ".log",
      ".csv",
      ".xml",
      ".html",
      ".css",
      ".scss",
      ".sass"
    ];

    const ext = path.extname(filePath).toLowerCase();
    return safeExtensions.includes(ext);
  }

  /**
   * Check if command is a test command
   */
  private static isTestCommand(command: string): boolean {
    const testPatterns = [
      /^npm\s+(run\s+)?test/i,
      /^yarn\s+test/i,
      /^pnpm\s+(run\s+)?test/i,
      /^pytest/i,
      /^python\s+-m\s+pytest/i,
      /^cargo\s+test/i,
      /^go\s+test/i,
      /^mvn\s+test/i,
      /^gradle\s+test/i
    ];

    return testPatterns.some(pattern => pattern.test(command.trim()));
  }

  /**
   * Get a user-friendly explanation of the current auto-approve mode
   */
  public static getAutoApproveModeDescription(): string {
    const config = vscode.workspace.getConfiguration("hooshyar");
    const mode = config.get<AutoApproveMode>("autoApproveMode", "off");
    const sizeLimit = config.get<number>("autoApproveSizeLimit", 5000);

    switch (mode) {
      case "off":
        return "🔒 Auto-approve: OFF - All changes require manual approval";
      case "safe":
        return `⚡ Auto-approve: SAFE - Small edits (<${sizeLimit} bytes) in active file auto-approved`;
      case "all":
        return "⚠️  Auto-approve: ALL - All changes auto-approved (use with caution!)";
      default:
        return "Auto-approve: Unknown mode";
    }
  }

  /**
   * Show current auto-approve status in status bar
   */
  public static createStatusBarItem(): vscode.StatusBarItem {
    const statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    
    const config = vscode.workspace.getConfiguration("hooshyar");
    const mode = config.get<AutoApproveMode>("autoApproveMode", "off");

    switch (mode) {
      case "off":
        statusBar.text = "$(shield) Hooshyar: Manual Approve";
        statusBar.tooltip = "Click to change auto-approve mode";
        break;
      case "safe":
        statusBar.text = "$(zap) Hooshyar: Safe Auto-Approve";
        statusBar.tooltip = "Safe edits auto-approved. Click to change.";
        break;
      case "all":
        statusBar.text = "$(warning) Hooshyar: Full Auto-Approve";
        statusBar.tooltip = "All changes auto-approved! Click to change.";
        break;
    }

    statusBar.command = "hooshyar.changeAutoApproveMode";
    statusBar.show();

    return statusBar;
  }

  /**
   * Show quick pick to change auto-approve mode
   */
  public static async promptChangeAutoApproveMode(): Promise<void> {
    const config = vscode.workspace.getConfiguration("hooshyar");
    const currentMode = config.get<AutoApproveMode>("autoApproveMode", "off");

    const items: vscode.QuickPickItem[] = [
      {
        label: "$(shield) Off - Always ask for approval",
        description: currentMode === "off" ? "✓ Current" : "",
        detail: "Maximum safety: manually approve every file change and command",
        picked: currentMode === "off"
      },
      {
        label: "$(zap) Safe - Auto-approve small, safe edits",
        description: currentMode === "safe" ? "✓ Current" : "",
        detail: "Balanced: auto-approve small edits to the active file, new files, and documentation/test files; scripts still require approval",
        picked: currentMode === "safe"
      },
      {
        label: "$(warning) All - Auto-approve everything",
        description: currentMode === "all" ? "✓ Current" : "",
        detail: "⚠️  Use with caution: automatically approve all changes without asking",
        picked: currentMode === "all"
      }
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select auto-approve mode for Hooshyar",
      title: "Hooshyar Auto-Approve Settings"
    });

    if (selected) {
      let newMode: AutoApproveMode = "off";
      if (selected.label.includes("Safe")) {
        newMode = "safe";
      } else if (selected.label.includes("All")) {
        newMode = "all";
        // Show warning for "all" mode
        const confirm = await vscode.window.showWarningMessage(
          "⚠️  Full auto-approve mode will automatically accept ALL file changes and commands without asking. This can be dangerous. Are you sure?",
          { modal: true },
          "Yes, Enable",
          "Cancel"
        );
        if (confirm !== "Yes, Enable") {
          return;
        }
      }

      await config.update("autoApproveMode", newMode, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `Hooshyar auto-approve mode changed to: ${newMode.toUpperCase()}`
      );
    }
  }
}

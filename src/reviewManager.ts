import * as vscode from "vscode";
import { revertFile, getOriginalContent } from "./writeBackup";
import { openDiffForFile } from "./diffPreview";
import { logInfo } from "./logger";

export class ReviewManager {
  private static instance: ReviewManager;
  private modifiedFiles = new Set<string>();
  private statusBarItem: vscode.StatusBarItem;

  private constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "hooshyar.reviewChanges";
  }

  public static getInstance(): ReviewManager {
    if (!ReviewManager.instance) {
      ReviewManager.instance = new ReviewManager();
    }
    return ReviewManager.instance;
  }

  public trackFile(relPath: string): void {
    if (!relPath || relPath === "undefined") return;
    this.modifiedFiles.add(relPath.trim().replace(/\\/g, "/"));
    this.updateStatusBar();
  }

  public getModifiedFiles(): string[] {
    return Array.from(this.modifiedFiles);
  }

  public clear(): void {
    this.modifiedFiles.clear();
    this.updateStatusBar();
  }

  public acceptAll(): void {
    const count = this.modifiedFiles.size;
    this.clear();
    vscode.window.showInformationMessage(`Hooshyar: Marked ${count} session change(s) as reviewed. Files were not staged or committed.`);
  }

  public async discardAll(): Promise<void> {
    const files = Array.from(this.modifiedFiles);
    if (files.length === 0) {
      vscode.window.showInformationMessage("Hooshyar: No pending changes to discard.");
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to discard all changes across ${files.length} files?`,
      { modal: true },
      "Discard All Changes"
    );

    if (confirm !== "Discard All Changes") return;

    let restoredCount = 0;
    for (const file of files) {
      try {
        await revertFile(file);
        restoredCount++;
      } catch (err) {
        logInfo(`Failed to revert ${file}: ${err}`);
      }
    }

    this.clear();
    vscode.window.showInformationMessage(`Hooshyar: Discarded changes. Restored ${restoredCount} files.`);
  }

  public async showReviewQuickPick(): Promise<void> {
    const files = Array.from(this.modifiedFiles);
    if (files.length === 0) {
      vscode.window.showInformationMessage("Hooshyar: No active file edits in this session.");
      return;
    }

    const items: vscode.QuickPickItem[] = [
      {
        label: "$(check) Mark All as Reviewed",
        description: `Clear the review list for ${files.length} files (does not stage or commit changes)`
      },
      {
        label: "$(discard) Discard All Changes",
        description: `Revert all ${files.length} files to previous state`
      },
      {
        label: "",
        kind: vscode.QuickPickItemKind.Separator
      },
      ...files.map((f) => ({
        label: `$(file-code) ${f}`,
        description: "Click to view diff"
      }))
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Hooshyar Review: ${files.length} files modified in this session`
    });

    if (!selected) return;

    if (selected.label.includes("Mark All as Reviewed")) {
      this.acceptAll();
    } else if (selected.label.includes("Discard All Changes")) {
      await this.discardAll();
    } else {
      const filePath = selected.label.replace("$(file-code) ", "").trim();
      if (filePath) {
        await openDiffForFile(filePath);
      }
    }
  }

  private updateStatusBar(): void {
    const count = this.modifiedFiles.size;
    if (count > 0) {
      this.statusBarItem.text = `$(diff) Hooshyar: ${count} edited ${count === 1 ? "file" : "files"}`;
      this.statusBarItem.tooltip = "Click to review or discard session changes. Marking reviewed does not stage or commit files.";
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}

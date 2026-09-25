import * as crypto from "crypto";
import * as vscode from "vscode";
import { logDebug, logInfo, logWarn } from "../logger";
import { resolveWorkspaceUri } from "../workspaceUtils";

export interface FileChange {
  path: string;
  type: "create" | "edit" | "delete";
  content?: string;
  oldContent?: string;
  hash: string;
}

export interface ChangeSet {
  id: string;
  description: string;
  changes: FileChange[];
  state: "pending" | "applying" | "applied" | "verified" | "rolled_back" | "conflicted";
  createdAt: number;
  appliedAt?: number;
  verification?: { passed: boolean; summary: string; verifiedAt: number };
}

export class ChangeSetManager {
  private readonly changeSets = new Map<string, ChangeSet>();
  private currentChangeSet?: ChangeSet;

  createChangeSet(description: string): string {
    const id = `cs-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const changeSet: ChangeSet = { id, description, changes: [], state: "pending", createdAt: Date.now() };
    this.changeSets.set(id, changeSet);
    this.currentChangeSet = changeSet;
    logInfo(`Created ChangeSet: ${id} - ${description}`);
    return id;
  }

  addChange(change: FileChange, changeSetId = this.currentChangeSet?.id): void {
    const changeSet = changeSetId ? this.changeSets.get(changeSetId) : undefined;
    if (!changeSet || changeSet.state !== "pending") throw new Error("No pending ChangeSet is active.");
    changeSet.changes.push({ ...change, path: normalizePath(change.path) });
    logDebug(`Staged ChangeSet ${changeSet.id}: ${change.type} ${change.path}`);
  }

  async apply(changeSetId: string): Promise<boolean> {
    const changeSet = this.requireChangeSet(changeSetId);
    if (changeSet.state !== "pending") throw new Error(`ChangeSet ${changeSetId} is not pending.`);
    const conflicts = await this.detectConflicts(changeSet);
    if (conflicts.length > 0) {
      changeSet.state = "conflicted";
      logWarn(`ChangeSet ${changeSetId} has conflicts: ${conflicts.join(", ")}`);
      return false;
    }

    changeSet.state = "applying";
    let appliedCount = 0;
    try {
      for (const change of changeSet.changes) {
        await this.applyChange(change);
        appliedCount++;
      }
      changeSet.state = "applied";
      changeSet.appliedAt = Date.now();
      logInfo(`ChangeSet ${changeSetId} applied successfully`);
      return true;
    } catch (error: any) {
      logWarn(`ChangeSet ${changeSetId} failed: ${error?.message ?? error}`);
      await this.rollbackApplied(changeSet, appliedCount);
      changeSet.state = "rolled_back";
      return false;
    }
  }

  async rollback(changeSetId: string): Promise<boolean> {
    const changeSet = this.requireChangeSet(changeSetId);
    if (changeSet.state !== "applied" && changeSet.state !== "verified") return false;
    try {
      await this.rollbackApplied(changeSet, changeSet.changes.length);
      changeSet.state = "rolled_back";
      logInfo(`ChangeSet ${changeSetId} rolled back successfully`);
      return true;
    } catch (error: any) {
      logWarn(`Failed to rollback ChangeSet ${changeSetId}: ${error?.message ?? error}`);
      return false;
    }
  }

  markVerified(changeSetId: string, passed: boolean, summary: string): void {
    const changeSet = this.requireChangeSet(changeSetId);
    changeSet.verification = { passed, summary, verifiedAt: Date.now() };
    if (passed && changeSet.state === "applied") changeSet.state = "verified";
  }

  getChangeSet(id: string): ChangeSet | undefined {
    return this.changeSets.get(id);
  }

  getCurrentChangeSet(): ChangeSet | undefined {
    return this.currentChangeSet;
  }

  listChangeSets(): ChangeSet[] {
    return [...this.changeSets.values()];
  }

  static hashContent(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  private async detectConflicts(changeSet: ChangeSet): Promise<string[]> {
    const conflicts: string[] = [];
    for (const change of changeSet.changes) {
      const uri = this.resolveUri(change.path);
      try {
        const current = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
        if (change.type === "create") {
          conflicts.push(change.path);
        } else if (change.hash !== ChangeSetManager.hashContent(current)) {
          conflicts.push(change.path);
        }
      } catch {
        if (change.type !== "create") conflicts.push(change.path);
      }
    }
    return conflicts;
  }

  private async applyChange(change: FileChange): Promise<void> {
    const uri = this.resolveUri(change.path);
    if (change.type === "delete") {
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
      return;
    }
    if (change.content === undefined) throw new Error(`Change ${change.path} has no content.`);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(pathDirectory(uri.fsPath)));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(change.content, "utf8"));
  }

  private async rollbackApplied(changeSet: ChangeSet, count: number): Promise<void> {
    for (let index = count - 1; index >= 0; index--) {
      const change = changeSet.changes[index];
      const uri = this.resolveUri(change.path);
      if (change.type === "create") {
        await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
      } else if (change.oldContent !== undefined) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(change.oldContent, "utf8"));
      }
    }
  }

  private resolveUri(filePath: string): vscode.Uri {
    return resolveWorkspaceUri(filePath).uri;
  }

  private requireChangeSet(id: string): ChangeSet {
    const changeSet = this.changeSets.get(id);
    if (!changeSet) throw new Error(`ChangeSet ${id} not found`);
    return changeSet;
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function pathDirectory(value: string): string {
  const slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return slash < 0 ? value : value.slice(0, slash);
}

let globalChangeSetManager: ChangeSetManager | undefined;

export function getChangeSetManager(): ChangeSetManager {
  globalChangeSetManager ??= new ChangeSetManager();
  return globalChangeSetManager;
}

import * as vscode from "vscode";
import { resolveWorkspaceUri } from "../workspaceUtils";
import { getSelfRepairPipeline } from "./selfRepair";
import { ChangeSetManager, FileChange, getChangeSetManager } from "./changeSetManager";

export interface ProposedFileChange {
  path?: string;
  type?: FileChange["type"];
  content?: string;
  expectedHash?: string;
}

export async function applyChangeSetTool(input: { description?: string; changes?: ProposedFileChange[] }): Promise<string> {
  const proposals = input.changes || [];
  if (proposals.length === 0) throw new Error("apply_changeset requires at least one change.");
  const manager = getChangeSetManager();
  const id = manager.createChangeSet(input.description?.trim() || "Agent file changes");
  for (const proposal of proposals) {
    const path = proposal.path?.trim();
    const type = proposal.type;
    if (!path || !type) throw new Error("Each ChangeSet change requires path and type.");
    const uri = resolveWorkspaceUri(path).uri;
    let oldContent: string | undefined;
    try {
      oldContent = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    } catch {
      oldContent = undefined;
    }
    if (type === "create" && oldContent !== undefined) throw new Error(`Cannot create '${path}': file already exists.`);
    if (type !== "create" && oldContent === undefined) throw new Error(`Cannot ${type} '${path}': file does not exist.`);
    const hash = oldContent === undefined ? "" : ChangeSetManager.hashContent(oldContent);
    if (proposal.expectedHash && proposal.expectedHash !== hash) {
      throw new Error(`Conflict detected for '${path}' before ChangeSet creation.`);
    }
    if ((type === "create" || type === "edit") && proposal.content === undefined) {
      throw new Error(`${type} change for '${path}' requires content.`);
    }
    manager.addChange({ path, type, content: proposal.content, oldContent, hash }, id);
  }
  if (!await manager.apply(id)) {
    throw new Error(`ChangeSet ${id} was not applied (${manager.getChangeSet(id)?.state}).`);
  }
  const repair = await getSelfRepairPipeline().verifyAndRepair(id);
  return JSON.stringify({ id, state: manager.getChangeSet(id)?.state, verification: repair }, null, 2);
}

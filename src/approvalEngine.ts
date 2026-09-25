import * as vscode from "vscode";
import { ApprovalManager } from "./approvalManager";
import { AgentTool } from "./tools/types";
import { normalizeCommandForHost } from "./tools";

export type ApprovalAction = "allow" | "ask" | "deny";

export interface CentralApprovalDecision {
  action: ApprovalAction;
  reason: string;
}

export interface ApprovalContext {
  activeEditorPath?: string;
  workspaceTrusted?: boolean;
}

export class ApprovalEngine {
  evaluate(tool: Pick<AgentTool, "name" | "risk">, input: Record<string, unknown>, context: ApprovalContext = {}): CentralApprovalDecision {
    const trusted = context.workspaceTrusted ?? vscode.workspace.isTrusted ?? true;
    if (!trusted && tool.risk !== "read") {
      return { action: "deny", reason: "Workspace is not trusted; write, execution, and external tools are disabled." };
    }
    if (tool.risk === "read" || tool.risk === "network") {
      return { action: "allow", reason: "Read-only tool." };
    }
    if (tool.risk === "execute") {
      const command = normalizeCommandForHost(String(input.command || ""));
      const decision = ApprovalManager.shouldAutoApproveCommand(command);
      return decision.shouldAutoApprove
        ? { action: "allow", reason: decision.reason || "Command policy allowed execution." }
        : { action: "ask", reason: decision.reason || "Command requires approval." };
    }
    if (tool.name === "write_file" || tool.name === "search_replace") {
      const filePath = typeof input.path === "string" ? input.path : "";
      const changedText = tool.name === "write_file" ? input.content : input.new_string;
      const contentSize = typeof changedText === "string" ? Buffer.byteLength(changedText, "utf8") : 0;
      const decision = ApprovalManager.shouldAutoApproveWrite(
        filePath,
        contentSize,
        tool.name === "write_file",
        context.activeEditorPath
      );
      return decision.shouldAutoApprove
        ? { action: "allow", reason: decision.reason || "Write policy allowed the change." }
        : { action: "ask", reason: decision.reason || "Write requires approval." };
    }
    return { action: "ask", reason: "Unknown mutating tools require explicit approval." };
  }
}

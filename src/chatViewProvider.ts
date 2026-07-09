import * as vscode from "vscode";
import * as path from "path";
import { ApiClient } from "./apiClient";
import { readApiClientConfig, ToolProtocol } from "./apiConfig";
import { buildUserContent, imageToDataUrl, isImagePath, isLikelyTextFile, readImageAttachment } from "./attachments";
import { trimHistoryForContext, estimateTokens } from "./contextManager";
import { buildInlineDiffPreview } from "./inlineDiff";
import { showWriteDiff } from "./diffPreview";
import { logDebug, logError, logInfo } from "./logger";
import {
  buildContextPrefix,
  buildSystemPrompt,
  buildUserMessagePrefix,
  getLastUserMessageText,
  openWrittenFile
} from "./messageNormalizer";
import { SessionManager } from "./sessionManager";
import { searchFileIndex, getWorkspaceFileIndex } from "./workspaceIndex";
import {
  extractProposedFileWrites,
  extractTextualToolCalls,
  flattenToolHistoryForApi,
  truncateToolOutput,
  userWantsFileWrite
} from "./toolCallParser";
import { buildToolDefinitions, executeTool, isMutatingTool } from "./tools";
import { resolveWorkspaceUri, readTextFile } from "./workspaceUtils";
import {
  Message,
  ContentBlock,
  ToolUseBlock,
  TaskItem,
  AttachedFile,
  AttachedImage,
  Usage,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from "./types";

const AGENT_SYSTEM_PROMPT_BASE =
  "You are Hooshyar, an autonomous in-editor coding agent running inside VS Code. " +
  "You operate in AGENT MODE: you plan multi-step work yourself, use tools to explore and modify the " +
  "user's actual codebase, and keep going across multiple tool calls until the task is fully done, " +
  "instead of just describing what the user should do.\n\n" +
  "## WORKSPACE ACCESS (READ THIS FIRST)\n" +
  "You DO have full, direct access to the user's currently open VS Code workspace through your tools. " +
  "The workspace root path and a listing of the project files are provided to you in an " +
  "[environment_details] block in the conversation. " +
  "Therefore you MUST NEVER say you lack access, and you MUST NEVER ask the user to upload files, " +
  "paste a file tree, provide a ZIP, or run `ls`. If you need to see files, call the tools yourself " +
  "(list_codebase, list_files, read_file, search_codebase). Acting on the real files via tools is " +
  "always the correct behavior — treat every request about \"the project\"/\"my code\" as a request to " +
  "use your tools on the open workspace.\n\n" +
  "## HOW TO CALL TOOLS (CRITICAL)\n" +
  "To use a tool, output a tool-call block EXACTLY in this format, with a single JSON object inside:\n" +
  "<tool_call>{\"name\": \"<tool_name>\", \"input\": { ... }}</tool_call>\n" +
  "Rules for tool calls:\n" +
  "- The content inside <tool_call> MUST be valid JSON with a \"name\" string and an \"input\" object.\n" +
  "- Emit one <tool_call>...</tool_call> block per tool you want to run. You may emit several in a row.\n" +
  "- Do NOT wrap tool calls in markdown code fences. Do NOT use any other format such as " +
  "<function>, <tool_name>, or <toolname> element tags.\n" +
  "- After you emit tool calls, STOP and wait; the tool results will be sent back to you in the next turn.\n" +
  "- You may write a short sentence of plain text before the tool calls to explain what you are doing, " +
  "but never invent or fabricate tool results yourself.\n\n" +
  "Example (exploring a project):\n" +
  "I'll look at the project structure first.\n" +
  "<tool_call>{\"name\": \"list_codebase\", \"input\": {\"path\": \".\"}}</tool_call>\n\n" +
  "### WRITING/EDITING FILES (use this exact tag format, NOT JSON)\n" +
  "Because file content is multi-line and would break JSON, for write_file you MUST use this format " +
  "where the raw file content goes between <content> tags:\n" +
  "<write_file>\n<path>relative/path/to/file.ext</path>\n<content>\n...FULL new file content here...\n</content>\n</write_file>\n" +
  "For search_replace (small edits), use:\n" +
  "<search_replace>\n<path>file.ext</path>\n<old_string>exact text</old_string>\n<new_string>replacement</new_string>\n</search_replace>\n" +
  "To EDIT an existing file: prefer search_replace; use write_file only for new files or full rewrites.\n\n" +
  "## FILE CREATION/EDITING (MANDATORY)\n" +
  "When the user asks to CREATE, WRITE, EDIT, or ADD a file (README, source code, config, etc.):\n" +
  "- You MUST call write_file with the complete file content. NEVER dump the full file in chat instead.\n" +
  "- Do NOT use :::writing, markdown previews, or \"suggested content\" blocks as a substitute for write_file.\n" +
  "- After exploring (if needed), emit write_file immediately — the file must actually appear on disk.\n" +
  "- You may write one short sentence before the write_file tag, then STOP.\n\n" +
  "## AVAILABLE TOOLS\n" +
  "- read_file {path}: read a workspace file.\n" +
  "- write_file {path, content}: create/overwrite a file (may require user approval).\n" +
  "- search_replace {path, old_string, new_string, replace_all?}: targeted edit (preferred for small changes).\n" +
  "- list_files {path}: list a directory (non-recursive).\n" +
  "- list_codebase {path?, glob?, depth?}: recursively list project files.\n" +
  "- search_codebase {pattern, path?, glob?, is_regex?, depth?}: grep-like search.\n" +
  "- update_tasks {tasks: [{id, content, status}]}: show/update your plan checklist.\n" +
  "- run_command {command}: run a shell command (only if enabled; may require approval).\n\n" +
  "## GUIDELINES\n" +
  "- For any non-trivial request, first call update_tasks with a short plan (a few concrete steps), " +
  "then work through it, updating each task's status as you go (exactly one 'in_progress' at a time).\n" +
  "- Use list_codebase / search_codebase to explore the project structure and find relevant code before " +
  "guessing at file contents or locations. Don't assume - verify by reading.\n" +
  "- Prefer read_file on specific files once you know which ones matter, rather than re-scanning the whole " +
  "codebase repeatedly.\n" +
  "- Prefer search_replace for small edits; use write_file for new files or full rewrites.\n" +
  "- Only write_file, search_replace, or run_command when you're confident; the user may be asked to approve " +
  "these actions.\n" +
  "- If context about the currently open file is included in the conversation, treat it as authoritative " +
  "current state of that file.\n" +
  "- When the task is complete, mark all tasks completed and summarize what changed.";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "hooshyar.chatView";

  private view?: vscode.WebviewView;
  private history: Message[] = [];
  private apiClient: ApiClient;
  private abortController?: AbortController;
  private pendingApprovals = new Map<string, (approved: boolean) => void>();
  private taskList: TaskItem[] = [];
  private pendingAttachments: AttachedFile[] = [];
  private pendingImages: AttachedImage[] = [];
  private isStreaming = false;
  private currentSessionId: string;
  private sessionUsage: Usage = { input_tokens: 0, output_tokens: 0 };
  private sessionManager: SessionManager;
  private detectedToolProtocol: ToolProtocol | null = null;
  private lastTurnTextLength = 0;
  private cachedSystemPrompt = AGENT_SYSTEM_PROMPT_BASE;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly secretStorage: vscode.SecretStorage,
    private readonly memento: vscode.Memento
  ) {
    this.apiClient = new ApiClient(() => this.readConfig());
    this.sessionManager = new SessionManager(memento);
    this.currentSessionId = this.sessionManager.getCurrentId();
    const session = this.sessionManager.find(this.currentSessionId);
    if (session) {
      this.history = session.history ?? [];
      this.taskList = session.taskList ?? [];
      this.sessionUsage = session.usage ?? { input_tokens: 0, output_tokens: 0 };
    }
    void this.refreshSystemPrompt();
  }

  private async refreshSystemPrompt(): Promise<void> {
    this.cachedSystemPrompt = await buildSystemPrompt(AGENT_SYSTEM_PROMPT_BASE);
  }

  private async persistCurrentSession(): Promise<void> {
    await Promise.resolve(
      this.sessionManager.persist(this.currentSessionId, this.history, this.taskList, this.sessionUsage)
    );
  }

  private sessionMetas() {
    return this.sessionManager.metas();
  }

  private postSessions() {
    this.postToWebview({
      type: "sessions",
      sessions: this.sessionMetas(),
      currentId: this.currentSessionId
    });
  }

  private postUsage() {
    this.postToWebview({
      type: "usage",
      inputTokens: this.sessionUsage.input_tokens ?? 0,
      outputTokens: this.sessionUsage.output_tokens ?? 0
    });
  }

  /** Last plain user message (strips environment_details / file context prefixes). */
  private getLastUserMessageTextLocal(): string {
    return getLastUserMessageText(this.history);
  }

  private readConfig() {
    return readApiClientConfig(this.cachedApiKey ?? "");
  }

  private effectiveToolProtocol(): ToolProtocol {
    const cfg = this.readConfig().toolProtocol;
    if (cfg === "native" || cfg === "text") return cfg;
    return this.detectedToolProtocol ?? "text";
  }

  private prepareMessagesForApi(): Message[] {
    const maxContext = vscode.workspace.getConfiguration("hooshyar").get<number>("maxContextChars", 120_000);
    const useNative = this.effectiveToolProtocol() === "native";
    const base = useNative ? this.history : flattenToolHistoryForApi(this.history);
    return trimHistoryForContext(base, maxContext);
  }

  private cachedApiKey: string | undefined;

  public async loadSecrets() {
    this.cachedApiKey = (await this.secretStorage.get("hooshyar.apiKey"))
      ?? vscode.workspace.getConfiguration("hooshyar").get<string>("apiKey", "");
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewToExtensionMessage) => {
      switch (msg.type) {
        case "ready":
          void getWorkspaceFileIndex();
          void this.refreshSystemPrompt();
          this.postToWebview({ type: "history", messages: this.history });
          this.postToWebview({ type: "taskListUpdate", tasks: this.taskList });
          this.postSessions();
          this.postUsage();
          break;
        case "sendMessage":
          await this.handleUserMessage(msg.text);
          break;
        case "newChat":
          this.newChat();
          break;
        case "stop":
          this.stop();
          break;
        case "attachFile":
          await this.pickAndAttachFile();
          break;
        case "removeAttachment":
          this.removePendingAttachment(msg.kind, msg.index);
          break;
        case "openHistory":
          await this.openHistory();
          break;
        case "loadSession":
          await this.loadSession(msg.id);
          break;
        case "deleteSession":
          this.deleteSession(msg.id);
          break;
        case "renameSession":
          this.renameSession(msg.id, msg.title);
          break;
        case "retryLastTurn":
          await this.retryLastTurn();
          break;
        case "insertAtCursor":
          await this.insertAtCursor(msg.text);
          break;
        case "searchMentions":
          await this.searchMentions(msg.query);
          break;
        case "approvalResponse": {
          const resolver = this.pendingApprovals.get(msg.id);
          if (resolver) {
            resolver(msg.approved);
            this.pendingApprovals.delete(msg.id);
          }
          break;
        }
      }
    });
  }

  public async newChat() {
    this.abortController?.abort();
    await this.persistCurrentSession();
    this.currentSessionId = this.sessionManager.genId();
    this.sessionManager.setCurrentId(this.currentSessionId);
    this.history = [];
    this.taskList = [];
    this.pendingAttachments = [];
    this.pendingImages = [];
    this.sessionUsage = { input_tokens: 0, output_tokens: 0 };
    this.detectedToolProtocol = null;
    this.postToWebview({ type: "history", messages: [] });
    this.postToWebview({ type: "taskListUpdate", tasks: [] });
    this.postAttachments();
    this.postSessions();
    this.postUsage();
  }

  /** Shows a picker of saved chats and loads the chosen one. */
  public async openHistory() {
    const sessions = this.sessionManager.getSessions();
    if (sessions.length === 0) {
      vscode.window.showInformationMessage("Hooshyar: no saved chats yet.");
      return;
    }
    const items = sessions.map((s) => ({
      label: s.title || "(untitled)",
      description: new Date(s.updatedAt).toLocaleString(),
      id: s.id
    }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: "Open a previous chat" });
    if (picked) this.loadSession(picked.id);
  }

  private async loadSession(id: string) {
    if (id === this.currentSessionId) return;
    await this.persistCurrentSession();
    const session = this.sessionManager.find(id);
    if (!session) return;
    this.abortController?.abort();
    this.currentSessionId = session.id;
    this.sessionManager.setCurrentId(session.id);
    this.history = session.history ?? [];
    this.taskList = session.taskList ?? [];
    this.sessionUsage = session.usage ?? { input_tokens: 0, output_tokens: 0 };
    this.postToWebview({ type: "history", messages: this.history });
    this.postToWebview({ type: "taskListUpdate", tasks: this.taskList });
    this.postSessions();
    this.postUsage();
  }

  private deleteSession(id: string) {
    const wasCurrent = id === this.currentSessionId;
    if (!this.sessionManager.deleteSession(id)) return;
    if (wasCurrent) {
      this.newChat();
    } else {
      this.postSessions();
    }
  }

  private renameSession(id: string, title: string) {
    if (!this.sessionManager.renameSession(id, title)) return;
    this.postSessions();
  }

  private async retryLastTurn() {
    if (this.isStreaming) return;
    while (this.history.length > 0 && this.history[this.history.length - 1].role !== "user") {
      this.history.pop();
    }
    if (this.history.length > 0) this.history.pop();
    if (this.history.length === 0) return;

    const last = this.history[this.history.length - 1];
    if (last.role !== "user") return;

    let text = "";
    if (typeof last.content === "string") {
      text = last.content;
    } else if (Array.isArray(last.content)) {
      text = last.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }
    if (!text.trim()) return;

    let userText = text;
    const marker = "---\n\n";
    const idx = userText.lastIndexOf(marker);
    if (idx >= 0) userText = userText.slice(idx + marker.length);
    this.history.pop();

    this.postToWebview({ type: "history", messages: this.history });
    await this.handleUserMessage(userText.trim());
  }

  private async insertAtCursor(text: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Hooshyar: no active editor to insert into.");
      return;
    }
    await editor.edit((eb) => {
      eb.insert(editor.selection.active, text);
    });
  }

  private async searchMentions(query: string) {
    await getWorkspaceFileIndex();
    const items = searchFileIndex(query, 12);
    const aliases = [
      { path: "workspace", label: "@workspace" },
      { path: "selection", label: "@selection" }
    ];
    const merged = [...aliases.filter((a) => a.path.includes(query.toLowerCase()) || query === ""), ...items];
    this.postToWebview({ type: "mentionSuggestions", items: merged.slice(0, 12) });
  }

  /** Stops the current generation immediately (called from the Stop button or command palette). */
  public stop() {
    if (!this.isStreaming) return;
    this.abortController?.abort();
  }

  public async attachFileCommand() {
    await this.pickAndAttachFile();
  }

  private async pickAndAttachFile() {
    const folders = vscode.workspace.workspaceFolders;
    const defaultUri = folders?.[0]?.uri;

    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      defaultUri,
      openLabel: "Attach to chat",
      filters: {
        Images: ["png", "jpg", "jpeg", "gif", "webp"],
        "Text files": ["txt", "md", "ts", "tsx", "js", "jsx", "py", "json", "css", "html", "yml", "yaml"]
      }
    });
    if (!uris || uris.length === 0) return;

    const root = folders?.[0]?.uri.fsPath;
    for (const uri of uris) {
      try {
        if (isImagePath(uri.fsPath)) {
          const image = await readImageAttachment(uri);
          this.pendingImages.push(image);
          continue;
        }

        if (!root) {
          vscode.window.showWarningMessage("Hooshyar: open a workspace folder to attach text files.");
          continue;
        }

        if (!isLikelyTextFile(uri.fsPath)) {
          vscode.window.showWarningMessage(`Hooshyar: skipped binary file ${path.basename(uri.fsPath)}`);
          continue;
        }

        const bytes = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(bytes).toString("utf-8");
        const relPath = path.relative(root, uri.fsPath).split(path.sep).join("/");
        this.pendingAttachments.push({ path: relPath, content });
      } catch (err: any) {
        vscode.window.showWarningMessage(`Hooshyar: couldn't attach ${uri.fsPath}: ${err?.message ?? err}`);
      }
    }

    this.postAttachments();
  }

  private removePendingAttachment(kind: "file" | "image", index: number) {
    if (kind === "file") {
      if (index >= 0 && index < this.pendingAttachments.length) {
        this.pendingAttachments.splice(index, 1);
      }
    } else if (index >= 0 && index < this.pendingImages.length) {
      this.pendingImages.splice(index, 1);
    }
    this.postAttachments();
  }

  private postAttachments() {
    this.postToWebview({
      type: "attachmentsUpdated",
      files: this.pendingAttachments.map((f) => f.path),
      images: this.pendingImages.map((img) => ({
        name: img.name,
        dataUrl: imageToDataUrl(img)
      }))
    });
  }

  private postToWebview(msg: ExtensionToWebviewMessage) {
    this.view?.webview.postMessage(msg);
  }

  private async requestMutatingApproval(call: ToolUseBlock): Promise<boolean> {
    let diffPreview: string | undefined;
    try {
      if (call.name === "write_file" && typeof call.input.path === "string" && typeof call.input.content === "string") {
        await showWriteDiff(call.input.path, call.input.content);
        let oldContent = "";
        try {
          const { uri } = resolveWorkspaceUri(call.input.path);
          oldContent = await readTextFile(uri);
        } catch {
          oldContent = "";
        }
        diffPreview = buildInlineDiffPreview(call.input.path, oldContent, call.input.content);
      } else if (
        call.name === "search_replace" &&
        typeof call.input.path === "string" &&
        typeof call.input.old_string === "string" &&
        typeof call.input.new_string === "string"
      ) {
        const { uri } = resolveWorkspaceUri(call.input.path);
        const text = await readTextFile(uri);
        const updated = call.input.replace_all
          ? text.split(call.input.old_string).join(call.input.new_string)
          : text.replace(call.input.old_string, call.input.new_string);
        await showWriteDiff(call.input.path, updated);
        diffPreview = buildInlineDiffPreview(call.input.path, text, updated);
      }
    } catch (err: any) {
      logError(`Diff preview failed: ${err?.message ?? err}`);
    }

    const description =
      call.name === "run_command"
        ? `Run command: ${String(call.input.command)}`
        : call.name === "search_replace"
        ? `Edit file: ${String(call.input.path)}`
        : `Write file: ${String(call.input.path)}`;

    return this.requestApproval(call.name, description, diffPreview);
  }

  private async requestApproval(name: string, description: string, diffPreview?: string): Promise<boolean> {
    const cfg = vscode.workspace.getConfiguration("hooshyar");
    if (!cfg.get<boolean>("requireApprovalForWrites", true)) return true;

    const id = Math.random().toString(36).slice(2);
    this.postToWebview({ type: "approvalRequest", id, name, description, diffPreview });
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(id, resolve);
    });
  }

  private async handleUserMessage(text: string) {
    const isFirstMessage = this.history.length === 0;
    const contextPrefix = await buildContextPrefix(this.pendingAttachments, () => {
      this.pendingAttachments = [];
    });
    const envAndMentions = await buildUserMessagePrefix(text, isFirstMessage);
    const prefix = envAndMentions + contextPrefix;
    const images = [...this.pendingImages];
    this.pendingImages = [];
    this.postAttachments();

    const userContent = buildUserContent(prefix + text, images);
    this.history.push({ role: "user", content: userContent });

    logInfo(`User message (${text.length} chars${images.length ? `, ${images.length} image(s)` : ""})`);

    this.abortController?.abort();
    this.abortController = new AbortController();
    this.isStreaming = true;
    this.postToWebview({ type: "streaming", active: true });

    try {
      await this.runAgentTurn(this.abortController.signal);
    } finally {
      this.isStreaming = false;
      this.postToWebview({ type: "streaming", active: false });
      await this.persistCurrentSession();
      this.postSessions();
    }
  }

  /** Runs one full turn: stream a response, execute any tool calls, and loop until end_turn or stop. */
  private async runAgentTurn(signal: AbortSignal, depth = 0): Promise<void> {
    if (signal.aborted) return;
    if (depth > 12) {
      this.postToWebview({ type: "error", message: "Stopped after too many tool-call rounds." });
      return;
    }

    const cfg = vscode.workspace.getConfiguration("hooshyar");
    const enableTools = cfg.get<boolean>("enableTools", true);
    const enableShellTool = cfg.get<boolean>("enableShellTool", false);
    const maxCodebaseFiles = cfg.get<number>("maxCodebaseFiles", 400);

    const assembledBlocks: ContentBlock[] = [];
    let currentTextIndex: number | null = null;
    const toolUseByIndex = new Map<number, { id: string; name: string; jsonParts: string[] }>();
    // Per-request token counters (input/output are cumulative within one response).
    let reqInput = 0;
    let reqOutput = 0;

    this.lastTurnTextLength = 0;
    const apiMessages = this.prepareMessagesForApi();
    const useNative = this.effectiveToolProtocol() === "native";
    const sendTools = enableTools && useNative;

    if (depth > 0) {
      this.postToWebview({ type: "agentWorking", active: true });
    }

    logDebug(`Agent turn depth=${depth} protocol=${this.effectiveToolProtocol()} messages=${apiMessages.length}`);

    await this.apiClient.send(
      {
        messages: apiMessages,
        system: this.cachedSystemPrompt,
        tools: sendTools ? buildToolDefinitions({ enableShellTool }) : undefined,
        tool_choice: sendTools ? { type: "auto" } : undefined
      },
      {
        onTextDelta: (text) => {
          this.lastTurnTextLength += text.length;
          this.postToWebview({ type: "assistantTextDelta", text });
          if (currentTextIndex === null) {
            assembledBlocks.push({ type: "text", text: "" });
            currentTextIndex = assembledBlocks.length - 1;
          }
          const block = assembledBlocks[currentTextIndex] as { type: "text"; text: string };
          block.text += text;
        },
        onToolUseStart: (index, id, name) => {
          toolUseByIndex.set(index, { id, name, jsonParts: [] });
        },
        onToolUseInputDelta: (index, partialJson) => {
          toolUseByIndex.get(index)?.jsonParts.push(partialJson);
        },
        onToolUseStop: (index) => {
          const entry = toolUseByIndex.get(index);
          if (!entry) return;
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(entry.jsonParts.join("") || "{}");
          } catch {
            input = {};
          }
          assembledBlocks.push({ type: "tool_use", id: entry.id, name: entry.name, input });
        },
        onUsage: (usage) => {
          if (typeof usage.input_tokens === "number") reqInput = usage.input_tokens;
          if (typeof usage.output_tokens === "number") reqOutput = usage.output_tokens;
        },
        onNativeToolDetected: () => {
          if (this.readConfig().toolProtocol === "auto") {
            this.detectedToolProtocol = "native";
            logInfo("Provider supports native tool_use blocks.");
          }
        },
        onDone: () => {
          /* handled after send() resolves below */
        },
        onError: (message) => {
          if (!signal.aborted) this.postToWebview({ type: "error", message });
        }
      },
      signal
    );

    if (reqInput === 0) {
      reqInput = estimateTokens(JSON.stringify(apiMessages) + this.cachedSystemPrompt);
    }
    if (reqOutput === 0) {
      const outText = assembledBlocks
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");
      reqOutput = estimateTokens(outText || " ".repeat(this.lastTurnTextLength));
    }

    this.sessionUsage.input_tokens = (this.sessionUsage.input_tokens ?? 0) + reqInput;
    this.sessionUsage.output_tokens = (this.sessionUsage.output_tokens ?? 0) + reqOutput;
    this.postUsage();

    this.postToWebview({ type: "assistantMessageDone" });
    this.postToWebview({ type: "agentWorking", active: false });
    if (signal.aborted) {
      // Persist whatever partial text/tool-calls we got so the stopped turn isn't silently lost.
      if (assembledBlocks.length > 0) this.history.push({ role: "assistant", content: assembledBlocks });
      return;
    }

    if (assembledBlocks.length === 0) {
      if (depth > 0 && userWantsFileWrite(this.getLastUserMessageTextLocal()) && depth < 12) {
        this.history.push({
          role: "user",
          content:
            "Continue the task. The user asked you to create or edit a file. " +
            "You already explored the project — now call write_file with the FULL file content " +
            "using the <write_file><path>...</path><content>...</content></write_file> format. Do not stop."
        });
        await this.runAgentTurn(signal, depth + 1);
      } else if (depth > 0) {
        this.postToWebview({
          type: "error",
          message: "Provider returned an empty response after tool execution. Try again or check your API settings."
        });
      }
      return;
    }
    this.history.push({ role: "assistant", content: assembledBlocks });

    let toolUseBlocks = assembledBlocks.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (toolUseBlocks.length === 0) {
      const knownToolNames = buildToolDefinitions({ enableShellTool: true }).map((t) => t.name);
      const fallback = extractTextualToolCalls(assembledBlocks, knownToolNames);
      if (fallback.toolCalls.length > 0) {
        toolUseBlocks = fallback.toolCalls;
        // Replace the stored assistant message with a cleaned text block + the
        // recovered tool_use blocks, so history stays consistent for the next turn.
        const rebuilt: ContentBlock[] = [];
        if (fallback.cleanedText.length > 0) {
          rebuilt.push({ type: "text", text: fallback.cleanedText });
        }
        rebuilt.push(...fallback.toolCalls);
        assembledBlocks.length = 0;
        assembledBlocks.push(...rebuilt);
        this.history[this.history.length - 1] = { role: "assistant", content: assembledBlocks };
      }
    }
    if (toolUseBlocks.length === 0) {
      const proposed = extractProposedFileWrites(assembledBlocks, this.getLastUserMessageTextLocal());
      if (proposed.length > 0) {
        toolUseBlocks = proposed;
      }
    }
    if (toolUseBlocks.length === 0) return; // plain end_turn, nothing left to do

    const resultBlocks: ContentBlock[] = [];
    for (const call of toolUseBlocks) {
      if (signal.aborted) break;
      this.postToWebview({ type: "toolCall", id: call.id, name: call.name, input: call.input });

      if (isMutatingTool(call.name)) {
        const approved = await this.requestMutatingApproval(call);
        if (!approved) {
          resultBlocks.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: "User declined this action.",
            is_error: true
          });
          this.postToWebview({ type: "toolResult", id: call.id, content: "Declined by user.", isError: true });
          continue;
        }
      }

      try {
        const rawOutput = await executeTool(call.name, call.input, {
          maxCodebaseFiles,
          onTaskUpdate: (tasks) => {
            this.taskList = tasks;
            this.postToWebview({ type: "taskListUpdate", tasks });
          }
        });
        const output = truncateToolOutput(rawOutput);
        resultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: output });
        this.postToWebview({ type: "toolResult", id: call.id, content: output, isError: false });
        if (call.name === "write_file" && typeof call.input.path === "string") {
          await openWrittenFile(call.input.path);
        }
      } catch (err: any) {
        const message = err?.message ?? String(err);
        resultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: message, is_error: true });
        this.postToWebview({ type: "toolResult", id: call.id, content: message, isError: true });
      }
    }

    if (signal.aborted) return;
    this.history.push({ role: "user", content: resultBlocks });
    await this.runAgentTurn(signal, depth + 1);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "style.css"));
    const nonce = String(Math.random()).slice(2);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};" />
  <link href="${styleUri}" rel="stylesheet" />
</head>
<body>
  <div id="layout">
    <aside id="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Chats</span>
        <button type="button" id="sidebar-new-btn" title="New chat">+</button>
      </div>
      <div id="session-list"></div>
    </aside>
    <div id="chat-pane">
      <div id="chat-pane-header">
        <button type="button" id="sidebar-toggle" title="Toggle chat history">☰</button>
        <span id="chat-pane-title">Chat</span>
      </div>
      <div id="tasklist" class="hidden"></div>
      <div id="messages"></div>
      <div id="approval-banner" class="hidden"></div>
      <div id="mention-menu" class="hidden"></div>
      <div id="statusbar"><span id="usage-info">0 tokens</span></div>
      <div id="attachments-bar" class="hidden"></div>
      <form id="input-form">
        <button type="button" id="attach-btn" title="Attach file or image">📎</button>
        <textarea id="input" rows="1" placeholder="Ask Hooshyar... @file @workspace (Shift+Enter newline)"></textarea>
        <button type="submit" id="send-btn">Send</button>
        <button type="button" id="stop-btn" class="hidden">Stop</button>
      </form>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

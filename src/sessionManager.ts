import * as vscode from "vscode";
import { ChatSession, ChatSessionMeta, Message } from "./types";

const SESSIONS_KEY = "hooshyar.sessions";
const MAX_SESSIONS = 50;
const MAX_HISTORY_CHARS = 400_000;

export class SessionManager {
  private currentSessionId: string;

  constructor(private readonly memento: vscode.Memento) {
    this.currentSessionId = this.genId();
    this.restoreLastSession();
  }

  getCurrentId(): string {
    return this.currentSessionId;
  }

  setCurrentId(id: string): void {
    this.currentSessionId = id;
  }

  genId(): string {
    return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  getSessions(): ChatSession[] {
    return this.memento.get<ChatSession[]>(SESSIONS_KEY, []);
  }

  metas(): ChatSessionMeta[] {
    return this.getSessions().map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt }));
  }

  find(id: string): ChatSession | undefined {
    return this.getSessions().find((s) => s.id === id);
  }

  private restoreLastSession(): void {
    const sessions = this.getSessions();
    if (sessions.length > 0) {
      this.currentSessionId = sessions[0].id;
    }
  }

  deriveTitle(history: Message[]): string {
    for (const m of history) {
      if (m.role !== "user") continue;
      let t = "";
      if (typeof m.content === "string") {
        t = m.content;
      } else if (Array.isArray(m.content)) {
        t = m.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
      }
      if (!t.trim()) continue;
      const marker = "---\n\n";
      const idx = t.lastIndexOf(marker);
      if (idx >= 0) t = t.slice(idx + marker.length);
      t = t.replace(/\s+/g, " ").trim();
      if (t) return t.slice(0, 60);
    }
    return "New chat";
  }

  private compressHistory(history: Message[]): Message[] {
    const serialized = JSON.stringify(history);
    if (serialized.length <= MAX_HISTORY_CHARS) return history;

    const trimmed = [...history];
    while (trimmed.length > 2 && JSON.stringify(trimmed).length > MAX_HISTORY_CHARS) {
      trimmed.shift();
    }
    return trimmed;
  }

  persist(
    sessionId: string,
    history: Message[],
    taskList: ChatSession["taskList"],
    usage: ChatSession["usage"]
  ): Thenable<void> {
    if (history.length === 0) return Promise.resolve();

    const sessions = this.getSessions();
    const now = Date.now();
    const idx = sessions.findIndex((s) => s.id === sessionId);
    const session: ChatSession = {
      id: sessionId,
      title: this.deriveTitle(history),
      createdAt: idx >= 0 ? sessions[idx].createdAt : now,
      updatedAt: now,
      history: this.compressHistory(history),
      taskList,
      usage
    };
    if (idx >= 0) sessions.splice(idx, 1);
    sessions.unshift(session);
    return this.memento.update(SESSIONS_KEY, sessions.slice(0, MAX_SESSIONS));
  }

  deleteSession(id: string): boolean {
    const sessions = this.getSessions();
    const next = sessions.filter((s) => s.id !== id);
    if (next.length === sessions.length) return false;
    void this.memento.update(SESSIONS_KEY, next);
    return true;
  }

  renameSession(id: string, title: string): boolean {
    const sessions = this.getSessions();
    const session = sessions.find((s) => s.id === id);
    if (!session) return false;
    session.title = title.trim().slice(0, 80) || session.title;
    session.updatedAt = Date.now();
    void this.memento.update(SESSIONS_KEY, sessions);
    return true;
  }
}

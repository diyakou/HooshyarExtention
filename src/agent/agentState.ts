export type AgentState =
  | "IDLE"
  | "REQUESTING_MODEL"
  | "WAITING_FOR_TOOL"
  | "WAITING_FOR_APPROVAL"
  | "RUNNING_TOOL"
  | "VERIFYING"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export interface AgentStateSnapshot {
  state: AgentState;
  previous: AgentState;
  changedAt: number;
  detail?: string;
}

const TRANSITIONS: Record<AgentState, ReadonlySet<AgentState>> = {
  IDLE: new Set(["REQUESTING_MODEL"]),
  REQUESTING_MODEL: new Set(["WAITING_FOR_TOOL", "COMPLETED", "CANCELLED", "FAILED"]),
  WAITING_FOR_TOOL: new Set(["WAITING_FOR_APPROVAL", "RUNNING_TOOL", "CANCELLED", "FAILED"]),
  WAITING_FOR_APPROVAL: new Set(["RUNNING_TOOL", "REQUESTING_MODEL", "CANCELLED", "FAILED"]),
  RUNNING_TOOL: new Set(["REQUESTING_MODEL", "VERIFYING", "COMPLETED", "CANCELLED", "FAILED"]),
  VERIFYING: new Set(["REQUESTING_MODEL", "COMPLETED", "CANCELLED", "FAILED"]),
  COMPLETED: new Set(["IDLE", "REQUESTING_MODEL"]),
  CANCELLED: new Set(["IDLE", "REQUESTING_MODEL"]),
  FAILED: new Set(["IDLE", "REQUESTING_MODEL"])
};

export class AgentStateMachine {
  private current: AgentState = "IDLE";
  private listeners = new Set<(snapshot: AgentStateSnapshot) => void>();

  get state(): AgentState {
    return this.current;
  }

  transition(next: AgentState, detail?: string): AgentStateSnapshot {
    if (next === this.current) {
      return { state: next, previous: this.current, changedAt: Date.now(), detail };
    }
    if (!TRANSITIONS[this.current].has(next)) {
      throw new Error(`Invalid agent state transition: ${this.current} -> ${next}`);
    }
    const previous = this.current;
    this.current = next;
    const snapshot = { state: next, previous, changedAt: Date.now(), detail };
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  reset(): void {
    if (this.current !== "IDLE") this.transition("IDLE");
  }

  onDidChange(listener: (snapshot: AgentStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

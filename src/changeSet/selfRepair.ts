import { getVerificationAgent, VerificationResult } from "../agent/verificationAgent";
import { getChangeSetManager } from "./changeSetManager";
import { logInfo, logWarn } from "../logger";

export interface RepairAttempt {
  attempt: number;
  error: string;
  fixes: string[];
  success: boolean;
}

export class SelfRepairPipeline {
  private readonly maxAttempts = 3;

  async verifyAndRepair(changeSetId: string): Promise<{ success: boolean; attempts: RepairAttempt[] }> {
    const manager = getChangeSetManager();
    const changeSet = manager.getChangeSet(changeSetId);
    if (!changeSet) throw new Error(`ChangeSet ${changeSetId} not found`);
    const files = changeSet.changes.map((change) => change.path);
    const verification = getVerificationAgent();
    const attempts: RepairAttempt[] = [];

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const result = await verification.verify(files);
      if (result.passed) {
        manager.markVerified(changeSetId, true, result.summary);
        logInfo(`ChangeSet ${changeSetId} verified on attempt ${attempt}`);
        return { success: true, attempts };
      }
      let fixes: string[] = [];
      try {
        fixes = attempt < this.maxAttempts ? await verification.applyQuickFixes(files) : [];
      } catch (err: any) {
        logWarn(`Quick fix application failed: ${err?.message ?? err}`);
      }
      attempts.push({ attempt, error: summarizeFailure(result), fixes, success: fixes.length > 0 });
      if (fixes.length === 0) break;
    }

    const last = attempts.at(-1);
    manager.markVerified(changeSetId, false, last?.error || "Verification failed without an applicable quick fix.");
    logWarn(`ChangeSet ${changeSetId} could not be repaired automatically`);
    return { success: false, attempts };
  }
}

function summarizeFailure(result: VerificationResult): string {
  return [result.summary, ...result.suggestions].join("\n");
}

let globalSelfRepair: SelfRepairPipeline | undefined;

export function getSelfRepairPipeline(): SelfRepairPipeline {
  globalSelfRepair ??= new SelfRepairPipeline();
  return globalSelfRepair;
}

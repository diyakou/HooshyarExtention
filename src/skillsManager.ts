import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { SkillReference } from "./types";
import { logWarn } from "./logger";

const MAX_SKILL_FILE_BYTES = 100_000;
const MAX_SKILLS_CHARS = 24_000;

function skillPath(reference: SkillReference): string {
  return typeof reference === "string" ? reference : reference.path;
}

function skillName(reference: SkillReference, filePath: string): string {
  if (typeof reference !== "string" && reference.name?.trim()) return reference.name.trim();
  return path.basename(path.dirname(filePath)) || path.basename(filePath, path.extname(filePath));
}

function isEnabled(reference: SkillReference): boolean {
  return typeof reference === "string" || reference.enabled !== false;
}

export function isSkillReference(value: unknown): value is SkillReference {
  return typeof value === "string" || (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { path?: unknown }).path === "string"
  );
}

async function resolveWorkspaceSkillPath(
  rawPath: string,
  folders = vscode.workspace.workspaceFolders
): Promise<{ absolute: string; label: string } | undefined> {
  if (!folders?.length || !rawPath.trim()) return undefined;

  const normalized = rawPath.trim().replace(/\\/g, "/");
  const candidates: Array<{ absolute: string; label: string; root: string }> = [];

  if (path.isAbsolute(rawPath)) {
    for (const folder of folders) {
      candidates.push({ absolute: rawPath, label: path.basename(rawPath), root: folder.uri.fsPath });
    }
  } else {
    const explicitlyNamedFolder = folders.find((folder) => normalized.startsWith(`${folder.name}/`));
    for (const folder of folders) {
      const prefix = `${folder.name}/`;
      if (explicitlyNamedFolder && folder !== explicitlyNamedFolder) continue;
      const relative = explicitlyNamedFolder ? normalized.slice(prefix.length) : normalized;
      candidates.push({
        absolute: path.resolve(folder.uri.fsPath, relative),
        label: folders.length > 1 ? `${folder.name}/${relative}` : relative,
        root: folder.uri.fsPath
      });
    }
  }

  for (const candidate of candidates) {
    try {
      const [realFile, realRoot] = await Promise.all([fs.realpath(candidate.absolute), fs.realpath(candidate.root)]);
      const relative = path.relative(realRoot, realFile);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      const stat = await fs.stat(realFile);
      if (!stat.isFile() || stat.size > MAX_SKILL_FILE_BYTES) continue;
      return { absolute: realFile, label: candidate.label };
    } catch {
      // Try the next workspace folder.
    }
  }
  return undefined;
}

export async function loadSkills(options?: {
  references?: SkillReference[];
  folders?: readonly vscode.WorkspaceFolder[];
  trusted?: boolean;
}): Promise<string> {
  if ((options?.trusted ?? vscode.workspace.isTrusted) === false) return "";

  const references = options?.references ??
    vscode.workspace.getConfiguration("hooshyar").get<SkillReference[]>("skills", []);
  const folders = options?.folders ?? vscode.workspace.workspaceFolders;
  const sections: string[] = [];
  let remaining = MAX_SKILLS_CHARS;

  for (const reference of references) {
    if (!isSkillReference(reference) || !isEnabled(reference) || remaining <= 0) continue;
    const requestedPath = skillPath(reference);
    const resolved = await resolveWorkspaceSkillPath(requestedPath, folders);
    if (!resolved) {
      logWarn(`[Skill] File is missing, outside the workspace, or too large: ${requestedPath}`);
      continue;
    }
    try {
      const content = (await fs.readFile(resolved.absolute, "utf8")).trim();
      if (!content) continue;
      const bounded = content.slice(0, remaining);
      sections.push(`[Skill: ${skillName(reference, resolved.absolute)} | ${resolved.label}]\n${bounded}`);
      remaining -= bounded.length;
    } catch (err: any) {
      logWarn(`[Skill] Could not load ${requestedPath}: ${err?.message ?? err}`);
    }
  }

  return sections.join("\n\n");
}

export function workspaceRelativeSkillPath(
  uri: vscode.Uri,
  folders = vscode.workspace.workspaceFolders
): string | undefined {
  if (!folders?.length) return undefined;
  const folder = folders.find((item) => {
    const relative = path.relative(item.uri.fsPath, uri.fsPath);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
  if (!folder) return undefined;
  const relative = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/");
  return folders.length > 1 ? `${folder.name}/${relative}` : relative;
}

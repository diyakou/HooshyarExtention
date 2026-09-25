import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { loadSkills, workspaceRelativeSkillPath } from "../out/skillsManager.js";

const require = createRequire(import.meta.url);
const vscode = require("vscode");

test("Standalone skill loading", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hooshyar-plugin-skill-"));
  const skillDir = path.join(root, ".hooshyar", "skills", "review");
  await fs.mkdir(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, "SKILL.md");
  await fs.writeFile(skillFile, "# Review skill\nCheck tests before completing work.", "utf8");

  const folders = [{
    uri: vscode.Uri.file(root),
    name: "sample",
    index: 0
  }];

  try {
    await t.test("loads a standalone skill", async () => {
      const references = [".hooshyar/skills/review/SKILL.md"];
      const loaded = await loadSkills({ references, folders, trusted: true });
      assert.match(loaded, /Skill: review/);
      assert.match(loaded, /Check tests before completing work/);
    });

    await t.test("rejects skill files outside the workspace", async () => {
      const references = [path.join(os.tmpdir(), "outside-SKILL.md")];
      assert.equal(await loadSkills({ references, folders, trusted: true }), "");
    });

    await t.test("converts selected files to workspace-relative paths", () => {
      assert.equal(
        workspaceRelativeSkillPath(vscode.Uri.file(skillFile), folders),
        ".hooshyar/skills/review/SKILL.md"
      );
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

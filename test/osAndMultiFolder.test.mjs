import test from "node:test";
import assert from "node:assert/strict";
import {
  getEnvironmentPlatformInfo,
  normalizeFsPath,
  isSubpath
} from "../out/workspaceUtils.js";
import {
  normalizeWindowsCommand,
  assertSafeCommand
} from "../out/tools.js";
import {
  buildSystemPrompt,
  buildEnvironmentDetails
} from "../out/messageNormalizer.js";

test("OS & Terminal Compatibility Tests", async (t) => {
  await t.test("getEnvironmentPlatformInfo returns valid OS and shell details", () => {
    const info = getEnvironmentPlatformInfo();
    assert.ok(info.os);
    assert.ok(info.platform);
    assert.ok(info.shell);
    assert.equal(typeof info.isWindows, "boolean");
    if (process.platform === "win32") {
      assert.equal(info.os, "Windows");
      assert.equal(info.isWindows, true);
    }
  });

  await t.test("normalizeWindowsCommand converts common Linux commands when on Windows", () => {
    if (process.platform === "win32") {
      assert.equal(normalizeWindowsCommand("export PORT=3000"), "set PORT=3000");
      assert.equal(normalizeWindowsCommand("export NODE_ENV=production"), "set NODE_ENV=production");
      assert.equal(normalizeWindowsCommand("which node"), "where node");
      assert.equal(normalizeWindowsCommand("source .venv/bin/activate"), ".venv\\Scripts\\activate");
      assert.equal(normalizeWindowsCommand("source ./venv/bin/activate"), "./venv\\Scripts\\activate");
      assert.equal(normalizeWindowsCommand("source script.bat"), "call script.bat");
    } else {
      // On non-Windows, passes through unchanged
      assert.equal(normalizeWindowsCommand("export PORT=3000"), "export PORT=3000");
    }
  });

  await t.test("assertSafeCommand allows safe variables while blocking command injection", () => {
    assert.doesNotThrow(() => assertSafeCommand("echo $env:PATH"));
    assert.doesNotThrow(() => assertSafeCommand("echo $PORT"));
    assert.throws(() => assertSafeCommand("echo $(whoami)"));
    assert.throws(() => assertSafeCommand("echo `dir`"));
  });

  await t.test("buildSystemPrompt includes OS instructions and multi-project guidance", async () => {
    const prompt = await buildSystemPrompt("Base prompt text");
    assert.ok(prompt.includes("HOST ENVIRONMENT & TERMINAL COMMAND RULES"));
    const info = getEnvironmentPlatformInfo();
    assert.ok(prompt.includes(info.os));
    if (info.isWindows) {
      assert.ok(prompt.includes("CRITICAL WINDOWS COMMAND RULES"));
      assert.ok(prompt.includes("NEVER generate Linux-only commands"));
    }
  });

  await t.test("buildEnvironmentDetails formats platform and shell info", async () => {
    const env = await buildEnvironmentDetails();
    assert.ok(env.includes("[environment_details]"));
    assert.ok(env.includes("Operating System:"));
    assert.ok(env.includes("Terminal Shell:"));
  });
});

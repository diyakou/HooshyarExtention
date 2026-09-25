import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHostCommandGuidance,
  getEnvironmentPlatformInfo,
  normalizeFsPath,
  isSubpath
} from "../out/workspaceUtils.js";
import {
  normalizeCommandForHost,
  normalizeWindowsCommand,
  assertSafeCommand
} from "../out/tools.js";
import {
  buildSystemPrompt,
  buildEnvironmentDetails,
  composeUserMessage,
  getDisplayUserMessageText,
  getLastUserMessageText
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
      assert.equal(normalizeWindowsCommand("source .venv/bin/activate"), "call .venv\\Scripts\\activate.bat");
      assert.equal(normalizeWindowsCommand("source ./venv/bin/activate"), "call .\\venv\\Scripts\\activate.bat");
      assert.equal(normalizeWindowsCommand("source script.bat"), "call script.bat");
    } else {
      // On non-Windows, passes through unchanged
      assert.equal(normalizeWindowsCommand("export PORT=3000"), "export PORT=3000");
    }
  });

  await t.test("normalizes generated commands for the exact Windows shell", () => {
    const powershell = {
      os: "Windows",
      platform: "win32",
      shell: "pwsh",
      shellPath: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      shellFamily: "powershell",
      isWindows: true
    };
    const cmd = {
      ...powershell,
      shell: "cmd",
      shellPath: "C:\\Windows\\System32\\cmd.exe",
      shellFamily: "cmd"
    };

    assert.equal(normalizeCommandForHost("export PORT=3000", powershell), "$env:PORT='3000'");
    assert.equal(normalizeCommandForHost("which node && ls -la", powershell), "Get-Command node && Get-ChildItem -Force");
    assert.equal(
      normalizeCommandForHost("source .venv/bin/activate", powershell),
      '& ".venv\\Scripts\\Activate.ps1"'
    );
    assert.equal(normalizeCommandForHost("export PORT=3000", cmd), "set PORT=3000");
    assert.equal(normalizeCommandForHost("which node && ls -la", cmd), "where node && dir /a");
    assert.equal(
      normalizeCommandForHost("source .venv/bin/activate", cmd),
      "call .venv\\Scripts\\activate.bat"
    );
  });

  await t.test("host command guidance names the detected shell family", () => {
    const powershellGuidance = buildHostCommandGuidance({
      os: "Windows",
      platform: "win32",
      shell: "powershell",
      shellPath: "powershell.exe",
      shellFamily: "powershell",
      isWindows: true
    });
    assert.match(powershellGuidance, /Generate PowerShell commands only/);
    assert.match(powershellGuidance, /not Linux\/bash or CMD/);
  });

  await t.test("assertSafeCommand allows safe variables while blocking command injection", () => {
    assert.doesNotThrow(() => assertSafeCommand("echo $env:PATH"));
    assert.doesNotThrow(() => assertSafeCommand("echo $PORT"));
    assert.doesNotThrow(() => assertSafeCommand('python -c "import sys; print(sys.version)"'));
    assert.doesNotThrow(() => assertSafeCommand('node -e "const a = 1; console.log(a);"'));
    assert.doesNotThrow(() => assertSafeCommand('git commit -m "feat: user; profile"'));
    assert.throws(() => assertSafeCommand("echo $(whoami)"));
    assert.throws(() => assertSafeCommand("echo `dir`"));
    assert.throws(() => assertSafeCommand("echo a; echo b"));
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

  await t.test("user message display excludes automatically attached context", () => {
    const content = composeUserMessage(
      ["[environment_details]\nOS: macOS\n[/environment_details]", "[Markdown file: README.md]\nSupported Versions"],
      "سلام"
    );

    assert.equal(getDisplayUserMessageText(content), "سلام");
    assert.equal(getLastUserMessageText([{ role: "user", content }]), "سلام");

    const legacyContent =
      "[environment_details]\nOS: macOS\n[/environment_details]\n\n---\n\n" +
      "[Initial Markdown context]\n[Markdown file: README.md]\n```md\n## Supported Versions\n```سلام";
    assert.equal(getDisplayUserMessageText(legacyContent), "سلام");
  });
});

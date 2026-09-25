import * as vscode from "vscode";
import * as path from "path";
import { DependencyInfo } from "./types";

export async function analyzeDependencies(rootPath: string): Promise<{ runtime: { name: string; version: string }[]; dev: { name: string; version: string }[] }> {
  const runtime: { name: string; version: string }[] = [];
  const dev: { name: string; version: string }[] = [];

  // Try Node.js package.json
  const nodeDeps = await analyzeNodeDependencies(rootPath);
  runtime.push(...nodeDeps.runtime);
  dev.push(...nodeDeps.dev);

  // Try Python requirements.txt
  const pythonDeps = await analyzePythonDependencies(rootPath);
  runtime.push(...pythonDeps.runtime);
  dev.push(...pythonDeps.dev);

  // Try Java pom.xml
  const javaDeps = await analyzeJavaDependencies(rootPath);
  runtime.push(...javaDeps.runtime);
  dev.push(...javaDeps.dev);

  return { runtime, dev };
}

async function analyzeNodeDependencies(rootPath: string): Promise<{ runtime: { name: string; version: string }[]; dev: { name: string; version: string }[] }> {
  const runtime: { name: string; version: string }[] = [];
  const dev: { name: string; version: string }[] = [];

  try {
    const packageJsonUri = vscode.Uri.file(path.join(rootPath, "package.json"));
    const content = await vscode.workspace.fs.readFile(packageJsonUri);
    const pkg = JSON.parse(Buffer.from(content).toString("utf-8"));

    if (pkg.dependencies) {
      for (const [name, version] of Object.entries(pkg.dependencies)) {
        runtime.push({ name, version: String(version) });
      }
    }

    if (pkg.devDependencies) {
      for (const [name, version] of Object.entries(pkg.devDependencies)) {
        dev.push({ name, version: String(version) });
      }
    }
  } catch {
    // No package.json
  }

  return { runtime, dev };
}

async function analyzePythonDependencies(rootPath: string): Promise<{ runtime: { name: string; version: string }[]; dev: { name: string; version: string }[] }> {
  const runtime: { name: string; version: string }[] = [];
  const dev: { name: string; version: string }[] = [];

  try {
    const reqUri = vscode.Uri.file(path.join(rootPath, "requirements.txt"));
    const content = await vscode.workspace.fs.readFile(reqUri);
    const lines = Buffer.from(content).toString("utf-8").split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^([a-zA-Z0-9_-]+)([=<>~!]+.*)?$/);
      if (match) {
        const name = match[1];
        const version = match[2] ? match[2].replace(/^[=<>~!]+/, '') : "*";
        runtime.push({ name, version });
      }
    }
  } catch {
    // No requirements.txt
  }

  // Try requirements-dev.txt
  try {
    const reqDevUri = vscode.Uri.file(path.join(rootPath, "requirements-dev.txt"));
    const content = await vscode.workspace.fs.readFile(reqDevUri);
    const lines = Buffer.from(content).toString("utf-8").split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^([a-zA-Z0-9_-]+)([=<>~!]+.*)?$/);
      if (match) {
        const name = match[1];
        const version = match[2] ? match[2].replace(/^[=<>~!]+/, '') : "*";
        dev.push({ name, version });
      }
    }
  } catch {
    // No requirements-dev.txt
  }

  return { runtime, dev };
}

async function analyzeJavaDependencies(rootPath: string): Promise<{ runtime: { name: string; version: string }[]; dev: { name: string; version: string }[] }> {
  const runtime: { name: string; version: string }[] = [];
  const dev: { name: string; version: string }[] = [];

  try {
    const pomUri = vscode.Uri.file(path.join(rootPath, "pom.xml"));
    const content = await vscode.workspace.fs.readFile(pomUri);
    const xml = Buffer.from(content).toString("utf-8");

    // Simple XML parsing - extract dependencies
    const depRegex = /<dependency>[\s\S]*?<groupId>(.*?)<\/groupId>[\s\S]*?<artifactId>(.*?)<\/artifactId>[\s\S]*?(?:<version>(.*?)<\/version>)?[\s\S]*?(?:<scope>(.*?)<\/scope>)?[\s\S]*?<\/dependency>/g;

    let match;
    while ((match = depRegex.exec(xml)) !== null) {
      const [, groupId, artifactId, version, scope] = match;
      const name = `${groupId}:${artifactId}`;
      const ver = version || "*";

      if (scope === "test") {
        dev.push({ name, version: ver });
      } else {
        runtime.push({ name, version: ver });
      }
    }
  } catch {
    // No pom.xml
  }

  return { runtime, dev };
}

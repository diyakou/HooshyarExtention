import * as vscode from "vscode";
import * as path from "path";
import { TechStackDetectionResult } from "./types";

interface PackageInfo {
  frameworks: string[];
  buildTools: string[];
  testFrameworks: string[];
  packageManager?: string;
}

export async function detectTechStack(rootPath: string): Promise<TechStackDetectionResult> {
  const detections = await Promise.all([
    detectFromPackageJson(rootPath),
    detectFromPythonFiles(rootPath),
    detectFromJavaFiles(rootPath),
    detectFromConfigFiles(rootPath)
  ]);

  const frameworks = new Set<string>();
  const buildTools = new Set<string>();
  const testFrameworks = new Set<string>();
  let packageManager: string | undefined;

  for (const detection of detections) {
    detection.frameworks.forEach(f => frameworks.add(f));
    detection.buildTools.forEach(b => buildTools.add(b));
    detection.testFrameworks.forEach(t => testFrameworks.add(t));
    packageManager = packageManager || detection.packageManager;
  }

  return {
    frameworks: Array.from(frameworks),
    buildTools: Array.from(buildTools),
    testFrameworks: Array.from(testFrameworks),
    packageManager,
    confidence: frameworks.size > 0 || buildTools.size > 0 ? 0.8 : 0.3
  };
}

async function detectFromPackageJson(rootPath: string): Promise<PackageInfo> {
  const frameworks: string[] = [];
  const buildTools: string[] = [];
  const testFrameworks: string[] = [];
  let packageManager: string | undefined;

  try {
    const packageJsonUri = vscode.Uri.file(path.join(rootPath, "package.json"));
    const content = await vscode.workspace.fs.readFile(packageJsonUri);
    const pkg = JSON.parse(Buffer.from(content).toString("utf-8"));

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies
    };

    // Detect frameworks
    if (allDeps["react"]) frameworks.push("React");
    if (allDeps["vue"]) frameworks.push("Vue");
    if (allDeps["@angular/core"]) frameworks.push("Angular");
    if (allDeps["svelte"]) frameworks.push("Svelte");
    if (allDeps["next"]) frameworks.push("Next.js");
    if (allDeps["nuxt"]) frameworks.push("Nuxt");
    if (allDeps["express"]) frameworks.push("Express");
    if (allDeps["fastify"]) frameworks.push("Fastify");
    if (allDeps["nestjs"]) frameworks.push("NestJS");
    if (allDeps["electron"]) frameworks.push("Electron");

    // Detect build tools
    if (allDeps["webpack"]) buildTools.push("Webpack");
    if (allDeps["vite"]) buildTools.push("Vite");
    if (allDeps["rollup"]) buildTools.push("Rollup");
    if (allDeps["esbuild"]) buildTools.push("esbuild");
    if (allDeps["parcel"]) buildTools.push("Parcel");
    if (allDeps["typescript"]) buildTools.push("TypeScript");
    if (allDeps["@babel/core"]) buildTools.push("Babel");

    // Detect test frameworks
    if (allDeps["jest"]) testFrameworks.push("Jest");
    if (allDeps["mocha"]) testFrameworks.push("Mocha");
    if (allDeps["vitest"]) testFrameworks.push("Vitest");
    if (allDeps["@playwright/test"]) testFrameworks.push("Playwright");
    if (allDeps["cypress"]) testFrameworks.push("Cypress");
    if (allDeps["ava"]) testFrameworks.push("AVA");

    // Detect package manager
    packageManager = "npm"; // Default
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path.join(rootPath, "pnpm-lock.yaml")));
      packageManager = "pnpm";
    } catch {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(path.join(rootPath, "yarn.lock")));
        packageManager = "yarn";
      } catch {
        // npm
      }
    }
  } catch {
    // No package.json or invalid
  }

  return { frameworks, buildTools, testFrameworks, packageManager };
}

async function detectFromPythonFiles(rootPath: string): Promise<PackageInfo> {
  const frameworks: string[] = [];
  const buildTools: string[] = [];
  const testFrameworks: string[] = [];
  let packageManager: string | undefined;

  try {
    // Check for requirements.txt
    const reqUri = vscode.Uri.file(path.join(rootPath, "requirements.txt"));
    const content = await vscode.workspace.fs.readFile(reqUri);
    const requirements = Buffer.from(content).toString("utf-8").toLowerCase();

    if (requirements.includes("django")) frameworks.push("Django");
    if (requirements.includes("flask")) frameworks.push("Flask");
    if (requirements.includes("fastapi")) frameworks.push("FastAPI");
    if (requirements.includes("pytest")) testFrameworks.push("pytest");
    if (requirements.includes("unittest")) testFrameworks.push("unittest");

    packageManager = "pip";
  } catch {
    // No requirements.txt
  }

  try {
    // Check for pyproject.toml
    const pyprojectUri = vscode.Uri.file(path.join(rootPath, "pyproject.toml"));
    await vscode.workspace.fs.stat(pyprojectUri);
    buildTools.push("Poetry");
    packageManager = "poetry";
  } catch {
    // No pyproject.toml
  }

  return { frameworks, buildTools, testFrameworks, packageManager };
}

async function detectFromJavaFiles(rootPath: string): Promise<PackageInfo> {
  const frameworks: string[] = [];
  const buildTools: string[] = [];
  const testFrameworks: string[] = [];

  try {
    // Check for pom.xml (Maven)
    await vscode.workspace.fs.stat(vscode.Uri.file(path.join(rootPath, "pom.xml")));
    buildTools.push("Maven");
  } catch {
    // No pom.xml
  }

  try {
    // Check for build.gradle (Gradle)
    await vscode.workspace.fs.stat(vscode.Uri.file(path.join(rootPath, "build.gradle")));
    buildTools.push("Gradle");
  } catch {
    // No build.gradle
  }

  return { frameworks, buildTools, testFrameworks };
}

async function detectFromConfigFiles(rootPath: string): Promise<PackageInfo> {
  const frameworks: string[] = [];
  const buildTools: string[] = [];
  const testFrameworks: string[] = [];

  // Check for various config files
  const configFiles = [
    { file: "tsconfig.json", tool: "TypeScript" },
    { file: "webpack.config.js", tool: "Webpack" },
    { file: "vite.config.ts", tool: "Vite" },
    { file: "rollup.config.js", tool: "Rollup" },
    { file: "jest.config.js", tool: "Jest" },
    { file: "vitest.config.ts", tool: "Vitest" },
    { file: "cypress.config.js", tool: "Cypress" },
    { file: "playwright.config.ts", tool: "Playwright" }
  ];

  for (const { file, tool } of configFiles) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path.join(rootPath, file)));
      if (tool === "Jest" || tool === "Vitest" || tool === "Cypress" || tool === "Playwright") {
        testFrameworks.push(tool);
      } else {
        buildTools.push(tool);
      }
    } catch {
      // File doesn't exist
    }
  }

  return { frameworks, buildTools, testFrameworks };
}

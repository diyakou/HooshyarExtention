import * as vscode from "vscode";
import * as path from "path";
import { ProjectProfile } from "./types";
import { detectTechStack } from "./techStackDetector";
import { extractConventions } from "./conventionsExtractor";
import { analyzeDependencies } from "./dependencyAnalyzer";
import { getWorkspaceFolders } from "../workspaceUtils";
import { logInfo, logDebug } from "../logger";

const PROFILE_CACHE_KEY = "hooshyar.projectProfile";
const PROFILE_VERSION = 1;

export class ProjectProfileManager {
  private static active?: ProjectProfileManager;
  private profile?: ProjectProfile;
  private analyzing = false;

  constructor(private globalState: vscode.Memento) {
    ProjectProfileManager.active = this;
  }

  static getActive(): ProjectProfileManager | undefined {
    return ProjectProfileManager.active;
  }

  async getProfile(force = false): Promise<ProjectProfile | undefined> {
    if (this.profile && !force) return this.profile;

    if (this.analyzing) {
      logDebug("Project profile analysis already in progress");
      return this.profile;
    }

    const cached = this.loadCached();
    if (cached && !force) {
      this.profile = cached;
      return cached;
    }

    await this.analyzeProject();
    return this.profile;
  }

  async analyzeProject(): Promise<void> {
    if (this.analyzing) return;
    this.analyzing = true;

    try {
      logInfo("Analyzing project profile...");
      const folders = getWorkspaceFolders();
      if (folders.length === 0) {
        logDebug("No workspace folders to analyze");
        return;
      }

      const rootFolder = folders[0];
      const rootPath = rootFolder.uri.fsPath;

      // Run analyses in parallel
      const [techStack, conventions, dependencies, languages] = await Promise.all([
        detectTechStack(rootPath),
        extractConventions(rootPath),
        analyzeDependencies(rootPath),
        this.analyzeLanguages(rootPath)
      ]);

      this.profile = {
        languages,
        frameworks: techStack.frameworks,
        buildTools: techStack.buildTools,
        testFrameworks: techStack.testFrameworks,
        packageManager: techStack.packageManager,
        conventions,
        dependencies,
        architecture: await this.analyzeArchitecture(rootPath),
        metadata: {
          name: path.basename(rootPath),
          lastAnalyzed: Date.now()
        }
      };

      await this.saveCached(this.profile);
      logInfo(`Project profile analyzed: ${this.profile.languages.length} languages, ${this.profile.frameworks.length} frameworks`);
    } catch (error: any) {
      logDebug(`Project profile analysis failed: ${error?.message ?? error}`);
    } finally {
      this.analyzing = false;
    }
  }

  async invalidate(): Promise<void> {
    this.profile = undefined;
    await this.globalState.update(PROFILE_CACHE_KEY, undefined);
  }

  private async analyzeLanguages(rootPath: string): Promise<{ name: string; percentage: number }[]> {
    const extensions = new Map<string, number>();
    const files = await vscode.workspace.findFiles("**/*", "**/node_modules/**", 5000);

    for (const file of files) {
      const ext = path.extname(file.fsPath).toLowerCase();
      if (ext) {
        extensions.set(ext, (extensions.get(ext) || 0) + 1);
      }
    }

    const total = Array.from(extensions.values()).reduce((sum, count) => sum + count, 0);
    if (total === 0) return [];

    const langMap: Record<string, string> = {
      ".ts": "TypeScript",
      ".tsx": "TypeScript",
      ".js": "JavaScript",
      ".jsx": "JavaScript",
      ".py": "Python",
      ".java": "Java",
      ".go": "Go",
      ".rs": "Rust",
      ".cpp": "C++",
      ".c": "C",
      ".cs": "C#",
      ".rb": "Ruby",
      ".php": "PHP",
      ".swift": "Swift",
      ".kt": "Kotlin",
      ".scala": "Scala"
    };

    const languages = new Map<string, number>();
    for (const [ext, count] of extensions) {
      const lang = langMap[ext];
      if (lang) {
        languages.set(lang, (languages.get(lang) || 0) + count);
      }
    }

    return Array.from(languages.entries())
      .map(([name, count]) => ({ name, percentage: Math.round((count / total) * 100) }))
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 5);
  }

  private async analyzeArchitecture(rootPath: string): Promise<{ directories: { path: string; purpose: string }[]; patterns: string[] }> {
    const directories: { path: string; purpose: string }[] = [];
    const patterns: string[] = [];

    const commonDirs = [
      { name: "src", purpose: "Source code" },
      { name: "lib", purpose: "Library code" },
      { name: "test", purpose: "Tests" },
      { name: "tests", purpose: "Tests" },
      { name: "dist", purpose: "Build output" },
      { name: "build", purpose: "Build output" },
      { name: "out", purpose: "Build output" },
      { name: "public", purpose: "Public assets" },
      { name: "static", purpose: "Static assets" },
      { name: "docs", purpose: "Documentation" },
      { name: "scripts", purpose: "Build/utility scripts" },
      { name: "config", purpose: "Configuration" }
    ];

    for (const dir of commonDirs) {
      try {
        const dirUri = vscode.Uri.file(path.join(rootPath, dir.name));
        const stat = await vscode.workspace.fs.stat(dirUri);
        if (stat.type === vscode.FileType.Directory) {
          directories.push({ path: dir.name, purpose: dir.purpose });
        }
      } catch {
        // Directory doesn't exist
      }
    }

    // Detect common patterns
    if (directories.some(d => d.path === "src" && d.purpose === "Source code")) {
      patterns.push("src-based");
    }
    if (directories.some(d => d.path === "test" || d.path === "tests")) {
      patterns.push("separate-test-directory");
    }

    return { directories, patterns };
  }

  private loadCached(): ProjectProfile | undefined {
    try {
      const cached = this.globalState.get<{ version: number; profile: ProjectProfile }>(PROFILE_CACHE_KEY);
      if (cached && cached.version === PROFILE_VERSION) {
        const age = Date.now() - cached.profile.metadata.lastAnalyzed;
        if (age < 24 * 60 * 60 * 1000) { // 24 hours
          return cached.profile;
        }
      }
    } catch {
      // Invalid cache
    }
    return undefined;
  }

  private async saveCached(profile: ProjectProfile): Promise<void> {
    await this.globalState.update(PROFILE_CACHE_KEY, { version: PROFILE_VERSION, profile });
  }
}

export function getActiveProjectProfileManager(): ProjectProfileManager | undefined {
  return ProjectProfileManager.getActive();
}

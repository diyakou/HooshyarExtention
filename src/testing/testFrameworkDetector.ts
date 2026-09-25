import * as vscode from "vscode";
import * as path from "path";

export type TestFramework = 'jest' | 'mocha' | 'pytest' | 'junit' | 'go-test' | 'unknown';

export interface TestFrameworkInfo {
  framework: TestFramework;
  configFile?: string;
  command: string;
  patterns: string[];
}

export class TestFrameworkDetector {
  async detect(rootPath: string): Promise<TestFrameworkInfo> {
    // Check for Node.js test frameworks
    const nodeFramework = await this.detectNodeFramework(rootPath);
    if (nodeFramework) return nodeFramework;

    // Check for Python test frameworks
    const pythonFramework = await this.detectPythonFramework(rootPath);
    if (pythonFramework) return pythonFramework;

    // Check for Java test frameworks
    const javaFramework = await this.detectJavaFramework(rootPath);
    if (javaFramework) return javaFramework;

    // Check for Go tests
    const goFramework = await this.detectGoFramework(rootPath);
    if (goFramework) return goFramework;

    return {
      framework: 'unknown',
      command: '',
      patterns: []
    };
  }

  private async detectNodeFramework(rootPath: string): Promise<TestFrameworkInfo | null> {
    try {
      // Check package.json
      const packageJsonUri = vscode.Uri.file(path.join(rootPath, 'package.json'));
      const content = await vscode.workspace.fs.readFile(packageJsonUri);
      const pkg = JSON.parse(Buffer.from(content).toString('utf-8'));

      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps['jest']) {
        return {
          framework: 'jest',
          configFile: await this.findFile(rootPath, ['jest.config.js', 'jest.config.ts', 'jest.config.json']),
          command: pkg.scripts?.test || 'npm test',
          patterns: ['**/*.test.{js,ts,jsx,tsx}', '**/*.spec.{js,ts,jsx,tsx}']
        };
      }

      if (deps['mocha']) {
        return {
          framework: 'mocha',
          configFile: await this.findFile(rootPath, ['.mocharc.json', '.mocharc.js']),
          command: pkg.scripts?.test || 'npm test',
          patterns: ['**/*.test.{js,ts}', '**/*.spec.{js,ts}']
        };
      }
    } catch {
      // No package.json
    }

    return null;
  }

  private async detectPythonFramework(rootPath: string): Promise<TestFrameworkInfo | null> {
    try {
      const pytestIni = vscode.Uri.file(path.join(rootPath, 'pytest.ini'));
      await vscode.workspace.fs.stat(pytestIni);
      return {
        framework: 'pytest',
        configFile: 'pytest.ini',
        command: 'pytest',
        patterns: ['**/test_*.py', '**/*_test.py']
      };
    } catch {
      // No pytest.ini
    }

    try {
      const setupPy = vscode.Uri.file(path.join(rootPath, 'setup.py'));
      const content = await vscode.workspace.fs.readFile(setupPy);
      const text = Buffer.from(content).toString('utf-8');
      if (text.includes('pytest')) {
        return {
          framework: 'pytest',
          command: 'pytest',
          patterns: ['**/test_*.py', '**/*_test.py']
        };
      }
    } catch {
      // No setup.py
    }

    return null;
  }

  private async detectJavaFramework(rootPath: string): Promise<TestFrameworkInfo | null> {
    try {
      const pomXml = vscode.Uri.file(path.join(rootPath, 'pom.xml'));
      await vscode.workspace.fs.stat(pomXml);
      return {
        framework: 'junit',
        configFile: 'pom.xml',
        command: 'mvn test',
        patterns: ['**/src/test/**/*Test.java']
      };
    } catch {
      // No pom.xml
    }

    try {
      const buildGradle = vscode.Uri.file(path.join(rootPath, 'build.gradle'));
      await vscode.workspace.fs.stat(buildGradle);
      return {
        framework: 'junit',
        configFile: 'build.gradle',
        command: 'gradle test',
        patterns: ['**/src/test/**/*Test.java']
      };
    } catch {
      // No build.gradle
    }

    return null;
  }

  private async detectGoFramework(rootPath: string): Promise<TestFrameworkInfo | null> {
    try {
      const goMod = vscode.Uri.file(path.join(rootPath, 'go.mod'));
      await vscode.workspace.fs.stat(goMod);
      return {
        framework: 'go-test',
        configFile: 'go.mod',
        command: 'go test ./...',
        patterns: ['**/*_test.go']
      };
    } catch {
      // No go.mod
    }

    return null;
  }

  private async findFile(rootPath: string, candidates: string[]): Promise<string | undefined> {
    for (const candidate of candidates) {
      try {
        const uri = vscode.Uri.file(path.join(rootPath, candidate));
        await vscode.workspace.fs.stat(uri);
        return candidate;
      } catch {
        // File doesn't exist
      }
    }
    return undefined;
  }
}

const fs = require('fs');

const path = 'e:/project/HooshyarExtention/src/intelligence/retrievalEngine.ts';
let code = fs.readFileSync(path, 'utf8');

// Fix resolveSymbol -> findSymbol
code = code.replace(/await this\.intelligence\.resolveSymbol\(/g, 'await this.intelligence.findSymbol(');
code = code.replace(/const resolved = await this\.intelligence\.findSymbol\(name\);\s+if \(resolved\) {\s+primarySymbols\.push\(resolved\);\s+}/g, 'const resolvedList = await this.intelligence.findSymbol(name);\n            if (resolvedList && resolvedList.length > 0) {\n                primarySymbols.push(resolvedList[0]);\n            }');
code = code.replace(/const resolvedDep = await this\.intelligence\.findSymbol\(dep\.name\);\s+if \(resolvedDep\) {\s+const depDeps/g, 'const resolvedDepList = await this.intelligence.findSymbol(dep.name);\n                     if (resolvedDepList && resolvedDepList.length > 0) {\n                         const resolvedDep = resolvedDepList[0];\n                         const depDeps');

// Fix location -> resolveWorkspaceUri(sym.file).uri
code = code.replace(/sym\.location\.uri\.toString\(\)/g, 'resolveWorkspaceUri(sym.file).uri.toString()');
code = code.replace(/sym\.location\.uri\.fsPath/g, 'resolveWorkspaceUri(sym.file).uri.fsPath');

code = code.replace(/dep\.location\.uri\.toString\(\)/g, 'resolveWorkspaceUri(dep.file).uri.toString()');
code = code.replace(/dep\.location\.uri\.fsPath/g, 'resolveWorkspaceUri(dep.file).uri.fsPath');

code = code.replace(/caller\.location\.uri\.toString\(\)/g, 'resolveWorkspaceUri(caller.file).uri.toString()');
code = code.replace(/caller\.location\.uri\.fsPath/g, 'resolveWorkspaceUri(caller.file).uri.fsPath');

code = code.replace(/dDep\.location\.uri\.toString\(\)/g, 'resolveWorkspaceUri(dDep.file).uri.toString()');
code = code.replace(/dDep\.location\.uri\.fsPath/g, 'resolveWorkspaceUri(dDep.file).uri.fsPath');

// Fix getDependencies -> findDependencies (which takes file, line, char) but we can just use sym.dependencies and sym.callers!
code = code.replace(/await this\.intelligence\.getDependencies\(sym\)/g, 'sym.dependencies');
code = code.replace(/await this\.intelligence\.getCallers\(sym\)/g, 'sym.callers');
code = code.replace(/await this\.intelligence\.getDependencies\(resolvedDep\)/g, 'resolvedDep.dependencies');

// Fix findRelatedTests
code = code.replace(/await this\.intelligence\.findRelatedTests\(sym\)/g, 'await this.intelligence.findRelatedTests(sym.file)');

// Fix retrieveSymbolCode
code = code.replace(/await this\.retrieveSymbolCode\(sym\)/g, 'await this.intelligence.getSymbolCode(sym.file, sym.startLine, sym.endLine)');

// Fix the actual retrieveSymbolCode function declaration
code = code.replace(/public async retrieveSymbolCode[\s\S]+?\n    }\n}/, '}');

// Fix rankedItems fallback
const mapReplacement = `rankedItems = deduplicatedUnranked.map((item, idx) => ({
                     id: \`item-\${idx}\`,
                     file: item.metadata?.file || '',
                     content: item.content,
                     signals: [],
                     score: 1 - (idx * 0.01),
                     estimatedTokens: Math.ceil((item.content?.length || 100) / 4),
                     source: item.type
                 })) as RankedContextItem[];`;
                 
code = code.replace(/rankedItems = deduplicatedUnranked\.map[\s\S]+?\}\)\) as RankedContextItem\[\];/g, mapReplacement);

fs.writeFileSync(path, code);

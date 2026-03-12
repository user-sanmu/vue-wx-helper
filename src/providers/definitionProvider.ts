import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseVueSfc, getScriptRange, getTemplateRange } from '../parsers/vueParser';
import { parseWxJson, getWxBasePath } from '../parsers/wxParser';
import { findGlobalComponent, resolveVueComponent } from '../parsers/componentResolver';
import { escapeRegex, fileExistsSync, findProjectRoot, resolveWxComponentPath, toKebabCase } from '../utils/fileUtils';

function getWordAtPosition(text: string, offset: number): { word: string; start: number; end: number } | undefined {
  if (offset < 0 || offset >= text.length) { return undefined; }
  let start = offset;
  let end = offset;
  while (start > 0 && /[a-zA-Z0-9_-]/.test(text[start - 1])) { start--; }
  while (end < text.length && /[a-zA-Z0-9_-]/.test(text[end])) { end++; }
  if (start === end) { return undefined; }
  return { word: text.substring(start, end), start, end };
}

function isInsideTag(text: string, offset: number): boolean {
  const before = text.substring(0, offset);
  const lastOpen = before.lastIndexOf('<');
  if (lastOpen === -1) { return false; }
  const lastClose = before.lastIndexOf('>');
  return lastClose < lastOpen;
}

interface ScriptImportInfo {
  localName: string;
  importedName: string;
  importPath: string;
}

function parseScriptImports(script: string): ScriptImportInfo[] {
  const results: ScriptImportInfo[] = [];

  const defaultRe = /import\s+([a-zA-Z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = defaultRe.exec(script)) !== null) {
    results.push({
      localName: match[1],
      importedName: 'default',
      importPath: match[2],
    });
  }

  const namedRe = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = namedRe.exec(script)) !== null) {
    const names = match[1];
    const importPath = match[2];
    for (const part of names.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) { continue; }
      const asParts = trimmed.split(/\s+as\s+/);
      const importedName = asParts[0].trim();
      const localName = (asParts.length > 1 ? asParts[1] : asParts[0]).trim();
      if (localName) {
        results.push({ localName, importedName, importPath });
      }
    }
  }

  return results;
}

function resolveScriptImportPath(currentFilePath: string, importPath: string): string | undefined {
  let resolvedBase: string | undefined;

  if (importPath.startsWith('@/')) {
    const root = findProjectRoot(currentFilePath);
    if (!root) { return undefined; }
    resolvedBase = path.join(root, 'src', importPath.slice(2));
  } else if (importPath.startsWith('.')) {
    resolvedBase = path.resolve(path.dirname(currentFilePath), importPath);
  } else if (importPath.startsWith('/')) {
    const root = findProjectRoot(currentFilePath);
    if (!root) { return undefined; }
    resolvedBase = path.join(root, importPath.slice(1));
  } else {
    return undefined;
  }

  const candidates = [
    resolvedBase,
    resolvedBase + '.ts',
    resolvedBase + '.js',
    resolvedBase + '.tsx',
    resolvedBase + '.jsx',
    path.join(resolvedBase, 'index.ts'),
    path.join(resolvedBase, 'index.js'),
    path.join(resolvedBase, 'index.tsx'),
    path.join(resolvedBase, 'index.jsx'),
  ];

  for (const candidate of candidates) {
    if (fileExistsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function indexToPosition(text: string, index: number): vscode.Position {
  const before = text.slice(0, index);
  const lines = before.split(/\r?\n/);
  return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
}

function findExportedSymbolLocation(filePath: string, symbolName: string): vscode.Location | undefined {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }

  if (symbolName === 'default') {
    const defaultIdx = content.search(/export\s+default\b/);
    if (defaultIdx >= 0) {
      return new vscode.Location(vscode.Uri.file(filePath), indexToPosition(content, defaultIdx));
    }
    return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(0, 0));
  }

  const escaped = escapeRegex(symbolName);
  const patterns = [
    new RegExp(`export\\s+async\\s+function\\s+${escaped}\\b`),
    new RegExp(`export\\s+function\\s+${escaped}\\b`),
    new RegExp(`export\\s+const\\s+${escaped}\\b`),
    new RegExp(`export\\s+let\\s+${escaped}\\b`),
    new RegExp(`export\\s+var\\s+${escaped}\\b`),
    new RegExp(`export\\s+class\\s+${escaped}\\b`),
    new RegExp(`export\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}`),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (match && match.index >= 0) {
      return new vscode.Location(vscode.Uri.file(filePath), indexToPosition(content, match.index));
    }
  }

  const fallback = new RegExp(`\\b${escaped}\\b`);
  const fallbackMatch = fallback.exec(content);
  if (fallbackMatch && fallbackMatch.index >= 0) {
    return new vscode.Location(vscode.Uri.file(filePath), indexToPosition(content, fallbackMatch.index));
  }

  return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(0, 0));
}

function findVueScriptDefinition(
  filePath: string,
  text: string,
  offset: number,
  scriptRange: { start: number; end: number },
): vscode.Location | undefined {
  const wordInfo = getWordAtPosition(text, offset);
  if (!wordInfo) { return undefined; }

  const scriptText = text.substring(scriptRange.start, scriptRange.end);
  const imports = parseScriptImports(scriptText);
  const importInfo = imports.find(item => item.localName === wordInfo.word);
  if (!importInfo) { return undefined; }

  const resolvedPath = resolveScriptImportPath(filePath, importInfo.importPath);
  if (!resolvedPath) { return undefined; }

  return findExportedSymbolLocation(resolvedPath, importInfo.importedName);
}

// ─── Vue Definition Provider ─────────────────────────────────────────────────

export class VueDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Definition> {
    const filePath = document.uri.fsPath;
    const text = document.getText();
    const offset = document.offsetAt(position);

    const scriptRange = getScriptRange(text);
    if (scriptRange && offset >= scriptRange.start && offset <= scriptRange.end) {
      return findVueScriptDefinition(filePath, text, offset, scriptRange);
    }

    const templateRange = getTemplateRange(text);
    if (!templateRange || offset < templateRange.start || offset > templateRange.end) {
      return undefined;
    }

    const wordInfo = getWordAtPosition(text, offset);
    if (!wordInfo) { return undefined; }

    // Check if the word is right after `<` or `</` (tag name position)
    const beforeWord = text.substring(0, wordInfo.start);
    if (!/[<\/]\s*$/.test(beforeWord) && !isInsideTag(text, wordInfo.start)) {
      return undefined;
    }

    const parsed = parseVueSfc(text);
    const tagName = wordInfo.word;

    // Try to find matching component
    let importPath: string | undefined;
    for (const [name, compPath] of parsed.components) {
      if (name === tagName || toKebabCase(name) === tagName) {
        importPath = compPath;
        break;
      }
    }

    if (importPath) {
      const resolved = resolveVueComponent(filePath, importPath);
      if (resolved.resolvedPath) {
        return new vscode.Location(vscode.Uri.file(resolved.resolvedPath), new vscode.Position(0, 0));
      }
    }

    // Fallback: check global components
    const globalComponent = findGlobalComponent(tagName, false, filePath);
    if (globalComponent?.resolvedPath) {
      return new vscode.Location(vscode.Uri.file(globalComponent.resolvedPath), new vscode.Position(0, 0));
    }

    return undefined;
  }
}

// ─── WXML Definition Provider ────────────────────────────────────────────────

export class WxmlDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Definition> {
    const filePath = document.uri.fsPath;
    const text = document.getText();
    const offset = document.offsetAt(position);

    const wordInfo = getWordAtPosition(text, offset);
    if (!wordInfo) { return undefined; }

    const beforeWord = text.substring(0, wordInfo.start);
    if (!/[<\/]\s*$/.test(beforeWord) && !isInsideTag(text, wordInfo.start)) {
      return undefined;
    }

    const jsonPath = filePath.replace(/\.wxml$/, '.json');
    const usingComponents = parseWxJson(jsonPath);

    const tagName = wordInfo.word;
    const compPath = usingComponents.get(tagName);

    if (compPath) {
      const resolvedPath = resolveWxComponentPath(filePath, compPath);
      if (resolvedPath) {
        return new vscode.Location(vscode.Uri.file(resolvedPath), new vscode.Position(0, 0));
      }

      const dir = path.dirname(filePath);
      const resolved = path.resolve(dir, compPath);
      const wxmlPath = resolved + '.wxml';
      try {
        require('fs').accessSync(wxmlPath);
        return new vscode.Location(vscode.Uri.file(wxmlPath), new vscode.Position(0, 0));
      } catch {
        // continue to global fallback
      }
    }

    // Fallback: check global components
    const globalComponent = findGlobalComponent(tagName, true, filePath);
    if (globalComponent?.resolvedPath) {
      return new vscode.Location(vscode.Uri.file(globalComponent.resolvedPath), new vscode.Position(0, 0));
    }

    return undefined;
  }
}

import * as vscode from 'vscode';
import * as path from 'path';
import { parseVueSfc, getTemplateRange } from '../parsers/vueParser';
import { parseWxJson, getWxBasePath } from '../parsers/wxParser';
import { resolveVueComponent, scanGlobalComponents } from '../parsers/componentResolver';
import { resolveWxComponentPath, toKebabCase } from '../utils/fileUtils';

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

// ─── Vue Definition Provider ─────────────────────────────────────────────────

export class VueDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Definition> {
    const filePath = document.uri.fsPath;
    const text = document.getText();
    const offset = document.offsetAt(position);

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
    const globals = scanGlobalComponents(false, filePath);
    for (const g of globals) {
      if (g.name === tagName || toKebabCase(g.name) === tagName) {
        if (g.resolvedPath) {
          return new vscode.Location(vscode.Uri.file(g.resolvedPath), new vscode.Position(0, 0));
        }
      }
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
    const globals = scanGlobalComponents(true, filePath);
    for (const g of globals) {
      if (g.name === tagName) {
        if (g.resolvedPath) {
          return new vscode.Location(vscode.Uri.file(g.resolvedPath), new vscode.Position(0, 0));
        }
      }
    }

    return undefined;
  }
}

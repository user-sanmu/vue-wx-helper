import * as vscode from 'vscode';
import { parseVueSfc, getTemplateRange, getScriptRange } from '../parsers/vueParser';
import { parseWxComponent, getWxBasePath, parseWxComponentProps } from '../parsers/wxParser';
import { resolveVueComponent, resolveVueComponentByPath, resolveWxComponent, scanGlobalComponents } from '../parsers/componentResolver';
import { fileExistsSync, toKebabCase } from '../utils/fileUtils';
import type { PropInfo } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findEnclosingComponentTag(text: string, offset: number, knownComponents: string[]): string | undefined {
  const before = text.substring(0, offset);
  let inQuote: string | null = null;

  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];

    // Track whether we're inside a quoted attribute value (walking backward)
    if ((ch === '"' || ch === "'") && !inQuote) {
      inQuote = ch;
      continue;
    }
    if (inQuote && ch === inQuote) {
      inQuote = null;
      continue;
    }
    if (inQuote) { continue; }

    if (ch === '>') {
      if (i > 0 && before[i - 1] === '/') {
        const openIdx = before.lastIndexOf('<', i - 2);
        if (openIdx >= 0) { i = openIdx; }
        continue;
      }
      return undefined;
    }
    if (ch === '<') {
      const afterOpen = before.substring(i + 1);
      const tagMatch = /^\/?\s*([a-zA-Z][\w-]*)/.exec(afterOpen);
      if (tagMatch) {
        if (afterOpen.trimStart().startsWith('/')) { return undefined; }
        const tagName = tagMatch[1];
        for (const comp of knownComponents) {
          if (comp === tagName || toKebabCase(comp) === tagName) {
            return comp;
          }
        }
      }
      return undefined;
    }
  }
  return undefined;
}

function isInsideMustache(text: string, offset: number): boolean {
  const before = text.substring(0, offset);
  const lastOpen = before.lastIndexOf('{{');
  if (lastOpen === -1) { return false; }
  const lastClose = before.lastIndexOf('}}', offset);
  return lastClose < lastOpen;
}

function isAfterDirectiveEquals(text: string, offset: number): boolean {
  const before = text.substring(0, offset);
  // Check patterns like: v-if=" , :prop=" , @event="
  const directiveRe = /(?:v-[\w-]+|[:@][\w-]+)\s*=\s*"[^"]*$/;
  return directiveRe.test(before);
}

function createComponentCompletionItem(name: string, isGlobal: boolean): vscode.CompletionItem {
  const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
  item.detail = isGlobal ? '(global component)' : '(local component)';
  item.insertText = new vscode.SnippetString(`${name} $1/>`);
  item.sortText = isGlobal ? '1' + name : '0' + name;
  return item;
}

function createPropCompletionItem(prop: PropInfo, isVue: boolean): vscode.CompletionItem {
  const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Property);
  item.detail = prop.type ? `(${prop.type})` : '(property)';
  if (isVue) {
    item.insertText = new vscode.SnippetString(`:${prop.name}="$1"`);
  } else {
    item.insertText = new vscode.SnippetString(`${prop.name}="{{$1}}"`);
  }
  return item;
}

function createDataCompletionItem(name: string, kind: string): vscode.CompletionItem {
  const itemKind = kind === 'method'
    ? vscode.CompletionItemKind.Method
    : kind === 'computed'
      ? vscode.CompletionItemKind.Property
      : vscode.CompletionItemKind.Field;
  const item = new vscode.CompletionItem(name, itemKind);
  item.detail = `(${kind})`;
  return item;
}

// ─── Vue Completion Provider ─────────────────────────────────────────────────

export class VueCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext,
  ): vscode.CompletionItem[] {
    const filePath = document.uri.fsPath;
    const text = document.getText();
    const offset = document.offsetAt(position);
    const templateRange = getTemplateRange(text);

    if (templateRange && offset >= templateRange.start && offset <= templateRange.end) {
      const parsed = parseVueSfc(text);
      return this.templateCompletions(filePath, text, offset, parsed, templateRange);
    }

    const scriptRange = getScriptRange(text);
    if (scriptRange && offset >= scriptRange.start && offset <= scriptRange.end) {
      const before = text.substring(0, offset);
      if (!/this\.\s*$/.test(before)) {
        return [];
      }
      const parsed = parseVueSfc(text);
      return this.scriptCompletions(text, offset, parsed);
    }

    return [];
  }

  private templateCompletions(
    filePath: string,
    text: string,
    offset: number,
    parsed: ReturnType<typeof parseVueSfc>,
    templateRange: { start: number; end: number },
  ): vscode.CompletionItem[] {
    const templateText = text.substring(templateRange.start, templateRange.end);
    const relOffset = offset - templateRange.start;
    const items: vscode.CompletionItem[] = [];

    // Component name after `<`
    const before = templateText.substring(0, relOffset);
    const tagTrigger = /<([a-zA-Z][\w-]*)?$/.exec(before);
    if (tagTrigger) {
      for (const [name] of parsed.components) {
        items.push(createComponentCompletionItem(name, false));
      }
      const globals = scanGlobalComponents(false, filePath);
      for (const g of globals) {
        if (!parsed.components.has(g.name)) {
          items.push(createComponentCompletionItem(g.name, true));
        }
      }
      return items;
    }

    // Component prop completion (inside a component tag, after space)
    const globals = scanGlobalComponents(false, filePath);
    const globalNames = globals.map(g => g.name).filter(n => !parsed.components.has(n));
    const allComponentNames = [...Array.from(parsed.components.keys()), ...globalNames];
    const enclosing = findEnclosingComponentTag(text, offset, allComponentNames);
    if (enclosing) {
      const importPath = parsed.components.get(enclosing);
      if (importPath) {
        const resolved = resolveVueComponent(filePath, importPath);
        for (const prop of resolved.props) {
          items.push(createPropCompletionItem(prop, true));
        }
      } else {
        const globalComp = globals.find(g => g.name === enclosing || toKebabCase(g.name) === enclosing);
        if (globalComp?.resolvedPath) {
          const resolved = resolveVueComponentByPath(globalComp.resolvedPath);
          for (const prop of resolved.props) {
            items.push(createPropCompletionItem(prop, true));
          }
        }
      }
      return items;
    }

    // Data/props/computed in {{ }} or directive values
    if (isInsideMustache(text, offset) || isAfterDirectiveEquals(text, offset)) {
      for (const prop of parsed.props) {
        items.push(createDataCompletionItem(prop.name, 'prop'));
      }
      for (const key of parsed.dataKeys) {
        items.push(createDataCompletionItem(key, 'data'));
      }
      for (const key of parsed.computedKeys) {
        items.push(createDataCompletionItem(key, 'computed'));
      }
      for (const key of parsed.methodKeys) {
        items.push(createDataCompletionItem(key, 'method'));
      }
      return items;
    }

    return items;
  }

  private scriptCompletions(
    text: string,
    offset: number,
    parsed: ReturnType<typeof parseVueSfc>,
  ): vscode.CompletionItem[] {
    const before = text.substring(0, offset);
    if (!/this\.\s*$/.test(before)) {
      return [];
    }

    const items: vscode.CompletionItem[] = [];
    for (const prop of parsed.props) {
      items.push(createDataCompletionItem(prop.name, 'prop'));
    }
    for (const key of parsed.dataKeys) {
      items.push(createDataCompletionItem(key, 'data'));
    }
    for (const key of parsed.computedKeys) {
      items.push(createDataCompletionItem(key, 'computed'));
    }
    for (const key of parsed.methodKeys) {
      items.push(createDataCompletionItem(key, 'method'));
    }
    return items;
  }
}

// ─── WXML Completion Provider ────────────────────────────────────────────────

export class WxmlCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const filePath = document.uri.fsPath;
    const text = document.getText();
    const offset = document.offsetAt(position);
    const items: vscode.CompletionItem[] = [];

    const before = text.substring(0, offset);

    const tagTrigger = /<([a-zA-Z][\w-]*)?$/.exec(before);
    const basePath = getWxBasePath(filePath);
    const wxComp = parseWxComponent(basePath);

    if (tagTrigger) {
      for (const [name] of wxComp.usingComponents) {
        items.push(createComponentCompletionItem(name, false));
      }
      const globals = scanGlobalComponents(true, filePath);
      for (const g of globals) {
        if (!wxComp.usingComponents.has(g.name)) {
          items.push(createComponentCompletionItem(g.name, true));
        }
      }
      return items;
    }

    // Component attribute completion
    const globals = scanGlobalComponents(true, filePath);
    const globalNames = globals.map(g => g.name).filter(n => !wxComp.usingComponents.has(n));
    const allComponentNames = [...Array.from(wxComp.usingComponents.keys()), ...globalNames];
    const enclosing = findEnclosingComponentTag(text, offset, allComponentNames);
    if (enclosing) {
      const compPath = wxComp.usingComponents.get(enclosing);
      if (compPath) {
        const resolved = resolveWxComponent(filePath, compPath);
        for (const prop of resolved.props) {
          items.push(createPropCompletionItem(prop, false));
        }
      } else {
        const globalComp = globals.find(g => g.name === enclosing);
        if (globalComp?.resolvedPath) {
          const compBasePath = globalComp.resolvedPath.replace(/\.(js|json)$/, '');
          const props = parseWxComponentProps(compBasePath);
          for (const prop of props) {
            items.push(createPropCompletionItem(prop, false));
          }
        }
      }
      return items;
    }

    // Data/properties in {{ }}
    if (isInsideMustache(text, offset)) {
      for (const prop of wxComp.properties) {
        items.push(createDataCompletionItem(prop.name, 'property'));
      }
      for (const key of wxComp.dataKeys) {
        items.push(createDataCompletionItem(key, 'data'));
      }
      return items;
    }

    return items;
  }
}

// ─── WX JS Completion Provider (this.data.) ──────────────────────────────────

export class WxJsCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const filePath = document.uri.fsPath;
    const text = document.getText();
    const offset = document.offsetAt(position);
    const before = text.substring(0, offset);

    if (!/this\.(?:data\.)?\s*$/.test(before)) {
      return [];
    }

    const basePath = filePath.replace(/\.(js|ts)$/, '');
    const wxmlPath = basePath + '.wxml';
    const jsonPath = basePath + '.json';
    if (!fileExistsSync(jsonPath) && !fileExistsSync(wxmlPath)) {
      return [];
    }

    const wxComp = parseWxComponent(basePath);
    const items: vscode.CompletionItem[] = [];

    // this.data. completions
    if (/this\.data\.\s*$/.test(before)) {
      for (const prop of wxComp.properties) {
        items.push(createDataCompletionItem(prop.name, 'property'));
      }
      for (const key of wxComp.dataKeys) {
        items.push(createDataCompletionItem(key, 'data'));
      }
      return items;
    }

    // this. completions (for methods and setData etc.)
    if (/this\.\s*$/.test(before) && !/this\.data\.\s*$/.test(before)) {
      items.push(createDataCompletionItem('data', 'data'));
      items.push(createDataCompletionItem('setData', 'method'));
      for (const key of wxComp.methodKeys) {
        items.push(createDataCompletionItem(key, 'method'));
      }
      for (const prop of wxComp.properties) {
        items.push(createDataCompletionItem(prop.name, 'property'));
      }
      return items;
    }

    return items;
  }
}

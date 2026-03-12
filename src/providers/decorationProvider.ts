import * as vscode from 'vscode';
import { parseVueSfc, getTemplateRange } from '../parsers/vueParser';
import { parseWxJson } from '../parsers/wxParser';
import { scanGlobalComponents } from '../parsers/componentResolver';
import { toKebabCase } from '../utils/fileUtils';

const COMPONENT_TAG_COLOR = '#4EC9B0';

const componentDecorationType = vscode.window.createTextEditorDecorationType({
  color: COMPONENT_TAG_COLOR,
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

let updateTimeout: ReturnType<typeof setTimeout> | undefined;

export function activateDecorations(context: vscode.ExtensionContext): void {
  if (vscode.window.activeTextEditor) {
    triggerUpdate(vscode.window.activeTextEditor);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) { triggerUpdate(editor); }
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document) {
        triggerUpdate(editor);
      }
    }),
    componentDecorationType,
  );
}

function triggerUpdate(editor: vscode.TextEditor): void {
  if (editor.document.uri.scheme !== 'file') { return; }
  if (updateTimeout) { clearTimeout(updateTimeout); }
  updateTimeout = setTimeout(() => updateDecorations(editor), 200);
}

function updateDecorations(editor: vscode.TextEditor): void {
  const filePath = editor.document.uri.fsPath;
  const text = editor.document.getText();
  const decorations: vscode.DecorationOptions[] = [];

  if (filePath.endsWith('.vue')) {
    const parsed = parseVueSfc(text);
    const localNames = Array.from(parsed.components.keys());
    const globals = scanGlobalComponents(false, filePath);
    const globalNames = globals
      .map(g => g.name)
      .filter(n => !parsed.components.has(n));
    const names = [...localNames, ...globalNames];

    if (names.length === 0) {
      editor.setDecorations(componentDecorationType, []);
      return;
    }

    const templateRange = getTemplateRange(text);
    if (!templateRange) {
      editor.setDecorations(componentDecorationType, []);
      return;
    }

    const searchText = text.substring(templateRange.start, templateRange.end);
    findComponentTagDecorations(editor, searchText, templateRange.start, names, decorations);
  } else if (filePath.endsWith('.wxml')) {
    const jsonPath = filePath.replace(/\.wxml$/, '.json');
    const usingComponents = parseWxJson(jsonPath);
    const localNames = Array.from(usingComponents.keys());
    const globals = scanGlobalComponents(true, filePath);
    const globalNames = globals
      .map(g => g.name)
      .filter(n => !usingComponents.has(n));
    const names = [...localNames, ...globalNames];
    if (names.length === 0) {
      editor.setDecorations(componentDecorationType, []);
      return;
    }

    findComponentTagDecorations(editor, text, 0, names, decorations);
  } else {
    editor.setDecorations(componentDecorationType, []);
    return;
  }

  editor.setDecorations(componentDecorationType, decorations);
}

function findComponentTagDecorations(
  editor: vscode.TextEditor,
  searchText: string,
  baseOffset: number,
  componentNames: string[],
  decorations: vscode.DecorationOptions[],
): void {
  const knownNames = new Set<string>();
  for (const name of componentNames) {
    knownNames.add(name);
    knownNames.add(toKebabCase(name));
  }

  const tagRe = /<\/?\s*([a-zA-Z][\w-]*)(?=[\s/>])/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(searchText)) !== null) {
    const tagNameInMatch = match[1];
    if (!knownNames.has(tagNameInMatch)) {
      continue;
    }

    const fullMatch = match[0];
    const tagNameOffset = fullMatch.indexOf(tagNameInMatch);
    const absoluteStart = baseOffset + match.index + tagNameOffset;
    const absoluteEnd = absoluteStart + tagNameInMatch.length;

    const startPos = editor.document.positionAt(absoluteStart);
    const endPos = editor.document.positionAt(absoluteEnd);
    decorations.push({ range: new vscode.Range(startPos, endPos) });
  }
}

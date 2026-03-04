import * as vscode from 'vscode';
import { VueCompletionProvider, WxmlCompletionProvider, WxJsCompletionProvider } from './providers/completionProvider';
import { VueDefinitionProvider, WxmlDefinitionProvider } from './providers/definitionProvider';
import { activateDecorations } from './providers/decorationProvider';

const VUE_SELECTOR: vscode.DocumentSelector = [
  { language: 'vue', scheme: 'file' },
  { scheme: 'file', pattern: '**/*.vue' },
];

const WXML_SELECTOR: vscode.DocumentSelector = [
  { language: 'wxml', scheme: 'file' },
  { scheme: 'file', pattern: '**/*.wxml' },
];

const JS_SELECTOR: vscode.DocumentSelector = [
  { language: 'javascript', scheme: 'file' },
];

export function activate(context: vscode.ExtensionContext) {
  // Vue completions: triggered by `<`, ` `, `.`
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      VUE_SELECTOR,
      new VueCompletionProvider(),
      '<', ' ', '.',
    ),
  );

  // WXML completions: triggered by `<`, ` `
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      WXML_SELECTOR,
      new WxmlCompletionProvider(),
      '<', ' ',
    ),
  );

  // WX JS completions: triggered by `.`
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      JS_SELECTOR,
      new WxJsCompletionProvider(),
      '.',
    ),
  );

  // Vue definition (Ctrl+Click)
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      VUE_SELECTOR,
      new VueDefinitionProvider(),
    ),
  );

  // WXML definition (Ctrl+Click)
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      WXML_SELECTOR,
      new WxmlDefinitionProvider(),
    ),
  );

  // Component tag green decoration
  activateDecorations(context);
}

export function deactivate() {}

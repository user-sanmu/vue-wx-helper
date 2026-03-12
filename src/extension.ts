import * as vscode from 'vscode';
import { VueCompletionProvider, WxmlCompletionProvider, WxJsCompletionProvider } from './providers/completionProvider';
import { VueDefinitionProvider, WxmlDefinitionProvider } from './providers/definitionProvider';
import { activateDecorations } from './providers/decorationProvider';
import { clearComponentResolverCache } from './parsers/componentResolver';
import { clearVueParserCache } from './parsers/vueParser';
import { clearWxParserCache } from './parsers/wxParser';
import { clearProjectRootCache } from './utils/fileUtils';

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

function clearProjectCaches(): void {
  clearProjectRootCache();
  clearComponentResolverCache();
}

function clearParseCaches(): void {
  clearVueParserCache();
  clearWxParserCache();
  clearComponentResolverCache();
}

function registerCacheWatcher(
  context: vscode.ExtensionContext,
  pattern: string,
  onInvalidate: () => void,
): void {
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  watcher.onDidCreate(onInvalidate);
  watcher.onDidChange(onInvalidate);
  watcher.onDidDelete(onInvalidate);
  context.subscriptions.push(watcher);
}

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

  registerCacheWatcher(context, '**/package.json', clearProjectCaches);
  registerCacheWatcher(context, '**/app.json', clearProjectCaches);

  for (const pattern of [
    '**/components/**/*.vue',
    '**/component/**/*.vue',
    '**/src/components/**/*.vue',
    '**/src/component/**/*.vue',
    '**/components/**/*.js',
    '**/components/**/*.ts',
    '**/components/**/*.json',
    '**/component/**/*.js',
    '**/component/**/*.ts',
    '**/component/**/*.json',
  ]) {
    registerCacheWatcher(context, pattern, clearParseCaches);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      clearProjectCaches();
      clearVueParserCache();
      clearWxParserCache();
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('vueWxHelper.componentFolders')) {
        clearProjectCaches();
      }
    }),
  );
}

export function deactivate() {}

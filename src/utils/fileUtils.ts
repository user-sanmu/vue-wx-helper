import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export function readFileSync(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

export function fileExistsSync(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function resolveVueComponentPath(basePath: string, importPath: string): string | undefined {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return undefined;
  }

  const dir = path.dirname(basePath);
  const resolved = path.resolve(dir, importPath);

  const candidates = [
    resolved,
    resolved + '.vue',
    path.join(resolved, 'index.vue'),
    resolved + '.js',
    path.join(resolved, 'index.js'),
    resolved + '.ts',
    path.join(resolved, 'index.ts'),
  ];

  for (const c of candidates) {
    if (fileExistsSync(c)) {
      return c;
    }
  }
  return undefined;
}

export function resolveWxComponentPath(basePath: string, componentPath: string): string | undefined {
  const dir = path.dirname(basePath);
  const resolved = path.resolve(dir, componentPath);

  const candidates = [
    resolved + '.js',
    resolved + '.ts',
    resolved,
  ];

  for (const c of candidates) {
    if (fileExistsSync(c)) {
      return c;
    }
  }

  const basename = path.basename(resolved);
  const inFolder = path.join(resolved, basename + '.js');
  if (fileExistsSync(inFolder)) {
    return inFolder;
  }

  return undefined;
}

export function resolveWxComponentWxml(basePath: string, componentPath: string): string | undefined {
  const dir = path.dirname(basePath);
  const resolved = path.resolve(dir, componentPath);
  const wxml = resolved + '.wxml';
  if (fileExistsSync(wxml)) {
    return wxml;
  }
  return undefined;
}

export function toKebabCase(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function toPascalCase(str: string): string {
  return str
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return undefined;
}

/**
 * From a given file path, walk up the directory tree to find the nearest
 * project root (a directory containing package.json or app.json).
 * Falls back to workspace root if nothing is found.
 */
export function findProjectRoot(filePath: string): string | undefined {
  let dir = path.dirname(filePath);
  const root = getWorkspaceRoot();
  const fsRoot = path.parse(dir).root;

  while (dir && dir !== fsRoot) {
    if (
      fileExistsSync(path.join(dir, 'package.json')) ||
      fileExistsSync(path.join(dir, 'app.json'))
    ) {
      return dir;
    }
    // Don't go above the workspace root
    if (root && dir === root) {
      return root;
    }
    const parent = path.dirname(dir);
    if (parent === dir) { break; }
    dir = parent;
  }

  return root;
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ComponentInfo, PropInfo } from '../types';
import { fileExistsSync, findProjectRoot, toPascalCase } from '../utils/fileUtils';
import { parseVueComponentProps } from './vueParser';
import { parseWxComponentProps } from './wxParser';

function isWxProject(root: string): boolean {
  return fileExistsSync(path.join(root, 'app.json'));
}

function getComponentFolders(root: string): string[] {
  const config = vscode.workspace.getConfiguration('vueWxHelper');
  const userFolders: string[] | undefined = config.get('componentFolders');
  if (userFolders && userFolders.length > 0) {
    return userFolders;
  }
  if (isWxProject(root)) {
    return ['components', 'component'];
  }
  return ['src/components', 'src/component'];
}

/**
 * Scan global component folders and return discovered components.
 * Auto-detects project type (Vue vs WX) based on app.json existence.
 * For multi-project workspaces, uses the project root nearest to `currentFilePath`.
 */
export function scanGlobalComponents(isWx: boolean, currentFilePath?: string): ComponentInfo[] {
  const root = currentFilePath ? findProjectRoot(currentFilePath) : findProjectRoot('');
  if (!root) {
    return [];
  }

  const folders = getComponentFolders(root);

  const results: ComponentInfo[] = [];

  for (const folder of folders) {
    const folderPath = path.join(root, folder);
    if (!fileExistsSync(folderPath)) {
      continue;
    }

    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (isWx) {
          if (entry.isDirectory()) {
            const compName = entry.name;
            const compDir = path.join(folderPath, compName);
            const jsPath = path.join(compDir, compName + '.js');
            const jsonPath = path.join(compDir, compName + '.json');
            if (fileExistsSync(jsPath) || fileExistsSync(jsonPath)) {
              results.push({
                name: compName,
                importPath: `./${folder}/${compName}/${compName}`,
                resolvedPath: fileExistsSync(jsPath) ? jsPath : jsonPath,
                isGlobal: true,
              });
            }
          }
        } else {
          if (entry.isFile() && entry.name.endsWith('.vue')) {
            const compName = entry.name.replace(/\.vue$/, '');
            const resolvedPath = path.join(folderPath, entry.name);
            results.push({
              name: toPascalCase(compName),
              importPath: `./${folder}/${entry.name}`,
              resolvedPath,
              isGlobal: true,
            });
          } else if (entry.isDirectory()) {
            const compDir = path.join(folderPath, entry.name);
            const indexVue = path.join(compDir, 'index.vue');
            const namedVue = path.join(compDir, entry.name + '.vue');
            const resolved = fileExistsSync(indexVue) ? indexVue
              : fileExistsSync(namedVue) ? namedVue : undefined;
            if (resolved) {
              results.push({
                name: toPascalCase(entry.name),
                importPath: `./${folder}/${entry.name}`,
                resolvedPath: resolved,
                isGlobal: true,
              });
            }
          }
        }
      }
    } catch {
    }
  }

  return results;
}

/**
 * Resolve a Vue component's props from an absolute file path.
 */
export function resolveVueComponentByPath(resolvedPath: string): { resolvedPath: string; props: PropInfo[] } {
  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const props = parseVueComponentProps(content);
    return { resolvedPath, props };
  } catch {
    return { resolvedPath, props: [] };
  }
}

/**
 * Resolve a Vue component from a relative import path (for locally imported components).
 */
export function resolveVueComponent(currentFilePath: string, importPath: string): { resolvedPath?: string; props: PropInfo[] } {
  const dir = path.dirname(currentFilePath);

  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return { props: [] };
  }

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
      return resolveVueComponentByPath(c);
    }
  }

  return { props: [] };
}

/**
 * Resolve a WX component to its JS path and parse its properties.
 */
export function resolveWxComponent(currentFilePath: string, componentPath: string): { resolvedPath?: string; props: PropInfo[] } {
  const dir = path.dirname(currentFilePath);
  const basePath = path.resolve(dir, componentPath);
  const props = parseWxComponentProps(basePath);

  const candidates = [
    basePath + '.js',
    basePath + '.ts',
    basePath,
  ];
  for (const c of candidates) {
    if (fileExistsSync(c)) {
      return { resolvedPath: c, props };
    }
  }

  const basename = path.basename(basePath);
  const inFolder = path.join(basePath, basename + '.js');
  if (fileExistsSync(inFolder)) {
    return { resolvedPath: inFolder, props };
  }

  return { props };
}

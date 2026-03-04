import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ComponentInfo, PropInfo } from '../types';
import { fileExistsSync, findProjectRoot, resolveVueComponentPath, resolveWxComponentPath, toPascalCase } from '../utils/fileUtils';
import { parseVueComponentProps } from './vueParser';
import { parseWxComponentProps } from './wxParser';

/**
 * Scan configured global component folders and return discovered components.
 * Uses the project root nearest to `currentFilePath` so that multi-project
 * workspaces each get their own global components.
 */
export function scanGlobalComponents(isWx: boolean, currentFilePath?: string): ComponentInfo[] {
  const root = currentFilePath ? findProjectRoot(currentFilePath) : findProjectRoot('');
  if (!root) { return []; }

  const config = vscode.workspace.getConfiguration('vueWxHelper');
  const folders: string[] = config.get('componentFolders', ['components', 'component']);

  const results: ComponentInfo[] = [];

  for (const folder of folders) {
    const folderPath = path.join(root, folder);
    if (!fileExistsSync(folderPath)) { continue; }

    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (isWx) {
          if (entry.isDirectory()) {
            const compName = entry.name;
            const jsPath = path.join(folderPath, compName, compName + '.js');
            const jsonPath = path.join(folderPath, compName, compName + '.json');
            if (fileExistsSync(jsPath) || fileExistsSync(jsonPath)) {
              results.push({
                name: compName,
                importPath: `./${folder}/${compName}/${compName}`,
                resolvedPath: fileExistsSync(jsPath) ? jsPath : undefined,
                isGlobal: true,
              });
            }
          }
        } else {
          // Vue project
          if (entry.isFile() && entry.name.endsWith('.vue')) {
            const compName = entry.name.replace(/\.vue$/, '');
            results.push({
              name: toPascalCase(compName),
              importPath: `./${folder}/${entry.name}`,
              resolvedPath: path.join(folderPath, entry.name),
              isGlobal: true,
            });
          } else if (entry.isDirectory()) {
            const indexVue = path.join(folderPath, entry.name, 'index.vue');
            const namedVue = path.join(folderPath, entry.name, entry.name + '.vue');
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
      // folder not readable
    }
  }

  return results;
}

/**
 * Resolve a Vue component to its file path and parse its props.
 */
export function resolveVueComponent(currentFilePath: string, importPath: string): { resolvedPath?: string; props: PropInfo[] } {
  const resolvedPath = resolveVueComponentPath(currentFilePath, importPath);
  if (!resolvedPath) {
    return { props: [] };
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const props = parseVueComponentProps(content);
    return { resolvedPath, props };
  } catch {
    return { resolvedPath, props: [] };
  }
}

/**
 * Resolve a WX component to its JS path and parse its properties.
 */
export function resolveWxComponent(currentFilePath: string, componentPath: string): { resolvedPath?: string; props: PropInfo[] } {
  const resolvedPath = resolveWxComponentPath(currentFilePath, componentPath);

  const dir = path.dirname(currentFilePath);
  const basePath = path.resolve(dir, componentPath);
  const props = parseWxComponentProps(basePath);

  return { resolvedPath, props };
}

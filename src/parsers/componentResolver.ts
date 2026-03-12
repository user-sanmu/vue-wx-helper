import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ComponentInfo, PropInfo } from '../types';
import { fileExistsSync, findProjectRoot, resolveVueComponentPath, toKebabCase, toPascalCase } from '../utils/fileUtils';
import { parseVueComponentProps } from './vueParser';
import { parseWxComponentProps } from './wxParser';

interface GlobalComponentIndex {
  byName: Map<string, ComponentInfo>;
  components: ComponentInfo[];
}

const globalComponentCache = new Map<string, GlobalComponentIndex>();
const vueComponentResolveCache = new Map<string, { mtimeMs: number; result: { resolvedPath: string; props: PropInfo[] } }>();

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

function getFileMtimeMs(filePath: string): number | undefined {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return undefined;
  }
}

function getGlobalCacheKey(root: string, isWx: boolean, folders: string[]): string {
  return `${root}::${isWx ? 'wx' : 'vue'}::${folders.join('|')}`;
}

function buildGlobalComponentIndex(root: string, isWx: boolean, folders: string[]): GlobalComponentIndex {
  const components: ComponentInfo[] = [];
  const byName = new Map<string, ComponentInfo>();

  for (const folder of folders) {
    const folderPath = path.join(root, folder);
    if (!fileExistsSync(folderPath)) {
      continue;
    }

    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (isWx) {
          if (!entry.isDirectory()) {
            continue;
          }
          const compName = entry.name;
          const compDir = path.join(folderPath, compName);
          const jsPath = path.join(compDir, compName + '.js');
          const jsonPath = path.join(compDir, compName + '.json');
          if (fileExistsSync(jsPath) || fileExistsSync(jsonPath)) {
            const component: ComponentInfo = {
              name: compName,
              importPath: `./${folder}/${compName}/${compName}`,
              resolvedPath: fileExistsSync(jsPath) ? jsPath : jsonPath,
              isGlobal: true,
            };
            components.push(component);
            byName.set(component.name, component);
          }
          continue;
        }

        if (entry.isFile() && entry.name.endsWith('.vue')) {
          const compName = entry.name.replace(/\.vue$/, '');
          const component: ComponentInfo = {
            name: toPascalCase(compName),
            importPath: `./${folder}/${entry.name}`,
            resolvedPath: path.join(folderPath, entry.name),
            isGlobal: true,
          };
          components.push(component);
          byName.set(component.name, component);
          byName.set(toKebabCase(component.name), component);
        } else if (entry.isDirectory()) {
          const compDir = path.join(folderPath, entry.name);
          const indexVue = path.join(compDir, 'index.vue');
          const namedVue = path.join(compDir, entry.name + '.vue');
          const resolved = fileExistsSync(indexVue) ? indexVue
            : fileExistsSync(namedVue) ? namedVue : undefined;
          if (resolved) {
            const component: ComponentInfo = {
              name: toPascalCase(entry.name),
              importPath: `./${folder}/${entry.name}`,
              resolvedPath: resolved,
              isGlobal: true,
            };
            components.push(component);
            byName.set(component.name, component);
            byName.set(toKebabCase(component.name), component);
          }
        }
      }
    } catch {
      // ignore unreadable folders
    }
  }

  return { byName, components };
}

function getGlobalComponentIndex(isWx: boolean, currentFilePath?: string): GlobalComponentIndex {
  const root = currentFilePath ? findProjectRoot(currentFilePath) : findProjectRoot('');
  if (!root) {
    return { byName: new Map(), components: [] };
  }

  const folders = getComponentFolders(root);
  const cacheKey = getGlobalCacheKey(root, isWx, folders);
  const cached = globalComponentCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const built = buildGlobalComponentIndex(root, isWx, folders);
  globalComponentCache.set(cacheKey, built);
  return built;
}

export function clearComponentResolverCache(): void {
  globalComponentCache.clear();
  vueComponentResolveCache.clear();
}

export function findGlobalComponent(name: string, isWx: boolean, currentFilePath?: string): ComponentInfo | undefined {
  return getGlobalComponentIndex(isWx, currentFilePath).byName.get(name);
}

/**
 * Scan global component folders and return discovered components.
 * Auto-detects project type (Vue vs WX) based on app.json existence.
 * For multi-project workspaces, uses the project root nearest to `currentFilePath`.
 */
export function scanGlobalComponents(isWx: boolean, currentFilePath?: string): ComponentInfo[] {
  return getGlobalComponentIndex(isWx, currentFilePath).components;
}

/**
 * Resolve a Vue component's props from an absolute file path.
 */
export function resolveVueComponentByPath(resolvedPath: string): { resolvedPath: string; props: PropInfo[] } {
  const mtimeMs = getFileMtimeMs(resolvedPath);
  const cached = vueComponentResolveCache.get(resolvedPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.result;
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const props = parseVueComponentProps(content);
    const result = { resolvedPath, props };
    vueComponentResolveCache.set(resolvedPath, { mtimeMs: mtimeMs ?? -1, result });
    return result;
  } catch {
    return { resolvedPath, props: [] };
  }
}

/**
 * Resolve a Vue component from a relative import path (for locally imported components).
 */
export function resolveVueComponent(currentFilePath: string, importPath: string): { resolvedPath?: string; props: PropInfo[] } {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return { props: [] };
  }
  const resolvedPath = resolveVueComponentPath(currentFilePath, importPath);
  if (resolvedPath) {
    return resolveVueComponentByPath(resolvedPath);
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

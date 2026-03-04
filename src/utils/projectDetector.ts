import * as fs from 'fs';
import * as path from 'path';
import { ProjectType } from '../types';
import { fileExistsSync, getWorkspaceRoot } from './fileUtils';

export function detectProjectTypes(): ProjectType[] {
  const root = getWorkspaceRoot();
  if (!root) {
    return [ProjectType.Unknown];
  }

  const types: ProjectType[] = [];

  if (
    fileExistsSync(path.join(root, 'app.json')) &&
    (fileExistsSync(path.join(root, 'app.js')) || fileExistsSync(path.join(root, 'app.ts')))
  ) {
    types.push(ProjectType.WxMiniProgram);
  }

  const pkgPath = path.join(root, 'package.json');
  if (fileExistsSync(pkgPath)) {
    try {
      const content = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['vue']) {
        types.push(ProjectType.Vue);
      }
    } catch {
      // ignore
    }
  }

  const vueConfigs = ['vue.config.js', 'vue.config.ts', 'vite.config.js', 'vite.config.ts'];
  for (const cfg of vueConfigs) {
    if (fileExistsSync(path.join(root, cfg))) {
      if (!types.includes(ProjectType.Vue)) {
        types.push(ProjectType.Vue);
      }
      break;
    }
  }

  return types.length > 0 ? types : [ProjectType.Unknown];
}

export function isVueFile(filePath: string): boolean {
  return filePath.endsWith('.vue');
}

export function isWxmlFile(filePath: string): boolean {
  return filePath.endsWith('.wxml');
}

export function isWxJsFile(filePath: string): boolean {
  if (!filePath.endsWith('.js') && !filePath.endsWith('.ts')) {
    return false;
  }
  const base = filePath.replace(/\.(js|ts)$/, '');
  return fileExistsSync(base + '.wxml') || fileExistsSync(base + '.json');
}

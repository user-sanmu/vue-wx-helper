import * as fs from 'fs';
import * as path from 'path';
import type { ParsedWxComponent, PropInfo } from '../types';
import { findMatchingBracket, extractTopLevelKeys } from './parseUtils';

const wxJsonCache = new Map<string, { signature: string; components: Map<string, string> }>();
const wxComponentCache = new Map<string, { signature: string; parsed: ParsedWxComponent }>();
const wxComponentPropsCache = new Map<string, { signature: string; props: PropInfo[] }>();

function getFileSignature(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

function readJsOrTs(basePath: string): string {
  try {
    return fs.readFileSync(basePath + '.js', 'utf-8');
  } catch {
    try {
      return fs.readFileSync(basePath + '.ts', 'utf-8');
    } catch {
      return '';
    }
  }
}

export function clearWxParserCache(): void {
  wxJsonCache.clear();
  wxComponentCache.clear();
  wxComponentPropsCache.clear();
}

/**
 * Parse a WeChat Mini Program JSON config file to extract usingComponents.
 */
export function parseWxJson(jsonPath: string): Map<string, string> {
  const signature = getFileSignature(jsonPath);
  const cached = wxJsonCache.get(jsonPath);
  if (cached && cached.signature === signature) {
    return cached.components;
  }

  const components = new Map<string, string>();
  try {
    const content = fs.readFileSync(jsonPath, 'utf-8');
    const json = JSON.parse(content);
    if (json.usingComponents && typeof json.usingComponents === 'object') {
      for (const [name, compPath] of Object.entries(json.usingComponents)) {
        if (typeof compPath === 'string') {
          components.set(name, compPath);
        }
      }
    }
  } catch {
    // ignore parse errors
  }
  wxJsonCache.set(jsonPath, { signature, components });
  return components;
}

/**
 * Parse a WeChat Mini Program JS file to extract Component/Page properties and data.
 */
export function parseWxJs(jsContent: string): { properties: PropInfo[]; dataKeys: string[]; methodKeys: string[] } {
  const result: { properties: PropInfo[]; dataKeys: string[]; methodKeys: string[] } = {
    properties: [],
    dataKeys: [],
    methodKeys: [],
  };

  // Find Component({ ... }) or Page({ ... })
  const callMatch = /(?:Component|Page)\s*\(/.exec(jsContent);
  if (!callMatch) { return result; }

  let idx = callMatch.index + callMatch[0].length;
  while (idx < jsContent.length && /\s/.test(jsContent[idx])) { idx++; }

  if (jsContent[idx] !== '{') { return result; }

  const closeIdx = findMatchingBracket(jsContent, idx);
  if (closeIdx === -1) { return result; }

  const optionsBody = jsContent.substring(idx + 1, closeIdx);

  // Extract properties
  result.properties = extractWxProperties(optionsBody);

  // Extract data
  result.dataKeys = extractWxData(optionsBody);

  // Extract methods
  result.methodKeys = extractWxMethods(optionsBody);

  return result;
}

function extractWxProperties(optionsBody: string): PropInfo[] {
  const props: PropInfo[] = [];
  const propMatch = /(?:^|[,{\s])properties\s*:\s*\{/.exec(optionsBody);
  if (!propMatch) { return props; }

  const braceStart = optionsBody.indexOf('{', propMatch.index + propMatch[0].indexOf('properties'));
  if (braceStart === -1) { return props; }

  const braceClose = findMatchingBracket(optionsBody, braceStart);
  if (braceClose === -1) { return props; }

  const body = optionsBody.substring(braceStart + 1, braceClose);

  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) { i++; }
    if (i >= body.length) { break; }

    if (body[i] === '/' && i + 1 < body.length) {
      if (body[i + 1] === '/') {
        const nl = body.indexOf('\n', i);
        i = nl === -1 ? body.length : nl + 1;
        continue;
      }
      if (body[i + 1] === '*') {
        const end = body.indexOf('*/', i + 2);
        i = end === -1 ? body.length : end + 2;
        continue;
      }
    }

    let key = '';
    if (/[a-zA-Z_$]/.test(body[i])) {
      while (i < body.length && /[a-zA-Z0-9_$]/.test(body[i])) {
        key += body[i];
        i++;
      }
    } else {
      i++;
      continue;
    }

    if (!key) { continue; }
    while (i < body.length && /\s/.test(body[i])) { i++; }

    const prop: PropInfo = { name: key };

    if (i < body.length && body[i] === ':') {
      i++;
      while (i < body.length && /\s/.test(body[i])) { i++; }

      if (body[i] === '{') {
        const close = findMatchingBracket(body, i);
        if (close !== -1) {
          const propBody = body.substring(i + 1, close);
          const typeMatch = /type\s*:\s*(\w+)/.exec(propBody);
          if (typeMatch) { prop.type = typeMatch[1]; }
          i = close + 1;
        }
      } else {
        // Shorthand: propName: Type
        const valStart = i;
        while (i < body.length && /[a-zA-Z0-9_$]/.test(body[i])) { i++; }
        prop.type = body.substring(valStart, i).trim();
      }
    }

    props.push(prop);
  }

  return props;
}

function extractWxData(optionsBody: string): string[] {
  const dataMatch = /(?:^|[,{\s])data\s*:\s*\{/.exec(optionsBody);
  if (!dataMatch) { return []; }

  const braceStart = optionsBody.indexOf('{', dataMatch.index + dataMatch[0].indexOf('data'));
  if (braceStart === -1) { return []; }

  const braceClose = findMatchingBracket(optionsBody, braceStart);
  if (braceClose === -1) { return []; }

  return extractTopLevelKeys(optionsBody.substring(braceStart + 1, braceClose));
}

function extractWxMethods(optionsBody: string): string[] {
  const methodMatch = /(?:^|[,{\s])methods\s*:\s*\{/.exec(optionsBody);
  if (!methodMatch) { return []; }

  const braceStart = optionsBody.indexOf('{', methodMatch.index + methodMatch[0].indexOf('methods'));
  if (braceStart === -1) { return []; }

  const braceClose = findMatchingBracket(optionsBody, braceStart);
  if (braceClose === -1) { return []; }

  return extractTopLevelKeys(optionsBody.substring(braceStart + 1, braceClose));
}

/**
 * Fully parse a WeChat Mini Program component given the base path (without extension).
 */
export function parseWxComponent(basePath: string): ParsedWxComponent {
  const jsonPath = basePath + '.json';
  const signature = [
    getFileSignature(jsonPath),
    getFileSignature(basePath + '.js'),
    getFileSignature(basePath + '.ts'),
  ].join('|');
  const cached = wxComponentCache.get(basePath);
  if (cached && cached.signature === signature) {
    return cached.parsed;
  }

  const usingComponents = parseWxJson(jsonPath);
  const jsContent = readJsOrTs(basePath);

  const parsed = parseWxJs(jsContent);
  const result = {
    usingComponents,
    properties: parsed.properties,
    dataKeys: parsed.dataKeys,
    methodKeys: parsed.methodKeys,
  };
  wxComponentCache.set(basePath, { signature, parsed: result });
  return result;
}

/**
 * Given a WXML file path, get the base path for the page/component (without extension).
 */
export function getWxBasePath(wxmlPath: string): string {
  return wxmlPath.replace(/\.wxml$/, '');
}

/**
 * Given a WXML file path, get the JSON path for reading usingComponents.
 */
export function getWxJsonPath(wxmlPath: string): string {
  return wxmlPath.replace(/\.wxml$/, '.json');
}

/**
 * Parse a target WX component's JS to get its properties (for prop completion).
 */
export function parseWxComponentProps(componentBasePath: string): PropInfo[] {
  const signature = [
    getFileSignature(componentBasePath + '.js'),
    getFileSignature(componentBasePath + '.ts'),
  ].join('|');
  const cached = wxComponentPropsCache.get(componentBasePath);
  if (cached && cached.signature === signature) {
    return cached.props;
  }

  const jsContent = readJsOrTs(componentBasePath);
  if (!jsContent) {
    return [];
  }

  const props = parseWxJs(jsContent).properties;
  wxComponentPropsCache.set(componentBasePath, { signature, props });
  return props;
}

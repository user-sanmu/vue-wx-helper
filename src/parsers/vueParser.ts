import type { ParsedVueSfc, PropInfo } from '../types';
import { findMatchingBracket, extractTopLevelKeys, findOptionBlock, skipExpression } from './parseUtils';

const MAX_VUE_PARSE_CACHE_SIZE = 50;
const vueSfcCache = new Map<string, ParsedVueSfc>();
const vuePropsCache = new Map<string, PropInfo[]>();

function setLimitedCache<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  if (cache.size > MAX_VUE_PARSE_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
}

export function clearVueParserCache(): void {
  vueSfcCache.clear();
  vuePropsCache.clear();
}

export function extractScriptContent(content: string): string | undefined {
  const match = /<script[^>]*>([\s\S]*?)<\/script>/i.exec(content);
  return match ? match[1] : undefined;
}

export function getTemplateRange(content: string): { start: number; end: number } | undefined {
  const openMatch = /<template[^>]*>/i.exec(content);
  if (!openMatch) { return undefined; }
  const start = openMatch.index + openMatch[0].length;
  const endTag = '</template>';
  const endIdx = content.lastIndexOf(endTag);
  if (endIdx <= start) { return undefined; }
  return { start, end: endIdx };
}

export function getScriptRange(content: string): { start: number; end: number } | undefined {
  const openMatch = /<script[^>]*>/i.exec(content);
  if (!openMatch) { return undefined; }
  const start = openMatch.index + openMatch[0].length;
  const endIdx = content.indexOf('</script>', start);
  if (endIdx === -1) { return undefined; }
  return { start, end: endIdx };
}

/**
 * Extract all static ES imports from a script block.
 * Returns a map of local identifier -> import path.
 */
function extractImports(script: string): Map<string, string> {
  const map = new Map<string, string>();

  // Default imports: import Foo from 'path'
  const defaultRe = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = defaultRe.exec(script)) !== null) {
    map.set(m[1], m[2]);
  }

  // Named imports: import { Foo, Bar as Baz } from 'path'
  const namedRe = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = namedRe.exec(script)) !== null) {
    const names = m[1];
    const importPath = m[2];
    for (const part of names.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) { continue; }
      const asParts = trimmed.split(/\s+as\s+/);
      const localName = (asParts.length > 1 ? asParts[1] : asParts[0]).trim();
      if (localName) {
        map.set(localName, importPath);
      }
    }
  }

  return map;
}

/**
 * Extract components registered in the Vue options `components: { ... }` block.
 * Returns a map of component-name -> import-path.
 */
function extractComponents(script: string, imports: Map<string, string>): Map<string, string> {
  const components = new Map<string, string>();

  const block = findOptionBlock(script, 'components');
  if (!block) { return components; }

  const body = script.substring(block.bodyStart, block.bodyEnd);
  let i = 0;

  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) { i++; }
    if (i >= body.length) { break; }

    // Skip comments
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

    // Skip spread
    if (body[i] === '.' && i + 2 < body.length && body[i + 1] === '.' && body[i + 2] === '.') {
      i += 3;
      i = skipExpression(body, i);
      continue;
    }

    // Read component name (key)
    let name = '';
    if (/[a-zA-Z_$]/.test(body[i])) {
      while (i < body.length && /[a-zA-Z0-9_$]/.test(body[i])) {
        name += body[i];
        i++;
      }
    } else if (body[i] === '\'' || body[i] === '"') {
      const quote = body[i];
      i++;
      while (i < body.length && body[i] !== quote) {
        if (body[i] === '\\') { i++; }
        name += body[i];
        i++;
      }
      if (i < body.length) { i++; }
    } else {
      i++;
      continue;
    }

    if (!name) { continue; }

    while (i < body.length && /\s/.test(body[i])) { i++; }

    if (i < body.length && body[i] === ':') {
      // key: value form
      i++;
      while (i < body.length && /\s/.test(body[i])) { i++; }

      const valueStart = i;
      i = skipExpression(body, i);
      const value = body.substring(valueStart, i).trim();

      // Try to extract import path from the value
      const dynamicMatch = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(value);
      if (dynamicMatch) {
        components.set(name, dynamicMatch[1]);
      } else {
        const requireMatch = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(value);
        if (requireMatch) {
          components.set(name, requireMatch[1]);
        } else {
          // Value is a reference to an imported identifier
          const refName = value.replace(/[^a-zA-Z0-9_$]/g, '');
          const refPath = imports.get(refName);
          if (refPath) {
            components.set(name, refPath);
          } else {
            components.set(name, value);
          }
        }
      }
    } else {
      // Shorthand: ComponentName (same as ComponentName: ComponentName)
      const refPath = imports.get(name);
      if (refPath) {
        components.set(name, refPath);
      } else {
        components.set(name, name);
      }
    }
  }

  return components;
}

/**
 * Extract props from the Vue `props` option.
 * Supports both object syntax `props: { name: { type, ... } }` and
 * array syntax `props: ['name1', 'name2']`.
 */
function extractProps(script: string): PropInfo[] {
  const props: PropInfo[] = [];

  // Try object syntax first
  const block = findOptionBlock(script, 'props');
  if (!block) {
    // Try array syntax: props: ['a', 'b']
    const arrMatch = /props\s*:\s*\[([^\]]*)\]/.exec(script);
    if (arrMatch) {
      const items = arrMatch[1];
      const strRe = /['"](\w+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = strRe.exec(items)) !== null) {
        props.push({ name: m[1] });
      }
    }
    return props;
  }

  const body = script.substring(block.bodyStart, block.bodyEnd);

  // Check if this is actually an array (props: [...])
  const trimmed = body.trim();
  if (trimmed.startsWith("'") || trimmed.startsWith('"')) {
    // Array syntax content
    const strRe = /['"](\w+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = strRe.exec(body)) !== null) {
      props.push({ name: m[1] });
    }
    return props;
  }

  // Object syntax: parse key-value pairs
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
    } else if (body[i] === '\'' || body[i] === '"') {
      const quote = body[i];
      i++;
      while (i < body.length && body[i] !== quote) {
        if (body[i] === '\\') { i++; }
        key += body[i];
        i++;
      }
      if (i < body.length) { i++; }
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
        // Full prop definition: { type: ..., required: ..., default: ... }
        const closeBrace = findMatchingBracket(body, i);
        if (closeBrace !== -1) {
          const propBody = body.substring(i + 1, closeBrace);
          const typeMatch = /type\s*:\s*(\w+)/.exec(propBody);
          if (typeMatch) { prop.type = typeMatch[1]; }
          const reqMatch = /required\s*:\s*(true|false)/.exec(propBody);
          if (reqMatch) { prop.required = reqMatch[1] === 'true'; }
          i = closeBrace + 1;
        } else {
          i = skipExpression(body, i);
        }
      } else if (body[i] === '[') {
        // Multiple types: [String, Number]
        const closeBracket = findMatchingBracket(body, i);
        if (closeBracket !== -1) {
          const typesStr = body.substring(i + 1, closeBracket);
          prop.type = typesStr.split(',').map(t => t.trim()).filter(Boolean).join(' | ');
          i = closeBracket + 1;
        } else {
          i = skipExpression(body, i);
        }
      } else {
        // Direct type constructor: String, Number, etc.
        const valueStart = i;
        i = skipExpression(body, i);
        prop.type = body.substring(valueStart, i).trim();
      }
    }

    props.push(prop);
  }

  return props;
}

/**
 * Extract data keys from `data() { return { ... } }` or `data: () => ({ ... })`.
 */
function extractDataKeys(script: string): string[] {
  const block = findOptionBlock(script, 'data');
  if (!block) { return []; }

  const body = script.substring(block.bodyStart, block.bodyEnd);

  // Look for `return {` inside the function body
  const returnMatch = /return\s*\{/.exec(body);
  if (returnMatch) {
    const braceStart = block.bodyStart + returnMatch.index + returnMatch[0].length - 1;
    const braceClose = findMatchingBracket(script, braceStart);
    if (braceClose !== -1) {
      const dataBody = script.substring(braceStart + 1, braceClose);
      return extractTopLevelKeys(dataBody);
    }
  }

  // Fallback: might be arrow `data: () => ({ key: val })` or direct object
  return extractTopLevelKeys(body);
}

function extractComputedKeys(script: string): string[] {
  const block = findOptionBlock(script, 'computed');
  if (!block) { return []; }
  return extractTopLevelKeys(script.substring(block.bodyStart, block.bodyEnd));
}

function extractMethodKeys(script: string): string[] {
  const block = findOptionBlock(script, 'methods');
  if (!block) { return []; }
  return extractTopLevelKeys(script.substring(block.bodyStart, block.bodyEnd));
}

/**
 * Parse a Vue Single File Component and extract all relevant information.
 */
export function parseVueSfc(content: string): ParsedVueSfc {
  const cached = vueSfcCache.get(content);
  if (cached) {
    return cached;
  }

  const result: ParsedVueSfc = {
    components: new Map(),
    imports: new Map(),
    props: [],
    dataKeys: [],
    computedKeys: [],
    methodKeys: [],
  };

  const script = extractScriptContent(content);
  if (!script) { return result; }

  result.imports = extractImports(script);
  result.components = extractComponents(script, result.imports);
  result.props = extractProps(script);
  result.dataKeys = extractDataKeys(script);
  result.computedKeys = extractComputedKeys(script);
  result.methodKeys = extractMethodKeys(script);

  setLimitedCache(vueSfcCache, content, result);
  return result;
}

/**
 * Parse a Vue component file and extract only its props.
 * Useful for providing prop completions when using a child component.
 */
export function parseVueComponentProps(content: string): PropInfo[] {
  const cached = vuePropsCache.get(content);
  if (cached) {
    return cached;
  }

  const script = extractScriptContent(content);
  if (!script) { return []; }
  const props = extractProps(script);
  setLimitedCache(vuePropsCache, content, props);
  return props;
}

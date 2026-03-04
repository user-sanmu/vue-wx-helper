/**
 * Skip over a string literal starting at `startIdx`.
 * Handles single-quoted, double-quoted and template literal strings.
 * Returns the index right after the closing quote.
 */
export function skipString(text: string, startIdx: number): number {
  const quote = text[startIdx];
  let i = startIdx + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) {
      return i + 1;
    }
    if (quote === '`' && text[i] === '$' && i + 1 < text.length && text[i + 1] === '{') {
      i += 2;
      let depth = 1;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') { depth++; }
        else if (text[i] === '}') { depth--; }
        else if (text[i] === '\'' || text[i] === '"' || text[i] === '`') {
          i = skipString(text, i);
          continue;
        }
        if (depth > 0) { i++; }
      }
      if (i < text.length) { i++; }
      continue;
    }
    i++;
  }
  return i;
}

/**
 * Find the index of the matching closing bracket for the opening bracket at `startIdx`.
 * Handles `{}`, `[]`, `()`. Skips strings and comments.
 * Returns -1 if no match is found.
 */
export function findMatchingBracket(text: string, startIdx: number): number {
  const open = text[startIdx];
  const close = open === '{' ? '}' : open === '[' ? ']' : open === '(' ? ')' : '';
  if (!close) { return -1; }

  let depth = 1;
  let i = startIdx + 1;

  while (i < text.length && depth > 0) {
    const ch = text[i];

    if (ch === '\'' || ch === '"' || ch === '`') {
      i = skipString(text, i);
      continue;
    }

    if (ch === '/' && i + 1 < text.length) {
      if (text[i + 1] === '/') {
        const nl = text.indexOf('\n', i);
        i = nl === -1 ? text.length : nl + 1;
        continue;
      }
      if (text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? text.length : end + 2;
        continue;
      }
    }

    if (ch === open) { depth++; }
    else if (ch === close) { depth--; }

    if (depth === 0) { return i; }
    i++;
  }
  return -1;
}

/**
 * Skip over a complete expression/value at depth 0.
 * Stops at `,` or unmatched `}` / `]` / `)`.
 */
export function skipExpression(text: string, startIdx: number): number {
  let i = startIdx;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '\'' || ch === '"' || ch === '`') {
      i = skipString(text, i);
      continue;
    }

    if (ch === '/' && i + 1 < text.length) {
      if (text[i + 1] === '/') {
        const nl = text.indexOf('\n', i);
        i = nl === -1 ? text.length : nl + 1;
        continue;
      }
      if (text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? text.length : end + 2;
        continue;
      }
    }

    if (ch === '{' || ch === '[' || ch === '(') {
      const close = findMatchingBracket(text, i);
      i = close === -1 ? text.length : close + 1;
      continue;
    }

    if (ch === '}' || ch === ']' || ch === ')' || ch === ',') {
      return i;
    }

    i++;
  }
  return i;
}

/**
 * Extract top-level key names from a JavaScript object body (the text between `{` and `}`).
 * Handles shorthand properties, key-value pairs, and method shorthands.
 */
export function extractTopLevelKeys(body: string): string[] {
  const keys: string[] = [];
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

    // Skip spread operators
    if (body[i] === '.' && i + 2 < body.length && body[i + 1] === '.' && body[i + 2] === '.') {
      i += 3;
      i = skipExpression(body, i);
      continue;
    }

    let key = '';
    if (body[i] === '\'' || body[i] === '"') {
      const quote = body[i];
      i++;
      while (i < body.length && body[i] !== quote) {
        if (body[i] === '\\') { i++; }
        key += body[i];
        i++;
      }
      if (i < body.length) { i++; }
    } else if (body[i] === '[') {
      // Computed property name – skip it
      const close = findMatchingBracket(body, i);
      i = close === -1 ? body.length : close + 1;
      while (i < body.length && /\s/.test(body[i])) { i++; }
      if (i < body.length && body[i] === ':') {
        i++;
        i = skipExpression(body, i);
      }
      continue;
    } else if (/[a-zA-Z_$]/.test(body[i])) {
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

    if (i < body.length && body[i] === ':') {
      keys.push(key);
      i++;
      i = skipExpression(body, i);
    } else if (i < body.length && body[i] === '(') {
      keys.push(key);
      const closeParen = findMatchingBracket(body, i);
      if (closeParen === -1) { break; }
      i = closeParen + 1;
      while (i < body.length && /\s/.test(body[i])) { i++; }
      if (i < body.length && body[i] === '{') {
        const closeBrace = findMatchingBracket(body, i);
        if (closeBrace === -1) { break; }
        i = closeBrace + 1;
      }
    } else {
      // Shorthand property or trailing identifier
      keys.push(key);
    }
  }

  return keys;
}

/**
 * Find a top-level option key (like `components`, `props`, `data`, `computed`, `methods`)
 * inside a Vue options object. Returns the index of the key name, or -1.
 *
 * This skips keys inside nested objects/functions so we only match actual Vue option keys.
 */
export function findOptionBlock(script: string, optionName: string): { bodyStart: number; bodyEnd: number } | undefined {
  const re = new RegExp(`(?:^|[,{\\s])${optionName}\\s*(?=[:({])`, 'gm');
  let match: RegExpExecArray | null;

  while ((match = re.exec(script)) !== null) {
    let idx = match.index + match[0].indexOf(optionName) + optionName.length;
    while (idx < script.length && /\s/.test(script[idx])) { idx++; }

    if (script[idx] === ':') {
      idx++;
      while (idx < script.length && /\s/.test(script[idx])) { idx++; }

      if (script[idx] === '{' || script[idx] === '[') {
        const close = findMatchingBracket(script, idx);
        if (close !== -1) {
          return { bodyStart: idx + 1, bodyEnd: close };
        }
      }

      // Could be `data: function() { return {...} }` or arrow function `data: () => ({...})`
      if (script[idx] === 'f' || script[idx] === '(') {
        // Skip to the opening `{` of the function body or `({` for arrow
        let j = idx;
        while (j < script.length && script[j] !== '{') {
          if (script[j] === '(' && script[idx] !== 'f') {
            // Arrow function with parens for params: () =>
            const cp = findMatchingBracket(script, j);
            if (cp === -1) { break; }
            j = cp + 1;
            while (j < script.length && /[\s=]/.test(script[j])) { j++; }
            if (script[j] === '>') { j++; }
            while (j < script.length && /\s/.test(script[j])) { j++; }
            break;
          }
          j++;
        }
        if (j < script.length && (script[j] === '{' || script[j] === '(')) {
          const bracket = script[j];
          const close = findMatchingBracket(script, j);
          if (close !== -1) {
            if (bracket === '(') {
              // Arrow returning object literal: () => ({...})
              let inner = j + 1;
              while (inner < close && /\s/.test(script[inner])) { inner++; }
              if (script[inner] === '{') {
                const innerClose = findMatchingBracket(script, inner);
                if (innerClose !== -1) {
                  return { bodyStart: inner + 1, bodyEnd: innerClose };
                }
              }
            }
            return { bodyStart: j + 1, bodyEnd: close };
          }
        }
      }
    } else if (script[idx] === '(') {
      // Method shorthand: data() { return {...} }
      const closeParen = findMatchingBracket(script, idx);
      if (closeParen === -1) { continue; }
      let j = closeParen + 1;
      while (j < script.length && /\s/.test(script[j])) { j++; }
      if (j < script.length && script[j] === '{') {
        const closeBrace = findMatchingBracket(script, j);
        if (closeBrace !== -1) {
          return { bodyStart: j + 1, bodyEnd: closeBrace };
        }
      }
    }
  }

  return undefined;
}

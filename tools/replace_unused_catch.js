#!/usr/bin/env node
// tools/replace_unused_catch.js
// Scans `tests/` for `catch (x)` blocks where `x` is not referenced inside
// the catch block and replaces them with `catch {}`. Prints a summary of
// modified files. This is conservative but helpful to remove unused-param
// lint noise in tests.

const fs = require('fs');
const path = require('path');

function findFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...findFiles(p));
    } else if (e.isFile() && p.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

function replaceInFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  let changed = false;
  let out = '';
  let i = 0;
  const len = src.length;

  while (i < len) {
    const catchIdx = src.indexOf('catch (', i);
    if (catchIdx === -1) {
      out += src.slice(i);
      break;
    }
    // copy up to catch(
    out += src.slice(i, catchIdx);
    const openParen = src.indexOf('(', catchIdx);
    const closeParen = src.indexOf(')', openParen + 1);
    if (openParen === -1 || closeParen === -1) {
      // malformed - copy rest and bail
      out += src.slice(catchIdx);
      break;
    }
    const paramText = src.slice(openParen + 1, closeParen).trim();
    // now find the opening brace after closeParen
    let braceIdx = src.indexOf('{', closeParen + 1);
    if (braceIdx === -1) {
      out += src.slice(catchIdx, closeParen + 1);
      i = closeParen + 1;
      continue;
    }
    // find matching closing brace for the catch block
    let depth = 0;
    let j = braceIdx;
    let blockEnd = -1;
    while (j < len) {
      const ch = src[j];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          blockEnd = j;
          break;
        }
      }
      j++;
    }
    if (blockEnd === -1) {
      // unbalanced braces, copy and move on
      out += src.slice(catchIdx, braceIdx + 1);
      i = braceIdx + 1;
      continue;
    }
    const blockContent = src.slice(braceIdx + 1, blockEnd);

    // Determine if the param is referenced inside the block (as a whole word)
    // Skip if paramText is empty or contains commas (multi-catch) - be conservative
    if (!paramText || paramText.includes(',') || paramText.includes('=')) {
      // leave unchanged
      out += src.slice(catchIdx, blockEnd + 1);
      i = blockEnd + 1;
      continue;
    }

    const re = new RegExp('\\b' + paramText.replace(/[$^\\.*+?()[\]{}|]/g, '\\$&') + '\\b');
    if (!re.test(blockContent)) {
      // replace 'catch (param) {' with 'catch {'
      out += 'catch {' + blockContent + '}';
      changed = true;
      i = blockEnd + 1;
    } else {
      out += src.slice(catchIdx, blockEnd + 1);
      i = blockEnd + 1;
    }
  }

  if (changed) {
    fs.writeFileSync(file, out, 'utf8');
    return true;
  }
  return false;
}

function main() {
  const testsDir = path.resolve(__dirname, '..', 'tests');
  if (!fs.existsSync(testsDir)) {
    console.error('No tests/ directory found, aborting');
    process.exit(1);
  }
  const files = findFiles(testsDir);
  const modified = [];
  for (const f of files) {
    try {
      if (replaceInFile(f)) modified.push(f);
    } catch (err) {
      console.error('error processing', f, err && err.message);
    }
  }
  if (modified.length) {
    console.log('Modified files:');
    modified.forEach((m) => console.log('  ', m));
  } else {
    console.log('No changes necessary');
  }
}

if (require.main === module) main();

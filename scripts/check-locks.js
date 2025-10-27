#!/usr/bin/env node
// Simple diagnostic: find package.json files with nearby package-lock.json
// and report mismatches between package.json declared dependency ranges and
// the corresponding entry in package-lock.json (useful for CI debugging).
const fs = require('fs');
const path = require('path');

function checkPair(dir) {
  const pkg = path.join(dir, 'package.json');
  const lock = path.join(dir, 'package-lock.json');
  if (!fs.existsSync(pkg) || !fs.existsSync(lock)) return null;
  try {
    const pj = JSON.parse(fs.readFileSync(pkg, 'utf8'));
    const pl = JSON.parse(fs.readFileSync(lock, 'utf8'));
    const diffs = [];
    const deps = Object.assign({}, pj.dependencies || {}, pj.devDependencies || {});
    for (const k of Object.keys(deps)) {
      const range = deps[k];
      const lockRange =
        (pl.packages && pl.packages[''].dependencies && pl.packages[''].dependencies[k]) ||
        (pl.dependencies && pl.dependencies[k] && pl.dependencies[k].version);
      if (!lockRange) {
        diffs.push({ dep: k, packageJson: range, lockFile: '<missing>' });
      } else {
        // lockRange may be a version string or a range in packages[''].dependencies
        if (
          String(lockRange).indexOf(range.replace(/^[\^~]/, '')) === -1 &&
          String(lockRange) !== range
        ) {
          diffs.push({ dep: k, packageJson: range, lockFile: lockRange });
        }
      }
    }
    return diffs.length ? { dir, diffs } : null;
  } catch (e) {
    return { dir, error: String(e) };
  }
}

function walk(start) {
  const queue = [start];
  const results = [];
  while (queue.length) {
    const cur = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    const isPkg = entries.some((d) => d.name === 'package.json');
    if (isPkg) {
      const r = checkPair(cur);
      if (r) results.push(r);
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'node_modules' && e.name[0] !== '.') {
        queue.push(path.join(cur, e.name));
      }
    }
  }
  return results;
}

const root = path.resolve(process.cwd());
const res = walk(root);
if (!res.length) {
  console.log('No package.json + package-lock.json mismatches detected by quick scan.');
  process.exit(0);
}
console.log('Detected potential mismatches:');
for (const r of res) {
  console.log('\nDirectory:', r.dir);
  if (r.error) console.log('  error reading files:', r.error);
  if (r.diffs) {
    for (const d of r.diffs) {
      console.log(`  - ${d.dep}: package.json=${d.packageJson}  lock=${d.lockFile}`);
    }
  }
}
process.exit(0);

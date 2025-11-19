#!/usr/bin/env node
// Simple analyzer that scans downloaded CI artifact folders (artifacts-ci-runs/*)
// for active handle and async handle map dumps and prints a small summary.
// Usage: node tools/analyze_handles.js

const fs = require('fs');
const path = require('path');

function findFiles(dir, patterns) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        for (const p of patterns) if (name.indexOf(p) !== -1) out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

function summaryFromActiveHandles(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const arr = JSON.parse(raw);
    const types = {};
    for (const h of arr) {
      const t = h.type || '<unknown>';
      types[t] = (types[t] || 0) + 1;
    }
    return { file, count: arr.length, types };
  } catch (e) {
    return { file, error: String(e) };
  }
}

function summaryFromAsyncMap(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const arr = JSON.parse(raw);
    const types = {};
    const samples = [];
    for (const e of arr) {
      const t = e.type || '<unknown>';
      types[t] = (types[t] || 0) + 1;
      if (samples.length < 6 && e.stack) samples.push({ id: e.id, type: t, stack: e.stack });
    }
    return { file, count: arr.length, types, samples };
  } catch (e) {
    return { file, error: String(e) };
  }
}

const base = path.resolve(process.cwd(), 'artifacts-ci-runs');
if (!fs.existsSync(base)) {
  console.error('No artifacts-ci-runs/ directory found in cwd:', process.cwd());
  process.exit(2);
}

console.log('Scanning', base);
const activeFiles = findFiles(base, [
  'active_handles.json',
  'active_handles_smoke_',
  'active_handles',
]);
const mapFiles = findFiles(base, [
  'async_handle_map.json',
  'async_handles_smoke_',
  'async_handle_map',
]);

console.log('\nFound active handle dumps:', activeFiles.length);
for (const f of activeFiles) {
  const s = summaryFromActiveHandles(f);
  console.log('\n--', f);
  if (s.error) console.log('  ERROR reading', s.error);
  else {
    console.log(`  total handles: ${s.count}`);
    console.log('  types:');
    for (const k of Object.keys(s.types).sort((a, b) => s.types[b] - s.types[a]))
      console.log(`    ${k}: ${s.types[k]}`);
  }
}

console.log('\nFound async handle map dumps:', mapFiles.length);
for (const f of mapFiles) {
  const s = summaryFromAsyncMap(f);
  console.log('\n--', f);
  if (s.error) console.log('  ERROR reading', s.error);
  else {
    console.log(`  entries: ${s.count}`);
    console.log('  types:');
    for (const k of Object.keys(s.types).sort((a, b) => s.types[b] - s.types[a]))
      console.log(`    ${k}: ${s.types[k]}`);
    if (s.samples && s.samples.length) {
      console.log('  sample stacks (truncated):');
      for (const sam of s.samples)
        console.log(
          `    id=${sam.id} type=${sam.type}\n      ${String(sam.stack).split('\n').slice(0, 6).join('\n      ')}`
        );
    }
  }
}

console.log('\nAnalysis complete.');

#!/usr/bin/env node
// tools/analyze_async_handles.js
// Usage: node tools/analyze_async_handles.js <dir>
// If <dir> is a directory containing downloaded artifacts, the script will locate
// the newest async_handles_*.json and active_handles*.json (if present) and print
// type counts and a short sample of creation stacks. It will also map active handles
// to their creation stacks if both files are present.

const fs = require('fs');
const path = require('path');

function findFiles(dir) {
  const all = [];
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else all.push(p);
    }
  }
  walk(dir);
  return all;
}

function newest(files) {
  if (!files || files.length === 0) return null;
  return files.map((f) => ({ f, m: fs.statSync(f).mtimeMs })).sort((a, b) => b.m - a.m)[0].f;
}

function loadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error('Failed to read/parse', p, err.message);
    process.exit(2);
  }
}

function summarizeAsyncMap(map) {
  const types = {};
  for (const id of Object.keys(map)) {
    const t = (map[id] && map[id].type) || 'UNKNOWN';
    types[t] = (types[t] || 0) + 1;
  }
  console.log('\nTYPE COUNTS:');
  Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .forEach((x) => console.log(' ', x[0], x[1]));
  const stacks = Object.values(map)
    .map((v) => (v && (v._createdStack || v.stack)) || '')
    .filter(Boolean);
  const uniq = [...new Map(stacks.map((s) => [s, s])).keys()].slice(0, 30);
  console.log('\nTOP CREATION STACKS (sample):');
  uniq.forEach((s, i) => {
    console.log('\n--- stack', i + 1, '---');
    console.log(s.split('\n').slice(0, 20).join('\n'));
  });
}

function mapActiveToStacks(active, amap) {
  const byType = {};
  for (const id of Object.keys(active)) {
    const info = amap[id] || {};
    const t = info.type || active[id].type || 'UNKNOWN';
    const stack = (info && (info._createdStack || info.stack)) || active[id].stack || '<no-stack>';
    if (!byType[t]) byType[t] = [];
    byType[t].push({ id, stack });
  }
  console.log('\nMAPPED ACTIVE HANDLES:');
  for (const t of Object.keys(byType)) {
    console.log('\n==', t, 'count=', byType[t].length);
    byType[t].slice(0, 5).forEach((x) => {
      console.log('-', x.id);
      console.log(x.stack.split('\n').slice(0, 12).join('\n'));
      console.log('---');
    });
  }
}

if (process.argv.length < 3) {
  console.error('Usage: node tools/analyze_async_handles.js <downloaded-artifacts-dir>');
  process.exit(1);
}

const dir = process.argv[2];
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error('Directory not found:', dir);
  process.exit(1);
}

const files = findFiles(dir);
const asyncFiles = files.filter((f) => /async_handles|async_handle_map/i.test(path.basename(f)));
const activeFiles = files.filter((f) =>
  /active_handles|active-handles|activeHandles/i.test(path.basename(f))
);

const asyncFile = newest(asyncFiles);
const activeFile = newest(activeFiles);

if (!asyncFile && !activeFile) {
  console.error('No async_handle or active_handles files found in:', dir);
  process.exit(1);
}

console.log('Found async file:', asyncFile || '<none>');
console.log('Found active file:', activeFile || '<none>');

let amap = {};
if (asyncFile) {
  amap = loadJson(asyncFile);
  summarizeAsyncMap(amap);
}

if (activeFile) {
  const active = loadJson(activeFile);
  if (!asyncFile) {
    console.log('\nActive handles only, printing top keys:');
    console.log(Object.keys(active).slice(0, 30));
  } else {
    mapActiveToStacks(active, amap);
  }
}

console.log('\nDone.');

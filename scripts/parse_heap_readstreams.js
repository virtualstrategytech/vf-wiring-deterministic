const fs = require('fs');
const path = require('path');

if (process.argv.length < 3) {
  console.error('Usage: node parse_heap_readstreams.js <heap_snapshot_path>');
  process.exit(2);
}

const heapPath = process.argv[2];
const outPath = path.join(path.dirname(heapPath), 'readstream_report.json');

console.error('Reading heap snapshot (this may take a moment)...');
const txt = fs.readFileSync(heapPath, 'utf8');

const findings = [];
const seen = new Set();

const needle = 'ReadStream';
let idx = 0;
while (true) {
  idx = txt.indexOf(needle, idx);
  if (idx === -1) break;

  // capture a window around the hit
  const start = Math.max(0, idx - 800);
  const end = Math.min(txt.length, idx + 800);
  const snippet = txt.slice(start, end);

  // try to extract a "path" or "name" property in the snippet
  const pathMatch = snippet.match(/"path"\s*:\s*"([^"]+)"/);
  const fileNameMatch = snippet.match(/"name"\s*:\s*"([^"]*ReadStream[^"]*)"/);
  const possible = {
    index: idx,
    snippetStart: start,
    snippetEnd: end,
    path: pathMatch ? pathMatch[1] : null,
    name: fileNameMatch ? fileNameMatch[1] : null,
    snippet: snippet.replace(/\s+/g, ' ').slice(0, 500),
  };

  const uniqueKey =
    (possible.path || '') + '::' + (possible.name || '') + '::' + Math.floor(idx / 1000);
  if (!seen.has(uniqueKey)) {
    seen.add(uniqueKey);
    findings.push(possible);
  }

  idx = idx + needle.length;
}

fs.writeFileSync(outPath, JSON.stringify({ heap: heapPath, findings }, null, 2));
console.error('Wrote report to', outPath);
console.log(JSON.stringify({ heap: heapPath, findingsCount: findings.length }, null, 2));

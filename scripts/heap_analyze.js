// scripts/heap_analyze.js
// Best-effort analyzer for V8 heap snapshots produced by v8.writeHeapSnapshot()
// This script searches for closure/function nodes whose name contains 'bound'
// or are named '(closure)' or 'anonymous' and prints their incoming retainers.

const fs = require('fs');
const path = require('path');

const snapPath =
  process.argv[2] ||
  path.resolve(
    __dirname,
    '..',
    'artifacts',
    fs
      .readdirSync(path.resolve(__dirname, '..', 'artifacts'))
      .filter((f) => f.endsWith('.heapsnapshot'))
      .sort()
      .pop()
  );
if (!snapPath || !fs.existsSync(snapPath)) {
  console.error(
    'Heap snapshot not found. Pass path as first argument or place a .heapsnapshot in artifacts/.'
  );
  process.exit(2);
}
console.log('Analyzing', snapPath);
const raw = fs.readFileSync(snapPath, 'utf8');
let snap;
try {
  snap = JSON.parse(raw);
} catch (e) {
  console.error('Failed to parse snapshot JSON:', (e && e.stack) || e);
  process.exit(2);
}
const meta = snap.snapshot.meta;
const node_fields = meta.node_fields; // e.g. ["type","name","id","self_size","edge_count","trace_node_id","detachedness"]
const edge_fields = meta.edge_fields; // ["type","name_or_index","to_node"]
const node_types = meta.node_types[0];
const nodes = snap.nodes; // flat integer array
const strings = snap.strings; // array of strings
const edge_fields_count = edge_fields.length;
const nodeFieldCount = node_fields.length;
const nodeCount = snap.snapshot.node_count;

console.log('nodeCount', nodeCount, 'strings', strings.length);

// helper to read a node at index i (node index i from 0..nodeCount-1)
function readNode(i) {
  const base = i * nodeFieldCount;
  const typeIndex = nodes[base];
  const nameIndex = nodes[base + 1];
  const id = nodes[base + 2];
  const self_size = nodes[base + 3];
  const edge_count = nodes[base + 4];
  const trace_node_id = nodes[base + 5];
  const detachedness = nodes[base + 6];
  return {
    i,
    typeIndex,
    type: node_types[typeIndex] || typeIndex,
    nameIndex,
    name: strings[nameIndex] || '<noname>',
    id,
    self_size,
    edge_count,
    trace_node_id,
    detachedness,
    base,
  };
}

// Build edge index: edges array follows nodes and contains triples per edge according to meta.edge_fields
const edges = snap.edges; // flat array
console.log(
  'edge count (from snapshot):',
  snap.snapshot.edge_count,
  'edges array length',
  edges.length
);

// We'll build incoming edges map: for each target node index, list of source node indices
// To map edge to target node index, edge.to_node is an index into nodes array (as node_index * nodeFieldCount?) According to spec, to_node is an index into nodes array (index of node * nodeFieldCount?). The snapshots store node indexes as index in nodes array, not node id.

// However, in snapshot format, nodes are sequential and 'to_node' value is an integer index into the nodes array (node offset), not node number. We need to compute target node idx = to_node / nodeFieldCount

const incoming = new Array(nodeCount).fill(null).map(() => []);
let edgePos = 0;
for (let nodeIdx = 0; nodeIdx < nodeCount; nodeIdx++) {
  const n = readNode(nodeIdx);
  const ec = n.edge_count;
  for (let e = 0; e < ec; e++) {
    const type = edges[edgePos];
    const name_or_index = edges[edgePos + 1];
    const to_node = edges[edgePos + 2];
    const toNodeIndex = Math.floor(to_node / nodeFieldCount);
    // record incoming from nodeIdx to toNodeIndex
    if (toNodeIndex >= 0 && toNodeIndex < nodeCount)
      incoming[toNodeIndex].push({ from: nodeIdx, type, name_or_index });
    edgePos += edge_fields_count;
  }
}
console.log('Built incoming edges map');

// find closure nodes
const closures = [];
for (let i = 0; i < nodeCount; i++) {
  const n = readNode(i);
  if (
    n.type === 'closure' ||
    (n.name &&
      (n.name.includes('bound') ||
        n.name.toLowerCase().includes('closure') ||
        n.name.toLowerCase().includes('anonymous') ||
        n.name.toLowerCase().includes('(closure)')))
  ) {
    closures.push(n);
  }
}
console.log('Found closures (candidates):', closures.length);

// Filter closures to those with name containing 'bound' or anonymous/closure
const interesting = closures.filter((n) => {
  if (!n.name) return true;
  const ln = String(n.name).toLowerCase();
  return (
    ln.includes('bound') ||
    ln.includes('closure') ||
    ln.includes('anonymous') ||
    ln.includes('(closure)')
  );
});
console.log('Interesting closures:', interesting.length);

function summarizeNode(n) {
  return `${n.i} ${n.type} "${n.name}" id=${n.id} size=${n.self_size} edges=${n.edge_count}`;
}

// For each interesting closure, print its incoming retainers (up to 10)
const report = [];
for (const c of interesting) {
  const inc = incoming[c.i] || [];
  // map retainers to readable names and sizes
  const retainers = inc.map((edge) => {
    const src = readNode(edge.from);
    return { from: edge.from, fromName: src.name, fromType: src.type, fromSize: src.self_size };
  });
  // sort by fromSize desc
  retainers.sort((a, b) => (b.fromSize || 0) - (a.fromSize || 0));
  report.push({ closure: summarizeNode(c), retainers: retainers.slice(0, 10) });
}

// Print summary
for (const r of report.slice(0, 30)) {
  console.log('CLOSURE:', r.closure);
  if (!r.retainers.length) console.log('  (no incoming retainers)');
  for (const rt of r.retainers) {
    console.log(
      `  retainer: node=${rt.from} type=${rt.fromType} name="${rt.fromName}" size=${rt.fromSize}`
    );
  }
}

// Now look for closures retained (transitively) by nodes whose name mentions our modules of interest
const interestingModulesLower = [
  'body-parser',
  'raw-body',
  'novain-platform',
  'webhook',
  'finalhandler',
  'express',
  'bodyparser',
  'rawbody',
];
console.log(
  '\nScanning closures for transitive retainers that mention module paths (BFS up to depth 10)...'
);

function nodeMatchesModule(n) {
  if (!n || !n.name) return false;
  const ln = String(n.name).toLowerCase();
  return interestingModulesLower.some((m) => ln.includes(m));
}

// Transitive BFS up the incoming edges from a start node to find a node whose name matches our modules
function findModuleRetainer(startIdx, maxDepth = 10) {
  const queue = [{ idx: startIdx, depth: 0, path: [startIdx] }];
  const seen = new Set([startIdx]);
  while (queue.length) {
    const cur = queue.shift();
    const { idx, depth, path } = cur;
    if (depth > maxDepth) continue;
    const inc = incoming[idx] || [];
    for (const e of inc) {
      const from = e.from;
      if (seen.has(from)) continue;
      seen.add(from);
      const node = readNode(from);
      const newPath = path.concat([from]);
      if (nodeMatchesModule(node)) {
        return { matchNode: node, path: newPath };
      }
      // Enqueue further up the chain
      queue.push({ idx: from, depth: depth + 1, path: newPath });
    }
  }
  return null;
}

let transitiveMatches = 0;
for (const r of report.slice(0, 200)) {
  // extract closure node index from the closure summary string: it starts with index
  const m = r.closure.match(/^(\d+) /);
  const idx = m ? Number(m[1]) : null;
  if (idx === null) continue;
  const found = findModuleRetainer(idx, 12);
  if (found) {
    transitiveMatches++;
    console.log('\nCLOSURE with transitive module retainer:', r.closure);
    console.log(
      `  matched module node: ${found.matchNode.i} name="${found.matchNode.name}" type=${found.matchNode.type} size=${found.matchNode.self_size}`
    );
    // print readable path (sample up to 10 nodes)
    const pathNodes = found.path.map((pi) => readNode(pi));
    console.log('  retainer path (closest->farthest) [showing up to 10 nodes]:');
    for (const pn of pathNodes.slice(0, 10)) {
      console.log(`    node=${pn.i} type=${pn.type} name="${pn.name}" size=${pn.self_size}`);
    }
  }
}
console.log(`\nTransitive matches found: ${transitiveMatches}`);
// Additionally search for nodes whose name contains relevant module paths
const interestingModules = [
  'body-parser',
  'raw-body',
  'novain-platform',
  'webhook',
  'finalhandler',
];
const moduleNodes = [];
for (let i = 0; i < nodeCount; i++) {
  const n = readNode(i);
  for (const m of interestingModules) {
    if (n.name && n.name.toLowerCase().includes(m)) {
      moduleNodes.push({ node: n, module: m });
      break;
    }
  }
}
console.log('Module-related nodes found:', moduleNodes.length);
for (const mn of moduleNodes.slice(0, 40)) {
  console.log(`MODULE NODE (${mn.module}): ${summarizeNode(mn.node)}`);
}

console.log('\nDone.');
for (const mn of moduleNodes.slice(0, 40)) {
  console.log(`MODULE NODE (${mn.module}): ${summarizeNode(mn.node)}`);
}

console.log('\nDone.');

import fs from 'node:fs';
import path from 'node:path';

const root = path.join(process.cwd(), 'src');
const exts = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (exts.has(path.extname(entry.name))) files.push(full);
  }
}


walk(root);

function resolveLocal(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ];
  return candidates.find(p => fs.existsSync(p));
}

const graph = new Map();

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const deps = [];
  for (const m of src.matchAll(/(?:import\s+(?:type\s+)?[\s\S]*?\s+from\s+|export\s+\*\s+from\s+|export\s+{[\s\S]*?}\s+from\s+|import\()\s*['"](\.\.?\/[^'"]+)['"]/g)) {
    const resolved = resolveLocal(file, m[1]);
    if (resolved) deps.push(resolved);
  }
  graph.set(file, deps);
}

const seen = new Set();
const stack = [];
const onStack = new Set();
const cycles = [];

function dfs(node) {
  seen.add(node);
  stack.push(node);
  onStack.add(node);

  for (const dep of graph.get(node) || []) {
    if (!seen.has(dep)) dfs(dep);
    else if (onStack.has(dep)) {
      const idx = stack.indexOf(dep);
      cycles.push(stack.slice(idx).concat(dep));
    }
  }

  stack.pop();
  onStack.delete(node);
}

for (const file of graph.keys()) {
  if (!seen.has(file)) dfs(file);
}

if (cycles.length) {
  console.error('\nCircular imports found:\n');
  for (const cycle of cycles.slice(0, 50)) {
    console.error(cycle.map(p => path.relative(process.cwd(), p)).join(' -> '));
  }
  process.exit(1);
}

console.log('No circular imports found.');

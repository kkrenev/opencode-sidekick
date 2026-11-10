import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webviewRoot = join(root, 'src', 'webview');
const layerRank = {
  shared: 1,
  entities: 2,
  features: 3,
  widgets: 4,
  app: 5,
};
const sliceLayers = new Set(['entities', 'features', 'widgets']);
const violations = [];

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    const info = statSync(absolute);
    if (info.isDirectory()) {
      walk(absolute);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      checkFile(absolute);
    }
  }
}

function checkFile(file) {
  const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  const sourceInfo = layerOf(file);
  if (!sourceInfo) {
    return;
  }
  for (const specifier of imports) {
    if (!specifier.startsWith('.')) {
      continue;
    }
    const target = resolve(dirname(file), specifier);
    const targetInfo = layerOf(target);
    if (!targetInfo) {
      continue;
    }
    const sourceRank = layerRank[sourceInfo.layer];
    const targetRank = layerRank[targetInfo.layer];
    if (targetRank > sourceRank) {
      violations.push(
        `${relative(root, file)} imports upward from ${sourceInfo.layer} to ${targetInfo.layer}: ${specifier}`,
      );
      continue;
    }
    if (
      sourceInfo.layer === targetInfo.layer &&
      sliceLayers.has(sourceInfo.layer) &&
      sourceInfo.slice !== targetInfo.slice
    ) {
      violations.push(
        `${relative(root, file)} imports another ${sourceInfo.layer} slice (${sourceInfo.slice} -> ${targetInfo.slice}): ${specifier}`,
      );
    }
  }
}

function layerOf(file) {
  const relativePath = relative(webviewRoot, file);
  if (relativePath.startsWith('..') || relativePath === '') {
    return undefined;
  }
  const [layer, slice] = relativePath.split(/[\\/]/);
  if (!(layer in layerRank)) {
    return undefined;
  }
  return { layer, slice };
}

walk(webviewRoot);

if (violations.length > 0) {
  console.error('Architecture violations:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('architecture-check: ok');

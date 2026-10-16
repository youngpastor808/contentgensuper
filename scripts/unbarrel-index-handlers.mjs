import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const indexFile = path.join(root, 'index.tsx');
const srcDir = path.join(root, 'src');

const CANDIDATES = [
  'handlers-settings.ts',
  'handlers-project.ts',
  'handlers-export.ts',
  'handlers-story.ts',
  'handlers-assets.ts',
  'handlers-graphics.ts',
  'handlers-images.ts',
  'handlers-inspector.ts',
  'handlers-misc.ts',
  'videoController.ts',
  'videoDirector.ts',
  'exporter.ts',
  'timelineBuilder.ts',
  'shortcuts.ts',
  'audio-first-director.ts',
  'audio-upload-director.ts',
  'handlers-transcript-editor.ts',
  'handlers-transcribe.ts',
  'audioPipeline.ts',
  'ui.ts',
];

const ALIAS_BY_FILE = {
  'handlers-settings.ts': 'settingsHandlers',
  'handlers-project.ts': 'projectHandlers',
  'handlers-export.ts': 'exportHandlers',
  'handlers-story.ts': 'storyHandlers',
  'handlers-assets.ts': 'assetHandlers',
  'handlers-graphics.ts': 'graphicsHandlers',
  'handlers-images.ts': 'imageHandlers',
  'handlers-inspector.ts': 'inspectorHandlers',
  'handlers-misc.ts': 'miscHandlers',
  'videoController.ts': 'videoController',
  'videoDirector.ts': 'videoDirector',
  'exporter.ts': 'exporter',
  'timelineBuilder.ts': 'timelineBuilder',
  'shortcuts.ts': 'shortcuts',
  'audio-first-director.ts': 'audioFirstDirector',
  'audio-upload-director.ts': 'audioUploadDirector',
  'handlers-transcript-editor.ts': 'transcriptHandlers',
  'handlers-transcribe.ts': 'transcribeHandlers',
  'audioPipeline.ts': 'audioPipeline',
  'ui.ts': 'ui',
};

const PREFERRED_SOURCE = {
  fetchAndPopulateVoices: 'audioPipeline.ts',
  fetchAndPopulateElevenLabsModels: 'audioPipeline.ts',
  handleOpenCloningModal: 'audioPipeline.ts',
  handleCloseCloningModal: 'audioPipeline.ts',
  handleCloningDropZoneClick: 'audioPipeline.ts',
  handleCloningFileChange: 'audioPipeline.ts',
  handleStartVoiceCloning: 'audioPipeline.ts',
  loadCustomVoicesIntoDropdown: 'audioPipeline.ts',
  handleRemoveCustomVoice: 'audioPipeline.ts',
  handleCustomVoiceUIVisibility: 'audioPipeline.ts',
  handleAddManualVoiceId: 'audioPipeline.ts',
  handleToggleManualVoiceId: 'audioPipeline.ts',
  removeCustomImage: 'ui.ts',
};

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function exportedNames(source) {
  const out = new Set();

  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    /export\s+const\s+([A-Za-z0-9_]+)/g,
    /export\s+let\s+([A-Za-z0-9_]+)/g,
    /export\s+class\s+([A-Za-z0-9_]+)/g,
  ];

  for (const re of patterns) {
    for (const m of source.matchAll(re)) out.add(m[1]);
  }

  for (const m of source.matchAll(/export\s*{\s*([^}]+)\s*}/g)) {
    const names = m[1]
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.split(/\s+as\s+/i)[1] || s.split(/\s+as\s+/i)[0]);
    for (const name of names) out.add(name.trim());
  }

  return out;
}

const symbolToFile = new Map();

for (const file of CANDIDATES) {
  const full = path.join(srcDir, file);
  if (!fs.existsSync(full)) continue;
  const source = read(full);
  for (const name of exportedNames(source)) {
    if (PREFERRED_SOURCE[name] && PREFERRED_SOURCE[name] !== file) continue;
    if (!symbolToFile.has(name)) symbolToFile.set(name, file);
  }
}

for (const [name, file] of Object.entries(PREFERRED_SOURCE)) {
  symbolToFile.set(name, file);
}

let indexSource = read(indexFile);
const usedHandlerSymbols = [...new Set([...indexSource.matchAll(/handlers\.([A-Za-z0-9_]+)/g)].map(m => m[1]))];

const neededAliases = new Set();

for (const symbol of usedHandlerSymbols) {
  const file = symbolToFile.get(symbol);
  if (!file) {
    console.warn(`No source file found for handlers.${symbol}`);
    continue;
  }
  const alias = ALIAS_BY_FILE[file];
  neededAliases.add(file);
  indexSource = indexSource.replaceAll(`handlers.${symbol}`, `${alias}.${symbol}`);
}

const newImports = [...neededAliases]
  .sort()
  .map(file => `import * as ${ALIAS_BY_FILE[file]} from './src/${file.replace(/\.ts$/, '')}';`)
  .join('\n');

indexSource = indexSource.replace(
  /import\s+\*\s+as\s+handlers\s+from\s+['"]\.\/src\/handlers\.ts['"];\n?/,
  `${newImports}\n`
);
// fallback for index without .ts
indexSource = indexSource.replace(
  /import\s+\*\s+as\s+handlers\s+from\s+['"]\.\/src\/handlers['"];\n?/,
  `${newImports}\n`
);

fs.writeFileSync(indexFile, indexSource);
console.log('Updated index.tsx successfully.');

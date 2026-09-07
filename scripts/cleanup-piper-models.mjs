#!/usr/bin/env node
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('models/piper');
const catalogPath = path.join(root, 'models.json');
const dryRun = process.argv.includes('--dry-run');
const qualitySuffixPattern = /-(x_low|low|medium|high)$/i;

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const voices = Array.isArray(catalog.voices) ? catalog.voices : [];
const canonicalByModelPath = new Map();
const aliasLabelsByModelPath = new Map();

for (const voice of voices) {
  if (typeof voice.modelPath !== 'string') {
    continue;
  }

  const normalized = normalizeModelPath(voice.modelPath);
  const parts = normalized.split('/');
  if (parts.length >= 4 && /^[a-z]{2}_[A-Z]{2}$/.test(parts[0]) && typeof voice.id === 'string' && /^[a-z]{2}_[A-Z]{2}-/.test(voice.id)) {
    canonicalByModelPath.set(normalized, voice);
  } else if (voice.id !== voice.label && typeof voice.label === 'string') {
    aliasLabelsByModelPath.set(normalized, voice.label);
  } else if (typeof voice.id === 'string' && !voice.id.startsWith('en_')) {
    aliasLabelsByModelPath.set(normalized, voice.id);
  }
}

let updatedAliases = 0;
for (const voice of canonicalByModelPath.values()) {
  const normalized = normalizeModelPath(voice.modelPath);
  const label = aliasLabelsByModelPath.get(normalized) ?? friendlyLabelFor(voice.id, voice.label);
  const gender = genderFor(voice.id, voice.gender);
  if (voice.label !== label) {
    console.log(`${dryRun ? 'Would relabel' : 'Relabeling'} ${voice.id}: ${voice.label} -> ${label}`);
    voice.label = label;
    updatedAliases += 1;
  }
  if (voice.gender !== gender) {
    console.log(`${dryRun ? 'Would update gender' : 'Updating gender'} ${voice.id}: ${voice.gender ?? 'unknown'} -> ${gender ?? 'unknown'}`);
    if (gender) {
      voice.gender = gender;
    } else {
      delete voice.gender;
    }
    updatedAliases += 1;
  }
}

const canonicalVoices = [];
const seenIds = new Set();
for (const voice of voices) {
  if (typeof voice.modelPath !== 'string') {
    continue;
  }

  const normalized = normalizeModelPath(voice.modelPath);
  const canonical = canonicalByModelPath.get(normalized);
  if (canonical && voice === canonical && typeof voice.id === 'string' && /^[a-z]{2}_[A-Z]{2}-/.test(voice.id) && !seenIds.has(voice.id)) {
    canonicalVoices.push(voice);
    seenIds.add(voice.id);
  } else if (canonical) {
    console.log(`${dryRun ? 'Would remove alias' : 'Removing alias'} ${voice.id} for ${canonical.id}`);
    updatedAliases += 1;
  }
}

canonicalVoices.sort((a, b) => a.id.localeCompare(b.id));
const finalVoices = bestQualityOnly(canonicalVoices);
catalog.voices = dryRun ? voices : finalVoices;
const defaultVoiceId = finalVoices.find((voice) => voice.label === 'Dave')?.id ?? catalog.defaultVoiceId;
if (catalog.defaultVoiceId !== defaultVoiceId) {
  console.log(`${dryRun ? 'Would update' : 'Updating'} defaultVoiceId: ${catalog.defaultVoiceId} -> ${defaultVoiceId}`);
  catalog.defaultVoiceId = defaultVoiceId;
  updatedAliases += 1;
}

const referenced = new Set();
for (const voice of finalVoices) {
  if (typeof voice.modelPath !== 'string') {
    continue;
  }

  const model = path.resolve(root, voice.modelPath);
  referenced.add(model);
  referenced.add(`${model}.json`);
}
referenced.add(catalogPath);

const files = await listFiles(root);
const removable = files.filter((file) => {
  const name = path.basename(file);
  return name === 'ALIASES' || name === 'MODEL_CARD' || ((file.endsWith('.onnx') || file.endsWith('.onnx.json')) && !referenced.has(file));
});

for (const file of removable) {
  assertInsideRoot(file);
  console.log(`${dryRun ? 'Would remove' : 'Removing'} ${path.relative(process.cwd(), file)}`);
  if (!dryRun) {
    await rm(file, { force: true });
  }
}

if (!dryRun && updatedAliases > 0) {
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}

if (!dryRun) {
  await removeEmptyDirs(root);
}

console.log(`${dryRun ? 'Would update' : 'Updated'} ${updatedAliases} catalog entr${updatedAliases === 1 ? 'y' : 'ies'} and ${dryRun ? 'would remove' : 'removed'} ${removable.length} file${removable.length === 1 ? '' : 's'}.`);

function normalizeModelPath(modelPath) {
  return modelPath.replace(/^\.\//, '').replaceAll('\\', '/');
}

function friendlyLabelFor(id, currentLabel) {
  const overrides = {
    'en_GB-alan-medium': 'Alan',
    'en_GB-alba-medium': 'Alba',
    'en_GB-aru-medium': 'Aru',
    'en_GB-cori-high': 'Cori',
    'en_GB-jenny_dioco-medium': 'Jenny',
    'en_GB-northern_english_male-medium': 'Dave',
    'en_GB-semaine-medium': 'Selma',
    'en_GB-southern_english_female-low': 'Mary',
    'en_GB-vctk-medium': 'Victoria',
    'en_US-amy-medium': 'Amy',
    'en_US-arctic-medium': 'Arctic',
    'en_US-bryce-medium': 'Bryce',
    'en_US-danny-low': 'Danny',
    'en_US-hfc_female-medium': 'Sarah',
    'en_US-hfc_male-medium': 'Tyler',
    'en_US-joe-medium': 'Joe',
    'en_US-john-medium': 'John',
    'en_US-kathleen-low': 'Kathleen',
    'en_US-kristin-medium': 'Kristin',
    'en_US-kusal-medium': 'Kusal',
    'en_US-l2arctic-medium': 'Lena',
    'en_US-lessac-high': 'Linda',
    'en_US-libritts_r-medium': 'Lira',
    'en_US-libritts-high': 'Irene',
    'en_US-ljspeech-high': 'Laura',
    'en_US-mike-medium': 'Mike',
    'en_US-norman-medium': 'Norman',
    'en_US-reza_ibrahim-medium': 'Reza',
    'en_US-ryan-high': 'Ryan',
    'en_US-sam-medium': 'Sam',
    'de_DE-eva_k-x_low': 'Eva',
    'de_DE-karlsson-low': 'Karl',
    'de_DE-kerstin-low': 'Kerstin',
    'de_DE-mls-medium': 'Marlene',
    'de_DE-pavoque-low': 'Paula',
    'de_DE-ramona-low': 'Ramona',
    'de_DE-thorsten_emotional-medium': 'Thorsten Emotional',
    'de_DE-thorsten-high': 'Thorsten',
    'es_AR-daniela-high': 'Daniela',
    'es_ES-carlfm-x_low': 'Carlos',
    'es_ES-davefx-medium': 'David',
    'es_ES-mls_10246-low': 'Lucia',
    'es_ES-mls_9972-low': 'Sofia',
    'es_ES-sharvard-medium': 'Isabel',
    'es_MX-ald-medium': 'Aldo',
    'es_MX-ald-x_low': 'Aldo Low',
    'es_MX-claude-high': 'Claude',
    'fr_FR-gilles-low': 'Gilles',
    'fr_FR-mls_1840-low': 'Camille',
    'fr_FR-mls-medium': 'Claire',
    'fr_FR-siwis-medium': 'Simone',
    'fr_FR-tom-medium': 'Tom',
    'fr_FR-upmc-medium': 'Margot',
    'ja_JA-hi_fi_captain-medium': 'Captain',
    'nl_BE-nathalie-medium': 'Nathalie',
    'nl_BE-nathalie-x_low': 'Nathalie Low',
    'nl_BE-rdh-medium': 'Robin',
    'nl_BE-rdh-x_low': 'Robin Low',
    'nl_NL-alex-medium': 'Alex',
    'nl_NL-mls_5809-low': 'Lotte',
    'nl_NL-mls_7432-low': 'Noor',
    'nl_NL-mls-medium': 'Mila',
    'nl_NL-pim-medium': 'Pim',
    'nl_NL-ronnie-medium': 'Ronnie',
    'zh_CN-chaowen-medium': 'Chaowen',
    'zh_CN-huayan-medium': 'Huayan',
    'zh_CN-huayan-x_low': 'Huayan Low',
    'zh_CN-xiao_ya-medium': 'Xiao Ya'
  };

  return overrides[id] ?? currentLabel ?? id;
}

function genderFor(id, currentGender) {
  const overrides = {
    'de_DE-eva_k-x_low': 'feminine',
    'de_DE-karlsson-low': 'masculine',
    'de_DE-kerstin-low': 'feminine',
    'de_DE-mls-medium': 'feminine',
    'de_DE-pavoque-low': 'feminine',
    'de_DE-ramona-low': 'feminine',
    'de_DE-thorsten_emotional-medium': 'masculine',
    'de_DE-thorsten-high': 'masculine',
    'en_GB-alan-medium': 'masculine',
    'en_GB-alba-medium': 'feminine',
    'en_GB-aru-medium': 'feminine',
    'en_GB-cori-high': 'feminine',
    'en_GB-jenny_dioco-medium': 'feminine',
    'en_GB-northern_english_male-medium': 'masculine',
    'en_GB-semaine-medium': 'feminine',
    'en_GB-southern_english_female-low': 'feminine',
    'en_GB-vctk-medium': 'feminine',
    'en_US-amy-medium': 'feminine',
    'en_US-arctic-medium': 'masculine',
    'en_US-bryce-medium': 'masculine',
    'en_US-danny-low': 'masculine',
    'en_US-hfc_female-medium': 'feminine',
    'en_US-hfc_male-medium': 'masculine',
    'en_US-joe-medium': 'masculine',
    'en_US-john-medium': 'masculine',
    'en_US-kathleen-low': 'feminine',
    'en_US-kristin-medium': 'feminine',
    'en_US-kusal-medium': 'masculine',
    'en_US-l2arctic-medium': 'masculine',
    'en_US-lessac-high': 'feminine',
    'en_US-libritts_r-medium': 'feminine',
    'en_US-libritts-high': 'feminine',
    'en_US-ljspeech-high': 'feminine',
    'en_US-mike-medium': 'masculine',
    'en_US-norman-medium': 'masculine',
    'en_US-reza_ibrahim-medium': 'masculine',
    'en_US-ryan-high': 'masculine',
    'en_US-sam-medium': 'feminine',
    'es_AR-daniela-high': 'feminine',
    'es_ES-carlfm-x_low': 'masculine',
    'es_ES-davefx-medium': 'masculine',
    'es_ES-mls_10246-low': 'feminine',
    'es_ES-mls_9972-low': 'feminine',
    'es_ES-sharvard-medium': 'feminine',
    'es_MX-ald-medium': 'masculine',
    'es_MX-claude-high': 'masculine',
    'fr_FR-gilles-low': 'masculine',
    'fr_FR-mls_1840-low': 'masculine',
    'fr_FR-mls-medium': 'feminine',
    'fr_FR-siwis-medium': 'feminine',
    'fr_FR-tom-medium': 'masculine',
    'fr_FR-upmc-medium': 'feminine',
    'ja_JA-hi_fi_captain-medium': 'feminine',
    'nl_BE-nathalie-medium': 'feminine',
    'nl_BE-rdh-medium': 'masculine',
    'nl_NL-alex-medium': 'masculine',
    'nl_NL-mls_5809-low': 'feminine',
    'nl_NL-mls_7432-low': 'feminine',
    'nl_NL-mls-medium': 'feminine',
    'nl_NL-pim-medium': 'masculine',
    'nl_NL-ronnie-medium': 'masculine',
    'zh_CN-chaowen-medium': 'masculine',
    'zh_CN-huayan-medium': 'feminine',
    'zh_CN-xiao_ya-medium': 'feminine'
  };

  return overrides[id] ?? currentGender;
}

function bestQualityOnly(voices) {
  const best = new Map();
  const duplicates = [];

  for (const voice of voices) {
    const familyKey = familyKeyFor(voice.id);
    const existing = best.get(familyKey);
    if (!existing) {
      best.set(familyKey, voice);
      continue;
    }

    if (qualityRank(qualityFor(voice.id)) > qualityRank(qualityFor(existing.id))) {
      duplicates.push(existing);
      best.set(familyKey, voice);
    } else {
      duplicates.push(voice);
    }
  }

  for (const voice of duplicates.sort((a, b) => a.id.localeCompare(b.id))) {
    const kept = best.get(familyKeyFor(voice.id));
    if (kept && kept.id !== voice.id) {
      console.log(`${dryRun ? 'Would remove lower-quality duplicate' : 'Removing lower-quality duplicate'} ${voice.id} for ${kept.id}`);
    }
  }

  return Array.from(best.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function familyKeyFor(id) {
  return id.replace(qualitySuffixPattern, '');
}

function qualityFor(id) {
  return id.match(qualitySuffixPattern)?.[1]?.toLowerCase() ?? 'unknown';
}

function qualityRank(quality) {
  switch (quality) {
    case 'high':
      return 4;
    case 'medium':
      return 3;
    case 'low':
      return 2;
    case 'x_low':
      return 1;
    default:
      return 0;
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(path.resolve(fullPath));
    }
  }

  return files;
}

async function removeEmptyDirs(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await removeEmptyDirs(path.join(directory, entry.name));
    }
  }

  if (directory !== root) {
    await rm(directory, { recursive: false }).catch(() => undefined);
  }
}

function assertInsideRoot(file) {
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove file outside ${root}: ${file}`);
  }
}

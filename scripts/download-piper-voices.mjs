#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

const repo = 'rhasspy/piper-voices';
const revision = 'main';
const defaultRoot = 'en';
const outputRoot = path.resolve('models/piper');
const catalogPath = path.join(outputRoot, 'models.json');
const qualitySuffixPattern = /-(x_low|low|medium|high)$/i;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const voices = await discoverVoices(discoveryRoots(args));
const selected = selectVoices(voices, args);
const limited = args.limit ? selected.slice(0, args.limit) : selected;

if (args.list) {
  for (const voice of limited) {
    console.log(`${voice.id}\t${voice.language}\t${voice.quality}\t${voice.gender ?? 'unknown'}\t${formatBytes(voice.size)}`);
  }
  process.exit(0);
}

if (!args.download) {
  printHelp();
  process.exit(0);
}

if (selected.length === 0) {
  throw new Error('No voices matched the requested filters.');
}

if (!args.all && args.voice.size === 0 && !args.limit) {
  throw new Error('Refusing to download an open-ended selection. Add --all, --limit N, or one or more --voice IDs.');
}

const toDownload = limited;
const catalog = await readCatalog();

console.log(`Selected ${toDownload.length} voice${toDownload.length === 1 ? '' : 's'} (${formatBytes(sumBytes(toDownload))}).`);

for (const voice of toDownload) {
  await downloadVoice(voice, args.dryRun);
  upsertCatalogVoice(catalog, voice);
}

if (!args.dryRun) {
  await mkdir(outputRoot, { recursive: true });
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`Updated ${path.relative(process.cwd(), catalogPath)}.`);
}

function parseArgs(argv) {
  const parsed = {
    all: false,
    allQualities: false,
    download: false,
    dryRun: false,
    help: false,
    language: new Set(),
    list: false,
    quality: new Set(),
    root: new Set(),
    voice: new Set(),
    limit: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case '--all':
        parsed.all = true;
        break;
      case '--all-qualities':
        parsed.allQualities = true;
        break;
      case '--download':
        parsed.download = true;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--language':
        parsed.language.add(next());
        break;
      case '--list':
        parsed.list = true;
        break;
      case '--quality':
        parsed.quality.add(next());
        break;
      case '--root':
        parsed.root.add(next());
        break;
      case '--voice':
        parsed.voice.add(next());
        break;
      case '--limit':
        parsed.limit = Number.parseInt(next(), 10);
        if (!Number.isInteger(parsed.limit) || parsed.limit <= 0) {
          throw new Error('--limit must be a positive integer.');
        }
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

async function discoverVoices(roots) {
  const voices = [];

  for (const root of roots) {
    const files = await fetchTree(`https://huggingface.co/api/models/${repo}/tree/${revision}/${root}?recursive=true`);
    const filePaths = new Set(files.filter((file) => file.type === 'file').map((file) => file.path));
    voices.push(...files
      .filter((file) => file.type === 'file' && file.path.endsWith('.onnx') && !file.path.endsWith('.onnx.json') && filePaths.has(`${file.path}.json`))
      .map((file) => toVoice(file, root)));
  }

  return voices.sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchTree(firstUrl) {
  const entries = [];
  let url = firstUrl;

  while (url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Hugging Face tree request failed with ${response.status}`);
    }

    entries.push(...(await response.json()));
    url = nextLink(response.headers.get('link'));
  }

  return entries;
}

function nextLink(linkHeader) {
  if (!linkHeader) {
    return undefined;
  }

  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function toVoice(file, root) {
  const id = path.basename(file.path, '.onnx');
  const relativePath = file.path.replace(new RegExp(`^${root}/?`), '');
  const segments = relativePath.split('/');
  const language = segments[0] ?? id.split('-')[0];
  const quality = segments.at(-2) ?? id.split('-').at(-1) ?? 'unknown';
  const lowerPath = file.path.toLowerCase();
  const gender = lowerPath.includes('female') ? 'feminine' : lowerPath.includes('male') ? 'masculine' : undefined;

  return {
    id,
    familyKey: id.replace(qualitySuffixPattern, ''),
    label: titleCase(id.replace(/^[a-z]{2}_[A-Z]{2}-/, '').replace(qualitySuffixPattern, '').replace(/[_-]/g, ' ')),
    language,
    gender,
    quality,
    remotePath: file.path,
    localPath: relativePath,
    size: file.lfs?.size ?? file.size ?? 0
  };
}

function selectVoices(voices, filters) {
  const matching = voices.filter((voice) => {
    if (filters.voice.size > 0 && !filters.voice.has(voice.id)) {
      return false;
    }

    if (filters.language.size > 0 && !matchesLanguageFilter(voice, filters.language)) {
      return false;
    }

    if (filters.quality.size > 0 && !filters.quality.has(voice.quality)) {
      return false;
    }

    return true;
  });

  if (filters.allQualities || filters.voice.size > 0 || filters.quality.size > 0) {
    return matching;
  }

  return bestQualityOnly(matching);
}

function discoveryRoots(filters) {
  if (filters.root.size > 0) {
    return Array.from(filters.root).sort();
  }

  const languageRoots = Array.from(filters.language)
    .map((language) => language.split('_')[0])
    .filter(Boolean);

  return languageRoots.length > 0 ? Array.from(new Set(languageRoots)).sort() : [defaultRoot];
}

function matchesLanguageFilter(voice, languages) {
  for (const language of languages) {
    if (voice.language === language || voice.language.startsWith(`${language}_`)) {
      return true;
    }
  }

  return false;
}

function bestQualityOnly(voices) {
  const best = new Map();

  for (const voice of voices) {
    const existing = best.get(voice.familyKey);
    if (!existing || qualityRank(voice.quality) > qualityRank(existing.quality)) {
      best.set(voice.familyKey, voice);
    }
  }

  return Array.from(best.values()).sort((a, b) => a.id.localeCompare(b.id));
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

async function downloadVoice(voice, dryRun) {
  const modelTarget = path.join(outputRoot, voice.localPath);
  const configTarget = `${modelTarget}.json`;

  console.log(`${dryRun ? 'Would download' : 'Downloading'} ${voice.id} -> ${path.relative(process.cwd(), modelTarget)}`);

  if (dryRun) {
    return;
  }

  await downloadFile(voice.remotePath, modelTarget);
  await downloadFile(`${voice.remotePath}.json`, configTarget);
}

async function downloadFile(remotePath, targetPath) {
  const existing = await stat(targetPath).catch(() => undefined);
  if (existing && existing.size > 0) {
    return;
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp`;
  const url = `https://huggingface.co/${repo}/resolve/${revision}/${remotePath}?download=true`;
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${remotePath} with ${response.status}`);
  }

  await finished(Readable.fromWeb(response.body).pipe(createWriteStream(tempPath)));
  await rename(tempPath, targetPath);
}

async function readCatalog() {
  const fallback = { defaultVoiceId: 'en_GB-northern_english_male-medium', voices: [] };
  const raw = await readFile(catalogPath, 'utf8').catch(() => undefined);
  if (!raw) {
    return fallback;
  }

  const parsed = JSON.parse(raw);
  return {
    defaultVoiceId: parsed.defaultVoiceId ?? fallback.defaultVoiceId,
    voices: Array.isArray(parsed.voices) ? parsed.voices : []
  };
}

function upsertCatalogVoice(catalog, voice) {
  const modelPath = `./${voice.localPath.replaceAll(path.sep, '/')}`;
  if (catalog.voices.some((existing) => existing.id === voice.id)) {
    return;
  }

  catalog.voices.push({
    id: voice.id,
    label: voice.label,
    language: voice.language,
    ...(voice.gender ? { gender: voice.gender } : {}),
    modelPath
  });
  catalog.voices.sort((a, b) => a.id.localeCompare(b.id));
}

function sumBytes(voices) {
  return voices.reduce((sum, voice) => sum + voice.size, 0);
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${bytes} B`;
}

function titleCase(input) {
  return input.replace(/\b\w/g, (character) => character.toUpperCase());
}

function printHelp() {
  console.log(`Usage:
  npm run voices:list -- [filters]
  npm run voices:download -- --voice en_US-amy-medium
  npm run voices:download -- --language en_US --quality medium --limit 5

Options:
  --list                  List matching voices.
  --download              Download matching voices and update models/piper/models.json.
  --voice <id>            Select an exact Piper voice ID. Can be repeated.
  --language <language>   Filter by language, such as en, en_US, or en_GB. Can be repeated.
  --root <folder>         Search a top-level Hugging Face folder, such as de or fr.
  --quality <quality>     Filter by x_low, low, medium, or high. Can be repeated.
  --limit <n>             Limit how many matching voices are downloaded.
  --all                   Allow downloading all matching voices.
  --all-qualities         Include every quality variant instead of best quality only.
  --dry-run               Show what would download without writing files.

By default, voices are grouped by family and only the highest available quality
is selected. Use --all-qualities to list or download x_low/low/medium/high variants.
`);
}

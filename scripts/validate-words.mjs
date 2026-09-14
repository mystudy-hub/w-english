#!/usr/bin/env node
// Node 24 native type stripping keeps the CLI and browser on one Zod contract.
import { readFileSync } from 'node:fs';
import { wordsSchema, validateCatalog } from '../src/data/content-schema.ts';
import { loadActiveCatalog } from './lib/catalog-source.mjs';

const args = process.argv.slice(2);
let file = 'data/sample_words.json';
let themeFile;
let release = false;
let fileSeen = false;
let useCatalog = false;
try {
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--release') release = true;
    else if (argument === '--catalog') useCatalog = true;
    else if (argument === '--theme') {
      themeFile = args[++index];
      if (!themeFile || themeFile.startsWith('--')) throw new Error('--theme 需要文件路径');
    } else if (argument.startsWith('--') || fileSeen) throw new Error('未知参数 ' + argument);
    else { file = argument; fileSeen = true; }
  }
  if (useCatalog && (fileSeen || themeFile)) throw new Error('--catalog 不能与单独词库路径同时使用');
  if (useCatalog) file = 'data/catalog.json';
  const words = useCatalog ? (await loadActiveCatalog(release)).words : wordsSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (!useCatalog && themeFile) validateCatalog(words, [JSON.parse(readFileSync(themeFile, 'utf8'))], release);
  else if (!useCatalog && release) {
    const pending = words.filter((word) => word.review.status !== 'audio_approved' || word.illustration.type !== 'image');
    if (pending.length) throw new Error(pending.map((word) => word.wordId + ': 正式包须有 audio_approved 和本地图片').join('\n'));
  }
  const statuses = words.reduce((result, word) => ({ ...result, [word.review.status]: (result[word.review.status] ?? 0) + 1 }), {});
  console.log('✓ ' + file + ': ' + words.length + ' 词通过校验' + (release ? '（正式包模式）' : '') + '；审核状态 ' + JSON.stringify(statuses));
} catch (error) {
  console.error('✗ ' + file + ': ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}

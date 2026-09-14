import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { audioReferences, manifestSchema, themeSchema, wordsSchema, type AssetRecord, type SpriteManifest, type ThemeConfig } from '../../src/data/content-schema.ts';
import { CORE_GUIDE_REFS, guideAudioRefs } from '../../src/domain/guide-content.ts';
import { makeContentPacks } from '../../src/domain/content-scopes.ts';

// Nonlinguistic test signals exist only in mocked HTTP responses, never public/ or audio-source/.
function wave(clips: number, tone: number) {
  const rate = 24000; const samples = Math.ceil((clips * 0.5 + 0.15) * rate);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let sample = 0; sample < samples; sample++) {
    const phase = sample / rate % 0.5;
    const value = phase >= 0.15 && phase < 0.35 ? Math.sin(sample / rate * Math.PI * 2 * tone) * 3000 : 0;
    bytes.writeInt16LE(Math.round(value), 44 + sample * 2);
  }
  return bytes;
}
export function syntheticContent({ audio = true, version = '2026.09.1', tone = 440, scenes = false, fullCatalog = false, omitSprites = [] as string[], retiredWordIds = [] as string[] } = {}) {
  const multiScene = scenes || fullCatalog;
  const words = wordsSchema.parse(JSON.parse(readFileSync(resolve(fullCatalog ? 'data/stage2_words.json' : scenes ? 'data/stage1_words.json' : 'data/stage0_words.json'), 'utf8'))).filter((word) => !retiredWordIds.includes(word.wordId)).map((word) => ({ ...word, contentVersion: version }));
  const source = { ...themeSchema.parse(JSON.parse(readFileSync(resolve(scenes ? 'data/stage1_theme.json' : 'data/stage0_theme.json'), 'utf8'))), contentVersion: version };
  source.wordIds = source.wordIds.filter((id) => !retiredWordIds.includes(id)); source.listenTapWordIds = source.listenTapWordIds.filter((id) => !retiredWordIds.includes(id));
  source.pages = source.pages.map((page) => page.filter((id) => !retiredWordIds.includes(id))).filter((page) => page.length);
  source.confusablePairs = source.confusablePairs.filter(([a, b]) => !retiredWordIds.includes(a) && !retiredWordIds.includes(b));
  const themes: ThemeConfig[] = fullCatalog ? ['animal_home', 'sunny_garden', 'happy_school'].map((id) => {
    const original = themeSchema.parse(JSON.parse(readFileSync(resolve(`data/stage2_${id}.json`), 'utf8')));
    return { ...original, contentVersion: version, wordIds: original.wordIds.filter((word) => !retiredWordIds.includes(word)),
      pages: original.pages.map((page) => page.filter((word) => !retiredWordIds.includes(word))).filter((page) => page.length),
      listenTapWordIds: original.listenTapWordIds.filter((word) => !retiredWordIds.includes(word)),
      confusablePairs: original.confusablePairs.filter(([a, b]) => !retiredWordIds.includes(a) && !retiredWordIds.includes(b)) };
  }) : scenes ? (['animal_home', 'sunny_garden', 'happy_school'] as const).map((id, index, ids) => {
    const selected = words.slice(index * 7, index === 2 ? undefined : (index + 1) * 7); const wordIds = selected.map((word) => word.wordId);
    for (const word of selected) {
      word.audio = { word: `${id}#${word.word}`, wordSlow: `${id}#${word.word}_slow` }; word.example = { ...word.example, audio: `${id}#${word.word}_sentence` };
    }
    return { ...source, themeId: id, title: { zh: ['动物之家', '阳光花园', '快乐学校'][index]!, en: id }, wordIds,
      pages: [wordIds.slice(0, 5), wordIds.slice(5)].filter((page) => page.length), listenTapWordIds: wordIds,
      confusablePairs: source.confusablePairs.filter(([a, b]) => wordIds.includes(a) && wordIds.includes(b)),
      spriteIds: [id, 'phonics', 'guide', 'sfx'], unlock: { prerequisiteThemeId: index ? ids[index - 1]! : null, requiredFirstCorrect: index ? 5 : 0 } };
  }) : [source];
  const theme = themes[0]!;
  const files = new Map<string, { bytes: Buffer; mime: string }>();
  const assets: Record<string, AssetRecord> = {};
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const add = (id: string, bytes: Buffer, prefix: string, extension: string, mime: string) => {
    const sha256 = hash(bytes); const url = `content/${prefix}.${sha256.slice(0, 16)}.${extension}`;
    assets[id] = { url, sha256, bytes: bytes.length, mime }; files.set(url, { bytes, mime }); return id;
  };
  for (const word of words) if (word.illustration.type === 'image') add(word.illustration.src, readFileSync(resolve('assets/illustrations', `${word.word}.svg`)), `images/${word.word}`, 'svg', 'image/svg+xml');
  const refs = [...new Set([...words.flatMap(audioReferences), ...guideAudioRefs(multiScene ? 2 : 1), ...(fullCatalog ? CORE_GUIDE_REFS : [])])];
  const sprites: Record<string, string> = {};
  if (audio) {
    for (const id of new Set(refs.map((ref) => ref.split('#')[0]!))) {
      if (omitSprites.includes(id)) continue;
      const clips = refs.filter((ref) => ref.startsWith(`${id}#`));
      const audioId = add(`audio:${id}`, wave(clips.length, tone), `audio/${id}`, 'wav', 'audio/wav');
      const sprite: SpriteManifest = { audioAssetId: audioId, durationMs: clips.length * 500 + 150, sampleRate: 24000, channels: 1,
        sprite: Object.fromEntries(clips.map((ref, index) => [ref.split('#')[1]!, [150 + index * 500, 200]])) };
      sprites[id] = add(`sprite:${id}`, Buffer.from(JSON.stringify(sprite)), `sprites/${id}`, 'json', 'application/json');
    }
  }
  const catalogAssetId = add('catalog', Buffer.from(JSON.stringify({ words, themes })), 'catalog', 'json', 'application/json');
  const manifest = manifestSchema.parse({ manifestVersion: 1, schemaVersion: 3, contentVersion: version, stage: multiScene ? 2 : undefined,
    appContract: { min: multiScene ? 2 : 1, max: multiScene ? 2 : 1 }, assets, sprites,
    packs: multiScene ? makeContentPacks({ assets, sprites, words, themes }) : [{ id: 'animal_home', themeId: 'animal_home', dependsOn: [], assetIds: Object.keys(assets) }],
    catalogAssetId, missingAudio: refs.filter((ref) => !sprites[ref.split('#')[0]!]), mode: 'preview' });
  const manifestBytes = Buffer.from(JSON.stringify(manifest)); const manifestHash = hash(manifestBytes);
  const manifestUrl = `content/manifest.${manifestHash.slice(0, 16)}.json`;
  files.set(manifestUrl, { bytes: manifestBytes, mime: 'application/json' });
  files.set('content/index.json', { bytes: Buffer.from(JSON.stringify({ manifestUrl, sha256: manifestHash })), mime: 'application/json' });
  return { words, theme, themes, manifest, files, manifestHash };
}

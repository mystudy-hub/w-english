import { describe, expect, it } from 'vitest';
import samples from '../data/sample_words.json';
import { manifestSchema, spriteSchema, themeSchema, validateCatalog, wordsSchema } from '../src/data/content-schema.ts';
import { theme, words } from './fixtures.ts';

describe('content contract', () => {
  it('accepts current CVC candidates and advanced structural samples', () => {
    expect(validateCatalog(words, [theme]).words).toHaveLength(10);
    expect(wordsSchema.parse(samples)).toHaveLength(5);
  });
  it.each([null, {}, [], [null], [42]])('rejects malformed or empty root %j', (value) => {
    expect(wordsSchema.safeParse(value).success).toBe(false);
  });
  it('requires actual individual letters, not only matching concatenation', () => {
    expect(wordsSchema.safeParse([{ ...words[0], spelling: ['cat'] }]).success).toBe(false);
  });
  it('rejects fake CVC and sight entries carrying a phonics stage', () => {
    const fox = { ...words[0], word: 'fox', wordId: 'w_fox_999', spelling: ['f', 'o', 'x'], syllables: ['fox'],
      graphemes: [{ letters: 'f', phonemes: ['f'], audio: 'phonics#f' }, { letters: 'o', phonemes: ['ɑ'], audio: 'phonics#o_short' }, { letters: 'x', phonemes: ['k', 's'], audio: 'phonics#x' }], phonemes: ['f', 'ɑ', 'k', 's'] };
    expect(wordsSchema.safeParse([fox]).success).toBe(false);
    expect(wordsSchema.safeParse([{ ...words[0], track: 'sight' }]).success).toBe(false);
  });
  it('rejects duplicate identities and reordered sounds', () => {
    expect(wordsSchema.safeParse([words[0], words[0]]).success).toBe(false);
    expect(wordsSchema.safeParse([{ ...words[0], phonemes: ['t', 'æ', 'k'] }]).success).toBe(false);
  });
  it('requires real approval metadata and release-ready pictures', () => {
    expect(wordsSchema.safeParse([{ ...words[0], review: { status: 'audio_approved', reviewer: 'Test fixture' } }]).success).toBe(false);
    expect(() => validateCatalog(words, [theme], true)).toThrow('audio_approved');
  });
  it('rejects a dangling audio reference namespace and missing scene words', () => {
    expect(() => validateCatalog(words, [{ ...theme, spriteIds: ['phonics'] }])).toThrow('未声明精灵');
    expect(() => validateCatalog(words.slice(1), [theme])).toThrow('缺少词');
  });
  it('checks page coverage, whitelist membership, and version identity', () => {
    expect(themeSchema.safeParse({ ...theme, pages: [theme.pages[0], theme.pages[0]] }).success).toBe(false);
    expect(themeSchema.safeParse({ ...theme, listenTapWordIds: ['w_missing_999'] }).success).toBe(false);
    expect(() => validateCatalog(words, [{ ...theme, contentVersion: '2026.10.1' }])).toThrow('版本不符');
  });
  it('rejects a scene whose distractor exclusions make every question impossible', () => {
    const pairs: [string, string][] = [];
    for (let a = 0; a < theme.wordIds.length; a++) for (let b = a + 1; b < theme.wordIds.length; b++) pairs.push([theme.wordIds[a]!, theme.wordIds[b]!]);
    expect(() => validateCatalog(words, [{ ...theme, confusablePairs: pairs }])).toThrow('无法组成');
  });
});

describe('sprite and manifest invariants', () => {
  const sprite = { audioAssetId: 'voice', durationMs: 2000, sampleRate: 24000, channels: 1,
    sprite: { first: [150, 400], second: [850, 500] } };
  it('rejects negative, empty, overlapping and out-of-bounds clips', () => {
    expect(spriteSchema.safeParse(sprite).success).toBe(true);
    for (const clips of [{ bad: [-1, 20] }, {}, { a: [100, 500], b: [400, 500] }, { end: [1500, 600] }]) {
      expect(spriteSchema.safeParse({ ...sprite, sprite: clips }).success).toBe(false);
    }
  });
  const manifest = { manifestVersion: 1, schemaVersion: 3, contentVersion: '2026.09.1', appContract: { min: 1, max: 1 },
    assets: { catalog: { url: 'content/catalog.a.json', bytes: 100, sha256: 'a'.repeat(64), mime: 'application/json' } },
    sprites: {}, packs: [{ id: 'base', themeId: 'animal_home', dependsOn: [], assetIds: ['catalog'] }],
    catalogAssetId: 'catalog', missingAudio: [], mode: 'preview' };
  it('requires safe asset URLs and a resolvable dependency graph', () => {
    expect(manifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifestSchema.safeParse({ ...manifest, assets: { catalog: { ...manifest.assets.catalog, url: 'content/../../secret.json' } } }).success).toBe(false);
    expect(manifestSchema.safeParse({ ...manifest, packs: [{ ...manifest.packs[0], dependsOn: ['base'] }] }).success).toBe(false);
    expect(manifestSchema.safeParse({ ...manifest, sprites: { phonics: 'missing' } }).success).toBe(false);
    expect(manifestSchema.safeParse({ ...manifest, mode: 'release', missingAudio: ['phonics#p'] }).success).toBe(false);
  });
});

// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadActiveCatalog } from '../scripts/lib/catalog-source.mjs';
import { audioInventory } from '../scripts/lib/audio-inventory.mjs';
import { readIllustration, verifyIllustrationLicenses } from '../scripts/lib/illustrations.mjs';
import { sha256 } from '../scripts/lib/files.mjs';
import { chooseOptions } from '../src/domain/questions.ts';
import { createSpellingSession } from '../src/domain/spelling.ts';
import { configSnapshot, LEVELS } from '../src/domain/config.ts';

const catalog = await loadActiveCatalog();
describe('Stage 2 publication candidate', () => {
  it('contains one hundred distinct words in three scenes and preserves all established identities', async () => {
    const { words, themes, source } = catalog;
    expect(source.stage).toBe(2); expect(words).toHaveLength(100); expect(new Set(words.map((word) => word.word)).size).toBe(100);
    expect(themes.map((theme) => theme.wordIds.length)).toEqual([34, 33, 33]);
    const original = JSON.parse(await readFile('data/stage1_words.json', 'utf8'));
    expect(words.slice(0, 20).map((word) => word.wordId)).toEqual(original.map((word) => word.wordId));
    const samples = JSON.parse(await readFile('data/sample_words.json', 'utf8'));
    for (const sample of samples) expect(words.find((word) => word.word === sample.word).wordId).toBe(sample.wordId);
  });
  it('keeps whole-word entries out of spelling and phoneme production and verifies six level/mode combinations', () => {
    const { words, themes } = catalog; const inventory = audioInventory(words, 2);
    expect(words.filter((word) => word.track === 'sight')).toHaveLength(11);
    expect(inventory.filter((clip) => ['word', 'slow', 'sentence'].includes(clip.kind))).toHaveLength(300);
    expect(inventory.some((clip) => clip.ref === 'phonics#one_onset')).toBe(false);
    for (const mode of ['tap', 'drag']) for (const level of ['L1', 'L2', 'L3']) for (const theme of themes) {
      const session = createSpellingSession({ id: 'test', now: 1, words, theme, progress: [], readyIds: new Set(words.map((word) => word.wordId)), random: () => .4, config: configSnapshot(mode, level) });
      expect(session).not.toBeNull(); expect(session.questions.length).toBeLessThanOrEqual(5);
      for (const question of session.questions) {
        const word = words.find((word) => word.wordId === question.wordId);
        expect(word.track).toBe('phonics'); expect(word.phonicsStage).toBeLessThanOrEqual(LEVELS[level].phonicsStage);
      }
    }
  });
  it('can build unambiguous listen options for every whitelisted word', () => {
    for (const theme of catalog.themes) {
      const pool = catalog.words.filter((word) => theme.listenTapWordIds.includes(word.wordId));
      for (const target of pool) for (const count of [3, 4]) {
        const options = chooseOptions(target, pool, count, theme, () => .4); expect(options).toHaveLength(count);
        for (const [a, b] of theme.confusablePairs) expect(options.includes(a) && options.includes(b)).toBe(false);
      }
    }
  });
  it('has actual image bytes and bundled license evidence for every word', async () => {
    const assets = {}; const records = [];
    for (const word of catalog.words) {
      const image = await readIllustration(word);
      expect(sha256(image.bytes)).toBe(image.license.sha256);
      assets[word.illustration.src] = { sha256: image.license.sha256 };
      const licenseAssetIds = image.evidence.map((proof) => { const id = `license:${proof.id}`; assets[id] = { mime: 'text/plain' }; return id; });
      records.push({ assetId: word.illustration.src, ...image.license, licenseAssetIds });
    }
    expect(() => verifyIllustrationLicenses(catalog.words, assets, records, true)).not.toThrow();
    const broken = structuredClone(records); broken[0].licenseAssetIds = ['missing'];
    expect(() => verifyIllustrationLicenses(catalog.words, assets, broken, true)).toThrow('未随包');
    const changed = structuredClone(records); changed[0].sha256 = '0'.repeat(64);
    expect(() => verifyIllustrationLicenses(catalog.words, assets, changed, true)).toThrow('指纹');
  });
});

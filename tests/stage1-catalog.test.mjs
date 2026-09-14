// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { validateCatalog } from '../src/data/content-schema.ts';
import { audioInventory } from '../scripts/lib/audio-inventory.mjs';
import { chooseOptions } from '../src/domain/questions.ts';

const stage1 = () => validateCatalog(JSON.parse(readFileSync('data/stage1_words.json', 'utf8')), [JSON.parse(readFileSync('data/stage1_theme.json', 'utf8'))]);
it('provides all twenty specified CVC words while preserving the original ten identities', () => {
  const { words, themes } = stage1();
  expect(words).toHaveLength(20);
  expect(words.map((word) => word.word)).toEqual(['cat','dog','pig','hen','sun','bed','bag','cup','hat','pen','rat','bat','ram','bug','map','cap','pan','net','log','pot']);
  const baseline = JSON.parse(readFileSync('data/stage0_words.json', 'utf8'));
  expect(words.slice(0, 10).map((word) => word.wordId)).toEqual(baseline.map((word) => word.wordId));
  expect(words.every((word) => word.review.status === 'draft' && word.phonicsStage === 1)).toBe(true);
  expect(themes[0].pages.map((page) => page.length)).toEqual([5,5,5,5]);
  for (const word of words) expect(readFileSync(`assets/illustrations/${word.word}.svg`, 'utf8')).toContain('<svg');
  expect(audioInventory(words).filter((clip) => clip.kind === 'phoneme')).toHaveLength(17);
});

it('keeps hat/cap and the confusing container pairs out of the same question', () => {
  const { words, themes } = stage1();
  const theme = themes[0];
  for (const target of words) for (const count of [3,4]) {
    const options = chooseOptions(target, words, count, theme, () => 0.4);
    expect(options).toHaveLength(count);
    for (const [a,b] of theme.confusablePairs) expect(options.includes(a) && options.includes(b)).toBe(false);
  }
});

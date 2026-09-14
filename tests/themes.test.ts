import { describe, expect, it } from 'vitest';
import { themeAccess } from '../src/domain/themes.ts';
import { validateCatalog } from '../src/data/content-schema.ts';
import { syntheticContent } from './helpers/synthetic-content.ts';

describe('theme unlocks', () => {
  it('requires five distinct first-correct words in the prerequisite scene', () => {
    const { themes } = syntheticContent({ scenes: true }); const root = themes[0]!; const next = themes[1]!;
    expect(themeAccess(root, themes, []).unlocked).toBe(true);
    const completed = root.wordIds.slice(0, 5).map((wordId) => ({ wordId, heardCount: 1, firstCorrectAt: 100 }));
    expect(themeAccess(next, themes, completed.slice(1)).unlocked).toBe(false);
    expect(themeAccess(next, themes, [completed[0]!, completed[0]!, completed[1]!, completed[2]!, completed[3]!]).unlocked).toBe(false);
    expect(themeAccess(next, themes, completed).unlocked).toBe(true);
    expect(themeAccess(themes[2]!, themes, completed).unlocked).toBe(false);
    expect(themeAccess(next, themes, completed.map((entry) => ({ ...entry, firstCorrectAt: undefined, exploredAt: 100 }))).unlocked).toBe(false);
  });
  it('rejects dangling or cyclic prerequisites and impossible unlock thresholds', () => {
    const { words, themes } = syntheticContent({ scenes: true });
    expect(() => validateCatalog(words, themes)).not.toThrow();
    const missing = structuredClone(themes); missing[1]!.unlock.prerequisiteThemeId = 'missing';
    expect(() => validateCatalog(words, missing)).toThrow('不存在');
    const cycle = structuredClone(themes); cycle[0]!.unlock.prerequisiteThemeId = cycle[2]!.themeId;
    expect(() => validateCatalog(words, cycle)).toThrow('循环');
    const impossible = structuredClone(themes); impossible[1]!.unlock.requiredFirstCorrect = 99;
    expect(() => validateCatalog(words, impossible)).toThrow('无法达到');
  });
});

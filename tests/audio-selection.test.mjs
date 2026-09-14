// @vitest-environment node
import { expect, it } from 'vitest';
import { loadActiveCatalog } from '../scripts/lib/catalog-source.mjs';
import { parseAudioOptions, selectAudioClips } from '../scripts/lib/audio-selection.mjs';

it('selects complete scene sprites and common dependencies without unrelated scene recordings', async () => {
  const catalog = await loadActiveCatalog();
  const all = selectAudioClips(catalog);
  const selected = selectAudioClips(catalog, { theme: 'animal_home' });
  expect(selected.partial).toBe(true);
  expect(selected.spriteIds).toEqual(expect.arrayContaining(['animal_home', 'animal_home_extra', 'guide', 'phonics', 'ui_guide']));
  expect(selected.spriteIds.some((id) => id.startsWith('sunny_garden') || id.startsWith('happy_school'))).toBe(false);
  expect(selected.clips.filter((clip) => clip.kind === 'phoneme')).toEqual(all.clips.filter((clip) => clip.kind === 'phoneme'));
  for (const clip of selected.clips.filter((clip) => clip.derivedFrom)) expect(selected.clips.some((source) => source.ref === clip.derivedFrom)).toBe(true);
});
it('allows independent guide production and rejects ambiguous or invalid selections', async () => {
  const catalog = await loadActiveCatalog(); const guide = selectAudioClips(catalog, parseAudioOptions(['--sprite', 'guide']));
  expect(guide.clips).toHaveLength(12); expect(guide.clips.every((clip) => clip.kind === 'guide')).toBe(true);
  expect(() => parseAudioOptions(['--theme', 'animal_home', '--sprite', 'guide'])).toThrow();
  expect(() => selectAudioClips(catalog, { theme: 'missing' })).toThrow('未知场景');
  expect(() => selectAudioClips(catalog, { sprite: '../guide' })).toThrow('名称无效');
  expect(() => selectAudioClips(catalog, { sprite: 'sfx' })).toThrow('未知语音精灵');
});

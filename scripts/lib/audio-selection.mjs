import { parseArgs } from 'node:util';
import { audioInventory } from './audio-inventory.mjs';
import { CORE_GUIDE_SPRITE } from '../../src/domain/guide-content.ts';

export function parseAudioOptions(args) {
  const { values } = parseArgs({ args, options: { theme: { type: 'string' }, sprite: { type: 'string' }, help: { type: 'boolean' } }, strict: true, allowPositionals: false });
  if (values.theme && values.sprite) throw new Error('--theme 与 --sprite 请只选择一种');
  return values;
}
export function selectAudioClips({ words, themes, source }, options = {}) {
  const all = audioInventory(words, source.stage);
  const available = new Set(all.map((clip) => clip.ref.split('#')[0]));
  const partial = options.theme !== undefined || options.sprite !== undefined;
  const identifiers = (input) => {
    const ids = [...new Set(input.split(',').map((value) => value.trim()))];
    if (ids.some((id) => !/^[a-z_]+$/.test(id))) throw new Error('场景或精灵名称无效');
    return ids;
  };
  let selected = available; let name = 'all';
  if (options.theme !== undefined) {
    const requested = identifiers(options.theme);
    for (const id of requested) if (!themes.some((theme) => theme.themeId === id)) throw new Error(`未知场景 ${id}`);
    selected = new Set(themes.filter((theme) => requested.includes(theme.themeId)).flatMap((theme) => theme.spriteIds).filter((id) => available.has(id)));
    if (available.has(CORE_GUIDE_SPRITE)) selected.add(CORE_GUIDE_SPRITE);
    name = `theme-${requested.join('-')}`;
  } else if (options.sprite !== undefined) {
    const requested = identifiers(options.sprite);
    for (const id of requested) if (!available.has(id)) throw new Error(`未知语音精灵 ${id}`);
    selected = new Set(requested); name = `sprite-${requested.join('-')}`;
  }
  // Whole sprites keep shared phonemes and derived slow clips consistent across batches.
  return { clips: all.filter((clip) => selected.has(clip.ref.split('#')[0])), spriteIds: [...selected], partial, name };
}

import { audioReferences, type AssetRecord, type ContentManifest, type ThemeConfig, type WordEntry } from '../data/content-schema.ts';
import { guideAudioRefs } from './guide-content.ts';

export const SUPPORTED_CONTENT_CONTRACTS = [1, 2] as const;
export function themeAssetIds(manifest: ContentManifest, themeIds: readonly string[]): Set<string> {
  const packs = new Map(manifest.packs.map((pack) => [pack.id, pack]));
  const assets = new Set<string>([manifest.catalogAssetId]); const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const pack = packs.get(id); if (!pack) throw new Error(`缺少依赖包 ${id}`);
    visited.add(id);
    for (const dependency of pack.dependsOn) visit(dependency);
    for (const asset of pack.assetIds) assets.add(asset);
  };
  for (const pack of manifest.packs) if (pack.themeId === null) visit(pack.id);
  for (const themeId of themeIds) {
    const selected = manifest.packs.filter((pack) => pack.themeId === themeId);
    if (!selected.length) throw new Error(`场景没有资源包 ${themeId}`);
    for (const pack of selected) visit(pack.id);
  }
  return assets;
}
export function themeAudioRefs(words: readonly WordEntry[], themes: readonly ThemeConfig[], themeIds: readonly string[], stage = 1): string[] {
  const allowed = new Set(themes.filter((theme) => themeIds.includes(theme.themeId)).flatMap((theme) => theme.wordIds));
  return [...new Set([...words.filter((word) => allowed.has(word.wordId)).flatMap(audioReferences), ...guideAudioRefs(stage)])];
}
export function makeContentPacks(input: {
  assets: Record<string, AssetRecord>; sprites: Record<string, string>; themes: readonly ThemeConfig[]; words: readonly WordEntry[];
}): ContentManifest['packs'] {
  const uses = new Map<string, number>();
  for (const theme of input.themes) for (const id of new Set(theme.spriteIds)) uses.set(id, (uses.get(id) ?? 0) + 1);
  const common = new Set(Object.keys(input.assets));
  const packs = input.themes.map((theme) => {
    const ids = new Set<string>();
    for (const word of input.words) if (theme.wordIds.includes(word.wordId) && word.illustration.type === 'image' && input.assets[word.illustration.src]) ids.add(word.illustration.src);
    for (const id of theme.spriteIds) if (id !== 'guide' && id !== 'sfx' && id !== 'phonics' && (uses.get(id) ?? 0) === 1) {
      if (input.sprites[id]) ids.add(input.sprites[id]!);
      if (input.assets[`audio:${id}`]) ids.add(`audio:${id}`);
    }
    for (const id of ids) common.delete(id);
    return { id: theme.themeId, themeId: theme.themeId, dependsOn: ['common'], assetIds: [...ids] };
  });
  return [{ id: 'common', themeId: null, dependsOn: [], assetIds: [...common] }, ...packs];
}

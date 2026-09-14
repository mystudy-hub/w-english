import { z } from 'zod';
import { assetSchema, spriteSchema } from '../data/content-schema.ts';
import { digest } from './content-packs.ts';
import type { AudioEngine } from './audio-engine.ts';
import { withRequestDeadline } from './request-deadline.ts';

const coreSchema = z.strictObject({
  coreVersion: z.literal(1), assets: z.record(z.string(), assetSchema),
  sprites: z.record(z.string().regex(/^(sfx|guide|ui_guide)$/), spriteSchema),
});
export async function loadCoreAudio(audio: AudioEngine, baseUrl: string) {
  const core = await withRequestDeadline(5000, async (signal) => {
    const response = await fetch(new URL('core/index.json', baseUrl), { signal });
    if (response.status !== 200) throw new Error('核心音频索引不可用');
    return coreSchema.parse(await response.json());
  });
  for (const sprite of Object.values(core.sprites)) {
    const asset = core.assets[sprite.audioAssetId];
    if (!asset || !asset.url.startsWith('core/')) throw new Error('核心音频清单不完整');
    const bytes = await withRequestDeadline(5000, async (signal) => {
      const file = await fetch(new URL(asset.url, baseUrl), { cache: 'force-cache', signal });
      if (file.status !== 200) throw new Error('核心音频不可用');
      return file.arrayBuffer();
    });
    if (bytes.byteLength !== asset.bytes || await digest(bytes) !== asset.sha256) throw new Error('核心音频校验失败');
  }
  audio.registerCore(core, core.sprites);
  await audio.preload(Object.keys(core.sprites));
  return true;
}

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { audioReferences, manifestSchema, spriteSchema, validateCatalog } from '../src/data/content-schema.ts';
import { readJson, sha256, within } from './lib/files.mjs';
import { audioBuildSchema, verifyClipApprovals } from './lib/audio-audit.mjs';
import { audioInventory } from './lib/audio-inventory.mjs';
import { probeAudio, truePeak, verifyDecodedAudio } from './lib/audio-production.mjs';
import { verifyContentApprovals } from './lib/content-audit.mjs';
import { builtinSfx } from './lib/builtin-sfx.mjs';
import { verifyIllustrationLicenses } from './lib/illustrations.mjs';

try {
  const root = resolve('public');
  const index = await readJson('public/content/index.json');
  if (!/^content\/manifest\.[a-f0-9]+\.json$/.test(index.manifestUrl)) throw new Error('清单索引路径非法');
  const manifestBytes = await readFile(within(root, index.manifestUrl));
  if (sha256(manifestBytes) !== index.sha256) throw new Error('清单哈希不符');
  const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString()));
  const allowPending = process.argv.includes('--preview');
  for (const [id, asset] of Object.entries(manifest.assets)) {
    const bytes = await readFile(within(root, asset.url));
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error(`${id}: 大小或哈希不符`);
  }
  const catalog = await readJson(within(root, manifest.assets[manifest.catalogAssetId].url));
  const { words } = validateCatalog(catalog.words, catalog.themes, !allowPending);
  if (!manifest.assets.licenses) throw new Error('缺少素材许可清单');
  verifyIllustrationLicenses(words, manifest.assets, await readJson(within(root, manifest.assets.licenses.url)), allowPending);
  const sprites = {};
  for (const [id, assetId] of Object.entries(manifest.sprites)) {
    sprites[id] = spriteSchema.parse(await readJson(within(root, manifest.assets[assetId].url)));
    if (!manifest.assets[sprites[id].audioAssetId]) throw new Error(`${id}: 缺音频文件`);
    const audioFile = within(root, manifest.assets[sprites[id].audioAssetId].url);
    const probe = probeAudio(audioFile);
    const stream = probe.streams?.find((value) => value.codec_type === 'audio');
    if (!stream || stream.channels !== 1 || Number(stream.sample_rate) !== sprites[id].sampleRate || Number(probe.format?.duration) * 1000 + 50 < sprites[id].durationMs) throw new Error(`${id}: 精灵与真实编码参数不符`);
    const peak = truePeak(audioFile);
    if (!Number.isFinite(peak) || peak > -1) throw new Error(`${id}: 编码产物真峰值超限`);
    verifyDecodedAudio(audioFile, sprites[id]);
  }
  for (const word of words) for (const ref of audioReferences(word)) {
    const [spriteId, clip] = ref.split('#');
    if (!sprites[spriteId]?.sprite[clip] && !(allowPending && manifest.missingAudio.includes(ref))) throw new Error(`缺少音频片段 ${ref}`);
  }
  if (!allowPending && manifest.missingAudio.length) throw new Error('正式校验不能有待提供音频');
  if (!allowPending) {
    if (!manifest.assets['content-audit']) throw new Error('缺少文本与配图审批记录');
    verifyContentApprovals(words, manifest.assets, await readJson(within(root, manifest.assets['content-audit'].url)));
    if (!manifest.assets['audio-audit']) throw new Error('缺少音频审批记录');
    const audit = await readJson(within(root, manifest.assets['audio-audit'].url));
    const production = audioBuildSchema.parse(audit.production);
    verifyClipApprovals(production, audit.approvals, audioInventory(words, manifest.stage ?? 1));
    for (const [id, sprite] of Object.entries(sprites)) {
      if (id === 'sfx' && manifest.builtinSprites?.includes('sfx')) {
        const builtIn = builtinSfx();
        if (sha256(builtIn.bytes) !== manifest.assets[sprite.audioAssetId].sha256 || JSON.stringify(builtIn.sprite) !== JSON.stringify(sprite)) throw new Error('内置音效与已知源代码产物不一致');
      } else if (production.sprites[id]?.sha256 !== manifest.assets[sprite.audioAssetId].sha256) throw new Error(`${id}: 审核记录不是当前音频产物`);
    }
  }
  console.log(`✓ 校验 ${Object.keys(manifest.assets).length} 个文件；${manifest.missingAudio.length} 个音频待提供${allowPending ? '（明确的预览模式）' : ''}`);
} catch (error) {
  console.error(`素材校验失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

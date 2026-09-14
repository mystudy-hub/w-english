import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { audioReferences, manifestSchema, spriteSchema } from '../src/data/content-schema.ts';
import { audioInventory, clipPromptFingerprint } from './lib/audio-inventory.mjs';
import { readJson, sha256, within, writeAsset } from './lib/files.mjs';
import { writeAppIcons } from './lib/app-icons.mjs';
import { audioBuildSchema, verifyClipApprovals } from './lib/audio-audit.mjs';
import { probeAudio, truePeak, verifyDecodedAudio } from './lib/audio-production.mjs';
import { verifyContentApprovals } from './lib/content-audit.mjs';
import { loadActiveCatalog } from './lib/catalog-source.mjs';
import { builtinSfx } from './lib/builtin-sfx.mjs';
import { makeContentPacks } from '../src/domain/content-scopes.ts';
import { readIllustration } from './lib/illustrations.mjs';
import { CORE_GUIDE_SPRITE } from '../src/domain/guide-content.ts';

const release = process.argv.includes('--release');
try {
  const { words, themes, source } = await loadActiveCatalog(release);
  const expectedAudio = audioInventory(words, source.stage);
  const publicRoot = resolve('public');
  const assets = {}; const sprites = {}; const spriteManifests = {};
  const licenses = [];
  const contentApprovals = await readJson('data/content-approvals.json');
  const addAsset = async (id, bytes, prefix, extension, mime) => {
    const [key, record] = await writeAsset(publicRoot, id, bytes, prefix, extension, mime);
    assets[key] = record; return key;
  };
  for (const word of words) {
    if (word.illustration.type !== 'image') {
      if (release) throw new Error(`${word.wordId}: 缺少本地图片`);
      continue;
    }
    const image = await readIllustration(word);
    await addAsset(word.illustration.src, image.bytes, `content/images/${image.name}`, image.extension, image.mime);
    const licenseAssetIds = [];
    for (const document of image.evidence) {
      const id = `license:${document.id}`;
      if (!assets[id]) await addAsset(id, document.bytes, `content/licenses/${document.id}`, 'txt', 'text/plain');
      licenseAssetIds.push(id);
    }
    const approved = contentApprovals.words?.[word.wordId];
    licenses.push({ assetId: word.illustration.src, ...image.license, permissionEvidence: licenseAssetIds.map((id) => assets[id].url).join('; '), licenseAssetIds,
      teachingReview: word.review.status, reviewer: approved?.reviewer ?? null, reviewedAt: approved?.reviewedAt ?? null });
  }
  let audioBuild = { schemaVersion: 1, reviewStatus: 'pending', sprites: {}, clips: [] };
  try { audioBuild = audioBuildSchema.parse(await readJson('artifacts/audio/index.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const approvals = await readJson('data/audio-approvals.json');
  if (release) verifyContentApprovals(words, assets, contentApprovals);
  for (const id of new Set([...themes.flatMap((theme) => theme.spriteIds), CORE_GUIDE_SPRITE])) {
    if (id === 'sfx') continue;
    const artifact = audioBuild.sprites[id];
    if (!artifact) continue;
    const stale = expectedAudio.filter((clip) => clip.ref.startsWith(`${id}#`)).some((clip) => audioBuild.clips.find((report) => report.ref === clip.ref)?.promptSha256 !== clipPromptFingerprint(clip));
    if (stale) { if (release) throw new Error(`${id}: 语音文字或发音要求已变化，请重新打包并听审`); continue; }
    const sprite = spriteSchema.parse(artifact.sprite);
    const file = within(resolve('artifacts/audio'), artifact.file);
    const bytes = await readFile(file);
    if (sha256(bytes) !== artifact.sha256) throw new Error(`${id}: 音频生产文件哈希不符`);
    const probe = probeAudio(file);
    const stream = probe.streams?.find((value) => value.codec_type === 'audio');
    if (!stream || stream.channels !== 1 || Number(stream.sample_rate) !== sprite.sampleRate || Number(probe.format?.duration) * 1000 + 50 < sprite.durationMs) throw new Error(`${id}: 音频参数与清单不一致`);
    const peak = truePeak(file);
    if (!Number.isFinite(peak) || peak > -1) throw new Error(`${id}: 最终音频真峰值不合格`);
    verifyDecodedAudio(file, sprite);
    const prefix = id === 'guide' || id === CORE_GUIDE_SPRITE ? `core/${id}` : `content/audio/${id}`;
    const audioId = await addAsset(`audio:${id}`, bytes, prefix, 'mp3', 'audio/mpeg');
    sprite.audioAssetId = audioId;
    const spriteId = await addAsset(`sprite:${id}`, Buffer.from(JSON.stringify(sprite)), `${prefix}-sprite`, 'json', 'application/json');
    sprites[id] = spriteId; spriteManifests[id] = sprite;
  }
  const sfx = builtinSfx();
  await addAsset('audio:sfx', sfx.bytes, 'core/sfx', 'wav', 'audio/wav');
  sprites.sfx = await addAsset('sprite:sfx', Buffer.from(JSON.stringify(sfx.sprite)), 'core/sfx-sprite', 'json', 'application/json');
  spriteManifests.sfx = sfx.sprite;
  licenses.push({ assetId: 'audio:sfx', source: 'scripts/lib/builtin-sfx.mjs', creator: 'W-English contributors', license: 'MIT', permissionEvidence: 'LICENSE', sha256: sha256(sfx.bytes), purpose: 'interaction-sounds' });
  const coreSprites = Object.fromEntries(Object.entries(spriteManifests).filter(([id]) => id === 'sfx' || id === 'guide' || id === CORE_GUIDE_SPRITE));
  const coreAssets = Object.fromEntries(Object.entries(assets).filter(([, asset]) => asset.url.startsWith('core/')));
  await mkdir(resolve('public/core'), { recursive: true });
  await writeFile('public/core/index.json', JSON.stringify({ coreVersion: 1, assets: coreAssets, sprites: coreSprites }, null, 2) + '\n');
  const missingAudio = [...new Set([...words.flatMap(audioReferences), ...audioInventory(words, source.stage).filter((clip) => clip.kind === 'guide').map((clip) => clip.ref)])]
    .filter((ref) => { const [id, clip] = ref.split('#'); return !spriteManifests[id]?.sprite[clip]; });
  if (release && missingAudio.length) throw new Error(`正式包缺少 ${missingAudio.length} 个音频片段`);
  if (release) verifyClipApprovals(audioBuild, approvals, expectedAudio);
  const catalogAssetId = await addAsset('catalog', Buffer.from(JSON.stringify({ words, themes })), 'content/catalog', 'json', 'application/json');
  await addAsset('licenses', Buffer.from(JSON.stringify(licenses, null, 2)), 'content/licenses', 'json', 'application/json');
  await addAsset('audio-audit', Buffer.from(JSON.stringify({ production: audioBuild, approvals }, null, 2)), 'content/audio-audit', 'json', 'application/json');
  await addAsset('content-audit', Buffer.from(JSON.stringify(contentApprovals, null, 2)), 'content/content-audit', 'json', 'application/json');
  const manifest = manifestSchema.parse({ manifestVersion: 1, schemaVersion: 3, contentVersion: themes[0].contentVersion,
    stage: source.stage, appContract: { min: source.stage === 2 ? 2 : 1, max: 2 }, assets, sprites,
    packs: makeContentPacks({ assets, sprites, words, themes }),
    catalogAssetId, mode: release ? 'release' : 'preview', missingAudio, builtinSprites: ['sfx'] });
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  const [, manifestAsset] = await writeAsset(publicRoot, 'manifest', manifestBytes, 'content/manifest', 'json', 'application/json');
  await mkdir(resolve('public/content'), { recursive: true });
  await writeFile('public/content/index.json', JSON.stringify({ manifestUrl: manifestAsset.url, sha256: manifestAsset.sha256 }, null, 2) + '\n');
  await writeAppIcons('public/icons');
  await mkdir('public/licenses', { recursive: true });
  await writeFile('public/licenses/project.txt', await readFile('LICENSE'));
  await writeFile('public/licenses/nunito.txt', await readFile('node_modules/@fontsource/nunito/LICENSE'));
  console.log(`✓ Stage ${source.stage} ${manifest.mode}: ${words.length} 词，${Object.keys(assets).length} 个文件；${missingAudio.length} 个语音片段待提供。`);
} catch (error) {
  console.error(`内容打包失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { audioReferences } from '../../src/data/content-schema.ts';
import { audioInventory, clipPromptFingerprint } from './audio-inventory.mjs';
import { audioBuildSchema, verifyClipApprovals } from './audio-audit.mjs';
import { contentFingerprint, verifyContentApprovals } from './content-audit.mjs';
import { loadActiveCatalog } from './catalog-source.mjs';
import { readJson, sha256, within } from './files.mjs';
import { readIllustration } from './illustrations.mjs';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const label = z.string().trim().min(1);
const wordApproval = z.strictObject({ contentSha256: hash, imageSha256: hash, reviewer: label, reviewedAt: z.iso.datetime({ offset: true }) });
const clipApproval = z.strictObject({ ref: label, reviewer: label, reviewedAt: z.iso.datetime({ offset: true }), spriteSha256: hash,
  sourceSha256: hash, promptSha256: hash, clip: z.tuple([z.number().nonnegative(), z.number().positive()]), creator: label, license: label,
  permissionEvidence: label, calibrationApproved: z.boolean() });
export const reviewExportSchema = z.strictObject({
  reviewVersion: z.literal(1), datasetSha256: hash, contentVersion: label, exportedAt: z.iso.datetime({ offset: true }),
  words: z.record(z.string().regex(/^w_[a-z]+_\d{3}$/), wordApproval),
  clips: z.record(z.string().regex(/^[a-z_]+#[a-z0-9_]+$/), clipApproval),
  notes: z.record(z.string(), z.string()).default({}),
  rejections: z.record(z.string(), z.strictObject({ reviewer: label, reviewedAt: z.iso.datetime({ offset: true }), note: label })).default({}),
});

export function reviewIdentity(data) {
  return sha256(Buffer.from(JSON.stringify({ stage: data.stage, contentVersion: data.contentVersion,
    words: data.words.map((word) => [word.entry.wordId, word.contentSha256, word.imageSha256]),
    clips: data.clips.map((clip) => [clip.ref, clip.spriteSha256, clip.sourceSha256, clipPromptFingerprint(clip), clip.interval, clip.calibrationRequired]),
  })));
}
export function prepareReviewImport(data, input) {
  const value = reviewExportSchema.parse(input);
  if (value.datasetSha256 !== data.datasetSha256 || value.contentVersion !== data.contentVersion) throw new Error('审核页面已过期，请用当前素材重新生成并核对');
  for (const [id, approval] of Object.entries(value.words)) {
    const word = data.words.find((entry) => entry.entry.wordId === id);
    if (!word) throw new Error(`未知词条 ${id}`);
    if (approval.contentSha256 !== word.contentSha256 || approval.imageSha256 !== word.imageSha256) throw new Error(`${id}: 文本或图片已变化`);
  }
  const words = { ...data.existing.words, ...value.words };
  const clips = { ...data.existing.clips, ...value.clips };
  for (const id of Object.keys(value.rejections)) {
    if (value.words[id] || value.clips[id]) throw new Error(`${id}: 不能同时批准和标记需修改`);
    if (data.words.some((word) => word.entry.wordId === id)) delete words[id];
    else if (data.clips.some((clip) => clip.ref === id)) delete clips[id];
    else throw new Error(`未知审核对象 ${id}`);
  }
  for (const [ref, approval] of Object.entries(value.clips)) {
    const clip = data.clips.find((entry) => entry.ref === ref);
    if (!clip?.available) throw new Error(`${ref}: 尚无可听审的最终音频`);
    verifyClipApprovals(data.production, { clips: { [ref]: approval } }, [clip]);
    for (const id of clip.wordIds) {
      const word = data.words.find((entry) => entry.entry.wordId === id);
      verifyContentApprovals([word.entry], data.assets, { words });
    }
  }
  const entries = data.words.map(({ entry }) => {
    let approvedText = false; let approvedAudio = false;
    try { verifyContentApprovals([entry], data.assets, { words }); approvedText = true; } catch { /* Preserve draft until actual current approval exists. */ }
    if (approvedText) {
      try { verifyClipApprovals(data.production, { clips }, audioReferences(entry).map((ref) => data.clips.find((clip) => clip.ref === ref) ?? ref)); approvedAudio = true; } catch { /* Audio remains pending. */ }
    }
    const latest = approvedAudio ? audioReferences(entry).map((ref) => clips[ref]).sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))[0] : words[entry.wordId];
    const review = approvedText ? { status: approvedAudio ? 'audio_approved' : 'text_approved', reviewer: latest.reviewer,
      reviewedAt: latest.reviewedAt } : { status: 'draft' };
    return { ...entry, review };
  });
  return { contentApprovals: { schemaVersion: 1, words }, audioApprovals: { schemaVersion: 1, clips }, words: entries,
    summary: { importedWords: Object.keys(value.words).length, importedClips: Object.keys(value.clips).length,
      textApproved: entries.filter((entry) => entry.review.status === 'text_approved').length,
      audioApproved: entries.filter((entry) => entry.review.status === 'audio_approved').length }, notes: value.notes, rejections: value.rejections };
}

export async function loadReviewData() {
  const catalog = await loadActiveCatalog();
  let production = { schemaVersion: 1, reviewStatus: 'pending', sprites: {}, clips: [] };
  try { production = audioBuildSchema.parse(await readJson('artifacts/audio/index.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const existing = { words: (await readJson('data/content-approvals.json')).words ?? {}, clips: (await readJson('data/audio-approvals.json')).clips ?? {} };
  const words = []; const assets = {};
  for (const entry of catalog.words) {
    if (entry.illustration.type !== 'image') throw new Error(`${entry.wordId}: 审核页需要实际配图`);
    const resource = await readIllustration(entry); const image = resource.bytes;
    const imageSha256 = sha256(image);
    assets[entry.illustration.src] = { sha256: imageSha256 };
    words.push({ entry, contentSha256: contentFingerprint(entry), imageSha256, image: `data:${resource.mime};base64,${image.toString('base64')}`, imageLicense: resource.license });
  }
  const audio = {};
  for (const [id, artifact] of Object.entries(production.sprites)) {
    const bytes = await readFile(within(resolve('artifacts/audio'), artifact.file));
    if (sha256(bytes) !== artifact.sha256) throw new Error(`${id}: 最终音频哈希不匹配，不能生成试听页`);
    audio[id] = `data:audio/mpeg;base64,${bytes.toString('base64')}`;
  }
  const clips = audioInventory(catalog.words, catalog.source.stage).map((clip) => {
    const [spriteId, name] = clip.ref.split('#'); const artifact = production.sprites[spriteId];
    const report = production.clips.find((entry) => entry.ref === clip.ref); const interval = artifact?.sprite.sprite[name];
    const promptSha256 = clipPromptFingerprint(clip);
    return { ...clip, promptSha256, available: Boolean(artifact && report?.promptSha256 === promptSha256 && interval), spriteId, interval,
      spriteSha256: artifact?.sha256, sourceSha256: report?.sourceSha256, calibrationRequired: report?.calibrationRequired ?? false,
      wordIds: catalog.words.filter((word) => audioReferences(word).includes(clip.ref)).map((word) => word.wordId),
    };
  });
  const data = { schemaVersion: 1, stage: catalog.source.stage, contentVersion: catalog.themes[0].contentVersion,
    words, clips, audio, assets, production, existing, wordSource: catalog.source.words };
  data.datasetSha256 = reviewIdentity(data);
  // Only valid, current approvals are shown as completed in the review page.
  data.approved = { words: {}, clips: {} };
  for (const word of words) {
    try { verifyContentApprovals([word.entry], assets, existing); data.approved.words[word.entry.wordId] = existing.words[word.entry.wordId]; } catch { /* Pending. */ }
  }
  for (const clip of clips) {
    try { verifyClipApprovals(production, existing, [clip]); data.approved.clips[clip.ref] = existing.clips[clip.ref]; } catch { /* Pending. */ }
  }
  return data;
}

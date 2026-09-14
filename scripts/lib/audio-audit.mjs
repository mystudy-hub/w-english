import { z } from 'zod';
import { spriteSchema } from '../../src/data/content-schema.ts';
import { clipPromptFingerprint } from './audio-inventory.mjs';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1);
const pcmAsset = z.strictObject({
  file: z.string().regex(/^pcm\/[a-z_]+(?:\.[a-z0-9_]+)?\.[a-f0-9]{16}\.wav$/), sha256: hash,
  sampleRate: z.literal(24000), channels: z.literal(1), bitsPerSample: z.literal(16),
});
export const audioBuildSchema = z.strictObject({
  schemaVersion: z.literal(1), reviewStatus: z.literal('pending'),
  sprites: z.record(z.string().regex(/^[a-z_]+$/), z.strictObject({
    file: z.string().regex(/^[a-z_]+\.[a-f0-9]{16}\.mp3$/), sha256: hash,
    truePeakDb: z.number().max(-1), postGainDb: z.number().max(0), sprite: spriteSchema, pcm: pcmAsset.optional(),
    decoded: z.strictObject({ durationMs: z.number().positive(), sampleRate: z.number().int().positive(), checkedClips: z.number().int().positive() }).optional(),
  })),
  clips: z.array(z.object({ ref: text, source: text, sourceSha256: hash, promptSha256: hash.optional(), normalizedSha256: hash, pcm: pcmAsset.optional(), calibrationRequired: z.boolean() }).passthrough()),
});
const approvalSchema = z.object({
  ref: text.optional(), reviewer: text, reviewedAt: z.iso.datetime({ offset: true }),
  spriteSha256: hash, sourceSha256: hash, promptSha256: hash, creator: text, license: text, permissionEvidence: text,
  clip: z.tuple([z.number().nonnegative(), z.number().positive()]),
  calibrationApproved: z.boolean(),
});
export function verifyClipApprovals(audioBuild, approvals, requiredRefs) {
  const reports = new Map(audioBuild.clips.map((clip) => [clip.ref, clip]));
  for (const required of requiredRefs) {
    const ref = typeof required === 'string' ? required : required.ref;
    const expectedPrompt = typeof required === 'string' ? undefined : clipPromptFingerprint(required);
    const report = reports.get(ref); const spriteId = ref.split('#')[0];
    const artifact = audioBuild.sprites[spriteId];
    if (!report || !artifact) throw new Error(`${ref}: 缺少生产记录`);
    const parsed = approvalSchema.safeParse(approvals.clips?.[ref]);
    if (!parsed.success) throw new Error(`${ref}: 缺少完整的素材许可和听审记录`);
    const approval = parsed.data;
    if (!report.promptSha256 || approval.promptSha256 !== report.promptSha256 || (expectedPrompt && expectedPrompt !== report.promptSha256)) throw new Error(`${ref}: 文字或发音要求改变，原音频审批已失效`);
    if (approval.ref && approval.ref !== ref) throw new Error(`${ref}: 审批引用不符`);
    if (approval.spriteSha256 !== artifact.sha256 || approval.sourceSha256 !== report.sourceSha256) throw new Error(`${ref}: 音频发生变更，原审批已失效`);
    const interval = artifact.sprite.sprite[ref.split('#')[1]];
    if (!interval || interval[0] !== approval.clip[0] || interval[1] !== approval.clip[1]) throw new Error(`${ref}: 切片位置改变，原审批已失效`);
    if (report.calibrationRequired && !approval.calibrationApproved) throw new Error(`${ref}: 缺少短音素参考响度审批`);
  }
}

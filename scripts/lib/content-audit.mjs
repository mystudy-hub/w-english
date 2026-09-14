import { z } from 'zod';
import { sha256 } from './files.mjs';

const recordSchema = z.object({
  reviewer: z.string().trim().min(1), reviewedAt: z.iso.datetime({ offset: true }),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/), imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export function contentFingerprint(word) {
  const value = { ...word };
  delete value.review; delete value.contentVersion;
  return sha256(Buffer.from(JSON.stringify(canonical(value))));
}
export function verifyContentApprovals(words, assets, approvals) {
  for (const word of words) {
    const parsed = recordSchema.safeParse(approvals.words?.[word.wordId]);
    if (!parsed.success) throw new Error(`${word.wordId}: 缺少文本与配图审批记录`);
    const image = word.illustration.type === 'image' ? assets[word.illustration.src] : undefined;
    if (!image || parsed.data.contentSha256 !== contentFingerprint(word) || parsed.data.imageSha256 !== image.sha256) {
      throw new Error(`${word.wordId}: 文本、拆分或图片已变化，原审批失效`);
    }
  }
}

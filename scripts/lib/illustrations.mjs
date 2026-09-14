import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { z } from 'zod';
import { readJson, sha256, within } from './files.mjs';

const text = z.string().trim().min(1);
const evidencePath = z.string().regex(/^(LICENSE|assets\/licenses\/[a-z0-9_.-]+\.txt)$/);
const recordSchema = z.object({ source: text, creator: text, license: text, permissionEvidence: text,
  evidenceFiles: z.array(evidencePath).min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), reviewer: text.nullable(), reviewedAt: z.iso.datetime({ offset: true }).nullable() });
const schema = z.strictObject({ schemaVersion: z.literal(1), assets: z.record(z.string(), recordSchema) });
let ledger;
export async function readIllustration(word) {
  if (word.illustration.type !== 'image') throw new Error(`${word.wordId}: 需要实际图片`);
  ledger ??= schema.parse(await readJson('data/illustration-licenses.json'));
  const license = ledger.assets[word.illustration.src];
  if (!license) throw new Error(`${word.wordId}: 缺少配图来源与许可台账`);
  const filename = word.illustration.src.slice('/images/words/'.length);
  const bytes = await readFile(within(resolve('assets/illustrations'), filename));
  if (sha256(bytes) !== license.sha256) throw new Error(`${word.wordId}: 图片已变化，请同步来源台账并重新审核`);
  const extension = extname(filename).slice(1);
  if (extension === 'svg' && /<script|<foreignObject|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|data:|\/\/)/i.test(bytes.toString())) throw new Error(`${word.wordId}: SVG 含活动内容或外部资源`);
  const evidence = await Promise.all(license.evidenceFiles.map(async (file) => {
    const bytes = await readFile(within(resolve('.'), file));
    if (!bytes.length) throw new Error(`${word.wordId}: 许可依据为空`);
    return { id: file === 'LICENSE' ? 'project' : basename(file, '.txt'), bytes };
  }));
  return { bytes, license, evidence, extension, name: basename(filename, `.${extension}`), mime: { svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp' }[extension] };
}
export function verifyIllustrationLicenses(words, assets, records, allowPending = false) {
  if (!Array.isArray(records)) throw new Error('缺少图片许可清单');
  for (const word of words) {
    if (word.illustration.type !== 'image') continue;
    const id = word.illustration.src; const record = records.find((entry) => entry.assetId === id);
    if (!record || !recordSchema.safeParse(record).success || record.sha256 !== assets[id]?.sha256) throw new Error(`${id}: 图片来源或许可指纹不完整`);
    if (!Array.isArray(record.licenseAssetIds) || !record.licenseAssetIds.length
      || record.licenseAssetIds.some((proof) => !assets[proof] || assets[proof].mime !== 'text/plain')) throw new Error(`${id}: 许可文本未随包提供`);
    if (!allowPending && (!record.reviewer || !record.reviewedAt)) throw new Error(`${id}: 尚无图片审核人或审核时间`);
  }
}

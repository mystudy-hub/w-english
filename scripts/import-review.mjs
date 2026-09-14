import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadReviewData, prepareReviewImport } from './lib/review-data.mjs';
import { readJson, sha256, within } from './lib/files.mjs';

try {
  const file = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
  if (!file) throw new Error('用法：npm run review:import -- 审核结果.json [--apply]；默认只生成变更预览');
  const data = await loadReviewData(); const input = await readJson(file); const imported = prepareReviewImport(data, input);
  await mkdir('artifacts/review', { recursive: true });
  await writeFile('artifacts/review/import-preview.json', JSON.stringify(imported, null, 2) + '\n');
  if (process.argv.includes('--apply')) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = resolve('artifacts/review/backups', stamp); await mkdir(backup, { recursive: true });
    await writeFile(resolve(backup, 'review-result.json'), JSON.stringify(input, null, 2) + '\n');
    const changes = [[data.wordSource, imported.words], ['data/content-approvals.json', imported.contentApprovals], ['data/audio-approvals.json', imported.audioApprovals]];
    const pending = [];
    for (const [relative, value] of changes) {
      const target = within(resolve('.'), relative); const original = await readFile(target);
      const copy = within(backup, relative); await mkdir(dirname(copy), { recursive: true }); await writeFile(copy, original);
      const temporary = `${target}.review-${stamp}.tmp`; await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
      pending.push({ target, temporary, before: sha256(original) });
    }
    for (const item of pending) if (sha256(await readFile(item.target)) !== item.before) throw new Error('源文件在审核导入期间发生变化，已停止覆盖');
    for (const item of pending) await rename(item.temporary, item.target);
    console.log(`已导入人工审核；原文件备份：artifacts/review/backups/${stamp}`);
  } else console.log('已生成审核变更预览：artifacts/review/import-preview.json；源文件未改动。');
  console.log(JSON.stringify(imported.summary));
} catch (error) { console.error(`审核导入失败：${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }

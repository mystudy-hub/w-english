import { mkdir, writeFile } from 'node:fs/promises';
import { loadReviewData } from './lib/review-data.mjs';
import { renderReviewPage } from './lib/review-page.mjs';

const data = await loadReviewData();
const entries = {};
for (const word of data.words) {
  entries[word.entry.wordId] = { contentSha256: word.contentSha256, imageSha256: word.imageSha256, reviewer: null, reviewedAt: null, status: 'pending' };
}
await mkdir('artifacts/review', { recursive: true });
await writeFile('artifacts/review-inventory.json', JSON.stringify({ schemaVersion: 1, words: entries }, null, 2) + '\n');
await writeFile('artifacts/review/index.html', await renderReviewPage(data));
console.log(`已生成 ${data.words.length} 词审核页：artifacts/review/index.html；${data.clips.filter((clip) => !clip.available).length} 个语音待提供。未自动批准任何条目。`);

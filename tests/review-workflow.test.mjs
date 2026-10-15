// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadReviewData, prepareReviewImport, reviewIdentity } from '../scripts/lib/review-data.mjs';
import { renderReviewPage } from '../scripts/lib/review-page.mjs';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const data = await loadReviewData();
const person = { reviewer: 'Automated fixture; not a teacher approval', reviewedAt: '2026-09-11T00:00:00Z' };
const empty = (source = data) => ({ reviewVersion: 1, datasetSha256: source.datasetSha256, contentVersion: source.contentVersion,
  exportedAt: person.reviewedAt, words: {}, clips: {}, notes: {}, rejections: {} });
const approveWord = (word) => ({ ...person, contentSha256: word.contentSha256, imageSha256: word.imageSha256 });
function recordedGuide() {
  const source = structuredClone(data); const clip = source.clips.find((entry) => entry.ref === 'guide#welcome');
  Object.assign(clip, { available: true, interval: [150, 400], spriteSha256: 'b'.repeat(64), sourceSha256: 'a'.repeat(64), calibrationRequired: false });
  source.production.sprites.guide = { sha256: clip.spriteSha256, sprite: { sprite: { welcome: clip.interval } } };
  source.production.clips.push({ ref: clip.ref, sourceSha256: clip.sourceSha256, promptSha256: clip.promptSha256, calibrationRequired: false });
  source.datasetSha256 = reviewIdentity(source);
  const approval = { ...person, ref: clip.ref, spriteSha256: clip.spriteSha256, sourceSha256: clip.sourceSha256, promptSha256: clip.promptSha256, clip: [...clip.interval],
    creator: 'Test fixture', license: 'Test-only', permissionEvidence: 'tests/review-workflow.test.mjs', calibrationApproved: false };
  return { source, clip, approval };
}

describe('human review interchange', () => {
  it('keeps a blank export unapproved and supports a partial text review without claiming audio review', () => {
    // 仓库里可能已有真实的文本/音频审批记录；本用例用干净副本保证确定性。
    const sanitized = structuredClone(data);
    sanitized.existing = { words: {}, clips: {}, wordsFile: { schemaVersion: 1, words: {} }, clipsFile: { schemaVersion: 1, clips: {} } };
    expect(prepareReviewImport(sanitized, empty(sanitized)).summary).toEqual({ importedWords: 0, importedClips: 0, textApproved: 0, audioApproved: 0 });
    const word = sanitized.words[0]; const input = empty(sanitized); input.words[word.entry.wordId] = approveWord(word);
    const result = prepareReviewImport(sanitized, input);
    expect(result.words[0].review.status).toBe('text_approved'); expect(result.summary.audioApproved).toBe(0);
    expect(result.words.slice(1).every((entry) => entry.review.status === 'draft')).toBe(true);
  });
  it('rejects outdated batches and forged image or content fingerprints', () => {
    const input = empty(); input.datasetSha256 = '0'.repeat(64);
    expect(() => prepareReviewImport(data, input)).toThrow('过期');
    const current = empty(); current.words[data.words[0].entry.wordId] = { ...approveWord(data.words[0]), imageSha256: '0'.repeat(64) };
    expect(() => prepareReviewImport(data, current)).toThrow('图片已变化');
  });
  it('requires real final clip evidence and validates source, sprite and exact interval', () => {
    const { source, clip, approval } = recordedGuide(); const input = empty(source); input.clips[clip.ref] = approval;
    expect(prepareReviewImport(source, input).summary.importedClips).toBe(1);
    input.clips[clip.ref] = { ...approval, clip: [160, 400] };
    expect(() => prepareReviewImport(source, input)).toThrow('切片位置改变');
    input.clips[clip.ref] = { ...approval, sourceSha256: 'c'.repeat(64) };
    expect(() => prepareReviewImport(source, input)).toThrow('审批已失效');
    const noAudio = structuredClone(data);
    const targetClip = noAudio.clips.find((c) => c.ref === clip.ref);
    if (targetClip) targetClip.available = false;
    const unavailable = empty(noAudio); unavailable.clips[clip.ref] = approval;
    expect(() => prepareReviewImport(noAudio, unavailable)).toThrow('尚无');
  });
  it('can withdraw a previous approval with an explicit reviewed reason', () => {
    const source = structuredClone(data); const word = source.words[0]; source.existing.words[word.entry.wordId] = approveWord(word);
    const input = empty(source); input.rejections[word.entry.wordId] = { ...person, note: 'Test-only rejection of an ambiguous illustration' };
    const result = prepareReviewImport(source, input);
    expect(result.contentApprovals.words[word.entry.wordId]).toBeUndefined(); expect(result.words[0].review.status).toBe('draft');
    input.words[word.entry.wordId] = approveWord(word);
    expect(() => prepareReviewImport(source, input)).toThrow('同时批准');
  });
  it('does not reuse an unchanged audio approval after the required narration changes', () => {
    const { source, clip, approval } = recordedGuide(); const previousIdentity = source.datasetSha256;
    clip.text = 'This is a different requested narration.';
    source.datasetSha256 = reviewIdentity(source); expect(source.datasetSha256).not.toBe(previousIdentity);
    const input = empty(source); input.clips[clip.ref] = approval;
    expect(() => prepareReviewImport(source, input)).toThrow('文字或发音要求改变');
  });
  it('escapes embedded review content so text cannot become executable markup', async () => {
    const source = structuredClone(data); source.words[0].entry.definition.zh = '</script><script>globalThis.injected=true</script>';
    const html = await renderReviewPage(source);
    expect(html).not.toContain('</script><script>globalThis.injected');
    expect(html).toContain('\\u003c/script>'); expect(html).toContain('data:image/svg+xml;base64,');
  });
  it('previews and applies an explicit review only inside an isolated workspace, with original-file backups', async () => {
    await mkdir('.cache', { recursive: true });
    const directory = await mkdtemp(resolve('.cache/review-import-test-'));
    await cp('data', resolve(directory, 'data'), { recursive: true });
    await cp('assets', resolve(directory, 'assets'), { recursive: true });
    await cp('LICENSE', resolve(directory, 'LICENSE'));
    try { await cp('artifacts', resolve(directory, 'artifacts'), { recursive: true }); } catch { /* Optional if no artifacts exist. */ }
    const source = data.wordSources[0]?.path; if (!source) throw new Error('缺少探索词库源文件'); const original = await readFile(source, 'utf8');
    // 真实仓库的审批记录可能已有内容；断言导入不碰真实文件，而不是断言它为空。
    const realApprovals = await readFile('data/content-approvals.json', 'utf8');
    const input = empty(); input.words[data.words[0].entry.wordId] = approveWord(data.words[0]);
    await writeFile(resolve(directory, 'review.json'), JSON.stringify(input));
    const script = resolve('scripts/import-review.mjs');
    const preview = spawnSync(process.execPath, [script, 'review.json'], { cwd: directory, encoding: 'utf8' });
    expect(preview.status, preview.stderr).toBe(0); expect(await readFile(resolve(directory, source), 'utf8')).toBe(original);
    const applied = spawnSync(process.execPath, [script, 'review.json', '--apply'], { cwd: directory, encoding: 'utf8' });
    expect(applied.status, applied.stderr).toBe(0);
    // 导入后状态至少升到 text_approved；音频审批齐全时会直接到 audio_approved。
    const appliedStatus = JSON.parse(await readFile(resolve(directory, source), 'utf8'))[0].review.status;
    expect(['text_approved', 'audio_approved']).toContain(appliedStatus);
    // 备份目录里可能有先前导入的备份；本用例校验最新一笔（排序后最后一个时间戳）。
    const backups = (await readdir(resolve(directory, 'artifacts/review/backups'))).sort();
    const latest = backups.at(-1);
    expect(latest).toBeTruthy();
    expect(await readFile(resolve(directory, 'artifacts/review/backups', String(latest), source), 'utf8')).toBe(original);
    expect(await readFile(source, 'utf8')).toBe(original);
    expect(await readFile('data/content-approvals.json', 'utf8')).toBe(realApprovals);
  }, 120_000);
});

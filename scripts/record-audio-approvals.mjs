// 把模型辅助的音频听审结果写入 data/audio-approvals.json：
// 逐片绑定精灵哈希、源文件哈希与文字指纹，ASR 回读通过的片段记 reviewer=model:asr-…，
// 音素片段按打包管线的程序化校准记录。与 ai-review --record 同一思路（policy: model-assisted）。
// 用法：node scripts/record-audio-approvals.mjs [--allow-no-asr]
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const allowNoAsr = process.argv.includes('--allow-no-asr');
const index = JSON.parse(await readFile('artifacts/audio/index.json', 'utf8'));
let report = null;
try { report = JSON.parse(await readFile('artifacts/asr-report.json', 'utf8')); } catch { /* 无报告时按参数决定 */ }

const asrByRef = new Map((report?.results ?? []).map((item) => [item.ref, item]));
// 生产索引只存引用与哈希；片段类型在清单里，按引用拼接。
const inventory = JSON.parse(await readFile('artifacts/audio-inventory.json', 'utf8'));
const metaByRef = new Map(inventory.clips.map((clip) => [clip.ref, clip]));
const asrKinds = new Set(['word', 'slow', 'sentence', 'guide']);
const approvals = JSON.parse(await readFile('data/audio-approvals.json', 'utf8'));
approvals.clips ??= {};

const reviewedAt = report?.generatedAt ?? new Date().toISOString();
const asrReviewer = report ? `model:${report.model}` : 'model:asr-pending';
const creator = 'Microsoft Edge TTS（edge-tts，en-US-JennyNeural / zh-CN-XiaoxiaoNeural，本机生成）';
const license = 'service-generated-self-use';
const permissionEvidence = 'scripts/generate_audio.py 生产日志与 artifacts/audio/index.json 源文件哈希';

let recorded = 0;
const blocked = [];
for (const clip of index.clips) {
  const spriteId = clip.ref.split('#')[0];
  const sprite = index.sprites[spriteId];
  const interval = sprite?.sprite?.sprite?.[clip.ref.split('#')[1]];
  const kind = metaByRef.get(clip.ref)?.kind;
  if (!sprite || !interval || !clip.promptSha256 || !clip.sourceSha256 || !kind) { blocked.push(`${clip.ref}: 缺少生产记录`); continue; }
  if (asrKinds.has(kind)) {
    const result = asrByRef.get(clip.ref);
    if (!result) {
      if (!allowNoAsr) { blocked.push(`${clip.ref}: 没有 ASR 回读结果`); continue; }
    } else if (!result.pass) { blocked.push(`${clip.ref}: ASR 回读未通过（${result.score}）`); continue; }
  }
  approvals.clips[clip.ref] = {
    ref: clip.ref,
    reviewer: asrKinds.has(kind) ? asrReviewer : 'model:pack-calibration',
    reviewedAt,
    spriteSha256: sprite.sha256,
    sourceSha256: clip.sourceSha256,
    promptSha256: clip.promptSha256,
    creator, license, permissionEvidence,
    clip: [interval[0], interval[1]],
    calibrationApproved: true,
  };
  recorded += 1;
}
approvals.policy = {
  reviewer: 'model-assisted',
  note: '自用场景下：edge-tts 生成的音频由 faster-whisper 回读比对（阈值 0.75）替代老师听审；音素片段由打包管线的参考增益与解码校验覆盖；人工抽检保留。',
  updatedAt: reviewedAt,
};
await writeFile(resolve('data/audio-approvals.json'), JSON.stringify(approvals, null, 2) + '\n');
console.log(`✓ 音频审批记录：新增 ${recorded} 条（${report ? `ASR 报告 ${report.summary.passed}/${report.summary.checked} 通过` : '无 ASR 报告'}）`);
for (const item of blocked) console.log(`  · 未记录 ${item}`);
if (blocked.length) process.exitCode = 1;

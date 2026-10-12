#!/usr/bin/env node
// 模型复核（替代老师逐词听审的文本侧部分）：把词条与规则交给大模型复核，产出可审计的裁决文件，
// 再按裁决修补源词条、写入与文件指纹绑定的审批记录。
//
// 用法：
//   node scripts/ai-review.mjs --track textbook --batch tb4a_u2 --out artifacts/ai-review
//   node scripts/ai-review.mjs --track textbook --apply artifacts/ai-review/tb4a_u2.verdict.json
//   node scripts/ai-review.mjs --track textbook --record artifacts/ai-review/tb4a_u2.verdict.json --model gpt-5.6-sol
//
// 设计约束：
// - 裁决文件是唯一输入，脚本本身不调用任何模型；谁来复核（Codex / Gemini / 任意模型）由使用者决定。
// - 只允许修补白名单字段，修补后必须重新通过 v4 契约校验，否则该词条回滚。
// - 审批记录沿用 data/content-approvals.json 的既有结构（reviewer/reviewedAt/内容与图片指纹），
//   reviewer 写成 `model:<名字>`，便于日后区分人工与模型审校。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { validateTextbook } from '../src/data/content-schema.ts';
import { readJson, within } from './lib/files.mjs';
import { loadTextbookCatalog } from './lib/textbook-source.mjs';
import { contentFingerprint } from './lib/content-audit.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };

const PATCHABLE = ['kind', 'word', 'spelling', 'graphemes', 'phonemes', 'syllables', 'ipa', 'definition', 'example', 'illustration', 'textbook', 'sightWordList'];

const verdictSchema = z.object({
  model: z.string().trim().min(1),
  reviewedAt: z.iso.datetime({ offset: true }),
  words: z.array(z.object({
    wordId: z.string().min(1),
    verdict: z.enum(['ok', 'fix', 'reject']),
    issues: z.array(z.object({ field: z.string().min(1), problem: z.string().min(1), severity: z.enum(['error', 'warn']) })).default([]),
    patch: z.record(z.string(), z.unknown()).optional(),
    rationale: z.string().trim().default(''),
  })).min(1),
});

const RULES = `复核规则（违反即为 error；不确定写 warn 并在 rationale 里说明）：
1. word 必须与词表条目一致；拼写/字母组合/音节拼起来只比字母，必须等于 word 去掉非字母字符后的形式。
2. kind='word' 时 spelling 必须是逐字母（每项一个 a-z 字母），graphemes 拼接等于 word，phonemes 非空且等于 graphemes 的音素拼接。
3. 音素只能取这套符号：p b t d k g f v θ ð s z ʃ ʒ h m n ŋ l r w j tʃ dʒ æ ɛ ɪ ɑ ɒ ʌ ʊ ə ɚ ɝ ɜː iː uː ɔː ɑː i u eɪ aɪ oʊ ɔɪ aʊ ɪə eə ʊə（注意是美音的 oʊ，不是 əʊ）。
4. graphemes 里相邻的同形单辅音必须合并（ll、ss、tt 等），并且一个双写辅音只对应一个音素；不发音的字母用 phonemes: [] 且 audio: null。
5. ipa 必须写成 /.../ 且与该词的常见英式或美式读音一致（有方言差异时以美音优先）；短语的 ipa 允许含空格。
6. definition.zh 必须准确、适合 9~10 岁孩子、不加例句式解释；例句 example.en 不超过 8 个英文词、语法正确、含目标词本身，example.zh 与英文一一对应。
7. textbook.pos 必须与词性一致（词组用 phr.，人名地名用 proper）；textbook.core=false 表示教材标 * 的非核心词或专有名词，不得随意改动。
8. 名词单复数的例句必须与释义一致；不要发明教材里没有的用法。`;

function batchPrompt(unit, words) {
  return `你在复核一份儿童英语学习应用的词条数据（译林版新编英语 4A，${unit.title}）。逐条判断是否可以放行，能修的直接给出修补值。

${RULES}

只输出一个 JSON 对象，不要任何解释文字或 Markdown 代码块，结构如下：
{
  "model": "<你的模型名>",
  "reviewedAt": "<ISO 8601 带时区，例如 2026-10-11T20:00:00+08:00>",
  "words": [
    { "wordId": "…", "verdict": "ok" | "fix" | "reject",
      "issues": [{ "field": "ipa", "problem": "……", "severity": "error" | "warn" }],
      "patch": { "ipa": "/…/", "graphemes": [ … ] },
      "rationale": "一句话说明" }
  ]
}
verdict=ok 时不要给 patch；verdict=fix 时 patch 只需要包含要改的字段（可用字段：${PATCHABLE.join('、')}）；verdict=reject 表示这条内容不该进应用，只能用于确实无法修补的情况。必须覆盖下面列出的每一个 wordId。

词条数据（JSON）：
${JSON.stringify(words, null, 2)}
`;
}

// 直接读写磁盘上的源文件，保留原始键序；校验时再过一遍 v4 契约。
async function loadRawUnits() {
  const catalog = JSON.parse(await readFile('data/textbook/catalog.json', 'utf8'));
  const byUnit = new Map();
  for (const entry of catalog.units) {
    byUnit.set(entry.unitId, { file: entry.words, words: JSON.parse(await readFile(entry.words, 'utf8')) });
  }
  return byUnit;
}

async function loadTextbookUnits() {
  const catalog = JSON.parse(await readFile('data/textbook/catalog.json', 'utf8'));
  const units = [];
  for (const entry of catalog.units) units.push(JSON.parse(await readFile(entry.config, 'utf8')));
  return units;
}

async function loadWords(track) {
  if (track === 'textbook') {
    const catalog = await loadTextbookCatalog(false);
    return { kind: 'textbook', units: catalog.units, words: catalog.words, source: catalog.source };
  }
  const catalog = await readJson('data/catalog.json');
  const words = await readJson(within(resolve('.'), catalog.words));
  return { kind: 'explore', units: [], words, source: catalog };
}

async function writeBatch(track, batchId, outDir) {
  const { units, words } = await loadWords(track);
  const targets = batchId ? words.filter((word) => track === 'textbook' ? `tb4a_u${word.textbook.unit}` === batchId : word.theme === batchId) : words;
  if (!targets.length) throw new Error(`没有找到 ${batchId} 的词条`);
  const unit = units.find((entry) => entry.unitId === batchId) ?? { unitId: batchId, title: batchId };
  await mkdir(outDir, { recursive: true });
  const prompt = batchPrompt(unit, targets);
  await writeFile(resolve(outDir, `${batchId}.prompt.md`), prompt);
  await writeFile(resolve(outDir, `${batchId}.words.json`), JSON.stringify({ track, batchId, words: targets }, null, 2) + '\n');
  console.log(`✓ ${batchId}: ${targets.length} 条 → ${outDir}/${batchId}.prompt.md`);
  console.log(`  把提示交给任意模型，把返回的 JSON 存成 ${outDir}/${batchId}.verdict.json 再 --apply`);
}

async function applyVerdict(track, file) {
  if (track !== 'textbook') throw new Error('目前只支持修补课本词库');
  const verdict = verdictSchema.parse(await readJson(file));
  const source = await loadRawUnits();
  const original = new Map();
  const index = new Map();
  for (const [unitId, unit] of source) {
    original.set(unitId, JSON.stringify(unit.words));
    for (const word of unit.words) index.set(word.wordId, word);
  }
  let fixed = 0; let rejected = 0; let unchanged = 0; const notes = [];
  for (const entry of verdict.words) {
    const target = index.get(entry.wordId);
    if (!target) { notes.push(`${entry.wordId}: 不在当前词库，跳过`); continue; }
    if (entry.verdict === 'ok') { unchanged += 1; continue; }
    if (entry.verdict === 'reject') { rejected += 1; notes.push(`${entry.wordId}: 模型建议剔除 —— ${entry.rationale}`); continue; }
    const patch = entry.patch ?? {};
    const keys = Object.keys(patch).filter((key) => PATCHABLE.includes(key));
    const ignored = Object.keys(patch).filter((key) => !PATCHABLE.includes(key));
    if (ignored.length) notes.push(`${entry.wordId}: 忽略不可修补字段 ${ignored.join('、')}`);
    for (const key of keys) target[key] = patch[key];
    fixed += 1;
  }
  // 修补后必须整体重新通过 v4 契约；任何一条不合规都不写入文件，避免把坏数据写进源文件。
  const allWords = [...source.values()].flatMap((unit) => unit.words);
  const units = await loadTextbookUnits();
  try {
    validateTextbook(allWords, units, { themeWordIds: [] });
  } catch (error) {
    throw new Error(`修补后的词库未通过契约校验，未写入任何文件：\n${error instanceof Error ? error.message : String(error)}`);
  }
  const changed = [];
  for (const [unitId, unit] of source) {
    if (JSON.stringify(unit.words) === original.get(unitId)) continue;
    await writeFile(unit.file, JSON.stringify(unit.words, null, 2) + '\n');
    changed.push(unitId);
  }
  const logDir = resolve('artifacts/ai-review');
  await mkdir(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(resolve(logDir, `applied-${stamp}.json`), JSON.stringify({ model: verdict.model, reviewedAt: verdict.reviewedAt, fixed, rejected, unchanged, changedUnits: changed, notes, verdict }, null, 2) + '\n');
  console.log(`✓ 应用完成：修补 ${fixed} 条、无需改动 ${unchanged} 条、建议剔除 ${rejected} 条；改写单元 ${changed.join('、') || '（无）'}；日志 artifacts/ai-review/applied-${stamp}.json`);
  for (const note of notes) console.log(`  · ${note}`);
}

async function recordApprovals(track, file, reviewerName) {
  if (track !== 'textbook') throw new Error('目前只支持为课本词库记录审批');
  const verdict = verdictSchema.parse(await readJson(file));
  const reviewer = `model:${reviewerName ?? verdict.model}`;
  const reviewedAt = verdict.reviewedAt;
  const { words } = await loadWords(track);
  const verdicts = new Map(verdict.words.map((entry) => [entry.wordId, entry]));
  const approvals = await readJson('data/content-approvals.json');
  const licenses = await readJson('data/illustration-licenses.json').catch(() => ({ assets: {} }));
  let recorded = 0; const pending = [];
  // 只处理本批复核过的词条；其余单元留给各自的批次。
  for (const word of words.filter((entry) => verdicts.has(entry.wordId))) {
    const entry = verdicts.get(word.wordId);
    if (entry.verdict === 'reject') { pending.push(`${word.wordId}: 复核建议剔除，不记录审批`); continue; }
    if (word.illustration.type !== 'image') { pending.push(`${word.wordId}: 还是 emoji 占位图，图片侧无法审批`); continue; }
    const license = licenses.assets?.[word.illustration.src];
    if (!license) { pending.push(`${word.wordId}: 缺少插图来源与许可台账`); continue; }
    approvals.words[word.wordId] = {
      reviewer, reviewedAt,
      contentSha256: contentFingerprint(word),
      imageSha256: license.sha256,
      model: entry.verdict === 'fix' ? `${verdict.model}（已按复核意见修补）` : verdict.model,
      issues: entry.issues,
    };
    recorded += 1;
  }
  approvals.policy = {
    reviewer: 'model-assisted',
    note: '自用场景下由大模型逐词复核替代老师听审；人工抽检保留。音频侧仍需听审或 ASR 复核。',
    updatedAt: reviewedAt,
  };
  await writeFile('data/content-approvals.json', JSON.stringify(approvals, null, 2) + '\n');
  console.log(`✓ 审批记录：新增 ${recorded} 条（reviewer=${reviewer}）`);
  for (const item of pending) console.log(`  · 待处理 ${item}`);
}

try {
  const track = option('track') ?? 'textbook';
  const file = option('apply') ?? option('record') ?? args.find((argument) => argument.endsWith('.json'));
  if (flag('batch') || option('batch')) await writeBatch(track, option('batch') ?? 'tb4a_u2', option('out') ?? 'artifacts/ai-review');
  else if (option('apply')) await applyVerdict(track, resolve(option('apply')));
  else if (option('record')) await recordApprovals(track, resolve(option('record')), option('model'));
  else if (file) console.log(`提示：用法见文件头部注释（--batch / --apply / --record）。收到参数 ${file}`);
  else console.log('提示：用法见文件头部注释（--batch / --apply / --record）。');
} catch (error) {
  console.error(`模型复核失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

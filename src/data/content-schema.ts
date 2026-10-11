import { z } from 'zod';
import { chooseOptions } from '../domain/questions.ts';

const text = z.string().trim().min(1, '不能为空');
const wordId = z.string().regex(/^w_[a-z0-9]+_\d{3}$/, '词条 ID 格式不正确');
export const audioRefSchema = z.string().regex(/^[a-z0-9_]+#[a-z0-9_]+$/, '音频必须使用 sprite#clip 引用');
export const contentVersionSchema = z.string().regex(/^\d{4}\.(0[1-9]|1[0-2])\.\d+$/, '内容版本须为 YYYY.MM.N');
const isoDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
export const PHONEMES = new Set([
  'p', 'b', 't', 'd', 'k', 'g', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h', 'm', 'n', 'ŋ',
  'l', 'r', 'w', 'j', 'tʃ', 'dʒ', 'æ', 'ɛ', 'ɪ', 'ɑ', 'ɒ', 'ʌ', 'ʊ', 'ə', 'ɚ', 'ɝ', 'ɜː',
  'iː', 'uː', 'ɔː', 'ɑː', 'i', 'u', 'eɪ', 'aɪ', 'oʊ', 'ɔɪ', 'aʊ', 'ɪə', 'eə', 'ʊə',
]);
const phoneme = z.string().refine((value) => PHONEMES.has(value), '未知音素');
const shortVowels = new Set(['æ', 'ɛ', 'ɪ', 'ɑ', 'ɒ', 'ʌ']);
export const countWords = (value: string) => value.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0;
const limitedText = (limit: number) => text.refine((value) => countWords(value) <= limit, `不能超过 ${limit} 个英文词`);

const graphemeSchema = z.strictObject({
  letters: z.string().regex(/^[a-z]+$/),
  phonemes: z.array(phoneme),
  audio: audioRefSchema.nullable(),
  note: text.optional(),
}).superRefine((value, ctx) => {
  if ((value.phonemes.length === 0) !== (value.audio === null)) {
    ctx.addIssue({ code: 'custom', path: ['audio'], message: '只有不发音字母使用 null 音频' });
  }
  if (/^([bcdfghjklmnpqrstvwxyz])\1$/.test(value.letters) && value.phonemes.length !== 1) {
    ctx.addIssue({ code: 'custom', path: ['phonemes'], message: '双写辅音只对应一个音素' });
  }
});

const reviewSchema = z.strictObject({
  status: z.enum(['draft', 'text_approved', 'audio_approved']),
  reviewer: text.optional(),
  reviewedAt: isoDate.optional(),
}).superRefine((value, ctx) => {
  if (value.status !== 'draft' && (!value.reviewer || !value.reviewedAt)) {
    ctx.addIssue({ code: 'custom', message: '已批准内容必须有审核人和 ISO 审核时间' });
  }
});

// 课本单元与句子的比对、拼接只按字母，忽略大小写、空格与句末标点。
const lettersOf = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');
const literalsOf = (graphemes: readonly { letters: string }[]) => graphemes.map((part) => part.letters).join('').toLowerCase();

// 课本轨道的分组信息：一本书、一个单元、一个词性与是否核心词。
export const textbookSchema = z.strictObject({
  bookId: z.literal('yilin-4a-2024'),
  unit: z.number().int().min(1).max(8),
  pos: z.enum(['n.', 'v.', 'adj.', 'adv.', 'prep.', 'pron.', 'num.', 'conj.', 'int.', 'phr.', 'proper']),
  core: z.boolean(),
});

export const textbookUnitSchema = z.strictObject({
  schemaVersion: z.literal(1),
  bookId: z.literal('yilin-4a-2024'),
  unitId: z.string().regex(/^tb4a_u[1-8]$/),
  title: text,
  wordIds: z.array(wordId).min(1),
  spriteIds: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1),
});
export type TextbookUnit = z.infer<typeof textbookUnitSchema>;

const wordBase = z.strictObject({
  schemaVersion: z.union([z.literal(3), z.literal(4)]),
  wordId,
  kind: z.enum(['word', 'phrase']).default('word'),
  word: z.string().regex(/^[A-Za-z][A-Za-z'’ .!?…-]*$/),
  theme: z.enum(['animals', 'food', 'nature', 'colors', 'school', 'family', 'body']).optional(),
  textbook: textbookSchema.optional(),
  sightWordList: z.enum(['dolch_pre_primer', 'dolch_primer', 'dolch_first', 'dolch_nouns', 'fry_100', 'fry_300']).optional(),
  spelling: z.array(z.string().regex(/^[A-Za-z][A-Za-z'’-]*$/)).min(1),
  graphemes: z.array(graphemeSchema).min(1),
  phonemes: z.array(phoneme),
  syllables: z.array(z.string().regex(/^[A-Za-z'’-]+$/)).min(1),
  ipa: z.string().regex(/^\/[^/]+\/$/, 'IPA 须有完整的 /.../ 边界'),
  definition: z.strictObject({ en_young: limitedText(8).optional(), en_older: limitedText(10).optional(), zh: text }),
  example: z.strictObject({ en: limitedText(8), zh: text, audio: audioRefSchema }),
  audio: z.strictObject({ word: audioRefSchema, wordSlow: audioRefSchema }),
  illustration: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('emoji'), value: text }),
    z.strictObject({ type: z.literal('image'), src: z.string().regex(/^\/images\/words\/[a-z0-9_-]+\.(svg|png|webp)$/), alt: text }),
  ]),
  sfx: audioRefSchema.nullable().optional(),
  parentTip: z.strictObject({ en: text, zh: text }).optional(),
  review: reviewSchema,
  contentVersion: contentVersionSchema,
});
type WordShape = z.infer<typeof wordBase> & { track: 'phonics' | 'sight' | 'textbook'; phonicsStage?: 1 | 2 | 3 | 4 };

// 探索词条与课本词条共用同一套跨字段规则；差别只在字段是否必填（见下）。
function refineWord(word: WordShape, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  const textbook = word.track === 'textbook';
  // 轨道与分组字段互相排斥：探索词条属于场景，课本词条属于单元
  if (textbook && !word.textbook) issue('textbook', '课本词条必须声明 textbook');
  if (!textbook && word.textbook) issue('textbook', '只有课本轨道可以使用 textbook');
  if (textbook && word.theme !== undefined) issue('theme', '课本词条不使用场景');
  if (!textbook && word.theme === undefined) issue('theme', '探索词条必须归属一个场景');
  if (!textbook && !word.parentTip) issue('parentTip', '探索词条必须提供亲子提示');
  if (!textbook) {
    if (!word.definition.en_young) issue('definition', '探索词条必须提供 en_young');
    if (!word.definition.en_older) issue('definition', '探索词条必须提供 en_older');
  }
  if (word.kind === 'word') {
    if (word.spelling.some((part) => !/^[a-z]$/.test(part))) issue('spelling', 'spelling 必须逐字母');
    // 拼写、音节与字母组合与词形的比对只比字母，所以 o'clock 这类带撇号的单词也适用。
    if (word.spelling.join('') !== lettersOf(word.word)) issue('spelling', '逐字母拼接必须等于单词');
    if (lettersOf(word.syllables.join('')) !== lettersOf(word.word)) issue('syllables', '音节拼接必须等于单词');
    if (literalsOf(word.graphemes) !== lettersOf(word.word)) issue('graphemes', '字母组合拼接必须等于单词');
    if (!word.phonemes.length) issue('phonemes', '单词必须提供音素');
    if (word.definition.en_young && countWords(word.definition.en_young) > 5) issue('definition', '单词的 en_young 不能超过 5 个英文词');
    if (JSON.stringify(word.graphemes.flatMap((part) => part.phonemes)) !== JSON.stringify(word.phonemes)) issue('phonemes', '音素顺序必须与字母组合一致');
  } else {
    // 短语、句子和专有名词按字母比对，忽略大小写、空格与句末标点
    if (lettersOf(word.spelling.join('')) !== lettersOf(word.word)) issue('spelling', '短语词元拼接必须等于短语');
    if (lettersOf(word.syllables.join('')) !== lettersOf(word.word)) issue('syllables', '短语音节拼接必须等于短语');
    if (lettersOf(word.graphemes.map((part) => part.letters).join('')) !== lettersOf(word.word)) issue('graphemes', '字母组合拼接必须等于短语');
  }
  word.graphemes.forEach((part, index) => {
    if (/^[bcdfghjklmnpqrstvwxyz]$/.test(part.letters) && word.graphemes[index - 1]?.letters === part.letters) {
      issue('graphemes', '相邻双写辅音必须合并');
    }
  });
  if (word.track === 'phonics' && word.phonicsStage === 1 && (
    !/^[bcdfghjklmnpqrstvwxyz][aeiou][bcdfghjklmnpqrstvwxyz]$/.test(word.word)
    || word.graphemes.length !== 3 || word.phonemes.length !== 3
    || !shortVowels.has(word.phonemes[1] ?? '')
    || word.graphemes.some((part) => part.letters.length !== 1 || part.phonemes.length !== 1)
  )) issue('phonicsStage', '阶段 1 必须是三字母、三个音素、短元音的 CVC 词');
}

// 探索词条：释义、亲子提示与场景必填，保持 Stage 0~2 的既有契约不变。
const exploreBase = wordBase.extend({
  theme: z.enum(['animals', 'food', 'nature', 'colors', 'school', 'family', 'body']),
  parentTip: z.strictObject({ en: text, zh: text }),
  definition: z.strictObject({ en_young: limitedText(5), en_older: limitedText(10), zh: text }),
});
export const exploreWordSchema = z.discriminatedUnion('track', [
  exploreBase.extend({ track: z.literal('phonics'), phonicsStage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }),
  exploreBase.extend({ track: z.literal('sight') }),
]).superRefine(refineWord);

// 课本词条：只用中文释义与单元分组，其余（拼读拆分、插图、音频、审批）与探索词条同规。
export const textbookWordSchema = wordBase.extend({ track: z.literal('textbook'), textbook: textbookSchema }).superRefine(refineWord);

function uniqueWordIds(words: { wordId: string }[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  words.forEach((word, index) => {
    if (seen.has(word.wordId)) ctx.addIssue({ code: 'custom', path: [index, 'wordId'], message: '词条 ID 重复' });
    seen.add(word.wordId);
  });
}

export const wordsSchema = z.array(exploreWordSchema).min(1, '词库不能为空').superRefine(uniqueWordIds);
export const textbookWordsSchema = z.array(textbookWordSchema).min(1, '课本词库不能为空').superRefine(uniqueWordIds);
export type WordEntry = z.infer<typeof exploreWordSchema>;
export type TextbookWordEntry = z.infer<typeof textbookWordSchema>;

export const themeSchema = z.strictObject({
  schemaVersion: z.literal(1), contentVersion: contentVersionSchema,
  themeId: z.string().regex(/^[a-z_]+$/), title: z.strictObject({ zh: text, en: text }),
  wordIds: z.array(wordId).min(1), pages: z.array(z.array(wordId).min(1).max(5)).min(1),
  listenTapWordIds: z.array(wordId), confusablePairs: z.array(z.tuple([wordId, wordId])),
  spriteIds: z.array(z.string().regex(/^[a-z_]+$/)).min(1),
  unlock: z.strictObject({ prerequisiteThemeId: z.string().regex(/^[a-z_]+$/).nullable(), requiredFirstCorrect: z.number().int().min(0) }),
}).superRefine((theme, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const ids = new Set(theme.wordIds);
  if (ids.size !== theme.wordIds.length) issue('场景收词不能重复');
  const pageIds = theme.pages.flat();
  if (new Set(pageIds).size !== pageIds.length || pageIds.length !== ids.size || pageIds.some((id) => !ids.has(id))) issue('场景分页必须无重复地覆盖所有词');
  if (new Set(theme.listenTapWordIds).size !== theme.listenTapWordIds.length || theme.listenTapWordIds.some((id) => !ids.has(id))) issue('活动白名单重复或超出场景');
  if (theme.confusablePairs.some(([a, b]) => a === b || !ids.has(a) || !ids.has(b))) issue('易混淆词对必须引用两个不同场景词');
  if (theme.unlock.prerequisiteThemeId === theme.themeId) issue('场景不能以前置条件引用自身');
});
export type ThemeConfig = z.infer<typeof themeSchema>;

export function audioReferences(word: WordEntry | TextbookWordEntry): string[] {
  const graphemeAudio = word.track === 'phonics' || word.track === 'textbook'
    ? word.graphemes.flatMap((part) => part.audio === null ? [] : [part.audio]) : [];
  return [word.audio.word, word.audio.wordSlow, word.example.audio, ...graphemeAudio, ...(word.sfx ? [word.sfx] : [])];
}

export function validateCatalog(wordsInput: unknown, themesInput: unknown, release = false) {
  const words = wordsSchema.parse(wordsInput);
  const themes = z.array(themeSchema).min(1).parse(themesInput);
  const errors: string[] = [];
  const byId = new Map(words.map((word) => [word.wordId, word]));
  if (new Set(themes.map((theme) => theme.themeId)).size !== themes.length) errors.push('场景 ID 重复');
  for (const theme of themes) {
    const seen = new Set<string>(); let ancestor: ThemeConfig | undefined = theme;
    while (ancestor?.unlock.prerequisiteThemeId) {
      if (seen.has(ancestor.themeId)) { errors.push(`${theme.themeId}: 场景解锁存在循环依赖`); break; }
      seen.add(ancestor.themeId);
      const parent = themes.find((entry) => entry.themeId === ancestor!.unlock.prerequisiteThemeId);
      if (!parent) { errors.push(`${theme.themeId}: 前置场景不存在`); break; }
      if (ancestor.unlock.requiredFirstCorrect > parent.listenTapWordIds.length) errors.push(`${ancestor.themeId}: 前置场景无法达到解锁词数`);
      ancestor = parent;
    }
    for (const id of theme.wordIds) {
      const word = byId.get(id);
      if (!word) { errors.push(`${theme.themeId}: 缺少词 ${id}`); continue; }
      if (word.contentVersion !== theme.contentVersion) errors.push(`${id}: 词条与场景版本不符`);
      for (const ref of audioReferences(word)) if (!theme.spriteIds.includes(ref.split('#')[0] ?? '')) errors.push(`${id}: 未声明精灵 ${ref}`);
    }
    const pool = theme.listenTapWordIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
    if (pool.length > 0 && !pool.some((word) => chooseOptions(word, pool, 3, theme, () => 0.5))) errors.push(`${theme.themeId}: 活动白名单无法组成三个可区分的选项`);
  }
  if (release) for (const word of words) {
    if (word.review.status !== 'audio_approved') errors.push(`${word.wordId}: 正式包只允许 audio_approved`);
    if (word.illustration.type !== 'image') errors.push(`${word.wordId}: 正式包不允许 emoji 占位图`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { words, themes };
}

const sourcePath = z.string().regex(/^data\/textbook\/[a-z0-9_-]+\.json$/).refine((value) => !value.includes('..'));

export const textbookCatalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  bookId: z.literal('yilin-4a-2024'),
  units: z.array(z.strictObject({ unitId: z.string().regex(/^tb4a_u[1-8]$/), config: sourcePath, words: sourcePath })).min(1),
});
export type TextbookCatalogSource = z.infer<typeof textbookCatalogSchema>;

// 构建产物里随包发布的课本块；运行时加载词库时按这份契约校验。
export const textbookAssetSchema = z.strictObject({
  bookId: z.literal('yilin-4a-2024'),
  units: z.array(textbookUnitSchema).min(1),
  words: textbookWordsSchema,
});
export type TextbookCatalog = z.infer<typeof textbookAssetSchema>;

export function validateTextbook(wordsInput: unknown, unitsInput: unknown, options: { themeWordIds?: readonly string[]; release?: boolean } = {}) {
  // 课本词库与探索词库共用同一个跨字段规则集（refineWord），但各自单独校验。
  const words = textbookWordsSchema.parse(wordsInput);
  const units = z.array(textbookUnitSchema).min(1).parse(unitsInput);
  const errors: string[] = [];
  const byId = new Map(words.map((word) => [word.wordId, word]));
  const reserved = new Set(options.themeWordIds ?? []);
  if (new Set(units.map((unit) => unit.unitId)).size !== units.length) errors.push('课本单元 ID 重复');
  if (new Set(units.map((unit) => unit.bookId)).size !== 1) errors.push('课本单元不属于同一本书');
  if (new Set(words.map((word) => word.contentVersion)).size > 1) errors.push('课本词条的内容版本不一致');
  const covered = new Set<string>();
  for (const unit of units) {
    const unitNumber = Number(unit.unitId.slice('tb4a_u'.length));
    for (const id of unit.wordIds) {
      const word = byId.get(id);
      if (!word) { errors.push(`${unit.unitId}: 缺少词 ${id}`); continue; }
      if (reserved.has(id)) errors.push(`${id}: 与探索词库的 ID 冲突`);
      if (covered.has(id)) errors.push(`${id}: 被多个单元重复收录`);
      covered.add(id);
      if (word.textbook.unit !== unitNumber) errors.push(`${id}: 所属单元与 textbook.unit 不一致`);
      for (const ref of audioReferences(word)) {
        const spriteId = ref.split('#')[0] ?? '';
        if (!unit.spriteIds.includes(spriteId)) errors.push(`${id}: 未声明精灵 ${ref}`);
      }
    }
  }
  for (const word of words) if (!covered.has(word.wordId)) errors.push(`${word.wordId}: 未进入任何课本单元`);
  // 探索词库的发布门禁在 validateCatalog；课本词库单独校验，所以同一规则在这里再执行一次。
  if (options.release) for (const word of words) {
    if (word.review.status !== 'audio_approved') errors.push(`${word.wordId}: 正式包只允许 audio_approved`);
    if (word.illustration.type !== 'image') errors.push(`${word.wordId}: 正式包不允许 emoji 占位图`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { words, units };
}

const assetUrl = z.string().regex(/^(content|core|images|icons|fonts)\/[a-zA-Z0-9/_\-.]+$/)
  .refine((value) => !value.includes('..') && !value.includes('//'), '资源必须为安全的同源相对路径');
export const assetSchema = z.strictObject({ url: assetUrl, bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/), mime: text });
export type AssetRecord = z.infer<typeof assetSchema>;
export const manifestSchema = z.strictObject({
  manifestVersion: z.literal(1), schemaVersion: z.union([z.literal(3), z.literal(4)]), contentVersion: contentVersionSchema,
  stage: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  appContract: z.strictObject({ min: z.number().int().positive(), max: z.number().int().positive() }),
  assets: z.record(z.string(), assetSchema), sprites: z.record(z.string(), text),
  packs: z.array(z.strictObject({ id: text, themeId: text.nullable(), dependsOn: z.array(text), assetIds: z.array(text) })).min(1),
  catalogAssetId: text,
  // Preview must declare missing recordings; these may never become a ready learning pack.
  missingAudio: z.array(audioRefSchema).default([]),
  mode: z.enum(['preview', 'release']),
  builtinSprites: z.array(z.literal('sfx')).optional(),
}).superRefine((manifest, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (manifest.appContract.min > manifest.appContract.max) issue('应用契约版本区间错误');
  if (!manifest.assets[manifest.catalogAssetId]) issue('缺少词库文件');
  if (manifest.mode === 'release' && manifest.missingAudio.length) issue('正式清单不能缺音频');
  const packs = new Map(manifest.packs.map((pack) => [pack.id, pack]));
  if (packs.size !== manifest.packs.length) issue('资源包 ID 重复');
  for (const id of Object.values(manifest.sprites)) if (!manifest.assets[id]) issue(`缺少精灵清单 ${id}`);
  const visiting = new Set<string>(); const visited = new Set<string>();
  const walk = (id: string) => {
    if (visiting.has(id)) { issue('资源包存在循环依赖'); return; }
    if (visited.has(id)) return;
    const pack = packs.get(id);
    if (!pack) { issue(`缺少依赖包 ${id}`); return; }
    visiting.add(id);
    for (const assetId of pack.assetIds) if (!manifest.assets[assetId]) issue(`资源包 ${id} 缺少 ${assetId}`);
    for (const dependency of pack.dependsOn) walk(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const pack of manifest.packs) walk(pack.id);
  const covered = new Set(manifest.packs.flatMap((pack) => pack.assetIds));
  for (const id of Object.keys(manifest.assets)) if (!covered.has(id)) issue(`资源没有所属包 ${id}`);
});
export type ContentManifest = z.infer<typeof manifestSchema>;

export const spriteSchema = z.strictObject({
  audioAssetId: text, durationMs: z.number().positive(), sampleRate: z.number().int().positive(), channels: z.number().int().min(1).max(2),
  sprite: z.record(z.string().regex(/^[a-z0-9_]+$/), z.tuple([z.number().nonnegative(), z.number().positive()])),
}).superRefine((value, ctx) => {
  const intervals = Object.entries(value.sprite).sort((a, b) => a[1][0] - b[1][0]);
  if (!intervals.length) ctx.addIssue({ code: 'custom', message: '精灵不能没有片段' });
  let end = 0;
  for (const [name, [start, length]] of intervals) {
    if (start < end || start + length > value.durationMs + 1) ctx.addIssue({ code: 'custom', message: `片段 ${name} 重叠或越界` });
    end = Math.max(end, start + length);
  }
});
export type SpriteManifest = z.infer<typeof spriteSchema>;

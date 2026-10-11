import { describe, expect, it } from 'vitest';
import { exploreWordSchema, textbookWordsSchema, validateTextbook } from '../src/data/content-schema.ts';
import { words as exploreWords } from './fixtures.ts';

const BOOK = 'yilin-4a-2024';
const VERSION = '2026.10.1';
const clip = (name: string) => `tb4a_u2#${name}`;

function word(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 4, wordId: 'w_tb4a_001', kind: 'word', word: 'day', track: 'textbook',
    textbook: { bookId: BOOK, unit: 2, pos: 'n.', core: true },
    spelling: ['d', 'a', 'y'], syllables: ['day'], ipa: '/deɪ/',
    graphemes: [
      { letters: 'd', phonemes: ['d'], audio: clip('p_d') },
      { letters: 'ay', phonemes: ['eɪ'], audio: clip('p_ay') },
    ],
    phonemes: ['d', 'eɪ'],
    definition: { zh: '一天，一日' },
    example: { en: 'Have a nice day.', zh: '祝你有愉快的一天！', audio: clip('day_example') },
    audio: { word: clip('day'), wordSlow: clip('day_slow') },
    illustration: { type: 'emoji', value: '📅' },
    review: { status: 'draft' },
    contentVersion: VERSION,
    ...overrides,
  };
}

function phrase(overrides: Record<string, unknown> = {}) {
  return word({
    wordId: 'w_tb4a_002', kind: 'phrase', word: 'get up', spelling: ['get', 'up'], syllables: ['get', 'up'], ipa: '/ɡet ʌp/',
    phonemes: [], graphemes: [
      { letters: 'g', phonemes: [], audio: null },
      { letters: 'et', phonemes: [], audio: null },
      { letters: 'up', phonemes: [], audio: null },
    ],
    definition: { zh: '起床' }, example: { en: 'I get up at six.', zh: '我六点起床。', audio: clip('get_up_example') },
    audio: { word: clip('get_up'), wordSlow: clip('get_up_slow') }, textbook: { bookId: BOOK, unit: 2, pos: 'phr.', core: true },
    ...overrides,
  });
}

const unit = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1, bookId: BOOK, unitId: 'tb4a_u2', title: 'Unit 2 My day',
  wordIds: ['w_tb4a_001', 'w_tb4a_002'], spriteIds: ['tb4a_u2'], ...overrides,
});

describe('textbook contract v4', () => {
  it('accepts a word and a phrase inside one unit', () => {
    const parsed = validateTextbook([word(), phrase()], [unit()]);
    expect(parsed.words.map((entry) => entry.kind)).toEqual(['word', 'phrase']);
    expect(parsed.units).toHaveLength(1);
  });

  it('rejects a phrase that forgot to declare itself', () => {
    // 缺省 kind 是 word，于是“get up”会先被逐字母规则拦住
    const result = textbookWordsSchema.safeParse([phrase({ kind: undefined })]);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => /逐字母|拼接/.test(String(issue.message)))).toBe(true);
  });

  it('rejects a textbook word without the textbook block', () => {
    const result = textbookWordsSchema.safeParse([word({ textbook: undefined })]);
    expect(result.success).toBe(false);
  });

  it('rejects a scene entry masquerading as a textbook word', () => {
    const result = textbookWordsSchema.safeParse([{ ...exploreWords[0], track: 'textbook', textbook: { bookId: BOOK, unit: 2, pos: 'n.', core: true } }]);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => String(issue.message).includes('不使用场景'))).toBe(true);
  });

  it('rejects graphemes that do not spell the phrase', () => {
    const result = textbookWordsSchema.safeParse([phrase({ graphemes: [
      { letters: 'g', phonemes: [], audio: null }, { letters: 'ot', phonemes: [], audio: null }, { letters: 'up', phonemes: [], audio: null },
    ] })]);
    expect(result.success).toBe(false);
  });

  it('still refuses a non-CVC word marked as phonics stage 1', () => {
    const cvc = { ...exploreWords[0], word: 'fox', wordId: 'w_fox_999', spelling: ['f', 'o', 'x'], syllables: ['fox'],
      graphemes: [{ letters: 'f', phonemes: ['f'], audio: 'phonics#f' }, { letters: 'o', phonemes: ['ɑ'], audio: 'phonics#o_short' }, { letters: 'x', phonemes: ['k', 's'], audio: 'phonics#x' }], phonemes: ['f', 'ɑ', 'k', 's'] };
    expect(exploreWordSchema.safeParse(cvc).success).toBe(false);
  });

  it('requires every textbook word to sit in exactly one unit', () => {
    expect(() => validateTextbook([word(), phrase()], [unit({ wordIds: ['w_tb4a_001'] })])).toThrow('未进入任何课本单元');
    expect(() => validateTextbook([word(), phrase()], [unit({ wordIds: ['w_tb4a_001', 'w_tb4a_002', 'w_tb4a_001'] })])).toThrow('重复收录');
    expect(() => validateTextbook([word(), phrase()], [unit({ wordIds: ['w_tb4a_001', 'w_tb4a_003'] })])).toThrow('缺少词');
  });

  it('refuses word ids that collide with the exploration catalogue', () => {
    expect(() => validateTextbook([word(), phrase()], [unit()], { themeWordIds: ['w_tb4a_001'] })).toThrow('与探索词库的 ID 冲突');
  });

  it('binds each unit to its own textbook.unit and sprite', () => {
    expect(() => validateTextbook([word(), phrase()], [unit({ unitId: 'tb4a_u3' })])).toThrow('所属单元');
    expect(() => validateTextbook([word({ audio: { word: 'tb4a_u9#day', wordSlow: clip('day_slow') } }), phrase()], [unit()])).toThrow('未声明精灵');
  });

  it('keeps draft and emoji content out of a release build', () => {
    expect(() => validateTextbook([word(), phrase()], [unit()], { release: true })).toThrow('正式包只允许 audio_approved');
    const approved = word({ review: { status: 'audio_approved', reviewer: '老师', reviewedAt: '2026-10-11' } });
    expect(() => validateTextbook([approved, phrase({ review: { status: 'audio_approved', reviewer: '老师', reviewedAt: '2026-10-11' } })], [unit()], { release: true }))
      .toThrow('正式包不允许 emoji 占位图');
  });

  it('rejects a unit list that is empty or duplicated', () => {
    expect(textbookWordsSchema.safeParse([]).success).toBe(false);
    expect(() => validateTextbook([word(), phrase()], [])).toThrow();
    expect(() => validateTextbook([word(), phrase()], [unit(), unit()])).toThrow('课本单元 ID 重复');
  });
});

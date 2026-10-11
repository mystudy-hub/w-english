import { describe, expect, it } from 'vitest';
import { textbookWordSchema, type TextbookWordEntry } from '../src/data/content-schema.ts';
import { DEFAULT_MODES, MODE_LABELS, checkSpelling, distractors, makeQuestion, shuffle, spellingTiles } from '../src/drill/quiz.ts';

let serial = 100;
function entry(word: string, zh: string, unit: number, pos: TextbookWordEntry['textbook']['pos'] = 'n.'): TextbookWordEntry {
  serial += 1;
  const phrase = word.includes(' ');
  const letters = [...word.replace(/[^a-z]/gi, '').toLowerCase()];
  return textbookWordSchema.parse({
    schemaVersion: 4, wordId: `w_tb4a_${serial}`, kind: phrase ? 'phrase' : 'word', word, track: 'textbook',
    textbook: { bookId: 'yilin-4a-2024', unit, pos, core: true },
    spelling: phrase ? word.split(' ') : letters,
    syllables: phrase ? word.split(' ') : [word],
    ipa: '/test/', graphemes: [{ letters: letters.join(''), phonemes: phrase ? [] : ['d'], audio: phrase ? null : 'tb4a_u2#p_d' }],
    phonemes: phrase ? [] : ['d'],
    definition: { zh }, example: { en: 'Test sentence.', zh: '测试句。', audio: 'tb4a_u2#example' },
    audio: { word: 'tb4a_u2#word', wordSlow: 'tb4a_u2#word_slow' },
    illustration: { type: 'emoji', value: '🔤' }, review: { status: 'draft' }, contentVersion: '2026.10.1',
  });
}

const first = () => 0; // 固定随机源：shuffle 保持不变，模式选择取第一个可用项

const day = entry('day', '一天', 2);
const night = entry('night', '夜晚', 2);
const week = entry('week', '一周', 3);
const getUp = entry('get up', '起床', 2, 'phr.');
const pool = [day, night, week, getUp];

describe('drill question generation', () => {
  it('offers the five modes that the specification lists', () => {
    expect(Object.keys(MODE_LABELS)).toEqual(['choice_en2zh', 'choice_zh2en', 'spelling', 'listening', 'flip']);
    expect(DEFAULT_MODES).toEqual(['choice_en2zh', 'choice_zh2en', 'listening', 'spelling']);
  });

  it('builds an English-to-Chinese choice with unique options that contain the answer', () => {
    const question = makeQuestion(day, pool, ['choice_en2zh'], first);
    expect(question.mode).toBe('choice_en2zh');
    if (question.mode !== 'choice_en2zh') return;
    expect(question.prompt).toBe('day');
    expect(question.answer).toBe('一天');
    expect(question.options).toContain('一天');
    expect(new Set(question.options).size).toBe(question.options.length);
    expect(question.speakText).toBe('day');
  });

  it('prompts with Chinese and answers in English for the reversed choice', () => {
    const question = makeQuestion(night, pool, ['choice_zh2en'], first);
    expect(question.mode).toBe('choice_zh2en');
    if (question.mode !== 'choice_zh2en') return;
    expect(question.prompt).toBe('夜晚');
    expect(question.answer).toBe('night');
    expect(question.options).toContain('night');
  });

  it('asks for spelling and listening without leaking the answer into the options', () => {
    const spelling = makeQuestion(week, pool, ['spelling'], first);
    expect(spelling).toMatchObject({ mode: 'spelling', hintZh: '一周', answer: 'week' });
    const listening = makeQuestion(week, pool, ['listening'], first);
    expect(listening.mode).toBe('listening');
    if (listening.mode !== 'listening') return;
    expect(listening.options).toContain('week');
    expect(listening.answer).toBe('week');
  });

  it('falls back to a flip card when nothing else is possible', () => {
    expect(makeQuestion(day, [day], ['choice_en2zh'], first)).toMatchObject({ mode: 'flip', speakText: 'day' });
    expect(makeQuestion(day, pool, [], first).mode).toBe('flip');
  });

  it('prefers same-unit, same-part-of-speech distractors before widening', () => {
    const picked = distractors(day, pool, 'word', 1, first);
    expect(['night']).toContain(picked[0]!.word); // 同单元同词性
    const wide = distractors(day, [day, week], 'word', 1, first);
    expect(wide[0]!.word).toBe('week'); // 只剩跨单元候选
    expect(distractors(day, pool, 'word', 5, first)).toHaveLength(3);
  });

  it('never repeats the target text as a distractor', () => {
    const twin = entry('day', '白天', 2);
    const picked = distractors(twin, [twin, day, night], 'word', 3, first);
    expect(picked.map((word) => word.word)).toEqual(['night']);
  });

  it('keeps phrases usable in every mode', () => {
    expect(spellingTiles(getUp)).toEqual(['get', 'up']);
    expect(spellingTiles(day)).toEqual(['d', 'a', 'y']);
    expect(makeQuestion(getUp, pool, ['spelling'], first)).toMatchObject({ mode: 'spelling', answer: 'get up' });
  });

  it('accepts child-typed spelling with case, spacing and hyphen differences', () => {
    expect(checkSpelling('  Get Up ', 'get up')).toBe(true);
    expect(checkSpelling('getup', 'get up')).toBe(true);
    expect(checkSpelling('icecream', 'ice-cream')).toBe(true);
    expect(checkSpelling('get', 'get up')).toBe(false);
  });

  it('shuffles deterministically with an injected random source', () => {
    expect(shuffle([1, 2, 3], first)).toEqual([2, 3, 1]);
    expect(shuffle([1, 2, 3], () => 0.999)).toEqual([1, 2, 3]);
    expect(shuffle([1, 2, 3]).sort()).toEqual([1, 2, 3]);
  });
});

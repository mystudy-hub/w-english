import type { ThemeConfig, WordEntry } from '../data/content-schema.ts';
import { LEVELS } from './config.ts';
import type { ConfigSnapshot, Question, SessionSnapshot, WordProgress } from './models.ts';
import { shuffled } from './questions.ts';

export function createSpellingSession(input: {
  id: string; now: number; theme: ThemeConfig; words: WordEntry[]; progress: WordProgress[];
  config: ConfigSnapshot; readyIds: ReadonlySet<string>; random: () => number; release?: boolean; manifestId?: string;
  focusWordId?: string;
  contentStage?: 0 | 1 | 2;
}): SessionSnapshot | null {
  const progress = new Map(input.progress.map((entry) => [entry.wordId, entry]));
  const pool = input.words.filter((word) => input.theme.wordIds.includes(word.wordId) && word.track === 'phonics'
    && (!input.focusWordId || word.wordId === input.focusWordId)
    && word.phonicsStage <= LEVELS[input.config.learningLevel].phonicsStage && input.readyIds.has(word.wordId)
    && (!input.release || word.review.status === 'audio_approved'));
  const words = shuffled(pool, input.random).sort((a, b) => (progress.get(a.wordId)?.lastAskedAt ?? 0) - (progress.get(b.wordId)?.lastAskedAt ?? 0)).slice(0, 5);
  if (!words.length) return null;
  const questions: Question[] = words.map((word, index) => {
    const tiles = word.spelling.map((_, index) => index);
    return { id: `${input.id}:q${index + 1}`, wordId: word.wordId, optionIds: [], state: 'loading',
      attemptCount: 0, heardInQuestion: false, hinted: false, remainingMs: null,
      spelling: { tiles: input.config.interactionMode === 'drag' ? shuffled(tiles, input.random) : tiles, placed: [], heardParts: [], skipped: false } };
  });
  return { id: input.id, status: 'active', activity: 'tapSpell', themeId: input.theme.themeId,
    contentStage: input.contentStage,
    contentVersion: input.theme.contentVersion, manifestId: input.manifestId,
    configSnapshot: { ...input.config, timeLimitMs: null }, questions, questionIds: questions.map((question) => question.id),
    currentQuestionIndex: 0, startedAt: input.now, updatedAt: input.now, clockRolledBack: false };
}
export function spellingReadyToFinish(question: Question, word: WordEntry) {
  const spelling = question.spelling;
  return Boolean(word.track === 'phonics' && spelling && !spelling.skipped && question.heardInQuestion && spelling.pendingPart === undefined
    && spelling.placed.length === word.spelling.length
    && word.graphemes.every((part, index) => part.audio === null || spelling.heardParts.includes(index)));
}
const VOWELS = new Set(['æ', 'ɛ', 'ɪ', 'ɑ', 'ɒ', 'ʌ', 'ʊ', 'ə', 'ɚ', 'ɝ', 'ɜː', 'iː', 'uː', 'ɔː', 'ɑː', 'i', 'u', 'eɪ', 'aɪ', 'oʊ', 'ɔɪ', 'aʊ', 'ɪə', 'eə', 'ʊə']);
export function graphemeKind(part: WordEntry['graphemes'][number]) {
  if (!part.phonemes.length) return 'silent';
  if (part.phonemes.every((phoneme) => VOWELS.has(phoneme))) return 'vowel';
  return part.phonemes.some((phoneme) => VOWELS.has(phoneme)) ? 'mixed' : 'consonant';
}
export function placeSpellingTile(question: Question, word: WordEntry, tile: number): { question: Question; accepted: boolean } {
  const spelling = question.spelling;
  if (!spelling || spelling.skipped || question.state !== 'awaitingAnswer' || !question.heardInQuestion || spelling.pendingPart !== undefined) throw new Error('请先听完当前声音');
  if (!spelling.tiles.includes(tile) || spelling.placed.includes(tile) || word.spelling[tile] !== word.spelling[spelling.placed.length]) return { question, accepted: false };
  const placed = [...spelling.placed, tile];
  let offset = 0; let pendingPart: number | undefined;
  word.graphemes.forEach((part, index) => {
    offset += part.letters.length;
    if (offset === placed.length && part.audio !== null && !spelling.heardParts.includes(index)) pendingPart = index;
  });
  return { accepted: true, question: { ...question, state: pendingPart === undefined ? 'awaitingAnswer' : 'promptPlaying',
    spelling: { ...spelling, placed, pendingPart } } };
}
export function spellingPartHeard(question: Question, word: WordEntry, part: number): Question {
  const spelling = question.spelling;
  if (!spelling || spelling.skipped || spelling.pendingPart !== part || !word.graphemes[part]?.audio) throw new Error('拼读声音已经切换');
  return { ...question, state: 'awaitingAnswer', spelling: { ...spelling, pendingPart: undefined,
    heardParts: [...new Set([...spelling.heardParts, part])] } };
}

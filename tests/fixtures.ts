import wordData from '../data/stage0_words.json';
import themeData from '../data/stage0_theme.json';
import { themeSchema, wordsSchema } from '../src/data/content-schema.ts';
import { defaultSettings } from '../src/domain/config.ts';
import type { AttemptRecord, Question } from '../src/domain/models.ts';

export const words = wordsSchema.parse(wordData);
export const theme = themeSchema.parse(themeData);
export const readyIds = new Set(words.map((word) => word.wordId));
export const settings = defaultSettings();
export function question(overrides: Partial<Question> = {}): Question {
  return { id: 's:q1', wordId: words[0]!.wordId, optionIds: words.slice(0, 3).map((word) => word.wordId),
    state: 'awaitingAnswer', attemptCount: 0, hinted: false, heardInQuestion: true, remainingMs: null, ...overrides };
}
export function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return { id: 's:q1:1', sessionId: 's', questionId: 's:q1', wordId: words[0]!.wordId,
    contentVersion: theme.contentVersion, ts: 1_000, activity: 'listenTap', attemptNo: 1,
    kind: 'select', selectedWordId: words[0]!.wordId, correct: true, heardInQuestion: true, hinted: false, ...overrides };
}

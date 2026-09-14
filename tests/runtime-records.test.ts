import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { abandonSession, changeLearningRest, clearLearningRecords, leaveExperience, recordLearningTime, refreshRecords, repository, sessionLock } from '../src/app/runtime.ts';
import { useAppStore } from '../src/app/store.ts';
import { database } from '../src/data/database.ts';
import { configSnapshot, defaultGuide } from '../src/domain/config.ts';
import type { UsageState, WordProgress } from '../src/domain/models.ts';
import { createSession } from '../src/domain/questions.ts';
import { defaultUsage } from '../src/domain/usage.ts';
import { readyIds, theme, words } from './fixtures.ts';
import { syntheticContent } from './helpers/synthetic-content.ts';

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Dexie.Promise<T>((fulfilled, failed) => { resolve = fulfilled; reject = failed; });
  return { promise, resolve, reject };
}
const oldProgress: WordProgress[] = [{ wordId: 'w_cat_001', heardCount: 1 }];
const newProgress: WordProgress[] = [{ wordId: 'w_cat_001', heardCount: 2 }];
let usageCycle = 0;
const makeRound = (id = 'round') => createSession({ id, now: 1000, theme, words, readyIds, progress: [], config: configSnapshot('tap', 'L1'), random: () => .25 })!;

beforeEach(() => {
  useAppStore.setState({ storage: 'persistent', entered: true, parentAuthorized: true, learningAccess: 'writer',
    progress: [], stickers: [], guide: defaultGuide(), session: undefined, notice: undefined, content: undefined,
    usage: { ...defaultUsage(), cycle: ++usageCycle }, interactionPaused: false });
  vi.spyOn(repository, 'progress').mockResolvedValue(oldProgress);
  vi.spyOn(database.guideState, 'get').mockResolvedValue(defaultGuide());
  vi.spyOn(repository, 'activeSession').mockResolvedValue(undefined);
  vi.spyOn(repository, 'stickers').mockResolvedValue([]);
});
afterEach(() => { vi.restoreAllMocks(); location.hash = ''; });

it.each(['resolve', 'reject'] as const)('keeps a newer refresh when an older query finishes late: %s', async (outcome) => {
  const oldQuery = deferred<WordProgress[]>();
  vi.mocked(repository.progress).mockReturnValueOnce(oldQuery.promise).mockResolvedValueOnce(newProgress);
  const older = refreshRecords(); await refreshRecords();
  expect(useAppStore.getState().progress).toEqual(newProgress);
  if (outcome === 'resolve') oldQuery.resolve(oldProgress); else oldQuery.reject(new Error('Old query failed'));
  await older;
  expect(useAppStore.getState().progress).toEqual(newProgress);
  expect(useAppStore.getState().notice).toBeUndefined();
});

it('does not move a question backward when a background record refresh returns an earlier snapshot', async () => {
  const round = createSession({ id: 'round', now: 1000, theme, words, readyIds, progress: [], config: configSnapshot('tap', 'L1'), random: () => .25 })!;
  useAppStore.setState({ session: round });
  vi.mocked(repository.activeSession).mockResolvedValue(structuredClone(round));
  const query = deferred<WordProgress[]>(); vi.mocked(repository.progress).mockReturnValue(query.promise);
  const refreshing = refreshRecords();
  const advanced = structuredClone(round); advanced.currentQuestionIndex = 1; advanced.questions[0]!.state = 'completed';
  useAppStore.setState({ session: advanced }); query.resolve(newProgress); await refreshing;
  expect(useAppStore.getState().session).toBe(advanced);
  expect(useAppStore.getState().progress).toEqual(newProgress);
});

it('does not restore cleared parent statistics from an earlier query', async () => {
  location.hash = '/parent'; useAppStore.setState({ progress: oldProgress });
  vi.spyOn(sessionLock, 'held', 'get').mockReturnValue(true);
  vi.spyOn(repository, 'clearLearningRecords').mockResolvedValue(undefined);
  const query = deferred<WordProgress[]>(); vi.mocked(repository.progress).mockReturnValue(query.promise);
  const refreshing = refreshRecords();
  await clearLearningRecords(); expect(useAppStore.getState().progress).toEqual([]);
  query.resolve(oldProgress); await refreshing;
  expect(useAppStore.getState().progress).toEqual([]);
  expect(useAppStore.getState().session).toBeUndefined();
});

it('does not restore a round after the session became active and empty again during a query', async () => {
  const round = makeRound(); const query = deferred<WordProgress[]>();
  vi.mocked(repository.progress).mockReturnValue(query.promise);
  vi.mocked(repository.activeSession).mockResolvedValue(round);
  const refreshing = refreshRecords();
  useAppStore.setState({ session: round }); useAppStore.setState({ session: undefined });
  query.resolve(newProgress); await refreshing;
  expect(useAppStore.getState().session).toBeUndefined();
  expect(useAppStore.getState().progress).toEqual(newProgress);
});

it.each(['another-round', 'another-visit'] as const)('a late exit does not clear the current session: %s', async (scenario) => {
  const original = makeRound(); useAppStore.setState({ session: original });
  vi.spyOn(sessionLock, 'held', 'get').mockReturnValue(true);
  const saving = deferred<void>(); vi.spyOn(repository, 'abandonSession').mockReturnValue(saving.promise);
  const exiting = abandonSession();
  if (scenario === 'another-visit') leaveExperience();
  const current = makeRound(scenario === 'another-visit' ? original.id : 'new-round');
  useAppStore.setState({ entered: true, session: current });
  saving.resolve(); await exiting;
  expect(useAppStore.getState().session).toBe(current);
});

it('a delayed rest save keeps its deadline without bringing back a cleared session', async () => {
  location.hash = '/parent'; const round = makeRound(); useAppStore.setState({ session: round });
  vi.spyOn(sessionLock, 'held', 'get').mockReturnValue(true);
  vi.spyOn(repository, 'clearLearningRecords').mockResolvedValue(undefined);
  const saving = deferred<Awaited<ReturnType<typeof repository.changeUsage>>>();
  vi.spyOn(repository, 'changeUsage').mockReturnValue(saving.promise);
  const changing = changeLearningRest('show');
  await clearLearningRecords();
  const resting: UsageState = { ...useAppStore.getState().usage, phase: 'resting', restUntil: Date.now() + 180_000 };
  saving.resolve({ usage: resting, session: { ...round, restUntil: resting.restUntil } }); await changing;
  expect(useAppStore.getState().session).toBeUndefined();
  expect(useAppStore.getState().usage).toEqual(resting);
});

it('a rest action from a previous visit cannot replace the current visit state', async () => {
  vi.spyOn(sessionLock, 'held', 'get').mockReturnValue(true);
  const saving = deferred<Awaited<ReturnType<typeof repository.changeUsage>>>();
  vi.spyOn(repository, 'changeUsage').mockReturnValue(saving.promise);
  const previous = useAppStore.getState().usage; const changing = changeLearningRest('show');
  leaveExperience(); const current = { ...defaultUsage(18), cycle: previous.cycle + 1, elapsedMs: 2000 };
  useAppStore.setState({ entered: true, usage: current });
  saving.resolve({ usage: { ...previous, phase: 'reminder' }, session: makeRound('previous') }); await changing;
  expect(useAppStore.getState().usage).toBe(current);
  expect(useAppStore.getState().session).toBeUndefined();
});

it.each(['resolve', 'reject'] as const)('ignores a previous visit time checkpoint result: %s', async (outcome) => {
  const fixture = syntheticContent({ scenes: true, audio: false });
  useAppStore.setState({ content: { id: fixture.manifestHash, manifest: fixture.manifest, catalog: { words: fixture.words, themes: fixture.themes },
    sprites: {}, verifiedIds: new Set(), requestedThemeIds: new Set(), committedThemeIds: new Set(), activeThemeId: 'animal_home' } });
  vi.spyOn(sessionLock, 'held', 'get').mockReturnValue(true);
  const saving = deferred<UsageState>(); vi.spyOn(repository, 'checkpointUsage').mockReturnValue(saving.promise);
  recordLearningTime(1000); const previous = useAppStore.getState().usage;
  leaveExperience(); const current = { ...defaultUsage(), cycle: previous.cycle + 1, elapsedMs: 2000 };
  useAppStore.setState({ entered: true, usage: current });
  if (outcome === 'resolve') saving.resolve(previous); else saving.reject(new Error('Old checkpoint failed'));
  await saving.promise.catch(() => undefined); await Promise.resolve();
  expect(useAppStore.getState().usage).toBe(current);
  expect(useAppStore.getState().notice).toBeUndefined();
});

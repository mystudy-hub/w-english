import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { audio, beginSession, boot, leaveExperience, repository, sessionLock } from '../src/app/runtime.ts';
import { useAppStore } from '../src/app/store.ts';
import { spriteSchema } from '../src/data/content-schema.ts';
import { configSnapshot } from '../src/domain/config.ts';
import type { SessionSnapshot } from '../src/domain/models.ts';
import { createSession } from '../src/domain/questions.ts';
import { defaultUsage } from '../src/domain/usage.ts';
import { ContentPackManager, type LoadedContent } from '../src/services/content-packs.ts';
import { syntheticContent } from './helpers/synthetic-content.ts';

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Dexie.Promise<T>((done, failed) => { resolve = done; reject = failed; });
  return { promise, resolve, reject };
}
function content(version = '2026.09.1'): LoadedContent {
  const fixture = syntheticContent({ scenes: true, version });
  return { id: fixture.manifestHash, manifest: fixture.manifest, catalog: { words: fixture.words, themes: fixture.themes },
    sprites: Object.fromEntries(Object.entries(fixture.manifest.sprites).map(([id, assetId]) => [id,
      spriteSchema.parse(JSON.parse(fixture.files.get(fixture.manifest.assets[assetId]!.url)!.bytes.toString('utf8')))])),
    verifiedIds: new Set(Object.keys(fixture.manifest.assets)), requestedThemeIds: new Set(['animal_home']), committedThemeIds: new Set(['animal_home']), activeThemeId: 'animal_home' };
}
const base = content();
const makeRound = (id = 'round') => createSession({ id, now: 1000, theme: base.catalog.themes[0]!, words: base.catalog.words,
  readyIds: new Set(base.catalog.words.map((word) => word.wordId)), progress: [], config: configSnapshot('tap', 'L1'), random: () => .25,
  manifestId: base.id, contentStage: 2 })!;
const navigationTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ coreVersion: 1, assets: {}, sprites: {} }), { status: 200 }));
  vi.spyOn(ContentPackManager.prototype, 'load').mockResolvedValue(base);
  vi.spyOn(ContentPackManager.prototype, 'activate').mockResolvedValue(true);
  vi.spyOn(audio, 'configure');
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  await boot(true, true);
  useAppStore.setState({ phase: 'ready', storage: 'persistent', entered: true, learningAccess: 'writer', parentAuthorized: false,
    content: base, pendingContent: undefined, session: undefined, progress: [], usage: defaultUsage(), interactionPaused: false, notice: undefined });
  vi.spyOn(sessionLock, 'held', 'get').mockReturnValue(true);
  vi.spyOn(repository, 'activeSession').mockResolvedValue(undefined);
  vi.spyOn(repository, 'startSession').mockResolvedValue(makeRound());
  location.hash = '/scene/animal_home'; await navigationTurn();
});
afterEach(async () => { leaveExperience(); vi.restoreAllMocks(); location.hash = ''; await navigationTurn(); });

it.each(['leave', 'navigate', 'navigate-back', 'hide-and-return', 'pause-and-return'] as const)('cancels a pending round before a new write when its context changes: %s', async (reason) => {
  const lookup = deferred<SessionSnapshot | undefined>(); vi.mocked(repository.activeSession).mockReturnValue(lookup.promise);
  const starting = beginSession();
  if (reason === 'leave') leaveExperience();
  else if (reason === 'navigate' || reason === 'navigate-back') {
    location.hash = '/word/w_cat_001'; if (reason === 'navigate-back') location.hash = '/scene/animal_home';
    await navigationTurn();
  } else if (reason === 'hide-and-return') {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
  } else { useAppStore.setState({ interactionPaused: true }); useAppStore.setState({ interactionPaused: false }); }
  lookup.resolve(undefined);
  expect(await starting).toBeUndefined(); expect(repository.startSession).not.toHaveBeenCalled();
  expect(useAppStore.getState().session).toBeUndefined();
});

it('does not resume a saved round from a previous visit lookup', async () => {
  const lookup = deferred<SessionSnapshot | undefined>(); vi.mocked(repository.activeSession).mockReturnValue(lookup.promise);
  const starting = beginSession(); leaveExperience(); lookup.resolve(makeRound('saved'));
  expect(await starting).toBeUndefined(); expect(useAppStore.getState().session).toBeUndefined();
});

it('lets an admitted write settle without publishing it into a later visit', async () => {
  const writing = deferred<SessionSnapshot | null>(); vi.mocked(repository.startSession).mockReturnValue(writing.promise);
  const starting = beginSession(); await vi.waitFor(() => expect(repository.startSession).toHaveBeenCalledTimes(1));
  leaveExperience(); const later = makeRound('later'); useAppStore.setState({ entered: true, learningAccess: 'writer', session: later });
  writing.resolve(makeRound('admitted'));
  expect(await starting).toBeUndefined(); expect(useAppStore.getState().session).toBe(later);
});

it('does not publish a pending content activation or start a round after leaving', async () => {
  const next = content('2026.09.2'); useAppStore.setState({ pendingContent: next });
  const activating = deferred<boolean>(); vi.mocked(ContentPackManager.prototype.activate).mockReturnValue(activating.promise);
  const starting = beginSession(); await vi.waitFor(() => expect(ContentPackManager.prototype.activate).toHaveBeenCalledTimes(1));
  leaveExperience(); activating.resolve(true);
  expect(await starting).toBeUndefined(); expect(repository.startSession).not.toHaveBeenCalled(); expect(audio.configure).not.toHaveBeenCalled();
  expect(useAppStore.getState().content).toBe(base); expect(useAppStore.getState().pendingContent).toBe(next);
});

it('keeps only the latest start request while an earlier lookup is pending', async () => {
  const lookup = deferred<SessionSnapshot | undefined>(); vi.mocked(repository.activeSession).mockReturnValueOnce(lookup.promise).mockResolvedValueOnce(undefined);
  const older = beginSession(); const newer = await beginSession();
  expect(newer?.status).toBe('active'); lookup.resolve(undefined);
  expect(await older).toBeUndefined(); expect(repository.startSession).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState().session).toBe(newer);
});

it('silences a cancelled start failure while keeping current failures retryable', async () => {
  const lookup = deferred<SessionSnapshot | undefined>(); vi.mocked(repository.activeSession).mockReturnValueOnce(lookup.promise);
  const older = beginSession(); location.hash = '/word/w_cat_001'; await navigationTurn(); lookup.reject(new Error('Old lookup failed'));
  await expect(older).resolves.toBeUndefined(); expect(useAppStore.getState().notice).toBeUndefined();
  vi.mocked(repository.activeSession).mockRejectedValueOnce(new Error('Current lookup failed'));
  await expect(beginSession()).rejects.toThrow('Current lookup failed');
});

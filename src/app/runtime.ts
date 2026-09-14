import { database } from '../data/database.ts';
import { LearningRepository } from '../data/learning-repository.ts';
import { defaultGuide, defaultSettings, guideEnabled } from '../domain/config.ts';
import { firstTheme, themeAccess } from '../domain/themes.ts';
import { accumulateUsage, changeUsage, defaultUsage, shouldShowRest, type UsageAction } from '../domain/usage.ts';
import type { ContentPackRecord, SessionSnapshot, Settings } from '../domain/models.ts';
import { AudioEngine } from '../services/audio-engine.ts';
import { loadCoreAudio } from '../services/core-audio.ts';
import { browserContentCache, ContentPackManager, memoryContentCache, type PackMetadata } from '../services/content-packs.ts';
import { SessionLock } from '../services/session-lock.ts';
import { applySettings, readSettings, useAppStore } from './store.ts';

export const APP_BASE = new URL(import.meta.env.BASE_URL, location.origin).href;
export const assetUrl = (url: string) => new URL(url, APP_BASE).href;
export const audio = new AudioEngine(assetUrl);
export const sessionLock = new SessionLock();
export const repository = new LearningRepository(database, (work) => sessionLock.write(work));
let manager: ContentPackManager | undefined;
let bootTask: Promise<void> | undefined;
let generation = 0;
let visitGeneration = 0;
let recordsRevision = 0;
let sessionRevision = 0;
let sessionStartRevision = 0;
const invalidateSessionStarts = () => { sessionStartRevision += 1; };
const suspendSessionStarts = () => { if (document.hidden) invalidateSessionStarts(); };
addEventListener('hashchange', invalidateSessionStarts);
document.addEventListener('visibilitychange', suspendSessionStarts);
const stopTrackingSession = useAppStore.subscribe((state, previous) => {
  if (state.session !== previous.session) sessionRevision += 1;
  if ((previous.entered && !state.entered) || (!previous.interactionPaused && state.interactionPaused)) invalidateSessionStarts();
});
import.meta.hot?.dispose(() => {
  generation += 1; leaveExperience(); audio.dispose(); stopTrackingSession();
  removeEventListener('hashchange', invalidateSessionStarts);
  document.removeEventListener('visibilitychange', suspendSessionStarts);
});
let entryTask: Promise<boolean> | undefined;
let usageRevision = 0; let usageWriterId = ''; let usageSequence = 0; let usageCumulativeMs = 0; let usageCycle = 0;
database.onStorageIssue((reason) => {
  leaveExperience();
  useAppStore.setState({ storage: 'pending', phase: 'failed', storageIssue: reason });
});

function metadata(persistent: boolean): PackMetadata {
  const records = new Map<string, ContentPackRecord>();
  if (!persistent) return {
    all: async () => [...records.values()], put: async (record) => { records.set(record.id, record); }, activeSessionVersion: async () => undefined,
    remove: async (ids) => { for (const id of ids) records.delete(id); },
    activate: async (id, themeId) => { const record = records.get(id); if (!record || !['ready', 'active'].includes(record.state)) return false; records.set(id, { ...record, activeThemeId: themeId, state: 'active', activatedAt: Date.now() }); return true; },
  };
  return {
    all: () => database.contentPacks.toArray(), put: (record) => database.contentPacks.put(record),
    remove: (ids) => database.transaction('rw', database.contentPacks, database.sessions, async () => {
      const session = await repository.activeSession();
      for (const id of ids) {
        const record = await database.contentPacks.get(id);
        if (record?.state === 'active' || (session?.manifestId ? session.manifestId === id : session?.contentVersion === record?.contentVersion)) continue;
        await database.contentPacks.delete(id);
      }
    }),
    activeSessionVersion: async () => (await repository.activeSession())?.contentVersion,
    activeSessionContentId: async () => (await repository.activeSession())?.manifestId,
    activate: (id, themeId) => sessionLock.write(() => database.transaction('rw', database.contentPacks, database.sessions, async () => {
      if (await repository.activeSession()) return false;
      const candidate = await database.contentPacks.get(id);
      if (!candidate || !['ready', 'active'].includes(candidate.state)) return false;
      if (themeId && candidate.readyThemeIds && !candidate.readyThemeIds.includes(themeId)) return false;
      await database.contentPacks.where('state').equals('active').modify({ state: 'ready' });
      await database.contentPacks.put({ ...candidate, activeThemeId: themeId, state: 'active', activatedAt: Date.now(), updatedAt: Date.now() });
      return true;
    })),
  };
}

export function boot(temporary = false, force = false): Promise<void> {
  if (bootTask && !force) return bootTask;
  const run = ++generation;
  useAppStore.setState({ phase: 'loading', error: undefined, storageIssue: undefined });
  bootTask = (async () => {
    try {
      let persistent = !temporary;
      let settings = defaultSettings();
      if (persistent) {
        try {
          let timeout: ReturnType<typeof setTimeout>;
          try { settings = await Promise.race([repository.initialize(), new Promise<never>((_, reject) => { timeout = setTimeout(() => { if (run === generation) database.close(); reject(new Error('读取学习记录超时')); }, 2000); })]); }
          finally { clearTimeout(timeout!); }
        } catch (error) {
          if (run !== generation) return;
          useAppStore.setState({ storage: 'pending', phase: 'failed', error: error instanceof Error ? error.message : '学习记录暂时无法读取',
            storageIssue: error instanceof Error && error.name === 'VersionError' ? 'newer' : useAppStore.getState().storageIssue ?? 'unavailable' });
          return;
        }
      }
      if (run !== generation) return;
      applySettings(settings);
      audio.setVolume(settings.parentSettings.volumeCap);
      void loadCoreAudio(audio, APP_BASE).then((loaded) => {
        if (loaded && run === generation) useAppStore.setState((state) => ({ audioRevision: state.audioRevision + 1 }));
      }).catch(() => {});
      let cache;
      try { cache = await browserContentCache(); }
      catch { cache = memoryContentCache(); persistent = false; }
      const contentManager = new ContentPackManager({ baseUrl: APP_BASE, metadata: metadata(persistent), cache,
        exclusive: (work) => navigator.locks ? navigator.locks.request('w-english:content-cache', work) : work(),
        canClean: () => !persistent || sessionLock.held,
      });
      manager = contentManager;
      usageRevision += 1;
      useAppStore.setState({ storage: persistent ? 'persistent' : 'temporary',
        ...(!persistent ? { usage: defaultUsage(settings.parentSettings.screenTimeMinutes), progress: [], stickers: [], session: undefined } : {}) });
      const content = await contentManager.load();
      if (run !== generation) return;
      useAppStore.setState({ phase: 'ready', storage: persistent ? 'persistent' : 'temporary', content, contentRecovery: contentManager.recovery,
        sceneThemeId: firstTheme(content.catalog.themes).themeId,
        ...(temporary ? { notice: '本次使用临时体验，学习记录不会保存。' } : {}) });
      audio.setVolume(settings.parentSettings.volumeCap);
      if (persistent) await refreshRecords();
    } catch (error) {
      if (run === generation) useAppStore.setState({ phase: 'failed', error: error instanceof Error ? error.message : '内容还没有准备好，请再试一次。' });
    }
  })();
  return bootTask;
}
export async function refreshRecords() {
  const initial = useAppStore.getState();
  if (initial.storage !== 'persistent') return;
  const run = generation; const visit = visitGeneration; const revision = ++recordsRevision; const sessionAtStart = sessionRevision;
  const current = () => run === generation && visit === visitGeneration && revision === recordsRevision;
  try {
    const [progress, guide, session, stickers] = await Promise.all([repository.progress(), database.guideState.get('local'), repository.activeSession(), repository.stickers()]);
    if (!current()) return;
    // Track transitions too: empty -> active -> empty is not the original empty state.
    useAppStore.setState({ progress, stickers, ...(guide ? { guide } : {}),
      ...(sessionRevision === sessionAtStart ? { session } : {}) });
  } catch { if (current()) useAppStore.setState({ notice: '本次记录暂时无法保存，请在家长页面重试。' }); }
}
export function canSaveLearning() {
  return useAppStore.getState().storage === 'persistent' && sessionLock.held;
}
export function enterExperience(parent = false): Promise<boolean> {
  if (useAppStore.getState().entered) return Promise.resolve(true);
  if (entryTask) return entryTask;
  const visit = ++visitGeneration;
  useAppStore.setState({ entering: true, notice: undefined });
  const task = (async () => {
    try {
      const state = useAppStore.getState();
      if (state.phase !== 'ready' && !parent) return false;
      const persistent = state.storage === 'persistent';
      const writable = persistent && sessionLock.supported;
      if (writable && !await sessionLock.acquire()) {
        if (visit === visitGeneration) useAppStore.setState({ notice: '另一个窗口正在学习。请先回到那个窗口的欢迎页，再在这里开始。' });
        return false;
      }
      if (visit !== visitGeneration) return false;
      // A window may have waited on welcome while another changed settings or a round.
      if (persistent) {
        const [settings, progress, guide, session, usage] = await Promise.all([
          repository.settings(), repository.progress(), database.guideState.get('local'), repository.activeSession(), repository.usage(),
        ]);
        const content = manager && state.phase === 'ready' ? await manager.load() : state.content;
        if (visit !== visitGeneration) return false;
        if (writable && content && (content.manifest.stage ?? 0) >= 2) {
          await repository.reconcileStickers();
          // A failed optional cleanup leaves history intact and retries on the next visit.
          await repository.retainRecentHistory(Date.now()).catch(() => {});
        }
        const stickers = await repository.stickers();
        if (visit !== visitGeneration) return false;
        applySettings(settings); audio.setVolume(settings.parentSettings.volumeCap);
        usageRevision += 1;
        useAppStore.setState({ content, contentRecovery: manager?.recovery, themeProgress: {}, progress, stickers, usage, ...(guide ? { guide } : {}), session: writable ? session : undefined,
          ...(content ? { sceneThemeId: session?.themeId ?? firstTheme(content.catalog.themes).themeId } : {}),
        });
      }
      usageWriterId = crypto.randomUUID(); usageSequence = 0; usageCumulativeMs = 0; usageCycle = useAppStore.getState().usage.cycle;
      useAppStore.setState({ entered: true, learningAccess: writable ? 'writer' : 'read-only',
        ...(!writable && state.storage !== 'pending' ? { notice: persistent ? '当前浏览器仅支持卡片体验，本次学习记录和设置不会保存。' : '本次使用临时体验，学习记录不会保存。' } : {}),
      });
      void prepareContent();
      return true;
    } catch {
      if (visit === visitGeneration) {
        void sessionLock.release();
        useAppStore.setState({ notice: '学习记录暂时无法恢复，请再试一次。' });
      }
      return false;
    } finally {
      if (visit === visitGeneration) useAppStore.setState({ entering: false });
    }
  })();
  entryTask = task;
  void task.finally(() => { if (entryTask === task) entryTask = undefined; });
  return task;
}
export function leaveExperience() {
  visitGeneration += 1; entryTask = undefined;
  // The active timer checkpoints before release starts draining repository writes.
  dispatchEvent(new Event('w-english:leave'));
  audio.cancel();
  useAppStore.setState({ entered: false, entering: false, parentAuthorized: false, learningAccess: 'inactive' });
  void sessionLock.release();
}
export function checkpointLearningTime() { dispatchEvent(new Event('w-english:checkpoint-time')); }
export function learningPaused() {
  const state = useAppStore.getState(); const session = state.session;
  const answering = location.hash.startsWith('#/play/') && session?.status === 'active';
  return state.interactionPaused || (state.entered && (state.content?.manifest.stage ?? 0) >= 2
    && shouldShowRest(state.usage, answering, answering ? session.questions[session.currentQuestionIndex]?.id : undefined));
}
export function recordLearningTime(deltaMs: number, questionId?: string) {
  const state = useAppStore.getState();
  if (!state.entered || (state.content?.manifest.stage ?? 0) < 2) return;
  const run = generation; const visit = visitGeneration;
  if (usageCycle !== state.usage.cycle) { usageCycle = state.usage.cycle; usageSequence = 0; usageCumulativeMs = 0; }
  usageCumulativeMs += deltaMs;
  const input = { cycle: usageCycle, writerId: usageWriterId, sequence: ++usageSequence, cumulativeMs: usageCumulativeMs,
    now: Date.now(), limitMinutes: readSettings().parentSettings.screenTimeMinutes, questionId };
  const next = accumulateUsage(state.usage, input); const revision = ++usageRevision;
  const current = () => run === generation && visit === visitGeneration && revision === usageRevision;
  useAppStore.setState({ usage: next });
  if (canSaveLearning()) void repository.checkpointUsage(input).then((usage) => {
    if (current()) useAppStore.setState({ usage });
  }).catch(() => { if (current()) useAppStore.setState({ notice: '使用时间暂时无法保存，请家长稍后重试。' }); });
}
export async function changeLearningRest(action: UsageAction) {
  checkpointLearningTime();
  const run = generation; const visit = visitGeneration; const sessionAtStart = sessionRevision;
  const state = useAppStore.getState(); const revision = ++usageRevision; const now = Date.now();
  if (canSaveLearning()) {
    const result = await repository.changeUsage(action, state.usage.cycle, now);
    if (run === generation && visit === visitGeneration && revision === usageRevision) {
      useAppStore.setState({ usage: result.usage, ...(sessionRevision === sessionAtStart ? { session: result.session } : {}) });
    }
  } else useAppStore.setState({ usage: changeUsage(state.usage, action, now) });
}
export function sceneRoute(themeId = useAppStore.getState().sceneThemeId) { return `/scene/${themeId}`; }
export function sessionRoute(session: SessionSnapshot) { return `/play/${session.activity === 'tapSpell' ? 'spell' : 'listen'}/${session.themeId}`; }
export function explorationRoute() { return (useAppStore.getState().content?.catalog.themes.length ?? 0) > 1 ? '/themes' : sceneRoute(); }
export function selectScene(themeId: string) {
  const state = useAppStore.getState();
  const theme = state.content?.catalog.themes.find((entry) => entry.themeId === themeId);
  if (theme) audio.unloadExcept(theme.spriteIds);
  useAppStore.setState({ sceneThemeId: themeId, scenePage: state.themePages[themeId] ?? 0,
    themePages: { ...state.themePages, [state.sceneThemeId]: state.scenePage },
    pack: state.content && manager ? manager.themeProgress(state.content, themeId) : state.pack });
}
export function readyThemeIds() { const content = useAppStore.getState().content; return content && manager ? manager.readyThemeIds(content) : new Set<string>(); }
export function contentThemeProgress(themeId: string) {
  const state = useAppStore.getState();
  return state.themeProgress[themeId] ?? (state.content && manager ? manager.themeProgress(state.content, themeId) : undefined);
}
export async function prepareContent(themeId = useAppStore.getState().sceneThemeId) {
  const content = useAppStore.getState().content;
  const currentManager = manager;
  if (!content || !currentManager) return;
  const theme = content.catalog.themes.find((entry) => entry.themeId === themeId);
  if (!theme || !themeAccess(theme, content.catalog.themes, useAppStore.getState().progress).unlocked) return;
  const current = () => manager === currentManager && useAppStore.getState().content?.id === content.id;
  try {
    await currentManager.download(content, (pack) => {
      if (current()) useAppStore.setState((state) => ({ ...(state.sceneThemeId === themeId ? { pack } : {}),
        themeProgress: { ...state.themeProgress, [themeId]: pack }, content: { ...content, verifiedIds: new Set(content.verifiedIds) } }));
    }, [themeId]);
    if (!current()) return;
    audio.register(content.manifest, content.sprites);
    const saved = useAppStore.getState();
    if (currentManager.readyThemeIds(content).has(themeId) && !saved.session && canSaveLearning()) await currentManager.activate(content, themeId);
    if (!current()) return;
    useAppStore.setState((state) => ({ content: { ...content, verifiedIds: new Set(content.verifiedIds) }, audioRevision: state.audioRevision + 1,
      contentRecovery: state.contentRecovery === 'repair' && state.pack.state === 'ready' ? undefined : state.contentRecovery }));
    const next = currentManager.updateCandidate;
    if (next) {
      const scopes = [...content.requestedThemeIds].filter((id) => next.catalog.themes.some((theme) => theme.themeId === id));
      void currentManager.download(next, () => {}, scopes).then(() => {
        if (current() && scopes.every((id) => currentManager.readyThemeIds(next).has(id))) useAppStore.setState({ pendingContent: next });
        return currentManager.cleanup();
      }).catch(() => { if (current()) useAppStore.setState({ notice: '新内容尚未下载完成，继续使用当前内容。' }); });
    } else void currentManager.cleanup().catch(() => {});
  } catch {
    // Fully verified cards remain playable when an unrelated asset failed or was paused.
    if (current()) {
      audio.register(content.manifest, content.sprites);
      useAppStore.setState((state) => ({ content: { ...content, verifiedIds: new Set(content.verifiedIds) }, audioRevision: state.audioRevision + 1 }));
    }
  }
}
export function pauseContentDownload() { manager?.cancelDownload(); }
export async function cleanContentCache() {
  if (!manager) throw new Error('内容尚未准备');
  return manager.cleanup();
}
export async function saveSettings(settings: Settings) {
  const access = useAppStore.getState().learningAccess;
  if (access === 'inactive') throw new Error('请先进入应用');
  const saved = access === 'writer';
  if (saved) await repository.saveSettings(settings);
  applySettings(settings); audio.setVolume(settings.parentSettings.volumeCap);
  return saved;
}
export async function clearLearningRecords() {
  const state = useAppStore.getState();
  if (!canSaveLearning() || !state.parentAuthorized || location.hash !== '#/parent') throw new Error('请由家长进入设置后清除记录');
  const visit = visitGeneration; const run = generation;
  audio.cancel();
  await repository.clearLearningRecords();
  if (visit !== visitGeneration || run !== generation) return;
  recordsRevision += 1;
  useAppStore.setState({ progress: [], stickers: [], session: undefined, guide: defaultGuide(), themePages: {}, scenePage: 0 });
  if (state.content) selectScene(firstTheme(state.content.catalog.themes).themeId);
}
export async function discover(wordId: string) {
  if (!canSaveLearning() || learningPaused() || document.hidden) return;
  try { await repository.discover(wordId, Date.now()); await refreshRecords(); }
  catch { useAppStore.setState({ notice: '本次探索记录暂时无法保存。' }); }
}
export async function playWord(ref: string, wordId: string, owner: string, countHeard: boolean) {
  const route = location.hash;
  if (learningPaused() || document.hidden) return { status: 'cancelled' as const, ref, playbackId: '' };
  const unlocked = await audio.unlock();
  if (route !== location.hash || learningPaused() || document.hidden) return { status: 'cancelled' as const, ref, playbackId: '' };
  if (!unlocked) return { status: 'failed' as const, ref, playbackId: '', error: '再点一次小喇叭试试。' };
  const result = await audio.play(ref, owner);
  if (result.status === 'ended' && countHeard && canSaveLearning()) {
    try { await repository.heard(wordId, result.playbackId); await refreshRecords(); }
    catch { useAppStore.setState({ notice: '听音记录暂时无法保存。' }); }
  }
  return result;
}
export async function beginSession(reviewOnly = false, themeId = useAppStore.getState().sceneThemeId, activity: 'listenTap' | 'tapSpell' = 'listenTap', focusWordId?: string) {
  checkpointLearningTime();
  const run = generation; const visit = visitGeneration; const revision = ++sessionStartRevision;
  const route = location.hash; const currentManager = manager;
  let state = useAppStore.getState();
  if (!currentManager || !state.content || !state.entered || state.phase !== 'ready' || document.hidden || learningPaused()) return undefined;
  if (!canSaveLearning()) {
    useAppStore.setState({ notice: '本次可以浏览卡片和听音，学习记录暂时无法保存。' }); return undefined;
  }
  const current = () => run === generation && visit === visitGeneration && revision === sessionStartRevision
    && manager === currentManager && location.hash === route && useAppStore.getState().entered && canSaveLearning() && !document.hidden && !learningPaused();
  try {
    const active = await repository.activeSession();
    if (!current()) return undefined;
    if (active) { selectScene(active.themeId); useAppStore.setState({ session: active }); return active; }
    const candidate = state.pendingContent;
    if (candidate) {
      const activated = await currentManager.activate(candidate, themeId);
      if (!current()) return undefined;
      if (activated) {
        audio.configure(candidate.manifest, candidate.sprites);
        useAppStore.setState((latest) => ({ content: candidate,
          pendingContent: latest.pendingContent?.id === candidate.id ? undefined : latest.pendingContent,
          contentRecovery: undefined, themeProgress: {} }));
      }
    }
    state = useAppStore.getState();
    const content = state.content!;
    if (activity === 'tapSpell' && (content.manifest.stage ?? 0) < 2) return undefined;
    const theme = content.catalog.themes.find((entry) => entry.themeId === themeId);
    if (!theme || !themeAccess(theme, content.catalog.themes, state.progress).unlocked) return undefined;
    if (theme.unlock.prerequisiteThemeId && !currentManager.readyThemeIds(content).has(themeId)) return undefined;
    const session = await repository.startSession({ id: crypto.randomUUID(), now: Date.now(), theme, words: content.catalog.words,
      settings: readSettings(), readyIds: activity === 'tapSpell' ? currentManager.readySpellingWordIds(content) : currentManager.readyWordIds(content),
      activity, focusWordId, contentStage: content.manifest.stage, random: Math.random, reviewOnly, release: content.manifest.mode === 'release', manifestId: content.id });
    // Accepted writes still settle before lock handover; their old page must not navigate.
    if (!current() || !session) return undefined;
    useAppStore.setState({ session }); return session;
  } catch (error) {
    if (!current()) return undefined;
    throw error;
  }
}
export function readyWordIds() {
  const state = useAppStore.getState();
  return state.content && manager ? manager.readyWordIds(state.content) : new Set<string>();
}
export function readySpellingWordIds() {
  const state = useAppStore.getState();
  return state.content && manager ? manager.readySpellingWordIds(state.content) : new Set<string>();
}
export function playGuide(ref: string, owner: string) {
  const settings = readSettings();
  const session = useAppStore.getState().session;
  if (session?.questions[session.currentQuestionIndex]?.id === owner) settings.interactionMode = session.configSnapshot.interactionMode;
  if (guideEnabled(settings) && !audio.isMuted && audio.has(ref) && !document.hidden && (owner === 'rest' || owner === 'orientation' || !learningPaused())) {
    useAppStore.setState((state) => ({ guidePulse: state.guidePulse + 1 }));
    return audio.guide(ref, owner);
  }
  return Promise.resolve(undefined);
}
export function playEffect(ref: string, owner = 'ui') {
  const settings = readSettings();
  const quiet = settings.parentSettings.bedtimeMode || settings.parentSettings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  return audio.effect(ref, owner, quiet);
}
export async function abandonSession() {
  checkpointLearningTime();
  const run = generation; const visit = visitGeneration;
  const session = useAppStore.getState().session;
  if (!session) return false;
  if (canSaveLearning()) await repository.abandonSession(session.id, Date.now());
  if (run !== generation || visit !== visitGeneration || useAppStore.getState().session?.id !== session.id) return false;
  useAppStore.setState({ session: undefined });
  return true;
}

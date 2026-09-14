import { manifestSchema, spriteSchema, validateCatalog, type AssetRecord, type ContentManifest, type SpriteManifest, type ThemeConfig, type WordEntry } from '../data/content-schema.ts';
import type { ContentPackRecord } from '../domain/models.ts';
import { SUPPORTED_CONTENT_CONTRACTS, themeAssetIds, themeAudioRefs } from '../domain/content-scopes.ts';
import { firstTheme } from '../domain/themes.ts';
import { withRequestDeadline } from './request-deadline.ts';

export const CONTENT_CACHE = 'w-english-content-v1';
export interface ContentCatalog { words: WordEntry[]; themes: ThemeConfig[] }
export interface PackMetadata {
  all(): Promise<ContentPackRecord[]>;
  put(record: ContentPackRecord): Promise<unknown>;
  remove(ids: string[]): Promise<void>;
  activeSessionVersion(): Promise<string | undefined>;
  activeSessionContentId?(): Promise<string | undefined>;
  activate(id: string, themeId?: string): Promise<boolean>;
}
export interface ContentCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
  keys(): Promise<string[]>;
}
export interface LoadedContent {
  id: string; manifest: ContentManifest; catalog: ContentCatalog;
  sprites: Record<string, SpriteManifest>; verifiedIds: Set<string>;
  requestedThemeIds: Set<string>; committedThemeIds: Set<string>; activeThemeId: string;
}
export interface PackProgress {
  state: 'idle' | 'downloading' | 'ready' | 'incomplete' | 'failed' | 'quota' | 'paused';
  completedBytes: number; totalBytes: number; percent: number; error?: string;
  themeIds?: string[];
}

export async function digest(bytes: ArrayBuffer): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), (value) => value.toString(16).padStart(2, '0')).join('');
}

export class ContentPackManager {
  private readonly baseUrl: string;
  private readonly metadata: PackMetadata;
  private readonly cache: ContentCache;
  private readonly fetcher: typeof fetch;
  private readonly hash: typeof digest;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private downloadPromise?: Promise<LoadedContent>;
  private downloadingId?: string;
  private downloadingScope?: string;
  private downloadAbort?: AbortController;
  private currentContent?: LoadedContent;
  private transient = new Map<string, ContentManifest>();
  private serial: Promise<unknown> = Promise.resolve();
  private readonly sharedLock: <T>(work: () => Promise<T>) => Promise<T>;
  private readonly canClean: () => boolean;
  private cleanupTask?: Promise<{ files: number; bytes: number; packs: number }>;
  private quotaRecovered = false;
  private listeners = new Set<(progress: PackProgress) => void>();
  private lastProgress?: PackProgress;
  updateCandidate?: LoadedContent;
  recovery?: 'fallback' | 'repair' | 'app-update';

  constructor(options: { baseUrl: string; metadata: PackMetadata; cache: ContentCache; fetcher?: typeof fetch; hash?: typeof digest; delay?: (ms: number) => Promise<void>; now?: () => number;
    exclusive?: <T>(work: () => Promise<T>) => Promise<T>; canClean?: () => boolean }) {
    this.baseUrl = options.baseUrl; this.metadata = options.metadata; this.cache = options.cache;
    this.fetcher = options.fetcher ?? fetch.bind(globalThis); this.hash = options.hash ?? digest;
    this.delay = options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.sharedLock = options.exclusive ?? ((work) => work()); this.canClean = options.canClean ?? (() => true);
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.catch(() => {}).then(() => this.sharedLock(async () => {
      this.quotaRecovered = false;
      try { return await work(); } finally { this.transient.clear(); }
    }));
    this.serial = next; return next;
  }
  url(relative: string) {
    const base = new URL(this.baseUrl);
    const url = new URL(relative, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('内容资源超出应用路径');
    return url.href;
  }
  private async checkedBytes(asset: AssetRecord): Promise<ArrayBuffer | undefined> {
    const response = await this.cache.match(this.url(asset.url));
    if (!response || response.status !== 200) return undefined;
    const bytes = await response.arrayBuffer();
    return bytes.byteLength === asset.bytes && await this.hash(bytes) === asset.sha256 ? bytes : undefined;
  }
  private async put(url: string, bytes: ArrayBuffer | string, mime: string) {
    const response = () => new Response(bytes, { headers: { 'Content-Type': mime } });
    try { await this.cache.put(url, response()); }
    catch (error) {
      if (!(error instanceof Error) || error.name !== 'QuotaExceededError' || !this.canClean()) throw error;
      if (!this.quotaRecovered) {
        this.quotaRecovered = true;
        this.cleanupTask = this.cleanFiles();
      }
      if (this.cleanupTask) await this.cleanupTask;
      await this.cache.put(url, response());
    }
  }
  private async retrieve(asset: AssetRecord, signal?: AbortSignal): Promise<ArrayBuffer> {
    signal?.throwIfAborted();
    const cached = await this.checkedBytes(asset);
    if (cached) return cached;
    let error: unknown;
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        signal?.throwIfAborted();
        const bytes = await withRequestDeadline(15_000, async (requestSignal) => {
          const response = await this.fetcher(this.url(asset.url), { cache: 'no-store', signal: requestSignal });
          if (response.status !== 200) throw new Error(`资源下载失败 (${response.status})`);
          return response.arrayBuffer();
        }, signal);
        if (bytes.byteLength !== asset.bytes || await this.hash(bytes) !== asset.sha256) throw new Error('资源校验失败');
        signal?.throwIfAborted();
        await this.put(this.url(asset.url), bytes, asset.mime);
        return bytes;
      } catch (caught) {
        error = caught;
        if (signal?.aborted || (caught instanceof Error && caught.name === 'QuotaExceededError')) break;
        if (attempt < 3) await this.delay(1000 * 2 ** attempt);
      }
    }
    throw error;
  }
  private async fromManifest(id: string, inputManifest: ContentManifest, cachedOnly = false): Promise<LoadedContent> {
    const manifest = manifestSchema.parse(inputManifest);
    if (!SUPPORTED_CONTENT_CONTRACTS.some((version) => version >= manifest.appContract.min && version <= manifest.appContract.max)) throw new Error('内容需要更新后的应用');
    this.transient.set(id, manifest);
    const bytes = cachedOnly ? await this.checkedBytes(manifest.assets[manifest.catalogAssetId]!) : await this.retrieve(manifest.assets[manifest.catalogAssetId]!);
    if (!bytes) { await this.degrade(id); throw new Error('本地词库需要重新准备'); }
    const input = JSON.parse(new TextDecoder().decode(bytes)) as { words: unknown; themes: unknown };
    const catalog = validateCatalog(input.words, input.themes, manifest.mode === 'release');
    if (catalog.themes.some((theme) => theme.contentVersion !== manifest.contentVersion)) throw new Error('目录和内容包版本不一致');
    for (const theme of catalog.themes) themeAssetIds(manifest, [theme.themeId]);
    const record = (await this.metadata.all()).find((entry) => entry.id === id);
    const availableThemes = new Set(catalog.themes.map((theme) => theme.themeId));
    const activeThemeId = [record?.activeThemeId, ...(record?.readyThemeIds ?? []), firstTheme(catalog.themes).themeId]
      .find((theme): theme is string => Boolean(theme && availableThemes.has(theme)))!;
    const content: LoadedContent = { id, manifest, catalog, sprites: {}, verifiedIds: new Set<string>(), activeThemeId,
      committedThemeIds: new Set(record?.readyThemeIds ?? (record?.state === 'active' || record?.state === 'ready' ? [activeThemeId] : [])),
      requestedThemeIds: new Set((record?.requestedThemeIds ?? [activeThemeId]).filter((theme) => availableThemes.has(theme))) };
    await this.inspect(content);
    if (!this.complete(content)) await this.degrade(id, content);
    return content;
  }
  private async inspect(content: LoadedContent) {
    content.verifiedIds.clear(); content.sprites = {};
    const spriteAssets = new Map(Object.entries(content.manifest.sprites).map(([id, asset]) => [asset, id]));
    const candidates: Record<string, SpriteManifest> = {};
    for (const [id, asset] of Object.entries(content.manifest.assets)) {
      const bytes = await this.checkedBytes(asset);
      if (!bytes) continue;
      const spriteId = spriteAssets.get(id);
      if (spriteId) {
        try { candidates[spriteId] = spriteSchema.parse(JSON.parse(new TextDecoder().decode(bytes))); }
        catch { continue; }
      }
      content.verifiedIds.add(id);
    }
    for (const [id, sprite] of Object.entries(candidates)) if (content.verifiedIds.has(sprite.audioAssetId)) content.sprites[id] = sprite;
  }
  private complete(content: LoadedContent, themeIds = [content.activeThemeId]) {
    return !themeAudioRefs(content.catalog.words, content.catalog.themes, themeIds, content.manifest.stage).some((ref) => content.manifest.missingAudio.includes(ref))
      && this.filesComplete(content, themeIds);
  }
  private filesComplete(content: LoadedContent, themeIds: string[]) {
    const required = themeAssetIds(content.manifest, themeIds);
    const wordIds = new Set(content.catalog.themes.filter((theme) => themeIds.includes(theme.themeId)).flatMap((theme) => theme.wordIds));
    return [...required].every((id) => content.verifiedIds.has(id))
      && content.catalog.words.filter((word) => wordIds.has(word.wordId)).every((word) => word.illustration.type === 'image' && required.has(word.illustration.src))
      && themeAudioRefs(content.catalog.words, content.catalog.themes, themeIds, content.manifest.stage).every((ref) => {
        const [id, clip] = ref.split('#');
        const sprite = content.sprites[id!];
        return content.manifest.missingAudio.includes(ref) || Boolean(sprite?.sprite[clip!]
          && required.has(content.manifest.sprites[id!]!) && required.has(sprite.audioAssetId));
      });
  }
  readyThemeIds(content: LoadedContent) {
    return new Set(content.catalog.themes.filter((theme) => content.committedThemeIds.has(theme.themeId) && this.complete(content, [theme.themeId])).map((theme) => theme.themeId));
  }
  themeProgress(content: LoadedContent, themeId: string): PackProgress {
    const ids = themeAssetIds(content.manifest, [themeId]);
    const totalBytes = [...ids].reduce((sum, id) => sum + content.manifest.assets[id]!.bytes, 0);
    const completedBytes = [...ids].filter((id) => content.verifiedIds.has(id)).reduce((sum, id) => sum + content.manifest.assets[id]!.bytes, 0);
    const ready = this.readyThemeIds(content).has(themeId);
    return { state: ready ? 'ready' : this.filesComplete(content, [themeId]) && !this.complete(content, [themeId]) ? 'incomplete' : 'idle', completedBytes, totalBytes,
      percent: ready ? 100 : Math.min(99, Math.floor(completedBytes / totalBytes * 100)), themeIds: [themeId] };
  }
  private async degrade(id: string, content?: LoadedContent) {
    const previous = (await this.metadata.all()).find((record) => record.id === id);
    if (!previous || !['active', 'ready', 'degraded'].includes(previous.state)) return;
    const verifiedIds = content ? [...content.verifiedIds] : [];
    await this.metadata.put({ ...previous, state: 'degraded', verifiedIds,
      readyThemeIds: (previous.readyThemeIds ?? [content?.activeThemeId ?? '']).filter((theme) => content && this.complete(content, [theme])),
      completedBytes: verifiedIds.reduce((sum, key) => sum + (previous.manifest.assets[key]?.bytes ?? 0), 0),
      error: '部分本地内容需要重新准备', updatedAt: this.now() });
    this.recovery = 'repair';
  }
  load(): Promise<LoadedContent> {
    return this.exclusive(async () => {
      this.updateCandidate = undefined; this.recovery = undefined;
      const content = await this.loadFiles(); this.currentContent = content; return content;
    });
  }
  private async loadFiles(): Promise<LoadedContent> {
    const records = await this.metadata.all();
    const sessionVersion = await this.metadata.activeSessionVersion();
    const sessionContentId = await this.metadata.activeSessionContentId?.();
    // An unfinished question owns its content version, including across reloads.
    const pinned = sessionContentId ? records.find((record) => record.id === sessionContentId)
      : sessionVersion ? records.find((record) => record.contentVersion === sessionVersion)
      : records.find((record) => record.state === 'active');
    if (pinned && (sessionVersion || sessionContentId)) return this.fromManifest(pinned.id, pinned.manifest);
    let fallback: LoadedContent | undefined; let partial: LoadedContent | undefined;
    if (!sessionVersion && !sessionContentId) {
      const candidates = records.slice().sort((a, b) => Number(b.state === 'active') - Number(a.state === 'active')
        || (b.activatedAt ?? b.updatedAt) - (a.activatedAt ?? a.updatedAt));
      for (const record of candidates) {
        try {
          const cached = await this.fromManifest(record.id, record.manifest, true);
          if (this.complete(cached)) { fallback = cached; break; }
          partial ??= cached;
        } catch { /* A damaged or incompatible pack cannot displace a usable version. */ }
      }
    }
    const indexUrl = this.url('content/index.json');
    try {
      let indexResponse: Response | undefined;
      try {
        const bytes = await withRequestDeadline(5000, async (signal) => {
          const fetched = await this.fetcher(indexUrl, { cache: 'no-store', signal });
          if (fetched.status !== 200) throw new Error('无法读取内容索引');
          return fetched.arrayBuffer();
        });
        indexResponse = new Response(bytes);
      } catch { indexResponse = await this.cache.match(indexUrl); }
      if (!indexResponse) throw new Error('请联网准备学习内容');
      const index = await indexResponse.json() as { manifestUrl?: unknown; sha256?: unknown };
      if (typeof index.manifestUrl !== 'string' || !/^content\/manifest\.[a-f0-9]+\.json$/.test(index.manifestUrl)
        || typeof index.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(index.sha256)) throw new Error('内容索引格式错误');
      const manifestUrl = this.url(index.manifestUrl);
      const cachedManifest = await this.cache.match(manifestUrl);
      let bytes = cachedManifest?.status === 200 ? await cachedManifest.arrayBuffer() : undefined;
      if (!bytes || await this.hash(bytes) !== index.sha256) {
        bytes = await withRequestDeadline(5000, async (signal) => {
          const response = await this.fetcher(manifestUrl, { cache: 'no-store', signal });
          if (response.status !== 200) throw new Error('无法读取内容清单');
          return response.arrayBuffer();
        });
      }
      if (await this.hash(bytes) !== index.sha256) throw new Error('内容清单校验失败');
      const manifest = manifestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
      if ((sessionContentId && index.sha256 !== sessionContentId) || (sessionVersion && manifest.contentVersion !== sessionVersion)) throw new Error('上次学习的内容尚未恢复，请稍后重试');
      const content = await this.fromManifest(index.sha256, manifest);
      await this.put(manifestUrl, bytes, 'application/json');
      await this.put(indexUrl, JSON.stringify(index), 'application/json');
      const previous = (await this.metadata.all()).find((entry) => entry.id === content.id);
      if (!previous) await this.metadata.put({ id: content.id, contentVersion: manifest.contentVersion, state: 'downloading', manifest,
        manifestUrl: index.manifestUrl, verifiedIds: [...content.verifiedIds], updatedAt: this.now(),
        completedBytes: [...content.verifiedIds].reduce((sum, key) => sum + manifest.assets[key]!.bytes, 0),
        totalBytes: Object.values(manifest.assets).reduce((sum, asset) => sum + asset.bytes, 0) });
      if (fallback && fallback.id !== content.id) {
        this.updateCandidate = content;
        if (pinned && pinned.id !== fallback.id) this.recovery = 'fallback';
        return fallback;
      }
      return content;
    } catch (error) {
      if (error instanceof Error && error.message === '内容需要更新后的应用') this.recovery = 'app-update';
      if (fallback) { if (pinned && pinned.id !== fallback.id && this.recovery !== 'app-update') this.recovery = 'fallback'; return fallback; }
      if (partial) return partial;
      throw error;
    }
  }
  download(content: LoadedContent, notify: (progress: PackProgress) => void, themeIds = [content.activeThemeId]): Promise<LoadedContent> {
    const scope = [...new Set(themeIds)].sort(); const scopeKey = scope.join(',');
    if (this.downloadPromise) {
      if (this.downloadingId === content.id && this.downloadingScope === scopeKey) {
        this.listeners.add(notify); if (this.lastProgress) notify(this.lastProgress);
        return this.downloadPromise.then((loaded) => { Object.assign(content, loaded); return content; });
      }
      return this.downloadPromise.catch(() => undefined).then(() => this.download(content, notify, scope));
    }
    this.downloadingId = content.id; this.downloadingScope = scopeKey;
    this.downloadAbort = new AbortController();
    const signal = this.downloadAbort.signal;
    this.listeners.add(notify);
    const publish = (progress: PackProgress) => { this.lastProgress = { ...progress, themeIds: scope }; for (const listener of this.listeners) listener(this.lastProgress); };
    this.downloadPromise = this.exclusive(() => this.downloadFiles(content, publish, signal, scope)).finally(() => {
      this.downloadPromise = undefined; this.downloadingId = undefined; this.downloadingScope = undefined; this.downloadAbort = undefined;
      this.listeners.clear(); this.lastProgress = undefined;
    });
    return this.downloadPromise;
  }
  cancelDownload() { this.downloadAbort?.abort(new DOMException('内容下载已暂停', 'AbortError')); }
  private async downloadFiles(content: LoadedContent, notify: (progress: PackProgress) => void, signal: AbortSignal, themeIds: string[]) {
    this.transient.set(content.id, content.manifest);
    const selected = themeAssetIds(content.manifest, themeIds);
    for (const id of themeIds) content.requestedThemeIds.add(id);
    const assets = [...selected].map((id) => [id, content.manifest.assets[id]!] as const);
    const total = assets.reduce((sum, [, asset]) => sum + asset.bytes, 0);
    const verified = new Set<string>();
    let completed = 0; let cursor = 0;
    const previous = (await this.metadata.all()).find((entry) => entry.id === content.id);
    const record = (state: ContentPackRecord['state'], error?: string): ContentPackRecord => ({
      ...previous,
      id: content.id, contentVersion: content.manifest.contentVersion, state, manifest: content.manifest,
      requestedThemeIds: [...content.requestedThemeIds], readyThemeIds: content.catalog.themes.filter((theme) => this.complete(content, [theme.themeId])).map((theme) => theme.themeId),
      verifiedIds: [...content.verifiedIds], completedBytes: [...content.verifiedIds].reduce((sum, id) => sum + content.manifest.assets[id]!.bytes, 0),
      totalBytes: [...themeAssetIds(content.manifest, [...content.requestedThemeIds])].reduce((sum, id) => sum + content.manifest.assets[id]!.bytes, 0), updatedAt: this.now(), error,
    });
    notify({ state: 'downloading', completedBytes: 0, totalBytes: total, percent: 0 });
    try {
      await this.inspect(content);
      if (previous?.state !== 'active') await this.metadata.put({ ...record('downloading'), readyThemeIds: [...content.committedThemeIds] });
      const worker = async () => {
        while (cursor < assets.length) {
          const [id, asset] = assets[cursor++]!;
          signal.throwIfAborted();
          await this.retrieve(asset, signal);
          verified.add(id); content.verifiedIds.add(id); completed += asset.bytes;
          notify({ state: 'downloading', completedBytes: completed, totalBytes: total, percent: Math.min(99, Math.floor(completed / total * 100)) });
        }
      };
      // Wait for both workers, including after one fails, before publishing metadata.
      const results = await Promise.allSettled([worker(), worker()]);
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failure) throw failure.reason;
      await this.inspect(content);
      for (const ref of themeAudioRefs(content.catalog.words, content.catalog.themes, themeIds, content.manifest.stage)) {
        const [id, clip] = ref.split('#');
        if (!content.sprites[id!]?.sprite[clip!] && !content.manifest.missingAudio.includes(ref)) throw new Error(`内容包遗漏音频引用 ${ref}`);
      }
      if (!this.filesComplete(content, themeIds)) throw new Error('场景资源包尚未完整');
      const incomplete = !this.complete(content, themeIds);
      const committed = record(previous?.state === 'active' && this.complete(content) ? 'active' : incomplete ? 'incomplete' : 'ready');
      await this.metadata.put(committed); content.committedThemeIds = new Set(committed.readyThemeIds);
      notify({ state: incomplete ? 'incomplete' : 'ready', completedBytes: completed, totalBytes: total, percent: incomplete ? 99 : 100 });
      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const state = signal.aborted ? 'paused' : error instanceof Error && error.name === 'QuotaExceededError' ? 'quota' : 'failed';
      // Preserve only entries that still hash correctly; partial cards may remain usable.
      await this.inspect(content).catch(() => { content.verifiedIds.clear(); content.sprites = {}; });
      verified.clear(); for (const id of content.verifiedIds) if (selected.has(id)) verified.add(id);
      completed = [...verified].reduce((sum, key) => sum + content.manifest.assets[key]!.bytes, 0);
      const previouslyReady = (previous?.readyThemeIds ?? (previous?.state === 'active' || previous?.state === 'ready' ? [content.activeThemeId] : []))
        .filter((theme) => this.complete(content, [theme]));
      const retainedState = previous?.state === 'active' ? this.complete(content) ? 'active' : 'degraded'
        : previous?.state === 'ready' && previouslyReady.length ? 'ready' : state;
      content.committedThemeIds = new Set(previouslyReady);
      try { await this.metadata.put({ ...record(retainedState, message), readyThemeIds: previouslyReady }); } catch { /* Storage failure is reported, never represented as ready. */ }
      notify({ state, completedBytes: completed, totalBytes: total, percent: Math.min(99, Math.floor(completed / total * 100)), error: message });
      throw error;
    }
  }
  activate(content: LoadedContent, themeId = content.activeThemeId) { return this.exclusive(() => this.activateFiles(content, themeId)); }
  private async activateFiles(content: LoadedContent, themeId: string) {
    if (themeAudioRefs(content.catalog.words, content.catalog.themes, [themeId], content.manifest.stage).some((ref) => content.manifest.missingAudio.includes(ref))) throw new Error('语音尚未齐全');
    if (await this.metadata.activeSessionVersion() || await this.metadata.activeSessionContentId?.()) return false;
    await this.inspect(content);
    if (!this.complete(content, [themeId])) { if (themeId === content.activeThemeId) await this.degrade(content.id, content); throw new Error('内容包已不完整'); }
    if (!content.committedThemeIds.has(themeId)) return false;
    const activated = await this.metadata.activate(content.id, themeId);
    if (activated) {
      content.activeThemeId = themeId;
      this.currentContent = content;
      if (this.updateCandidate?.id === content.id) this.updateCandidate = undefined;
    }
    return activated;
  }
  cleanup() { return this.exclusive(() => this.cleanFiles()); }
  private async cleanFiles(): Promise<{ files: number; bytes: number; packs: number }> {
    if (!this.canClean()) return { files: 0, bytes: 0, packs: 0 };
    const records = await this.metadata.all();
    const sessionId = await this.metadata.activeSessionContentId?.();
    const sessionVersion = await this.metadata.activeSessionVersion();
    const keep = new Set<string>([...this.transient.keys()]);
    for (const content of [this.currentContent, this.updateCandidate]) if (content) keep.add(content.id);
    if (this.downloadingId) keep.add(this.downloadingId);
    const complete = records.filter((record) => record.state === 'active' || record.state === 'ready')
      .sort((a, b) => Number(b.state === 'active') - Number(a.state === 'active') || (b.activatedAt ?? b.updatedAt) - (a.activatedAt ?? a.updatedAt));
    for (const record of complete.slice(0, 2)) keep.add(record.id);
    for (const record of records) if (record.state === 'active' || (sessionId ? record.id === sessionId : sessionVersion && record.contentVersion === sessionVersion)) keep.add(record.id);
    const manifests = new Map(records.filter((record) => keep.has(record.id)).map((record) => [record.id, record.manifest]));
    for (const [id, manifest] of this.transient) manifests.set(id, manifest);
    for (const content of [this.currentContent, this.updateCandidate]) if (content) manifests.set(content.id, content.manifest);
    const retained = new Set<string>([this.url('content/index.json')]);
    for (const manifest of manifests.values()) for (const asset of Object.values(manifest.assets)) retained.add(this.url(asset.url));
    for (const record of records) if (keep.has(record.id) && record.manifestUrl) retained.add(this.url(record.manifestUrl));
    const base = new URL(this.baseUrl);
    let files = 0; let bytes = 0;
    for (const key of await this.cache.keys()) {
      const url = new URL(key);
      if (url.origin !== base.origin || !(url.pathname.startsWith(`${base.pathname}content/`) || url.pathname.startsWith(`${base.pathname}core/`)) || retained.has(key)) continue;
      const prefix = /\/content\/manifest\.([a-f0-9]+)\.json$/.exec(url.pathname)?.[1];
      if (prefix && [...keep].some((id) => id.startsWith(prefix))) continue;
      const response = await this.cache.match(key);
      const size = response ? (await response.arrayBuffer()).byteLength : 0;
      if (await this.cache.delete(key)) { files += 1; bytes += size; }
    }
    const obsolete = records.filter((record) => !keep.has(record.id)).map((record) => record.id);
    await this.metadata.remove(obsolete);
    return { files, bytes, packs: obsolete.length };
  }
  readyWordIds(content: LoadedContent) {
    return new Set(content.catalog.words.filter((word) => {
      if (word.illustration.type !== 'image' || !content.verifiedIds.has(word.illustration.src)) return false;
      const [spriteId, clip] = word.audio.word.split('#');
      const sprite = content.sprites[spriteId!];
      return Boolean(sprite?.sprite[clip!] && content.verifiedIds.has(sprite.audioAssetId));
    }).map((word) => word.wordId));
  }
  readySpellingWordIds(content: LoadedContent) {
    const ready = this.readyWordIds(content);
    return new Set(content.catalog.words.filter((word) => word.track === 'phonics' && ready.has(word.wordId)
      && word.graphemes.every((part) => {
        if (!part.audio) return true;
        const [id, clip] = part.audio.split('#'); const sprite = content.sprites[id!];
        return sprite?.sprite[clip!] && content.verifiedIds.has(sprite.audioAssetId);
      })).map((word) => word.wordId));
  }
}

export async function browserContentCache(): Promise<ContentCache> {
  const cache = await caches.open(CONTENT_CACHE);
  return { match: (url) => cache.match(url), put: (url, response) => cache.put(url, response), delete: (url) => cache.delete(url), keys: async () => (await cache.keys()).map((request) => request.url) };
}
export function memoryContentCache(): ContentCache {
  const entries = new Map<string, Response>();
  return { match: async (url) => entries.get(url)?.clone(), put: async (url, response) => { entries.set(url, response.clone()); }, delete: async (url) => entries.delete(url), keys: async () => [...entries.keys()] };
}

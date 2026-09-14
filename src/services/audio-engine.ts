import { Howl, Howler } from 'howler';
import type { AssetRecord, ContentManifest, SpriteManifest } from '../data/content-schema.ts';

export type PlaybackStatus = 'ended' | 'cancelled' | 'failed';
export interface PlaybackResult { status: PlaybackStatus; playbackId: string; ref: string; error?: string }
export interface SoundHandle {
  ready: Promise<void>;
  play(clip: string, ended: () => void, failed: () => void, gain?: number): () => void;
  unload(): void;
}
export interface AudioBackend {
  unlock(): Promise<boolean>;
  create(url: string, sprite: SpriteManifest, mime: string): SoundHandle;
  setVolume(cap: number): void;
  setMuted(muted: boolean): void;
  sampleRate(): number;
  generation?(): number;
}

class HowlerBackend implements AudioBackend {
  private unlocker?: Howl;
  private resetCount = 0;
  unlock(): Promise<boolean> {
    try {
      if (Howler.ctx?.state === 'closed') { Howler.unload(); this.unlocker = undefined; this.resetCount += 1; }
      // Creating the Howl initializes Howler.ctx synchronously within the gesture.
      this.unlocker ??= new Howl({ src: ['data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA='], format: ['wav'], preload: false, volume: 0 });
      if (!Howler.ctx) return Promise.resolve(false);
      if ((Howler.ctx.state as string) === 'running') return Promise.resolve(true);
      let timeout: ReturnType<typeof setTimeout>;
      return Promise.race([Howler.ctx.resume().then(() => (Howler.ctx.state as string) === 'running').catch(() => false),
        new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), 4000); })]).finally(() => clearTimeout(timeout!));
    } catch { return Promise.resolve(false); }
  }
  create(url: string, sprite: SpriteManifest, mime: string): SoundHandle {
    const howl = new Howl({ src: [url], sprite: sprite.sprite, preload: false, rate: 1, html5: false, format: [mime.includes('wav') ? 'wav' : 'mp3'] });
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('语音加载超时')); }, 10_000);
      const cleanup = () => { clearTimeout(timeout); howl.off('load', loaded); howl.off('loaderror', error); };
      const loaded = () => { cleanup(); resolve(); };
      const error = () => { cleanup(); reject(new Error('语音加载失败')); };
      howl.once('load', loaded); howl.once('loaderror', error); howl.load();
    });
    return {
      ready,
      play(clip, ended, failed, gain = 1) {
        const id = howl.play(clip);
        howl.volume(gain, id);
        const done = () => { detach(); ended(); };
        const error = () => { detach(); failed(); };
        const detach = () => { howl.off('end', done, id); howl.off('playerror', error, id); };
        howl.once('end', done, id); howl.once('playerror', error, id);
        return () => { detach(); howl.stop(id); };
      },
      unload() { howl.unload(); },
    };
  }
  setVolume(cap: number) { Howler.volume(cap); }
  setMuted(muted: boolean) { Howler.mute(muted); }
  sampleRate() { return Howler.ctx?.sampleRate ?? 48_000; }
  generation() { return this.resetCount; }
}

interface RegisteredSprite { sprite: SpriteManifest; asset: AssetRecord }
interface ActivePlayback { id: string; ref: string; owner: string; stop?: () => void; finish: (status: PlaybackStatus, error?: string) => void }
interface QueuedGuide { ref: string; owner: string; at: number; playbackId: string; timeout: ReturnType<typeof setTimeout>; resolve: (result: PlaybackResult) => void }
export class AudioEngine {
  private readonly backend: AudioBackend;
  private readonly assetUrl: (url: string) => string;
  private readonly clock: () => number;
  private sprites = new Map<string, RegisteredSprite>();
  private coreSprites = new Map<string, RegisteredSprite>();
  private handles = new Map<string, { handle: SoundHandle; bytes: number; touched: number }>();
  private current?: ActivePlayback;
  private effectPlayback?: ActivePlayback;
  private queuedGuide?: QueuedGuide;
  private lastEffectAt = Number.NEGATIVE_INFINITY;
  private sequence = 0;
  private ownerEpochs = new Map<string, number>();
  private muted = false;
  private volumeCap = 0.7;
  private outputGain = 1;
  private deviceFade?: ReturnType<typeof setInterval>;
  private contextGeneration = 0;
  constructor(assetUrl: (url: string) => string, backend: AudioBackend = new HowlerBackend(), clock = () => performance.now()) {
    this.assetUrl = assetUrl; this.backend = backend; this.clock = clock;
  }
  get playing() { return Boolean(this.current); }
  get isMuted() { return this.muted; }
  unlock() {
    const resumed = this.backend.unlock();
    const generation = this.backend.generation?.() ?? 0;
    if (generation !== this.contextGeneration) {
      this.cancel(); this.handles.clear(); this.contextGeneration = generation;
    }
    return resumed;
  }
  configure(manifest: ContentManifest, sprites: Record<string, SpriteManifest>) {
    this.cancel(); this.unloadExcept([]); this.sprites = new Map(this.coreSprites);
    this.register(manifest, sprites);
  }
  registerCore(manifest: Pick<ContentManifest, 'assets'>, sprites: Record<string, SpriteManifest>) {
    for (const [id, sprite] of Object.entries(sprites)) {
      const asset = manifest.assets[sprite.audioAssetId]; if (asset) this.coreSprites.set(id, { sprite, asset });
    }
    this.register(manifest, sprites);
  }
  register(manifest: Pick<ContentManifest, 'assets'>, sprites: Record<string, SpriteManifest>) {
    for (const [id, sprite] of Object.entries(sprites)) {
      const asset = manifest.assets[sprite.audioAssetId];
      if (!asset) continue;
      const previous = this.sprites.get(id);
      if (previous && (previous.asset.sha256 !== asset.sha256 || JSON.stringify(previous.sprite) !== JSON.stringify(sprite))) {
        if (this.current?.ref.startsWith(`${id}#`)) this.current.finish('cancelled');
        if (this.effectPlayback?.ref.startsWith(`${id}#`)) this.effectPlayback.finish('cancelled');
        this.handles.get(id)?.handle.unload(); this.handles.delete(id);
      }
      this.sprites.set(id, { sprite, asset });
    }
  }
  async preload(ids: string[]) { await Promise.all(ids.filter((id) => this.sprites.has(id)).map((id) => this.sound(id))); }
  has(ref: string) {
    const [id, clip] = ref.split('#');
    return Boolean(this.sprites.get(id!)?.sprite.sprite[clip!]);
  }
  setVolume(cap: number) { this.volumeCap = Math.max(0.4, Math.min(1, cap)); this.backend.setVolume(this.volumeCap * this.outputGain); }
  outputDeviceChanged() {
    clearInterval(this.deviceFade);
    const started = this.clock(); const initialGain = this.outputGain;
    this.deviceFade = setInterval(() => {
      const elapsed = Math.max(0, this.clock() - started);
      this.outputGain = elapsed < 300 ? initialGain * (1 - elapsed / 300) : Math.min(1, (elapsed - 300) / 300);
      this.backend.setVolume(this.volumeCap * this.outputGain);
      if (elapsed >= 600) { clearInterval(this.deviceFade); this.deviceFade = undefined; }
    }, 25);
  }
  setMuted(muted: boolean) { if (muted) this.cancel(); this.muted = muted; this.backend.setMuted(muted); }
  cancel(owner?: string) {
    this.cancelSpeech(owner);
    if (!owner || this.effectPlayback?.owner === owner) this.effectPlayback?.finish('cancelled');
  }
  cancelSpeech(owner?: string) {
    if (owner) this.ownerEpochs.set(owner, (this.ownerEpochs.get(owner) ?? 0) + 1);
    if (!owner || this.current?.owner === owner) { this.sequence += 1; this.current?.finish('cancelled'); }
    if (!owner || this.queuedGuide?.owner === owner) this.discardGuide();
  }
  private discardGuide() {
    const queued = this.queuedGuide; this.queuedGuide = undefined;
    if (!queued) return;
    clearTimeout(queued.timeout);
    queued.resolve({ status: 'cancelled', playbackId: queued.playbackId, ref: queued.ref });
  }
  private async sound(id: string): Promise<SoundHandle> {
    let entry = this.handles.get(id);
    if (!entry) {
      const registered = this.sprites.get(id);
      if (!registered) throw new Error('语音素材尚未准备好');
      const bytes = this.backend.sampleRate() * registered.sprite.channels * registered.sprite.durationMs / 1000 * 4;
      if (bytes > 64 * 1024 * 1024) throw new Error('语音超出设备内存预算');
      const used = () => [...this.handles.values()].reduce((total, value) => total + value.bytes, 0);
      const pinned = new Set([this.current?.ref.split('#')[0], this.effectPlayback?.ref.split('#')[0]]);
      for (const [key, candidate] of [...this.handles].sort((a, b) => a[1].touched - b[1].touched)) {
        if (used() + bytes <= 64 * 1024 * 1024) break;
        if (pinned.has(key)) continue;
        candidate.handle.unload(); this.handles.delete(key);
      }
      if (used() + bytes > 64 * 1024 * 1024) throw new Error('正在播放的语音已占用音频内存预算');
      entry = { handle: this.backend.create(this.assetUrl(registered.asset.url), registered.sprite, registered.asset.mime), bytes, touched: this.clock() };
      this.handles.set(id, entry);
    }
    entry.touched = this.clock();
    try { await entry.handle.ready; return entry.handle; }
    catch (error) {
      entry.handle.unload();
      if (this.handles.get(id) === entry) this.handles.delete(id);
      throw error;
    }
  }
  play(ref: string, owner: string): Promise<PlaybackResult> {
    this.sequence += 1; this.discardGuide();
    return this.perform(ref, owner);
  }
  private perform(ref: string, owner: string): Promise<PlaybackResult> {
    this.current?.finish('cancelled');
    const playbackId = crypto.randomUUID();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (status: PlaybackStatus, error?: string) => {
        if (settled) return; settled = true;
        if (this.current?.id === playbackId) {
          if (status !== 'ended') this.current.stop?.();
          this.current = undefined;
        }
        resolve({ status, ref, playbackId, ...(error ? { error } : {}) });
        if (status === 'ended') this.flushGuide();
      };
      this.current = { id: playbackId, ref, owner, finish };
      if (this.muted) { finish('failed', '请先打开声音'); return; }
      const [id, clip] = ref.split('#');
      if (!id || !clip || !this.has(ref)) { finish('failed', '语音素材尚未准备好'); return; }
      void this.sound(id).then((sound) => {
        if (settled || this.current?.id !== playbackId) return;
        const stop = sound.play(clip, () => finish('ended'), () => finish('failed', '请再点一次喇叭'));
        if (this.current?.id === playbackId) this.current.stop = stop;
      }).catch((error: unknown) => finish('failed', error instanceof Error ? error.message : '语音无法播放'));
    });
  }
  guide(ref: string, owner: string): Promise<PlaybackResult> {
    if (!this.has(ref) || this.muted) return Promise.resolve({ status: 'failed', ref, playbackId: crypto.randomUUID() });
    if (!this.current) return this.perform(ref, owner);
    this.discardGuide();
    return new Promise((resolve) => {
      const playbackId = crypto.randomUUID();
      const timeout = setTimeout(() => { if (this.queuedGuide?.playbackId === playbackId) this.discardGuide(); }, 3000);
      this.queuedGuide = { ref, owner, at: this.clock(), playbackId, timeout, resolve };
    });
  }
  private flushGuide() {
    const guide = this.queuedGuide; this.queuedGuide = undefined;
    if (!guide) return;
    clearTimeout(guide.timeout);
    const cancelled = () => guide.resolve({ status: 'cancelled', playbackId: guide.playbackId, ref: guide.ref });
    if (this.clock() - guide.at > 3000) { cancelled(); return; }
    const sequence = this.sequence; const ownerEpoch = this.ownerEpochs.get(guide.owner) ?? 0;
    queueMicrotask(() => {
      if (!this.current && sequence === this.sequence && ownerEpoch === (this.ownerEpochs.get(guide.owner) ?? 0)) void this.perform(guide.ref, guide.owner).then(guide.resolve);
      else cancelled();
    });
  }
  effect(ref: string, owner = 'ui', quiet = false): Promise<PlaybackResult> {
    const playbackId = crypto.randomUUID();
    if (this.muted || !this.has(ref) || (quiet && ref !== 'sfx#pop') || (ref === 'sfx#pop' && this.clock() - this.lastEffectAt < 100)) {
      return Promise.resolve({ status: 'cancelled', ref, playbackId });
    }
    this.lastEffectAt = this.clock(); this.effectPlayback?.finish('cancelled');
    return new Promise((resolve) => {
      let settled = false;
      const finish = (status: PlaybackStatus) => {
        if (settled) return; settled = true;
        if (this.effectPlayback?.id === playbackId) {
          if (status !== 'ended') this.effectPlayback.stop?.();
          this.effectPlayback = undefined;
        }
        resolve({ status, ref, playbackId });
      };
      this.effectPlayback = { id: playbackId, ref, owner, finish };
      const [id, clip] = ref.split('#');
      void this.sound(id!).then((sound) => {
        if (settled || this.effectPlayback?.id !== playbackId) return;
        const stop = sound.play(clip!, () => finish('ended'), () => finish('failed'), 0.3);
        if (this.effectPlayback?.id === playbackId) this.effectPlayback.stop = stop;
      }).catch(() => finish('failed'));
    });
  }
  async playSequence(refs: string[], owner: string): Promise<PlaybackResult | undefined> {
    this.cancel(); const sequence = this.sequence;
    let result: PlaybackResult | undefined;
    for (const ref of refs) {
      if (sequence !== this.sequence) return result ? { ...result, status: 'cancelled' } : undefined;
      result = await this.perform(ref, owner);
      if (result.status !== 'ended') return result;
    }
    return result;
  }
  unloadExcept(ids: string[]) {
    for (const [id, entry] of this.handles) if (!ids.includes(id)) {
      if (this.current?.ref.startsWith(`${id}#`)) this.current.finish('cancelled');
      if (this.effectPlayback?.ref.startsWith(`${id}#`)) this.effectPlayback.finish('cancelled');
      entry.handle.unload(); this.handles.delete(id);
    }
  }
  dispose() { clearInterval(this.deviceFade); this.deviceFade = undefined; this.outputGain = 1; this.backend.setVolume(this.volumeCap); this.cancel(); this.unloadExcept([]); }
}

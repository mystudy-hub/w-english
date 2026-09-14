import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, type AudioBackend, type SoundHandle } from '../src/services/audio-engine.ts';
import type { ContentManifest, SpriteManifest } from '../src/data/content-schema.ts';

class FakeBackend implements AudioBackend {
  plays: Array<{ clip: string; end: () => void; fail: () => void; stopped: boolean; gain: number }> = [];
  volume = vi.fn(); muted = vi.fn(); unloaded = vi.fn(); ready: Promise<void> = Promise.resolve();
  created = 0; context = 0; generation = () => this.context;
  unlock = async () => true;
  sampleRate = () => 48000;
  setVolume(cap: number) { this.volume(cap); }
  setMuted(muted: boolean) { this.muted(muted); }
  create(): SoundHandle {
    this.created += 1;
    return { ready: this.ready, unload: this.unloaded,
      play: (clip, end, fail, gain = 1) => { const entry = { clip, end, fail, stopped: false, gain }; this.plays.push(entry); return () => { entry.stopped = true; }; },
    };
  }
}
const sprite: SpriteManifest = { audioAssetId: 'audio', durationMs: 1000, sampleRate: 24000, channels: 1, sprite: { cat: [150, 200], dog: [650, 200], cue: [150, 200] } };
const manifest: ContentManifest = {
  manifestVersion: 1, schemaVersion: 3, contentVersion: '2026.09.1', appContract: { min: 1, max: 1 },
  assets: { audio: { url: 'content/audio/test.mp3', sha256: 'a'.repeat(64), bytes: 100, mime: 'audio/mpeg' } },
  sprites: {}, packs: [], catalogAssetId: 'catalog', missingAudio: [], mode: 'preview',
};
const waitPlays = (backend: FakeBackend, count: number) => vi.waitFor(() => expect(backend.plays).toHaveLength(count));

describe('audio scheduling lifecycle', () => {
  it('keeps app-shell instructions available when an older content pack replaces the scene', async () => {
    const backend = new FakeBackend(); const engine = new AudioEngine((url) => url, backend);
    engine.registerCore(manifest, { ui_guide: { ...sprite, sprite: { rotate: [150, 200] } } });
    engine.configure(manifest, { animal_home: sprite });
    expect(engine.has('ui_guide#rotate')).toBe(true); expect(engine.has('animal_home#cat')).toBe(true);
    const playback = engine.play('ui_guide#rotate', 'orientation'); await waitPlays(backend, 1);
    backend.plays[0]!.end(); expect((await playback).status).toBe('ended'); engine.dispose();
  });
  it('reports missing audio as failure, never as completion', async () => {
    const backend = new FakeBackend(); const engine = new AudioEngine((url) => url, backend);
    expect((await engine.play('phonics#p', 'card')).status).toBe('failed');
    expect(backend.plays).toHaveLength(0);
  });
  it('replaces an old request and ignores its late completion callback', async () => {
    const backend = new FakeBackend(); const engine = new AudioEngine((url) => url, backend);
    engine.configure(manifest, { animal_home: sprite });
    const first = engine.play('animal_home#cat', 'card'); await waitPlays(backend, 1);
    const second = engine.play('animal_home#dog', 'card'); await waitPlays(backend, 2);
    expect(backend.plays[0]!.stopped).toBe(true);
    backend.plays[0]!.end(); expect(engine.playing).toBe(true);
    backend.plays[1]!.end();
    expect((await first).status).toBe('cancelled'); expect((await second).status).toBe('ended');
  });
  it('cancels a request while its sprite is still loading', async () => {
    const backend = new FakeBackend(); let loaded!: () => void;
    backend.ready = new Promise((resolve) => { loaded = resolve; });
    const engine = new AudioEngine((url) => url, backend); engine.configure(manifest, { animal_home: sprite });
    const play = engine.play('animal_home#cat', 'card'); engine.cancel('card'); loaded();
    expect((await play).status).toBe('cancelled'); await Promise.resolve(); expect(backend.plays).toHaveLength(0);
  });
  it('discards expired guide cues and cues whose owner has left', async () => {
    let now = 0;
    const backend = new FakeBackend(); const engine = new AudioEngine((url) => url, backend, () => now);
    engine.configure(manifest, { animal_home: sprite, guide: sprite });
    const first = engine.play('animal_home#cat', 'card'); await waitPlays(backend, 1);
    engine.guide('guide#cue', 'card'); now = 4000; backend.plays[0]!.end(); await first;
    await Promise.resolve(); expect(backend.plays).toHaveLength(1);
    const second = engine.play('animal_home#cat', 'card'); await waitPlays(backend, 2);
    engine.guide('guide#cue', 'card'); backend.plays[1]!.end(); engine.cancel('card'); await second;
    await Promise.resolve(); expect(backend.plays).toHaveLength(2);
  });
  it('does not claim a whole sequence finished when a new user request interrupts it', async () => {
    const backend = new FakeBackend(); const engine = new AudioEngine((url) => url, backend);
    engine.configure(manifest, { animal_home: sprite });
    const sequence = engine.playSequence(['animal_home#cat', 'animal_home#dog'], 'phonics');
    await waitPlays(backend, 1); backend.plays[0]!.end();
    const other = engine.play('animal_home#cat', 'card');
    expect((await sequence)?.status).toBe('cancelled'); await waitPlays(backend, 2); backend.plays[1]!.end(); await other;
  });
  it('keeps mute independent of the volume cap', () => {
    const backend = new FakeBackend(); const engine = new AudioEngine((url) => url, backend);
    engine.setVolume(10); expect(backend.volume).toHaveBeenLastCalledWith(1);
    engine.setVolume(0); expect(backend.volume).toHaveBeenLastCalledWith(0.4);
    engine.setMuted(true); expect(engine.isMuted).toBe(true); expect(backend.muted).toHaveBeenLastCalledWith(true);
  });
  it('fades around an output change without exceeding a changed cap or undoing mute', () => {
    vi.useFakeTimers(); let now = 0;
    const backend = new FakeBackend(); const engine = new AudioEngine((url) => url, backend, () => now);
    try {
      engine.setVolume(0.7); engine.outputDeviceChanged(); now = 150; vi.advanceTimersByTime(150);
      expect(backend.volume).toHaveBeenLastCalledWith(0.35);
      engine.setVolume(0.4); expect(backend.volume).toHaveBeenLastCalledWith(0.2);
      now = 300; vi.advanceTimersByTime(150); expect(backend.volume).toHaveBeenLastCalledWith(0);
      engine.setMuted(true); now = 450; vi.advanceTimersByTime(150); expect(backend.volume).toHaveBeenLastCalledWith(0.2);
      engine.outputDeviceChanged(); now = 1050; vi.advanceTimersByTime(600);
      expect(backend.volume).toHaveBeenLastCalledWith(0.4); expect(engine.isMuted).toBe(true);
      const calls = backend.volume.mock.calls.length; vi.advanceTimersByTime(1000); expect(backend.volume).toHaveBeenCalledTimes(calls);
    } finally { engine.dispose(); vi.useRealTimers(); }
  });
  it('does not reuse unloaded sprite handles after the audio context is recreated', async () => {
    const backend = new FakeBackend(); const engine = new AudioEngine((url) => url, backend);
    engine.configure(manifest, { animal_home: sprite });
    const first = engine.play('animal_home#cat', 'card'); await waitPlays(backend, 1); backend.plays[0]!.end(); await first;
    backend.context += 1; await engine.unlock();
    const second = engine.play('animal_home#cat', 'card'); await waitPlays(backend, 2); backend.plays[1]!.end(); await second;
    expect(backend.created).toBe(2);
  });
  it('does not report a muted or interrupted-by-mute playback as heard', async () => {
    const backend = new FakeBackend(); const engine = new AudioEngine((url) => url, backend);
    engine.configure(manifest, { animal_home: sprite });
    const playing = engine.play('animal_home#cat', 'card'); await waitPlays(backend, 1);
    engine.setMuted(true); backend.plays[0]!.end();
    expect((await playing).status).toBe('cancelled');
    expect((await engine.play('animal_home#dog', 'card')).status).toBe('failed');
    expect(backend.plays).toHaveLength(1);
  });
  it('does not let an old loading failure discard a handle from a recreated context', async () => {
    const backend = new FakeBackend(); let rejectOld!: (error: Error) => void;
    backend.ready = new Promise((_, reject) => { rejectOld = reject; });
    const engine = new AudioEngine((url) => url, backend); engine.configure(manifest, { animal_home: sprite });
    const old = engine.play('animal_home#cat', 'old');
    backend.context += 1; await engine.unlock(); backend.ready = Promise.resolve();
    const current = engine.play('animal_home#dog', 'current'); await waitPlays(backend, 1);
    rejectOld(new Error('Old context load failed')); await old; await Promise.resolve();
    backend.plays[0]!.end(); await current;
    const replay = engine.play('animal_home#cat', 'current'); await waitPlays(backend, 2);
    backend.plays[1]!.end(); await replay; expect(backend.created).toBe(2);
  });
  it('plays quiet effects without replacing the learning voice', async () => {
    const backend = new FakeBackend(); const engine = new AudioEngine((url) => url, backend);
    engine.configure(manifest, { animal_home: sprite, sfx: { ...sprite, sprite: { pop: [0, 50] } } });
    const voice = engine.play('animal_home#cat', 'card'); await waitPlays(backend, 1);
    const effect = engine.effect('sfx#pop'); await waitPlays(backend, 2);
    expect(backend.plays[0]!.stopped).toBe(false); expect(backend.plays[1]!.gain).toBe(0.3);
    backend.plays[1]!.end(); expect((await effect).status).toBe('ended'); expect(engine.playing).toBe(true);
    backend.plays[0]!.end(); expect((await voice).status).toBe('ended');
  });
  it('throttles click sounds and suppresses celebration in quiet mode', async () => {
    let now = 0; const backend = new FakeBackend(); const engine = new AudioEngine((url) => url, backend, () => now);
    engine.configure(manifest, { sfx: { ...sprite, sprite: { pop: [0, 50], chime_success: [350,100] } } });
    const first = engine.effect('sfx#pop'); await waitPlays(backend, 1);
    now = 99; expect((await engine.effect('sfx#pop')).status).toBe('cancelled');
    expect((await engine.effect('sfx#chime_success', 'ui', true)).status).toBe('cancelled');
    backend.plays[0]!.end(); await first;
    now = 100; const next = engine.effect('sfx#pop', 'ui', true); await waitPlays(backend, 2); backend.plays[1]!.end(); await next;
  });
  it('settles queued guidance when a child action supersedes it', async () => {
    const backend = new FakeBackend(); const engine = new AudioEngine((url) => url, backend);
    engine.configure(manifest, { animal_home: sprite, guide: sprite });
    const voice = engine.play('animal_home#cat', 'card'); await waitPlays(backend, 1);
    const guide = engine.guide('guide#cue', 'card');
    const next = engine.play('animal_home#dog', 'card');
    expect((await guide).status).toBe('cancelled'); expect((await voice).status).toBe('cancelled');
    await waitPlays(backend, 2); backend.plays[1]!.end(); await next;
  });
  it('merges an unchanged core registry without cancelling a live utterance', async () => {
    const backend = new FakeBackend(); const engine = new AudioEngine((url) => url, backend);
    engine.configure(manifest, { animal_home: sprite });
    const voice = engine.play('animal_home#cat', 'card'); await waitPlays(backend, 1);
    engine.register(manifest, { animal_home: sprite, guide: sprite });
    expect(backend.plays[0]!.stopped).toBe(false); backend.plays[0]!.end(); expect((await voice).status).toBe('ended');
  });
});

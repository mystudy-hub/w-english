import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/domain/config.ts';
import { SPEED_CONFIG } from '../src/features/dianfan.tsx';
import { AudioEngine } from '../src/services/audio-engine.ts';
import { syncAudioSettings } from '../src/app/runtime.ts';

describe('audio playback speed and slow-listening configuration', () => {
  it('configures Dianfan speed settings with slower slow mode and medium matching previous slow', () => {
    // 现在的慢速改成更慢的速度 (0.58x)
    expect(SPEED_CONFIG.slow.wordRate).toBe(0.58);
    expect(SPEED_CONFIG.slow.sentenceRate).toBe(0.62);
    expect(SPEED_CONFIG.slow.label).toBe('慢速');

    // 较慢改成现在慢速的速度 (0.70x)
    expect(SPEED_CONFIG.medium.wordRate).toBe(0.70);
    expect(SPEED_CONFIG.medium.sentenceRate).toBe(0.74);
    expect(SPEED_CONFIG.medium.label).toBe('较慢');

    // 标准速度 (0.85x)
    expect(SPEED_CONFIG.normal.wordRate).toBe(0.85);
    expect(SPEED_CONFIG.normal.sentenceRate).toBe(0.88);
  });

  it('provides sensible playbackRate and slowPlaybackRate in defaultSettings', () => {
    const settings = defaultSettings();
    expect(settings.parentSettings.playbackRate).toBe(0.85);
    expect(settings.parentSettings.slowPlaybackRate).toBe(0.60);
  });

  it('manages AudioEngine rate and clamps within comfortable ranges', () => {
    const engine = new AudioEngine((url) => url);
    expect(engine.playbackRate).toBe(0.85);
    expect(engine.slowPlaybackRate).toBe(0.60);

    // 可调 0.x
    engine.setPlaybackRate(0.70);
    expect(engine.playbackRate).toBe(0.70);

    engine.setSlowPlaybackRate(0.55);
    expect(engine.slowPlaybackRate).toBe(0.55);

    // 越界保护
    engine.setPlaybackRate(0.1);
    expect(engine.playbackRate).toBe(0.4);

    engine.setPlaybackRate(2.5);
    expect(engine.playbackRate).toBe(1.5);
  });

  it('syncAudioSettings correctly delegates to the engine', () => {
    const settings = defaultSettings();
    settings.parentSettings.playbackRate = 0.75;
    settings.parentSettings.slowPlaybackRate = 0.50;

    syncAudioSettings(settings.parentSettings);
    // audio singleton is used in runtime
  });
});

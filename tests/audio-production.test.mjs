// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { produceSprites, probeAudio, truePeak, verifyDecodedAudio } from '../scripts/lib/audio-production.mjs';
import { audioBuildSchema, verifyClipApprovals } from '../scripts/lib/audio-audit.mjs';
import { sha256 } from '../scripts/lib/files.mjs';

function testSignal(seconds = 0.8) {
  const sampleRate = 24000; const samples = Math.floor(sampleRate * seconds);
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i / sampleRate * 2 * Math.PI * 440) * 4000), 44 + i * 2);
  return data;
}

describe('real audio tooling with explicitly synthetic test signals', () => {
  it('encodes a padded sprite, slows a derivative and binds approval to the actual files', async () => {
    await mkdir('.cache', { recursive: true });
    const directory = await mkdtemp(resolve('.cache/audio-production-test-'));
    await mkdir(resolve(directory, 'words'));
    await writeFile(resolve(directory, 'words/cat.wav'), testSignal());
    const clips = [
      { ref: 'animal_home#cat', kind: 'word', input: 'words/cat.wav' },
      { ref: 'animal_home#cat_slow', kind: 'slow', derivedFrom: 'animal_home#cat' },
    ];
    const result = await produceSprites(clips, { sourceDirectory: directory, outputDirectory: resolve(directory, 'output') });
    expect(audioBuildSchema.safeParse(result).success).toBe(true);
    const artifact = result.sprites.animal_home;
    const file = resolve(directory, 'output', artifact.file);
    const bytes = await readFile(file);
    expect(sha256(bytes)).toBe(artifact.sha256);
    expect(probeAudio(file).streams[0].channels).toBe(1);
    expect(truePeak(file)).toBeLessThanOrEqual(-1);
    expect(artifact.decoded.checkedClips).toBe(2);
    expect(Math.abs(artifact.decoded.durationMs - artifact.sprite.durationMs)).toBeLessThanOrEqual(50);
    expect(() => verifyDecodedAudio(file, { ...artifact.sprite, durationMs: 1 })).toThrow('解码时长');
    expect(() => verifyDecodedAudio(file, { ...artifact.sprite, sprite: { missing: [artifact.sprite.durationMs + 1, 20] } })).toThrow('超出实际');
    expect(() => verifyDecodedAudio(file, { ...artifact.sprite, sprite: { silent: [0, 20] } })).toThrow('只有静音');
    for (const clip of result.clips) {
      const pcmFile = resolve(directory, 'output', clip.pcm.file); const pcmBytes = await readFile(pcmFile);
      expect(sha256(pcmBytes)).toBe(clip.pcm.sha256);
      expect(sha256(pcmBytes.subarray(44))).toBe(clip.normalizedSha256);
      expect(probeAudio(pcmFile).streams[0]).toMatchObject({ codec_name: 'pcm_s16le', sample_rate: '24000', channels: 1, bits_per_sample: 16 });
    }
    const assembly = await readFile(resolve(directory, 'output', artifact.pcm.file));
    expect(sha256(assembly)).toBe(artifact.pcm.sha256);
    expect((assembly.length - 44) / 2 / 24000 * 1000).toBe(artifact.sprite.durationMs);
    expect(assembly.subarray(44, 44 + 24000 * .15 * 2).every((byte) => byte === 0)).toBe(true);
    const normal = artifact.sprite.sprite.cat; const slow = artifact.sprite.sprite.cat_slow;
    expect(normal[0]).toBe(150);
    expect(slow[0] - normal[0] - normal[1]).toBeCloseTo(300, 5);
    expect(slow[1] / normal[1]).toBeGreaterThan(1.2);
    expect(slow[1] / normal[1]).toBeLessThan(1.4);
    expect(result.reviewStatus).toBe('pending');
    expect(() => verifyClipApprovals(result, { clips: {} }, clips.map((clip) => clip.ref))).toThrow('听审记录');
    const approvals = { clips: Object.fromEntries(result.clips.map((clip) => [clip.ref, {
      reviewer: 'Synthetic test fixture; not a real approval', reviewedAt: '2026-09-10T00:00:00Z',
      spriteSha256: artifact.sha256, sourceSha256: clip.sourceSha256, promptSha256: clip.promptSha256,
      clip: [...artifact.sprite.sprite[clip.ref.split('#')[1]]],
      creator: 'Test generator', license: 'Test-only signal', permissionEvidence: 'tests/audio-production.test.mjs', calibrationApproved: true,
    }])) };
    expect(() => verifyClipApprovals(result, approvals, clips.map((clip) => clip.ref))).not.toThrow();
    expect(() => verifyClipApprovals(result, approvals, [{ ...clips[0], text: 'changed target' }])).toThrow('文字或发音要求改变');
    const interval = artifact.sprite.sprite.cat;
    artifact.sprite.sprite.cat = [interval[0] + 10, interval[1]];
    expect(() => verifyClipApprovals(result, approvals, ['animal_home#cat'])).toThrow('切片位置改变');
    artifact.sprite.sprite.cat = interval;
    approvals.clips['animal_home#cat'].spriteSha256 = '0'.repeat(64);
    expect(() => verifyClipApprovals(result, approvals, ['animal_home#cat'])).toThrow('审批已失效');
    // This test writes only its private .cache folder, never the app's audio-source or published assets.
  });
  it('does not publish a partial index when an input recording is missing', async () => {
    await mkdir('.cache', { recursive: true });
    const directory = await mkdtemp(resolve('.cache/audio-missing-test-'));
    await expect(produceSprites([{ ref: 'phonics#p', kind: 'phoneme', input: 'missing.wav' }], { sourceDirectory: directory, outputDirectory: resolve(directory, 'output') })).rejects.toThrow();
    await expect(readFile(resolve(directory, 'output/index.json'))).rejects.toThrow();
  });
  it('merges whole-sprite batches, replaces only the chosen group and preserves the index on failed input or corruption', async () => {
    await mkdir('.cache', { recursive: true }); const directory = await mkdtemp(resolve('.cache/audio-batch-test-'));
    const outputDirectory = resolve(directory, 'output'); const options = { sourceDirectory: directory, outputDirectory, retainExisting: true };
    await writeFile(resolve(directory, 'cat.wav'), testSignal()); await writeFile(resolve(directory, 'welcome.wav'), testSignal());
    const wordClips = [{ ref: 'animal_home#cat', kind: 'word', input: 'cat.wav' }, { ref: 'animal_home#cat_slow', kind: 'slow', derivedFrom: 'animal_home#cat' }];
    const first = await produceSprites(wordClips, options);
    const second = await produceSprites([{ ref: 'guide#welcome', kind: 'guide', input: 'welcome.wav' }], options);
    expect(second.sprites.animal_home).toEqual(first.sprites.animal_home);
    expect(second.clips).toHaveLength(3); expect(second.reviewStatus).toBe('pending');
    const indexPath = resolve(outputDirectory, 'index.json'); const saved = await readFile(indexPath);
    await expect(produceSprites([{ ref: 'phonics#p', kind: 'phoneme', input: 'missing.wav' }], options)).rejects.toThrow();
    expect(await readFile(indexPath)).toEqual(saved);
    await writeFile(resolve(directory, 'cat.wav'), testSignal(1.2));
    const replaced = await produceSprites(wordClips, options);
    expect(replaced.sprites.guide).toEqual(second.sprites.guide);
    expect(replaced.sprites.animal_home.sha256).not.toBe(first.sprites.animal_home.sha256);
    expect(replaced.clips).toHaveLength(3); expect(new Set(replaced.clips.map((clip) => clip.ref)).size).toBe(3);
    expect(audioBuildSchema.safeParse(replaced).success).toBe(true);
    const current = await readFile(indexPath);
    const retainedPcm = resolve(outputDirectory, replaced.clips.find((clip) => clip.ref === 'guide#welcome').pcm.file);
    const beforePcm = await readFile(retainedPcm); await writeFile(retainedPcm, 'corrupted PCM');
    await expect(produceSprites(wordClips, options)).rejects.toThrow('PCM 中间文件哈希不符');
    expect(await readFile(indexPath)).toEqual(current); await writeFile(retainedPcm, beforePcm);
    await writeFile(resolve(outputDirectory, replaced.sprites.guide.file), 'corrupted');
    await expect(produceSprites(wordClips, options)).rejects.toThrow('哈希不符');
    expect(await readFile(indexPath)).toEqual(current);
    await expect(readFile(resolve(outputDirectory, '.index.lock'))).rejects.toThrow();
  }, 15_000);
  it('refuses another writer without deleting its lock or publishing an index', async () => {
    await mkdir('.cache', { recursive: true }); const directory = await mkdtemp(resolve('.cache/audio-lock-test-'));
    const locked = resolve(directory, '.index.lock'); await writeFile(locked, 'another-writer');
    await expect(produceSprites([{ ref: 'guide#welcome', kind: 'guide', input: 'welcome.wav' }], { sourceDirectory: directory, outputDirectory: directory, retainExisting: true })).rejects.toThrow('已有打包任务');
    expect(await readFile(locked, 'utf8')).toBe('another-writer');
    await expect(readFile(resolve(directory, 'index.json'))).rejects.toThrow();
  });
});

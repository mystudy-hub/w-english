import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { sha256, within } from './files.mjs';
import { audioBuildSchema } from './audio-audit.mjs';
import { clipPromptFingerprint } from './audio-inventory.mjs';

export const SAMPLE_RATE = 24_000;
function pcmWave(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
async function savePcm(output, name, pcm) {
  const bytes = pcmWave(pcm); const hash = sha256(bytes); const file = `pcm/${name}.${hash.slice(0, 16)}.wav`;
  await writeFile(within(output, file), bytes);
  return { file, sha256: hash, sampleRate: SAMPLE_RATE, channels: 1, bitsPerSample: 16 };
}
async function verifyPcm(output, artifact, label, normalizedSha256) {
  if (!artifact) return;
  const bytes = await readFile(within(output, artifact.file));
  if (sha256(bytes) !== artifact.sha256) throw new Error(`${label}: PCM 中间文件哈希不符`);
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 16) !== 'WAVEfmt '
    || bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1
    || bytes.readUInt16LE(22) !== 1 || bytes.readUInt32LE(24) !== SAMPLE_RATE || bytes.readUInt32LE(28) !== SAMPLE_RATE * 2
    || bytes.readUInt16LE(32) !== 2 || bytes.readUInt16LE(34) !== 16 || bytes.toString('ascii', 36, 40) !== 'data'
    || bytes.readUInt32LE(40) !== bytes.length - 44 || (bytes.length - 44) % 2) throw new Error(`${label}: PCM 中间文件参数不符`);
  if (normalizedSha256 && sha256(bytes.subarray(44)) !== normalizedSha256) throw new Error(`${label}: PCM 与规范化记录不一致`);
}
const ffmpeg = process.env.FFMPEG_PATH || ffmpegInstaller.path;
const ffprobe = process.env.FFPROBE_PATH || ffprobeInstaller.path;
function run(binary, args, input, maxBuffer = 4 * 1024 * 1024) {
  const result = spawnSync(binary, args, { input, windowsHide: true, maxBuffer, timeout: 30_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${binary === ffmpeg ? 'ffmpeg' : 'ffprobe'}: ${result.stderr.toString().slice(-1600)}`);
  return result;
}
function measure(input, pcm = false) {
  const args = ['-hide_banner', '-nostdin', ...(pcm ? ['-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0'] : ['-i', input]),
    '-af', 'loudnorm=I=-16:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'];
  const output = run(ffmpeg, args, pcm ? input : undefined).stderr.toString();
  const stats = output.match(/\{\s*"input_i"[\s\S]*?\}/g)?.at(-1);
  if (!stats) throw new Error('无法读取响度测量结果');
  return JSON.parse(stats);
}
export function probeAudio(file) {
  const result = run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]);
  return JSON.parse(result.stdout.toString());
}
export function truePeak(file) { return Number(measure(file).input_tp); }

export function verifyDecodedAudio(file, sprite) {
  const rate = sprite.sampleRate;
  const pcm = run(ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-vn', '-ar', String(rate), '-ac', '1', '-f', 's16le', 'pipe:1'], undefined, rate * 2 * 181).stdout;
  const samples = pcm.length / 2; const durationMs = samples / rate * 1000;
  if (!pcm.length || pcm.length % 2 || Math.abs(durationMs - sprite.durationMs) > 50) throw new Error('解码时长与精灵清单不一致');
  for (const [name, [offset, duration]] of Object.entries(sprite.sprite)) {
    const start = Math.round(offset / 1000 * rate); const end = start + Math.round(duration / 1000 * rate);
    if (start < 0 || end <= start || end > samples) throw new Error(`${name}: 切片超出实际解码音频`);
    let nonzero = false;
    for (let sample = start; sample < end; sample++) if (pcm.readInt16LE(sample * 2) !== 0) { nonzero = true; break; }
    if (!nonzero) throw new Error(`${name}: 解码后的切片只有静音`);
  }
  return { durationMs, sampleRate: rate, checkedClips: Object.keys(sprite.sprite).length };
}

function multiplyPcm(pcm, gain) {
  const output = Buffer.alloc(pcm.length);
  for (let offset = 0; offset < pcm.length; offset += 2) output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm.readInt16LE(offset) * gain))), offset);
  return output;
}
function normalizeClip(source, clip, gainDb) {
  const result = run(ffmpeg, ['-hide_banner', '-nostdin', '-i', 'pipe:0', '-vn', '-af', clip.kind === 'slow' ? 'atempo=0.75' : 'anull',
    '-ar', String(SAMPLE_RATE), '-ac', '1', '-f', 's16le', 'pipe:1'], source);
  let pcm = result.stdout;
  if (!pcm.length || pcm.length % 2 || pcm.length > SAMPLE_RATE * 2 * 30) throw new Error(`${clip.ref}: 片段必须为 0~30 秒有效声音`);
  let peak = 0;
  for (let offset = 0; offset < pcm.length; offset += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(offset)) / 32768);
  if (peak === 0) throw new Error(`${clip.ref}: 不能使用静音占位片段`);
  const stats = measure(pcm, true);
  let normalization;
  const finite = ['input_i', 'input_tp', 'input_lra', 'input_thresh'].every((key) => Number.isFinite(Number(stats[key])));
  if (clip.kind !== 'phoneme' && finite) {
    const filter = `loudnorm=I=-16:TP=-1:LRA=11:measured_I=${Number(stats.input_i)}:measured_TP=${Number(stats.input_tp)}:measured_LRA=${Number(stats.input_lra)}:measured_thresh=${Number(stats.input_thresh)}:linear=true`;
    pcm = run(ffmpeg, ['-hide_banner', '-nostdin', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0',
      '-af', filter, '-ar', String(SAMPLE_RATE), '-ac', '1', '-f', 's16le', 'pipe:1'], pcm).stdout;
    normalization = { method: 'loudnorm-two-pass', targetLufs: -16, inputLufs: Number(stats.input_i), calibrationRequired: false };
  } else {
    if (gainDb !== undefined && (!Number.isFinite(gainDb) || gainDb < -24 || gainDb > 12)) throw new Error(`${clip.ref}: 校准增益须在 -24~12 dB 内`);
    const scale = Math.min(10 ** ((gainDb ?? 0) / 20), 0.78 / peak);
    pcm = multiplyPcm(pcm, scale);
    normalization = { method: 'reference-gain', gainDb: 20 * Math.log10(scale), calibrationRequired: true };
  }
  return { pcm, normalization, sourceSha256: sha256(source), normalizedSha256: sha256(pcm) };
}

async function produceLockedSprites(clips, { sourceDirectory, outputDirectory, gains = {}, retainExisting = false }) {
  const output = within(process.cwd(), outputDirectory);
  const byRef = new Map(clips.map((clip) => [clip.ref, clip]));
  if (!clips.length || byRef.size !== clips.length || clips.some((clip) => !/^[a-z_]+#[a-z0-9_]+$/.test(clip.ref))) throw new Error('音频清单为空、引用重复或格式错误');
  const replaced = new Set(clips.map((clip) => clip.ref.split('#')[0]));
  let retained = { sprites: {}, clips: [] };
  if (retainExisting) {
    let previous;
    try { previous = audioBuildSchema.parse(JSON.parse(await readFile(within(output, 'index.json'), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) {
      retained = { sprites: Object.fromEntries(Object.entries(previous.sprites).filter(([id]) => !replaced.has(id))),
        clips: previous.clips.filter((clip) => !replaced.has(clip.ref.split('#')[0])) };
      const reports = new Set(retained.clips.map((clip) => clip.ref));
      if (reports.size !== retained.clips.length) throw new Error('原音频索引有重复片段');
      for (const [id, artifact] of Object.entries(retained.sprites)) {
        if (sha256(await readFile(within(output, artifact.file))) !== artifact.sha256) throw new Error(`${id}: 保留精灵的文件哈希不符`);
        await verifyPcm(output, artifact.pcm, id);
        if (Object.keys(artifact.sprite.sprite).some((clip) => !reports.has(`${id}#${clip}`))) throw new Error(`${id}: 原音频缺少生产记录`);
      }
      for (const clip of retained.clips) await verifyPcm(output, clip.pcm, clip.ref, clip.normalizedSha256);
      if (retained.clips.some((clip) => !retained.sprites[clip.ref.split('#')[0]]?.sprite.sprite[clip.ref.split('#')[1]])) throw new Error('原生产记录引用了不存在的切片');
    }
  }
  const sourceBytes = new Map();
  // Resolve all inputs before writing an index. No partial index can become current.
  for (const clip of clips) {
    const input = clip.input || byRef.get(clip.derivedFrom)?.input;
    if (!input) throw new Error(`${clip.ref}: 缺少源文件配置`);
    if (!sourceBytes.has(input)) {
      const bytes = await readFile(within(resolve(sourceDirectory), input));
      if (bytes.length > 32 * 1024 * 1024) throw new Error(`${input}: 源片段过大`);
      sourceBytes.set(input, bytes);
    }
  }
  const groups = new Map();
  const report = [];
  await mkdir(within(output, 'pcm'), { recursive: true });
  for (const clip of clips) {
    if (!/^[a-z_]+#[a-z0-9_]+$/.test(clip.ref)) throw new Error('音频引用格式错误');
    const [spriteId, clipId] = clip.ref.split('#');
    const input = clip.input || byRef.get(clip.derivedFrom).input;
    const normalized = normalizeClip(sourceBytes.get(input), clip, gains[clip.ref]);
    const pcm = await savePcm(output, `${spriteId}.${clipId}`, normalized.pcm);
    if (!groups.has(spriteId)) groups.set(spriteId, []);
    groups.get(spriteId).push({ clipId, ...normalized });
    report.push({ ref: clip.ref, source: input, promptSha256: clipPromptFingerprint(clip), ...normalized.normalization, sourceSha256: normalized.sourceSha256, normalizedSha256: normalized.normalizedSha256, pcm });
  }
  const index = {};
  for (const [id, parts] of groups) {
    let samples = 0; const sprite = {}; const buffers = [];
    const padSamples = Math.round(SAMPLE_RATE * 0.15);
    for (const part of parts) {
      buffers.push(Buffer.alloc(padSamples * 2)); samples += padSamples;
      sprite[part.clipId] = [samples / SAMPLE_RATE * 1000, part.pcm.length / 2 / SAMPLE_RATE * 1000];
      buffers.push(part.pcm); samples += part.pcm.length / 2;
      buffers.push(Buffer.alloc(padSamples * 2)); samples += padSamples;
    }
    const durationMs = samples / SAMPLE_RATE * 1000;
    if (durationMs > 180_000) throw new Error(`${id}: 精灵超过 180 秒，需拆包`);
    const pcm = Buffer.concat(buffers);
    const intermediate = await savePcm(output, id, pcm);
    const temporary = within(output, `.${id}.${randomUUID()}.mp3`);
    let postGainDb = 0; let peak = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 3; attempt++) {
      run(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0',
        '-af', `volume=${postGainDb}dB`, '-c:a', 'libmp3lame', '-b:a', '64k', '-write_xing', '1', '-map_metadata', '-1', temporary], pcm);
      peak = truePeak(temporary);
      if (!Number.isFinite(peak)) throw new Error(`${id}: 编码后真峰值不可测量`);
      if (peak <= -1) break;
      postGainDb -= peak + 1.15;
    }
    if (peak > -1) throw new Error(`${id}: 编码后真峰值超过 -1 dBTP`);
    const bytes = await readFile(temporary);
    if (bytes.length > 4 * 1024 * 1024) throw new Error(`${id}: 精灵超过 4 MiB`);
    const fileHash = sha256(bytes); const file = `${id}.${fileHash.slice(0, 16)}.mp3`;
    const finalFile = within(output, file);
    await writeFile(finalFile, bytes);
    const probe = probeAudio(finalFile);
    const stream = probe.streams?.find((item) => item.codec_type === 'audio');
    if (!stream || stream.channels !== 1 || Number(stream.sample_rate) !== SAMPLE_RATE || Number(probe.format?.duration) * 1000 + 50 < durationMs) throw new Error(`${id}: 编码规格或时间范围不匹配`);
    const manifest = { audioAssetId: `audio:${id}`, durationMs, sampleRate: SAMPLE_RATE, channels: 1, sprite };
    const decoded = verifyDecodedAudio(finalFile, manifest);
    await unlink(temporary);
    index[id] = { file, sha256: fileHash, truePeakDb: peak, postGainDb, pcm: intermediate, decoded, sprite: manifest };
  }
  const pending = { schemaVersion: 1, sprites: { ...retained.sprites, ...index }, clips: [...retained.clips, ...report], reviewStatus: 'pending' };
  const temporaryIndex = within(output, `.index.${randomUUID()}.json`);
  await writeFile(temporaryIndex, JSON.stringify(pending, null, 2) + '\n');
  await rename(temporaryIndex, within(output, 'index.json'));
  return pending;
}

export async function produceSprites(clips, options) {
  const output = within(process.cwd(), options.outputDirectory);
  await mkdir(output, { recursive: true });
  const lockPath = within(output, '.index.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`音频目录已有打包任务：${output}。请等待任务结束后重试。`); throw error; }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await produceLockedSprites(clips, options);
  } finally { await lock.close(); await unlink(lockPath); }
}

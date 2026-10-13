import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import ffprobe from '@ffprobe-installer/ffprobe';

const lessons = JSON.parse(readFileSync('data/dianfan_1a_lessons.json', 'utf8'));
const audioDir = resolve('public/content/dianfan/1a');

if (!existsSync(audioDir)) {
  mkdirSync(audioDir, { recursive: true });
}

console.log(`开始处理典范英语 1A（共 ${lessons.length} 课音频与时间轴对齐）...`);

function getAudioDuration(file) {
  try {
    const out = JSON.parse(execSync(`"${ffprobe.path}" -v error -show_entries format=duration -of json "${file}"`).toString());
    return parseFloat(out.format.duration);
  } catch {
    return 60;
  }
}

// 检测原版音频（带跟读停顿）中的语句与停顿切片
function analyzeOriginalAudio(file, expectedSentenceCount) {
  const dur = getAudioDuration(file);
  const out = execSync(`"${ffmpeg.path}" -i "${file}" -af silencedetect=noise=-28dB:d=0.25 -f null - 2>&1`).toString();
  const starts = [];
  const ends = [];
  for (const line of out.split('\n')) {
    const s = line.match(/silence_start: ([\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) starts.push(parseFloat(s[1]));
    if (e) ends.push(parseFloat(e[1]));
  }

  const chunks = [];
  for (let i = 0; i < ends.length; i++) {
    const start = ends[i];
    const end = starts[i + 1] ?? dur;
    if (end - start > 0.15) {
      chunks.push({ start: +(start.toFixed(2)), end: +(end.toFixed(2)) });
    }
  }

  // 聚类：把句内短促停顿（< 1.8秒）合并为一个句段
  const groups = [];
  if (chunks.length > 0) {
    let cur = { start: chunks[0].start, end: chunks[0].end };
    for (let i = 1; i < chunks.length; i++) {
      const gap = chunks[i].start - cur.end;
      if (gap > 1.8) {
        groups.push(cur);
        cur = { start: chunks[i].start, end: chunks[i].end };
      } else {
        cur.end = chunks[i].end;
      }
    }
    groups.push(cur);
  }

  // 如果第 0 个组是 "Good English Lesson N"（通常持续 < 2.5s 且在 0~3s 之间），保留为片头
  let intro = null;
  let sentenceGroups = groups;
  if (groups.length > 1 && groups[0].start < 2.5 && groups[0].end < 3.5) {
    intro = groups[0];
    sentenceGroups = groups.slice(1);
  }

  return { totalDuration: +(dur.toFixed(2)), intro, sentenceGroups };
}

const timingsMap = {};

for (let i = 1; i <= lessons.length; i++) {
  const pad = String(i).padStart(2, '0');
  const src = resolve(audioDir, `${pad}.mp3`);
  const fluentDst = resolve(audioDir, `${pad}_fluent.mp3`);
  const lesson = lessons[i - 1];

  if (!existsSync(src)) {
    console.warn(`[跳过] 找不到原声: ${src}`);
    continue;
  }

  // 1. 生成去除多余长停顿的流畅连贯版 MP3（保留自然句间呼吸停顿 0.4s）
  if (!existsSync(fluentDst)) {
    try {
      execSync(`"${ffmpeg.path}" -y -i "${src}" -af "silenceremove=stop_periods=-1:stop_duration=1.2:stop_threshold=-28dB" -c:a libmp3lame -q:a 2 "${fluentDst}" 2>&1`);
    } catch (e) {
      console.warn(`[生成连贯音频失败] ${pad}:`, e.message);
    }
  }

  const fluentDuration = getAudioDuration(fluentDst);
  const analysis = analyzeOriginalAudio(src, lesson.sentences.length);

  // 2. 为每句话计算在原声音频和连贯音频中的合理起止时间
  const sentenceTimings = [];
  const rawGroups = analysis.sentenceGroups;

  for (let sIdx = 0; sIdx < lesson.sentences.length; sIdx++) {
    const text = lesson.sentences[sIdx];
    let start = 0;
    let end = 0;
    let pauseAfter = 3.5;

    if (sIdx < rawGroups.length) {
      start = rawGroups[sIdx].start;
      end = rawGroups[sIdx].end;
      const nextStart = rawGroups[sIdx + 1]?.start ?? analysis.totalDuration;
      pauseAfter = +(Math.max(0, nextStart - end).toFixed(2));
    } else if (rawGroups.length > 0) {
      // 若句子数多于聚类组，平滑估算
      const last = rawGroups[rawGroups.length - 1];
      start = last.end;
      end = analysis.totalDuration;
    }

    sentenceTimings.push({
      index: sIdx,
      text,
      start,
      end,
      pauseAfter, // 跟读留白秒数
    });
  }

  timingsMap[lesson.id] = {
    lessonId: lesson.id,
    title: lesson.title,
    repeatAudioUrl: `content/dianfan/1a/${pad}.mp3`,
    repeatDuration: analysis.totalDuration,
    fluentAudioUrl: `content/dianfan/1a/${pad}_fluent.mp3`,
    fluentDuration: +(fluentDuration.toFixed(2)),
    sentences: sentenceTimings,
  };

  if (i % 10 === 0 || i === lessons.length) {
    console.log(`[完成] 第 ${i}/${lessons.length} 课: ${lesson.title}`);
  }
}

const outJsonPath = resolve('data/dianfan_1a_audio.json');
writeFileSync(outJsonPath, JSON.stringify(timingsMap, null, 2) + '\n', 'utf8');

// 同时写入轻量 TypeScript 模块以便类型化引用
const tsContent = `// Auto-generated Dianfan English 1A Audio Timings & Metadata
export interface DianfanSentenceTiming {
  index: number;
  text: string;
  start: number;
  end: number;
  pauseAfter: number;
}

export interface DianfanLessonAudio {
  lessonId: string;
  title: string;
  repeatAudioUrl: string;
  repeatDuration: number;
  fluentAudioUrl: string;
  fluentDuration: number;
  sentences: DianfanSentenceTiming[];
}

export const DIANFAN_AUDIO_MAP: Record<string, DianfanLessonAudio> = ${JSON.stringify(timingsMap, null, 2)};
`;

const outTsPath = resolve('src/data/dianfan-audio.ts');
writeFileSync(outTsPath, tsContent, 'utf8');

console.log(`\n✓ 全部 42 课官方原声音频与时间轴对齐处理完成！`);
console.log(`  - JSON 数据: ${outJsonPath}`);
console.log(`  - TypeScript 模块: ${outTsPath}`);

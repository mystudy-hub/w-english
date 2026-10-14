import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

const lessons = JSON.parse(readFileSync('data/dianfan_1a_lessons.json', 'utf8'));
const audioDir = resolve('public/content/dianfan/1a');

function getSpeechChunks(file) {
  const out = execSync(`"${ffmpeg.path}" -i "${file}" -af silencedetect=noise=-28dB:d=0.25 -f null - 2>&1`).toString();
  const starts = [];
  const ends = [];
  for (const line of out.split('\n')) {
    const s = line.match(/silence_start: ([\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) starts.push(parseFloat(s[1]));
    if (e) ends.push(parseFloat(e[1]));
  }
  const durLine = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const dur = durLine ? +durLine[1] * 3600 + +durLine[2] * 60 + parseFloat(durLine[3]) : 60;

  const raw = [];
  for (let i = 0; i < ends.length; i++) {
    const start = ends[i];
    const end = starts[i + 1] ?? dur;
    if (end - start > 0.15) raw.push({ start: +(start.toFixed(2)), end: +(end.toFixed(2)) });
  }

  // 合并句内微小气口停顿（< 0.9s）
  const chunks = [];
  if (raw.length > 0) {
    let cur = { start: raw[0].start, end: raw[0].end };
    for (let i = 1; i < raw.length; i++) {
      if (raw[i].start - cur.end < 0.9) {
        cur.end = raw[i].end;
      } else {
        chunks.push(cur);
        cur = { start: raw[i].start, end: raw[i].end };
      }
    }
    chunks.push(cur);
  }

  return { dur: +(dur.toFixed(2)), chunks };
}

const audioMap = {};

for (let idx = 1; idx <= lessons.length; idx++) {
  const pad = String(idx).padStart(2, '0');
  const file = resolve(audioDir, `${pad}.mp3`);
  const l = lessons[idx - 1];

  if (!existsSync(file)) {
    console.warn(`[跳过] 缺少 ${file}`);
    continue;
  }

  const { dur, chunks: rawChunks } = getSpeechChunks(file);
  let chunks = [...rawChunks];

  // 1. 如果第一个片段在 0~3.5 秒之间且持续 < 2.5 秒，是 "Good English Lesson N" 的片头报幕，滤掉
  if (chunks.length > l.sentences.length && chunks[0].start < 3.2 && chunks[0].end < 3.8) {
    chunks = chunks.slice(1);
  }

  // 2. 将切片智能平滑对齐到课文句子
  const sentenceTimings = [];
  const totalSentences = l.sentences.length;

  if (chunks.length === totalSentences) {
    // 完美的 1-对-1 对应！
    for (let sIdx = 0; sIdx < totalSentences; sIdx++) {
      const c = chunks[sIdx];
      const nextStart = chunks[sIdx + 1]?.start ?? dur;
      sentenceTimings.push({
        index: sIdx,
        text: l.sentences[sIdx],
        start: c.start,
        end: c.end,
        pauseAfter: +(Math.max(0, nextStart - c.end).toFixed(2)),
      });
    }
  } else if (chunks.length < totalSentences) {
    // 切片少于句子（通常是有两三个短句在一个气口内读完）：按句子字数比例分配时间
    const wordsPerSentence = l.sentences.map((s) => s.split(/\s+/).length);
    const totalWords = wordsPerSentence.reduce((a, b) => a + b, 0);

    const firstStart = chunks[0]?.start ?? 2.5;
    const lastEnd = chunks[chunks.length - 1]?.end ?? dur - 1.5;
    const speechSpan = lastEnd - firstStart;

    let accumTime = firstStart;
    for (let sIdx = 0; sIdx < totalSentences; sIdx++) {
      const sentDuration = Math.max(1.5, +((wordsPerSentence[sIdx] / totalWords) * speechSpan).toFixed(2));
      const start = +(accumTime.toFixed(2));
      const end = +(Math.min(dur, start + sentDuration).toFixed(2));
      const nextStart = +(Math.min(dur, end + 3.5).toFixed(2));

      sentenceTimings.push({
        index: sIdx,
        text: l.sentences[sIdx],
        start,
        end,
        pauseAfter: 3.5,
      });
      accumTime = nextStart;
    }
  } else {
    // 切片多于句子（句中有稍长的破折号或逗号停顿）：智能聚合最接近的片段
    const merged = [...chunks];
    while (merged.length > totalSentences) {
      // 找出当前间隔最短的相邻切片进行合并
      let minGap = Infinity;
      let minGapIdx = 0;
      for (let k = 0; k < merged.length - 1; k++) {
        const gap = merged[k + 1].start - merged[k].end;
        if (gap < minGap) {
          minGap = gap;
          minGapIdx = k;
        }
      }
      merged[minGapIdx].end = merged[minGapIdx + 1].end;
      merged.splice(minGapIdx + 1, 1);
    }

    for (let sIdx = 0; sIdx < totalSentences; sIdx++) {
      const c = merged[sIdx];
      const nextStart = merged[sIdx + 1]?.start ?? dur;
      sentenceTimings.push({
        index: sIdx,
        text: l.sentences[sIdx],
        start: c.start,
        end: c.end,
        pauseAfter: +(Math.max(0, nextStart - c.end).toFixed(2)),
      });
    }
  }

  audioMap[l.id] = {
    lessonId: l.id,
    title: l.title,
    audioUrl: `content/dianfan/1a/${pad}.mp3`,
    duration: dur,
    sentences: sentenceTimings,
  };
}

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
  audioUrl: string;
  duration: number;
  sentences: DianfanSentenceTiming[];
}

export const DIANFAN_AUDIO_MAP: Record<string, DianfanLessonAudio> = ${JSON.stringify(audioMap, null, 2)};
`;

writeFileSync('src/data/dianfan-audio.ts', tsContent, 'utf8');
console.log(`✓ 42 课原声音频切片与时间对齐全部完成！已写入 src/data/dianfan-audio.ts`);

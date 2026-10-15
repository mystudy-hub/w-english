import { CORE_GUIDE_CUES, CORE_GUIDE_SPRITE, GUIDE_CUES, guideCues } from '../../src/domain/guide-content.ts';
import { sha256 } from './files.mjs';
export { GUIDE_CUES };
export function clipPromptFingerprint(clip) {
  return sha256(Buffer.from(JSON.stringify({ ref: clip.ref, kind: clip.kind, locale: clip.locale ?? null,
    text: clip.text ?? null, ipa: clip.ipa ?? null, phonemes: clip.phonemes ?? null, tempo: clip.tempo ?? null })));
}
export function audioInventory(words, stage = 1) {
  const clips = new Map();
  for (const word of words) {
    // 课本词条的输入文件按单元分目录，避免与探索词或其他单元同拼写冲突；
    // Windows 文件名不能包含 ? 等标点，拼写统一清洗为安全字符。
    const scoped = word.track === 'textbook';
    const prefix = scoped ? `textbook/${word.audio.word.split('#')[0]}/` : '';
    const name = scoped ? word.word.replace(/[^A-Za-z0-9]+/g, '_') : word.word;
    clips.set(word.audio.word, { ref: word.audio.word, kind: 'word', text: word.word, ipa: word.ipa, locale: 'en-US', input: `${prefix}words/${name}.wav`, review: 'pending' });
    clips.set(word.audio.wordSlow, { ref: word.audio.wordSlow, kind: 'slow', text: word.word, ipa: word.ipa, locale: 'en-US', derivedFrom: word.audio.word, tempo: 0.75, review: 'pending' });
    clips.set(word.example.audio, { ref: word.example.audio, kind: 'sentence', text: word.example.en, locale: 'en-US', input: `${prefix}sentences/${name}.wav`, review: 'pending' });
    for (const part of word.track === 'phonics' || word.track === 'textbook' ? word.graphemes : []) if (part.audio) {
      const clip = part.audio.split('#')[1];
      const existing = clips.get(part.audio);
      if (existing && JSON.stringify(existing.phonemes) !== JSON.stringify(part.phonemes)) throw new Error(`音素引用冲突: ${part.audio}`);
      clips.set(part.audio, { ref: part.audio, kind: 'phoneme', phonemes: part.phonemes, locale: 'en-US', input: `phonics/${clip}.wav`, review: 'pending' });
    }
  }
  for (const [name, text] of Object.entries(guideCues(stage))) clips.set(`guide#${name}`, { ref: `guide#${name}`, kind: 'guide', text, locale: 'zh-CN', input: `guide/${name}.wav`, review: 'pending' });
  for (const [name, text] of Object.entries(CORE_GUIDE_CUES)) clips.set(`${CORE_GUIDE_SPRITE}#${name}`, { ref: `${CORE_GUIDE_SPRITE}#${name}`, kind: 'guide', text, locale: 'zh-CN', input: `guide/${name}.wav`, review: 'pending' });
  return [...clips.values()];
}

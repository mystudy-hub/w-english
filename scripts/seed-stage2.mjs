import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';
import { audioReferences, validateCatalog, wordSchema } from '../src/data/content-schema.ts';
import { readJson, sha256, within } from './lib/files.mjs';
import { STAGE2_DRAFTS } from './lib/stage2-drafts.mjs';

// One-time authoring tool. Identical output may be reused; edited files are never overwritten.
const version = '2026.09.3';
const clips = { p: 'p', b: 'b', t: 't', d: 'd', k: 'k', g: 'g', f: 'f', v: 'v', 'θ': 'th', 'ð': 'th_voiced', s: 's', z: 'z', 'ʃ': 'sh', 'ʒ': 'zh', h: 'h', m: 'm', n: 'n', 'ŋ': 'ng', l: 'l', r: 'r', w: 'w', j: 'y', 'tʃ': 'ch', 'dʒ': 'j', 'æ': 'a_short', 'ɛ': 'e_short', 'ɪ': 'i_short', 'ɑ': 'o_short', 'ʌ': 'u_short', 'ʊ': 'oo_short', 'ə': 'schwa', 'ɚ': 'er_unstressed', 'ɝ': 'er', 'iː': 'ee', 'uː': 'oo_long', 'ɔː': 'aw', i: 'i_unstressed', 'eɪ': 'a_long', 'aɪ': 'i_long', 'oʊ': 'o_long', 'aʊ': 'ow', 'ɔɪ': 'oi', 'ɑ+r': 'ar', 'ɔː+r': 'or', 'ɛ+r': 'air', 'ɪ+r': 'ear', 'ə+l': 'el', 'k+s': 'ks', 'w+ʌ': 'one_onset' };
const base = await readJson('data/stage1_words.json');
const sampleIds = new Map((await readJson('data/sample_words.json')).map((word) => [word.word, word.wordId]));
const words = base.map((word) => ({ ...word, contentVersion: version, review: { status: 'draft' } }));
const illustrationKinds = new Map(); const roomWords = new Map([['animal_home', words.map((word) => word.wordId)]]);
const errors = []; let ordinal = 24;
for (const [room, rows] of Object.entries(STAGE2_DRAFTS)) {
  const ids = roomWords.get(room) ?? []; let index = 0;
  for (const row of rows.trim().split('\n')) {
    const [word, stage, ipa, syllables, spelling, category, illustration, zh, young, older, example, exampleZh] = row.split('|').map((value) => value.trim());
    const wordId = sampleIds.get(word) ?? `w_${word}_${String(ordinal).padStart(3, '0')}`; ordinal += 1;
    const namespace = room === 'animal_home' ? 'animal_home_extra' : `${room}_${index < 17 ? 'a' : 'b'}`; index += 1;
    const graphemes = spelling.split(' ').map((part) => {
      const [letters, sounds] = part.split(':'); const phonemes = sounds === '_' ? [] : sounds.split('+');
      if (phonemes.length && !clips[sounds]) throw new Error(`${word}: 未定义音素素材 ${sounds}`);
      const note = !phonemes.length ? '这个字母在本词中不发音' : /^([bcdfghjklmnpqrstvwxyz])\1$/.test(letters) ? '双写辅音合并，只发一次音'
        : letters === 'le' ? 'consonant-le 整体教学，不拆成 l + e' : letters.length > 1 ? '按此字母组合的实际声音整体教学' : undefined;
      return { letters, phonemes, audio: phonemes.length ? `phonics#${clips[sounds]}` : null, ...(note ? { note } : {}) };
    });
    const sight = stage.startsWith('s:');
    const entry = { schemaVersion: 3, wordId, word, theme: category, track: sight ? 'sight' : 'phonics',
      ...(sight ? { sightWordList: stage.slice(2) } : { phonicsStage: Number(stage) }),
      spelling: [...word], graphemes, phonemes: graphemes.flatMap((part) => part.phonemes), syllables: syllables.split('-'), ipa: `/${ipa}/`,
      definition: { en_young: young, en_older: older, zh }, example: { en: example, zh: exampleZh, audio: `${namespace}#${word}_sentence` },
      audio: { word: `${namespace}#${word}`, wordSlow: `${namespace}#${word}_slow` }, illustration: { type: 'image', src: `/images/words/${word}.svg`, alt: zh }, sfx: null,
      parentTip: { en: sight ? `Listen to ${word} as one whole word, then read the sentence together.` : `Look at the picture and say ${word}. Listen to each letter group together.`,
        zh: sight ? `把 ${word} 作为整词听读，再一起读例句，指出句子里高亮的 ${word}；不要求按字母拼音。`
          : `指着图片认识「${zh}」，先听完整的 ${word}，再按字母组合听声音。${graphemes.some((part) => part.letters === 'le') ? 'le 保持为一个声音组合。' : graphemes.some((part) => part.audio === null) ? '灰色的不发音字母只看形状，不单独配音。' : ''}` },
      review: { status: 'draft' }, contentVersion: version };
    const parsed = wordSchema.safeParse(entry);
    if (!parsed.success) { errors.push(`${word}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`); continue; }
    words.push(parsed.data); ids.push(wordId); illustrationKinds.set(word, illustration);
  }
  roomWords.set(room, ids);
}
if (errors.length) throw new Error(errors.join('\n'));
if (words.length !== 100 || new Set(words.map((word) => word.word)).size !== 100) throw new Error(`需要 100 个不同词，实际 ${words.length}`);

const byWord = new Map(words.map((word) => [word.word, word.wordId]));
const exclusions = { animal_home: [['hat', 'cap'], ['cup', 'pot'], ['pan', 'pot'], ['box', 'gift'], ['house', 'door']],
  sunny_garden: [['rain', 'cloud'], ['seed', 'bean'], ['seed', 'nut']], happy_school: [['car', 'truck'], ['bus', 'truck']] };
const titles = { animal_home: ['动物之家', 'Animal Home'], sunny_garden: ['阳光花园', 'Sunny Garden'], happy_school: ['快乐学校', 'Happy School'] };
const rooms = [...roomWords.keys()];
const themes = rooms.map((themeId, index) => {
  const wordIds = roomWords.get(themeId); const entries = words.filter((word) => wordIds.includes(word.wordId));
  return { schemaVersion: 1, contentVersion: version, themeId, title: { zh: titles[themeId][0], en: titles[themeId][1] }, wordIds,
    pages: Array.from({ length: Math.ceil(wordIds.length / 5) }, (_, page) => wordIds.slice(page * 5, page * 5 + 5)),
    listenTapWordIds: entries.filter((word) => word.track === 'phonics').map((word) => word.wordId),
    confusablePairs: exclusions[themeId].map((pair) => pair.map((word) => byWord.get(word))),
    spriteIds: [...new Set([...entries.flatMap(audioReferences).map((ref) => ref.split('#')[0]), 'phonics', 'guide', 'sfx'])],
    unlock: { prerequisiteThemeId: index === 0 ? null : rooms[index - 1], requiredFirstCorrect: index === 0 ? 0 : 5 } };
});
validateCatalog(words, themes);

const ownLicense = await readFile('LICENSE', 'utf8');
const lucideLicense = await readFile('node_modules/lucide-react/LICENSE', 'utf8');
const fontLicense = await readFile('node_modules/@fontsource/nunito/LICENSE', 'utf8');
const font = (await readFile('node_modules/@fontsource/nunito/files/nunito-latin-800-normal.woff2')).toString('base64');
const palettes = { animals: ['#edf4de', '#537d62'], food: ['#fff1d8', '#ad794e'], nature: ['#eaf3e1', '#537c58'], colors: ['#f6f1df', '#647d68'], school: ['#eaf0f5', '#597b93'], family: ['#f6e9db', '#987351'], body: ['#fae9dc', '#a66f58'] };
const custom = {
  bread: '<path d="M85 121c-35-49 114-79 150-18 20 21 10 49-14 51v102H95V154c-15-4-18-20-10-33Z" fill="#edc180" stroke="#a87a48" stroke-width="10"/><path d="M124 123q15-32 35-18m8 18q16-32 35-18" fill="none" stroke="#c18c52" stroke-width="10" stroke-linecap="round"/>',
  corn: '<path d="M157 56c-55 0-57 158 0 206 59-49 60-206 0-206Z" fill="#efd077" stroke="#b69c4e" stroke-width="8"/><path d="M135 81v150m24-161v177m24-166v150m-61-118h72m-76 28h80m-74 28h68m-60 28h52" stroke="#ccad4f" stroke-width="5"/><path d="M160 267C80 262 61 173 77 135c58 36 69 82 83 132Zm0 0c73-10 99-100 83-139-61 32-67 82-83 139Z" fill="#7ea770" stroke="#5c8756" stroke-width="7"/>',
  grass: '<path d="M76 259c10-38 5-70-7-110 39 15 54 50 52 94-3-60 15-111 33-148 19 55 23 103 11 151 21-73 42-110 79-134-2 55-15 95-33 131 23-43 43-60 70-71-11 43-27 69-45 87Z" fill="#78a775" stroke="#537e59" stroke-width="7" stroke-linejoin="round"/>',
  pond: '<ellipse cx="158" cy="206" rx="114" ry="68" fill="#9cbcad"/><ellipse cx="158" cy="204" rx="102" ry="55" fill="#a5d4df" stroke="#6aa5b6" stroke-width="7"/><path d="M111 188q29-11 57 0m-30 37q27-10 53 0M69 183V93m17 82V82m-28 85-17-37" fill="none" stroke="#6d9c75" stroke-width="7" stroke-linecap="round"/><path d="M69 106V72m17 26V61" stroke="#a78b55" stroke-width="12" stroke-linecap="round"/>',
  rock: '<path d="m54 232 27-104 79-51 88 49 27 104-82 36-94-9Z" fill="#b0b8b3" stroke="#748980" stroke-width="9" stroke-linejoin="round"/><path d="m81 128 84 28 83-30m-83 30 28 110m-28-110-66 101" fill="none" stroke="#91a09a" stroke-width="7"/>',
  seed: '<path d="M82 203c-13-61 47-108 151-117 9 93-16 152-83 158-34 3-62-13-68-41Z" fill="#bc926d" stroke="#856d54" stroke-width="9"/><path d="M110 217q54-19 94-92" fill="none" stroke="#dac09a" stroke-width="10" stroke-linecap="round"/>',
  desk: '<path d="M53 126h211v41H53Zm16 41v89m178-89v89" fill="#cfb082" stroke="#8c785e" stroke-width="10" stroke-linejoin="round"/><path d="M187 173h44v37h-44Z" fill="#ead4ad" stroke="#8c785e" stroke-width="7"/><circle cx="209" cy="191" r="4" fill="#8c785e"/>',
  foot: '<path d="M137 248c-18-35 14-65 10-91-7-50-4-80 30-83 28-2 56 30 55 69-1 29-24 57-30 82-8 36-48 46-65 23Z" fill="#e5b990" stroke="#b58a6d" stroke-width="8"/><ellipse cx="155" cy="65" rx="20" ry="28" fill="#e5b990"/><ellipse cx="194" cy="65" rx="14" ry="20" fill="#e5b990"/><ellipse cx="220" cy="83" rx="12" ry="17" fill="#e5b990"/><ellipse cx="237" cy="107" rx="10" ry="14" fill="#e5b990"/><ellipse cx="246" cy="132" rx="8" ry="12" fill="#e5b990"/>',
  ball: '<circle cx="160" cy="166" r="94" fill="#edb270" stroke="#a97848" stroke-width="8"/><path d="M69 153q95 44 179 15M140 74q47 89-2 181M82 112q94 34 143 119" fill="none" stroke="#b88651" stroke-width="8"/>',
  doll: '<path d="m120 190-30 52m110-52 30 52m-92 9-13 43m57-43 13 43" stroke="#bd9578" stroke-width="19" stroke-linecap="round"/><path d="m127 159-14 88h93l-13-88" fill="#9fbac1" stroke="#7596a0" stroke-width="7"/><circle cx="160" cy="110" r="58" fill="#e9bf98" stroke="#b48a68" stroke-width="7"/><path d="M105 100c-15-82 121-82 111 5-24-6-44-24-53-41-17 18-37 31-58 36Z" fill="#936c51"/><circle cx="141" cy="116" r="5" fill="#645345"/><circle cx="178" cy="116" r="5" fill="#645345"/><path d="M146 139q14 13 27 0" fill="none" stroke="#a17660" stroke-width="5" stroke-linecap="round"/>',
  kite: '<path d="m157 43 82 94-79 87-86-91Z" fill="#e8bf78" stroke="#b59461" stroke-width="7"/><path d="m157 43 3 181m-86-91 165 4" stroke="#a8a080" stroke-width="5"/><path d="M159 225q-38 30 6 45t-8 31" fill="none" stroke="#99ac8b" stroke-width="6"/><path d="m144 257-22-9v22l22-13 21 13v-22Z" fill="#91b4bc"/>',
  ring: '<circle cx="159" cy="193" r="70" fill="none" stroke="#cfb06a" stroke-width="24"/><path d="m126 73 66 0 19 27-52 49-52-49Z" fill="#a2c7d3" stroke="#6e9eac" stroke-width="7" stroke-linejoin="round"/><path d="m126 73 12 28 21 48 23-48 10-28m-85 27h104" fill="none" stroke="#79a8b7" stroke-width="4"/>',
  glue: '<path d="M120 126h78l20 40v98H98v-98Z" fill="#e7eadb" stroke="#9cab91" stroke-width="8"/><path d="M132 125V91h53v34m-48-35 9-39h23l10 39" fill="#e9bc77" stroke="#b6935f" stroke-width="7" stroke-linejoin="round"/><rect x="110" y="180" width="96" height="53" rx="9" fill="#a1bec5"/><path d="M159 189c-6 10-17 17-17 25a17 17 0 0 0 34 0c0-8-12-15-17-25Z" fill="#f9fcf4"/>',
};
function svgFor(word, kind) {
  const [background, stroke] = palettes[word.theme]; let drawing; let licenses = ownLicense;
  if (kind === 'custom:sight') {
    drawing = `<style>@font-face{font-family:Nunito;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:800}text{font-family:Nunito,sans-serif}</style><rect x="54" y="83" width="212" height="147" rx="28" fill="#fffdf4" stroke="${stroke}" stroke-width="7"/><text x="160" y="174" text-anchor="middle" dominant-baseline="middle" font-size="${word.word.length > 3 ? 58 : 72}" font-weight="800" fill="${stroke}">${word.word}</text>`;
    licenses += `\n\n${fontLicense}`;
  } else if (['custom:red', 'custom:green', 'custom:blue'].includes(kind)) {
    const paint = { red: '#d36558', green: '#589877', blue: '#518cb9' }[word.word];
    drawing = `<path d="M88 90c25-35 83-36 99-2 47-19 84 9 75 45 41 52-6 104-41 92-5 43-67 66-89 26-50 25-90-17-70-55-40-33-23-89 26-106Z" fill="${paint}"/><ellipse cx="113" cy="123" rx="20" ry="12" fill="#fff" opacity=".25"/>`;
  } else if (kind.startsWith('custom:')) drawing = custom[kind.slice(7)];
  else {
    if (!icons[kind]) throw new Error(`找不到图形 ${kind}`);
    drawing = renderToStaticMarkup(createElement(icons[kind], { size: 222, color: stroke, strokeWidth: 1.55 })).replace('<svg ', '<svg x="49" y="43" ');
    licenses += `\n\n${lucideLicense}`;
  }
  if (!drawing) throw new Error(`缺少插图 ${word.word}`);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" role="img" aria-label="${word.illustration.alt}"><metadata><![CDATA[${licenses.replaceAll(']]>', ']]]]><![CDATA[>')}]]></metadata><rect x="22" y="22" width="276" height="276" rx="76" fill="${background}"/><ellipse cx="160" cy="276" rx="83" ry="10" fill="${stroke}" opacity=".09"/>${drawing}</svg>\n`);
}
async function createFile(path, bytes) {
  try {
    const previous = await readFile(path);
    if (!previous.equals(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes))) throw new Error(`拒绝覆盖已编辑的文件 ${path}`);
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { flag: 'wx' });
}
const ledger = { schemaVersion: 1, assets: {} }; const generated = [];
for (const word of words) {
  const kind = illustrationKinds.get(word.word); const file = within(resolve('assets/illustrations'), `${word.word}.svg`);
  const bytes = kind ? svgFor(word, kind) : await readFile(file);
  const external = kind && !kind.startsWith('custom:'); const embeddedFont = kind === 'custom:sight';
  const evidenceFiles = ['LICENSE', ...(external ? ['assets/licenses/lucide.txt'] : []), ...(embeddedFont ? ['assets/licenses/nunito.txt'] : [])];
  ledger.assets[word.illustration.src] = { source: external ? `lucide-react@1.43.0:${kind}; layout: scripts/seed-stage2.mjs` : `assets/illustrations/${word.word}.svg`,
    creator: external ? 'Lucide and Feather contributors; W-English layout' : embeddedFont ? 'W-English contributors; Nunito font authors' : 'W-English contributors',
    license: external ? 'ISC / MIT (Lucide and Feather); MIT (layout)' : embeddedFont ? 'MIT (layout); OFL-1.1 (embedded Nunito)' : 'MIT',
    permissionEvidence: evidenceFiles.join('; '), evidenceFiles, sha256: sha256(bytes), reviewer: null, reviewedAt: null };
  if (kind) generated.push([file, bytes]);
}
const outputs = [['assets/licenses/lucide.txt', lucideLicense], ['assets/licenses/nunito.txt', fontLicense], ...generated,
  ['data/illustration-licenses.json', JSON.stringify(ledger, null, 2) + '\n'], ['data/stage2_words.json', JSON.stringify(words, null, 2) + '\n'],
  ...themes.map((theme) => [`data/stage2_${theme.themeId}.json`, JSON.stringify(theme, null, 2) + '\n'])];
// Check all existing targets before creating any output, including a partially completed prior run.
for (const [path, bytes] of outputs) {
  try { await access(path); const previous = await readFile(path); if (!previous.equals(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes))) throw new Error(`拒绝覆盖已编辑的文件 ${path}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const [path, bytes] of outputs) await createFile(path, bytes);
console.log(`已生成 ${words.length} 个待审词、${themes.length} 个场景、${generated.length} 张新增配图及许可台账；活动目录尚未切换。`);

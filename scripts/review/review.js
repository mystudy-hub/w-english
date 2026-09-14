const data = JSON.parse(document.getElementById('review-data').textContent);
const byId = new Map(data.words.map((word) => [word.entry.wordId, word]));
const byRef = new Map(data.clips.map((clip) => [clip.ref, clip]));
const key = `w-english-review:${data.datasetSha256}`;
const state = { words: { ...data.approved.words }, clips: { ...data.approved.clips }, notes: {}, rejections: {}, rights: {}, reviewer: '' };
const heard = new Set(); const decoded = new Map();
let selected = data.words[0]?.entry.wordId; let context; let gain; let currentSource; let playGeneration = 0;
const element = (tag, text, className) => {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
};
const button = (label, clicked, primary = false) => { const node = element('button', label, primary ? 'primary' : ''); node.type = 'button'; node.addEventListener('click', clicked); return node; };
const message = (text) => { document.getElementById('status').textContent = text; };
const save = () => { try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* Export remains available when local storage is restricted. */ } };
const validWord = (id, approval) => byId.has(id) && approval?.contentSha256 === byId.get(id).contentSha256 && approval?.imageSha256 === byId.get(id).imageSha256 && typeof approval.reviewer === 'string' && approval.reviewer.trim() && Number.isFinite(Date.parse(approval.reviewedAt));
const validClip = (ref, approval) => {
  const clip = byRef.get(ref);
  return clip?.available && approval?.ref === ref && approval.spriteSha256 === clip.spriteSha256 && approval.sourceSha256 === clip.sourceSha256 && approval.promptSha256 === clip.promptSha256
    && JSON.stringify(approval.clip) === JSON.stringify(clip.interval) && ['reviewer', 'creator', 'license', 'permissionEvidence'].every((key) => typeof approval[key] === 'string' && approval[key].trim())
    && Number.isFinite(Date.parse(approval.reviewedAt)) && (!clip.calibrationRequired || approval.calibrationApproved === true);
};
function restore(value) {
  for (const [id, approval] of Object.entries(value.words ?? {})) if (validWord(id, approval)) state.words[id] = approval;
  for (const [ref, approval] of Object.entries(value.clips ?? {})) if (validClip(ref, approval)) state.clips[ref] = approval;
  for (const [id, note] of Object.entries(value.notes ?? {})) if ((byId.has(id) || byRef.has(id)) && typeof note === 'string') state.notes[id] = note;
  for (const [id, rejection] of Object.entries(value.rejections ?? {})) if ((byId.has(id) || byRef.has(id)) && rejection?.reviewer && rejection?.note && Number.isFinite(Date.parse(rejection.reviewedAt))) {
    delete state.words[id]; delete state.clips[id]; state.rejections[id] = rejection;
  }
  for (const clip of data.clips) if (clip.wordIds.some((id) => !state.words[id])) delete state.clips[clip.ref];
}
try {
  const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
  if (saved) { restore(saved); if (typeof saved.reviewer === 'string') state.reviewer = saved.reviewer; }
} catch { /* A malformed local draft does not approve anything. */ }
document.getElementById('reviewer').value = state.reviewer;
document.getElementById('reviewer').addEventListener('input', (event) => { state.reviewer = event.target.value; save(); });
const identity = () => {
  const reviewer = state.reviewer.trim();
  if (!reviewer) { message('请填写实际审核人后再批准。'); document.getElementById('reviewer').focus(); return undefined; }
  return { reviewer, reviewedAt: new Date().toISOString() };
};
function stopAudio() {
  playGeneration += 1;
  if (currentSource) { const source = currentSource; currentSource = undefined; source.onended = null; source.stop(); }
}
document.getElementById('stop').addEventListener('click', () => { stopAudio(); message('试听已停止，本次未记为完整听审。'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAudio(); });
document.getElementById('volume').addEventListener('input', (event) => { if (gain) gain.gain.value = Number(event.target.value); });
async function play(clip) {
  stopAudio(); const generation = playGeneration; heard.delete(clip.ref);
  try {
    const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!context) { context = new Audio(); gain = context.createGain(); gain.connect(context.destination); }
    await context.resume(); gain.gain.value = Number(document.getElementById('volume').value);
    message(`正在试听 ${clip.ref}…`);
    if (!decoded.has(clip.spriteId)) {
      const bytes = await (await fetch(data.audio[clip.spriteId])).arrayBuffer();
      decoded.set(clip.spriteId, await context.decodeAudioData(bytes));
    }
    if (generation !== playGeneration || document.hidden) return;
    const source = context.createBufferSource(); source.buffer = decoded.get(clip.spriteId); source.connect(gain);
    const [start, length] = clip.interval;
    if (start + length > source.buffer.duration * 1000 + 1) throw new Error('Clip outside audio');
    currentSource = source;
    source.onended = () => {
      if (generation !== playGeneration || currentSource !== source) return;
      currentSource = undefined; heard.add(clip.ref); message(`已完整播放 ${clip.ref}。请核对发音、响度和切片边界。`); renderDetail();
    };
    source.start(0, start / 1000, length / 1000);
  } catch { if (generation === playGeneration) message('此片段暂时无法播放，请重新生成审核页或换用支持 Web Audio 的浏览器。'); }
}
function noteField(id, container) {
  const label = element('label', '修改意见 / 备注'); const input = element('textarea'); input.value = state.notes[id] ?? '';
  input.addEventListener('input', () => { state.notes[id] = input.value; save(); }); label.append(input); container.append(label);
}
function approveStatus(approval, container) {
  if (approval) container.append(element('p', `已批准 · ${approval.reviewer} · ${new Date(approval.reviewedAt).toLocaleString()}`, 'notice approved'));
}
function rejectButton(id) {
  return button('标记需修改 / 撤回批准', () => {
    const person = identity(); if (!person) return;
    if (!state.notes[id]?.trim()) { message('请先在备注中说明需要修改的地方。'); document.querySelector('#detail textarea')?.focus(); return; }
    state.rejections[id] = { ...person, note: state.notes[id].trim() }; delete state.words[id]; delete state.clips[id]; save();
    if (byId.has(id)) for (const clip of data.clips) if (clip.wordIds.includes(id)) delete state.clips[clip.ref];
    save();
    message('已标记需修改，导出结果会包含撤回决定。'); render();
  });
}
function renderWord(word, container) {
  const entry = word.entry; const hero = element('div', undefined, 'word-hero');
  const image = element('img'); image.src = word.image; image.alt = entry.illustration.alt;
  const copy = element('div'); copy.append(element('h2', entry.word), element('p', `${entry.ipa} · ${entry.definition.zh}`), element('p', entry.wordId, 'muted'));
  hero.append(image, copy); container.append(hero);
  const fields = element('dl');
  for (const [label, value] of [['幼龄释义', entry.definition.en_young], ['进阶释义', entry.definition.en_older], ['英文例句', entry.example.en], ['中文例句', entry.example.zh], ['家长提示', entry.parentTip.zh], ['英文提示', entry.parentTip.en]]) fields.append(element('dt', label), element('dd', value));
  container.append(fields);
  if (entry.track === 'phonics') {
    const parts = element('div', undefined, 'parts');
    for (const part of entry.graphemes) {
      const item = element('div', undefined, 'part'); item.append(element('strong', part.letters), element('small', part.phonemes.length ? `/${part.phonemes.join(' / ')}/` : '不发音'));
      if (part.note) item.append(element('small', part.note)); parts.append(item);
    }
    container.append(parts, element('p', `音节：${entry.syllables.join(' · ')} · 逐字母：${entry.spelling.join(' · ')}`, 'muted'));
  } else container.append(element('p', '整词识别通道：在例句中高亮整词，不进入拼读或拼字母活动。', 'notice'));
  const section = element('div', undefined, 'section'); section.append(element('h3', '文字与配图审核')); approveStatus(state.words[entry.wordId], section);
  const checked = element('input'); checked.type = 'checkbox';
  const label = element('label'); label.append(checked, document.createTextNode('已核对词义、例句、拆分、教学提示与配图表达')); section.append(label);
  const approve = button('批准文字与配图', () => {
    const person = identity(); if (!person || !checked.checked) return;
    state.words[entry.wordId] = { ...person, contentSha256: word.contentSha256, imageSha256: word.imageSha256 };
    delete state.rejections[entry.wordId];
    save(); message(`${entry.word} 的文字与配图已记录批准，语音仍单独审核。`); render();
  }, true);
  approve.disabled = true; checked.addEventListener('change', () => { approve.disabled = !checked.checked; });
  section.append(approve); noteField(entry.wordId, section); section.append(rejectButton(entry.wordId));
  const source = element('details'); source.append(element('summary', '素材来源与校验信息'), element('p', `来源：${word.imageLicense.source}`), element('p', `作者：${word.imageLicense.creator}；许可：${word.imageLicense.license}；依据：${word.imageLicense.permissionEvidence}`), element('p', `文字指纹：${word.contentSha256}`), element('p', `图片指纹：${word.imageSha256}`)); section.append(source); container.append(section);
}
function renderClip(clip, container) {
  const names = { word: '常速单词', slow: '慢速单词', sentence: '例句', phoneme: '孤立音素', guide: '中文向导' };
  container.append(element('div', names[clip.kind], 'pill'), element('h2', clip.text ?? `/${clip.phonemes.join(' / ')}/`), element('p', clip.ref, 'muted'));
  if (!clip.available) { container.append(element('p', `尚未提供最终语音。${clip.input ? `输入位置：audio-source/${clip.input}` : `从 ${clip.derivedFrom} 派生慢速版。`}`, 'notice')); noteField(clip.ref, container); return; }
  approveStatus(state.clips[clip.ref], container);
  const playButton = button('试听最终切片', () => void play(clip), true); container.append(playButton);
  container.append(element('p', `片段长度 ${(clip.interval[1] / 1000).toFixed(2)} 秒。${heard.has(clip.ref) ? '本次已完整试听。' : '请完整听一遍后审核。'}`, 'muted'));
  const missingText = clip.wordIds.filter((id) => !state.words[id]);
  if (missingText.length) container.append(element('p', `请先审核相关词条的文字与配图：${missingText.map((id) => byId.get(id).entry.word).join('、')}`, 'notice'));
  const rights = state.rights[clip.ref] ?? state.clips[clip.ref] ?? {}; state.rights[clip.ref] = { ...rights };
  const fields = element('div', undefined, 'rights');
  for (const [key, name] of [['creator', '素材作者 / 权利人'], ['license', '适用许可 / 授权名称'], ['permissionEvidence', '授权依据的位置或文件名']]) {
    const label = element('label', name); const input = element('input'); input.value = rights[key] ?? ''; input.addEventListener('input', () => { state.rights[clip.ref][key] = input.value; }); label.append(input); fields.append(label);
  }
  container.append(fields);
  const calibrated = element('input'); calibrated.type = 'checkbox';
  if (clip.calibrationRequired) { const label = element('label'); label.append(calibrated, document.createTextNode('已核对短音素的参考响度，声音清楚且没有吃掉开头')); container.append(label); }
  const checked = element('input'); checked.type = 'checkbox';
  const label = element('label'); label.append(checked, document.createTextNode('发音、语速、响度和切片边界通过听审')); container.append(label);
  const approve = button('批准此语音片段', () => {
    const person = identity(); if (!person || !heard.has(clip.ref) || !checked.checked || missingText.length) return;
    const rights = state.rights[clip.ref];
    if (['creator', 'license', 'permissionEvidence'].some((key) => !rights[key]?.trim())) { message('请填写此语音的作者、许可与授权依据。'); return; }
    if (clip.calibrationRequired && !calibrated.checked) { message('请核对短音素的参考响度。'); return; }
    state.clips[clip.ref] = { ...person, ref: clip.ref, creator: rights.creator.trim(), license: rights.license.trim(), permissionEvidence: rights.permissionEvidence.trim(),
      spriteSha256: clip.spriteSha256, sourceSha256: clip.sourceSha256, promptSha256: clip.promptSha256, clip: clip.interval, calibrationApproved: calibrated.checked };
    delete state.rejections[clip.ref];
    save(); message(`${clip.ref} 的最终切片听审已记录。`); render();
  }, true);
  approve.disabled = true; checked.addEventListener('change', () => { approve.disabled = !checked.checked || !heard.has(clip.ref) || missingText.length > 0; });
  container.append(approve); noteField(clip.ref, container); container.append(rejectButton(clip.ref));
  const metadata = element('details'); metadata.append(element('summary', '切片与来源指纹'), element('p', `区间：[${clip.interval.join(', ')}] 毫秒`), element('p', `文字与发音要求：${clip.promptSha256}`), element('p', `源文件：${clip.sourceSha256}`), element('p', `最终精灵：${clip.spriteSha256}`)); container.append(metadata);
}
function renderDetail() {
  const container = document.getElementById('detail'); container.replaceChildren();
  const word = byId.get(selected); const clip = byRef.get(selected);
  if (word) renderWord(word, container); else if (clip) renderClip(clip, container); else container.append(element('p', '选择左侧素材开始核对。', 'muted'));
}
function renderList() {
  const kind = document.getElementById('kind').value;
  const search = document.getElementById('search').value.toLowerCase().trim(); const pending = document.getElementById('pending').checked;
  const list = document.getElementById('items'); list.replaceChildren();
  const items = kind === 'words' ? data.words : data.clips;
  for (const item of items) {
    const id = item.entry?.wordId ?? item.ref; const text = item.entry ? `${item.entry.word} · ${item.entry.illustration.alt}` : item.ref;
    const approved = (kind === 'words' ? state.words : state.clips)[id];
    if (pending && approved) continue;
    if (search && !`${text} ${item.text ?? ''} ${item.entry?.definition.zh ?? ''}`.toLowerCase().includes(search)) continue;
    const node = button(text, () => { stopAudio(); selected = id; render(); }); node.setAttribute('aria-current', String(selected === id));
    node.append(element('small', state.rejections[id] ? '需修改' : approved ? '已批准' : kind === 'clips' && !item.available ? '待素材' : '待审')); list.append(node);
  }
  if (!list.childElementCount) list.append(element('p', '没有符合条件的素材。', 'muted'));
  document.getElementById('summary').textContent = `内容 ${data.contentVersion} · ${Object.keys(state.words).length}/${data.words.length} 词文字配图已审 · ${Object.keys(state.clips).length}/${data.clips.length} 段语音已审`;
}
function render() { renderList(); renderDetail(); }
document.getElementById('search').addEventListener('input', renderList);
document.getElementById('pending').addEventListener('change', renderList);
document.getElementById('kind').addEventListener('change', (event) => { stopAudio(); selected = event.target.value === 'words' ? data.words[0]?.entry.wordId : data.clips[0]?.ref; render(); });
document.getElementById('export').addEventListener('click', () => {
  const value = { reviewVersion: 1, datasetSha256: data.datasetSha256, contentVersion: data.contentVersion, exportedAt: new Date().toISOString(), words: state.words, clips: state.clips, notes: state.notes, rejections: state.rejections };
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = `w-english-review-${data.contentVersion}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
  message('已发起审核结果下载，请在浏览器中保存。工程端仍会核对当前素材指纹。');
});
document.getElementById('import').addEventListener('click', () => document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', async (event) => {
  try {
    const file = event.target.files[0]; if (!file) return; const value = JSON.parse(await file.text());
    if (value.reviewVersion !== 1 || value.datasetSha256 !== data.datasetSha256 || value.contentVersion !== data.contentVersion) throw new Error('Different review dataset');
    restore(value); save(); render(); message('已恢复与当前素材匹配的审核记录。');
  } catch { message('审核文件不匹配或无法读取，请使用当前这批素材的导出结果。'); }
  event.target.value = '';
});
render();

export const GUIDE_CUES = {
  welcome: '你好！我们一起认识新朋友吧。',
  explore: '点一个你喜欢的朋友，和它打个招呼吧。',
  offline: '先连上网，我就能把朋友们带来啦。',
  audio_retry: '点一下小喇叭，我们再听听。',
  listen_choose: '听一听，再点出你听到的图片。',
  try_again: '再听一次，试试看。',
  idle: '点点小喇叭，听一听吧。',
  round_end: '这一轮完成啦，和家人分享一下吧。',
};
export const GUIDE_AUDIO_REFS = Object.keys(GUIDE_CUES).map((key) => `guide#${key}`);
export const STAGE2_GUIDE_CUES = {
  choose_world: '选一个亮起来的地方，我们一起去看看。',
  blend: '点点泡泡，听一听，再把声音连起来。',
  spell: '按顺序点一点，把字母小火车接起来吧。',
  rest: '小眼睛休息一下吧。',
};
export function guideCues(stage = 1) { return stage >= 2 ? { ...GUIDE_CUES, ...STAGE2_GUIDE_CUES } : GUIDE_CUES; }
export function guideAudioRefs(stage = 1) { return Object.keys(guideCues(stage)).map((key) => `guide#${key}`); }

// App-shell instructions stay separate from the frozen guide sets of older content packs.
export const CORE_GUIDE_SPRITE = 'ui_guide';
export const CORE_GUIDE_CUES = { rotate: '把小小世界横过来，给小伙伴们多一点空间吧。' };
export const CORE_GUIDE_REFS = Object.keys(CORE_GUIDE_CUES).map((key) => `${CORE_GUIDE_SPRITE}#${key}`);

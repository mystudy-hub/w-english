// Web Audio API 原生音效生成器：零音频资源依赖，纯算法合成清脆音效。
// 移植来源：memoryApp/src/tts/sfx.ts（快照 b43afb31c9485256d2461948c8734b881d799537）。
// 课本轨道（drill）使用它做即时反馈；探索轨道继续用精灵音效，两条通道互不影响。

export type SfxKind = 'correct' | 'wrong' | 'complete';

let ctx: AudioContext | null = null;

// 无法创建或已被关闭时返回 null；挂起时先尝试恢复，恢复不了就静默跳过，不抛错。
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    try { ctx = new AudioCtx(); } catch { return null; }
  }
  if (ctx.state === 'closed') return null;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

// 答对音效：欢快清脆的双音节上扬升调（叮咚～）
function correct(ac: AudioContext): void {
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();

  osc.type = 'sine';
  // 第一个音 659Hz (E5)，0.08 秒后跳到 880Hz (A5)
  osc.frequency.setValueAtTime(659.25, now);
  osc.frequency.setValueAtTime(880.0, now + 0.08);

  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

  osc.connect(gain);
  gain.connect(ac.destination);

  osc.start(now);
  osc.stop(now + 0.35);
}

// 答错音效：温和低沉的提示音（咚…），不刺耳不打击孩子
function wrong(ac: AudioContext): void {
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(261.63, now); // C4
  osc.frequency.linearRampToValueAtTime(196.0, now + 0.2); // G3

  gain.gain.setValueAtTime(0.25, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

  osc.connect(gain);
  gain.connect(ac.destination);

  osc.start(now);
  osc.stop(now + 0.3);
}

// 通关庆祝音效：经典 RPG 升级四音连奏（C5 - E5 - G5 - C6）
function complete(ac: AudioContext): void {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
  notes.forEach((freq, index) => {
    const now = ac.currentTime + index * 0.1;
    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);

    osc.connect(gain);
    gain.connect(ac.destination);

    osc.start(now);
    osc.stop(now + 0.28);
  });
}

export function playSfx(kind: SfxKind): void {
  const ac = getAudioContext();
  if (!ac) return;
  try {
    if (kind === 'correct') correct(ac);
    else if (kind === 'wrong') wrong(ac);
    else complete(ac);
  } catch {
    // 自动播放限制或设备不可用时保持安静，不影响答题流程。
  }
}

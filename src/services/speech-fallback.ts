// Robust Web Speech API fallback for words, sentences and phonemes
let voicesCache: SpeechSynthesisVoice[] = [];

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  const updateVoices = () => {
    try {
      voicesCache = window.speechSynthesis.getVoices();
    } catch {
      /* ignore voice update error */
    }
  };
  updateVoices();
  window.speechSynthesis.onvoiceschanged = updateVoices;
}

export function isSpeechSynthesisAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function cancelWebSpeech(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore cancel error */
    }
  }
}

export function speakWithWebSpeech(
  text: string,
  rate = 0.85,
  pitch = 1.02
): Promise<{ status: 'ended' | 'failed' | 'cancelled'; playbackId: string }> {
  const playbackId = crypto.randomUUID();
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve({ status: 'failed', playbackId });
  }

  return new Promise((resolve) => {
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = Math.max(0.4, Math.min(1.5, rate));
      utterance.pitch = pitch;

      const voices = voicesCache.length ? voicesCache : window.speechSynthesis.getVoices();
      const preferredVoice =
        voices.find(
          (v) =>
            v.lang.startsWith('en') &&
            (v.name.includes('Jenny') ||
              v.name.includes('Natural') ||
              v.name.includes('Aria') ||
              v.name.includes('Google US') ||
              v.name.includes('Guy') ||
              v.name.includes('Samantha'))
        ) ||
        voices.find((v) => v.lang.startsWith('en-US')) ||
        voices.find((v) => v.lang.startsWith('en'));

      if (preferredVoice) utterance.voice = preferredVoice;

      let settled = false;
      const wordCount = text.trim().split(/\s+/).length;
      const expectedMs = Math.max(1200, Math.round((wordCount * 650) / utterance.rate));
      const timer = setTimeout(() => finish('ended'), expectedMs + 600);

      const finish = (status: 'ended' | 'failed' | 'cancelled') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status, playbackId });
      };

      utterance.onend = () => finish('ended');
      utterance.onerror = (e) => {
        if (e.error === 'canceled' || e.error === 'interrupted') {
          finish('cancelled');
        } else {
          finish('failed');
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      resolve({ status: 'failed', playbackId });
    }
  });
}

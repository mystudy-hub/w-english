import { useState, useMemo, useEffect, useRef } from 'react';
import { 
  ArrowLeft, BookOpen, Volume2, Search, Sparkles, Award, Layers, Star, 
  Turtle, Play, Pause, SlidersHorizontal, RotateCcw, Repeat, 
  Mic, Headphones, Music
} from 'lucide-react';
import { DIANFAN_WORDS, DIANFAN_LESSONS, type DianfanWord } from '../data/dianfan-data.ts';
import { DIANFAN_AUDIO_MAP, type DianfanLessonAudio } from '../data/dianfan-audio.ts';
import { IconButton } from '../components/ui.tsx';
import { navigate } from '../app/router.ts';
import { audio, playEffect, toggleFavorite } from '../app/runtime.ts';
import { useAppStore, useParentStore } from '../app/store.ts';
// 语音兜底的唯一所有者是 speech-fallback：这里只调用，不再自带一份 Web Speech 实现。
import { cancelWebSpeech, isSpeechSynthesisAvailable, speakWithWebSpeech } from '../services/speech-fallback.ts';

export type SpeedMode = 'slow' | 'medium' | 'normal' | 'custom';

export const SPEED_CONFIG: Record<
  'slow' | 'medium' | 'normal',
  { label: string; icon: string; wordRate: number; sentenceRate: number; rate: number; desc: string }
> = {
  slow: {
    label: '慢速',
    icon: '🐢',
    wordRate: 0.58,
    sentenceRate: 0.62,
    rate: 0.75,
    desc: '原声慢放，清晰辨音',
  },
  medium: {
    label: '较慢',
    icon: '🍃',
    wordRate: 0.70,
    sentenceRate: 0.74,
    rate: 0.85,
    desc: '舒适自然，字句分明',
  },
  normal: {
    label: '标准',
    icon: '⚡',
    wordRate: 0.85,
    sentenceRate: 0.88,
    rate: 1.0,
    desc: '官方正版流利语速',
  },
};

export function DianfanPage() {
  const [activeTab, setActiveTab] = useState<'lessons' | 'words' | 'favorites' | 'quiz'>('lessons');
  const [selectedLessonId, setSelectedLessonId] = useState<string>(DIANFAN_LESSONS[0]?.id || '1A-01');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'phonics' | 'sight' | 'role'>('all');

  // 生词本数据
  const favorites = useParentStore((s) => s.favoriteWords ?? []);
  const favoriteWordsList = useMemo(() => {
    const set = new Set(favorites.map((w) => w.toLowerCase()));
    return DIANFAN_WORDS.filter((w) => set.has(w.word.toLowerCase()));
  }, [favorites]);

  const handleToggleFavorite = async (word: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await toggleFavorite(word);
    void playEffect('sfx#pop');
  };

  // 播放模式：'repeat'(带留白官方跟读) | 'continuous'(无停顿连贯精听) | 'tts'(机械备用)
  const [playMode, setPlayMode] = useState<'repeat' | 'continuous' | 'tts'>('repeat');

  // 语速设置（支持原声变速）
  const [speedMode, setSpeedMode] = useState<SpeedMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dianfan_speed_mode') as SpeedMode;
      if (saved === 'custom' || (saved && saved in SPEED_CONFIG)) return saved;
    }
    return 'normal';
  });

  const [customRate, setCustomRate] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = parseFloat(localStorage.getItem('dianfan_custom_rate') || '');
      if (!isNaN(saved) && saved >= 0.5 && saved <= 1.3) return saved;
    }
    return 0.85;
  });

  const [showSpeedPopover, setShowSpeedPopover] = useState(false);

  const currentPlaybackRate = useMemo(() => {
    if (speedMode === 'custom') return customRate;
    return SPEED_CONFIG[speedMode]?.rate ?? 1.0;
  }, [speedMode, customRate]);

  // 原声音频播放器核心状态
  const nativeAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeSentenceIdx, setActiveSentenceIdx] = useState<number | null>(null);
  const [isPauseForRepeating, setIsPauseForRepeating] = useState(false);
  const [pauseCountdown, setPauseCountdown] = useState<number>(0);
  const [loopSentenceIdx, setLoopSentenceIdx] = useState<number | null>(null);
  const [playingWord, setPlayingWord] = useState<string | null>(null);
  const [audioLoadError, setAudioLoadError] = useState(false);

  // 单句播放边界引用
  const singleSentenceBoundaryRef = useRef<{ index: number; stopTime: number; loop: boolean } | null>(null);

  // 当前选中课文的原生音频元数据
  const currentLessonAudio: DianfanLessonAudio | null = useMemo(() => {
    return DIANFAN_AUDIO_MAP[selectedLessonId] || null;
  }, [selectedLessonId]);

  const selectedLesson = useMemo(() => {
    return DIANFAN_LESSONS.find((l) => l.id === selectedLessonId) || DIANFAN_LESSONS[0]!;
  }, [selectedLessonId]);

  const lessonWords = useMemo(() => {
    const wordSet = new Set(selectedLesson.words);
    return DIANFAN_WORDS.filter((w) => wordSet.has(w.word));
  }, [selectedLesson]);

  // 封面插图路径
  const coverImageUrl = useMemo(() => {
    return `content/dianfan/1a/covers/${selectedLessonId}.jpg`;
  }, [selectedLessonId]);

  // 切换课文或模式时，停止当前播放并重置状态
  useEffect(() => {
    if (nativeAudioRef.current) {
      nativeAudioRef.current.pause();
    }
    cancelWebSpeech();
    setIsAudioPlaying(false);
    setCurrentTime(0);
    setActiveSentenceIdx(null);
    setIsPauseForRepeating(false);
    setLoopSentenceIdx(null);
    singleSentenceBoundaryRef.current = null;
    setAudioLoadError(false);
  }, [selectedLessonId]);

  // 保持语速生效
  useEffect(() => {
    if (nativeAudioRef.current) {
      nativeAudioRef.current.playbackRate = currentPlaybackRate;
    }
  }, [currentPlaybackRate]);

  // 原生音频时间更新与句子高亮驱动
  const handleNativeTimeUpdate = () => {
    const audioEl = nativeAudioRef.current;
    if (!audioEl || !currentLessonAudio) return;

    const t = audioEl.currentTime;
    setCurrentTime(t);

    // 1. 如果处于单句精听模式
    if (singleSentenceBoundaryRef.current) {
      const target = singleSentenceBoundaryRef.current;
      if (t >= target.stopTime) {
        if (target.loop) {
          const sent = currentLessonAudio.sentences[target.index];
          if (sent) {
            audioEl.currentTime = sent.start;
            audioEl.play().catch(() => {});
            return;
          }
        } else {
          audioEl.pause();
          setIsAudioPlaying(false);
          singleSentenceBoundaryRef.current = null;
          setIsPauseForRepeating(false);
          return;
        }
      }
    }

    // 2. 整课播放的时间跟随高亮判断
    const sentences = currentLessonAudio.sentences;
    let foundIdx: number | null = null;
    let inPause = false;
    let remaining = 0;

    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (!s) continue;
      if (t >= s.start && t < s.end) {
        foundIdx = i;
        inPause = false;
        break;
      } else if (t >= s.end && t < s.end + s.pauseAfter) {
        foundIdx = i;
        inPause = true;
        remaining = Math.max(0, Math.ceil(s.end + s.pauseAfter - t));
        break;
      }
    }

    // 如果处于连贯模式且进入了原版留白，自动跳到下一句的开始
    if (playMode === 'continuous' && inPause && foundIdx !== null) {
      const nextSentence = sentences[foundIdx + 1];
      if (nextSentence) {
        audioEl.currentTime = nextSentence.start;
        return;
      }
    }

    setActiveSentenceIdx(foundIdx);
    setIsPauseForRepeating(inPause);
    setPauseCountdown(remaining);
  };

  const handleNativeAudioEnded = () => {
    setIsAudioPlaying(false);
    setActiveSentenceIdx(null);
    setIsPauseForRepeating(false);
    singleSentenceBoundaryRef.current = null;
  };

  // 播放 / 暂停全篇原声
  const handleTogglePlayAll = async () => {
    const audioEl = nativeAudioRef.current;
    if (!audioEl || !currentLessonAudio) {
      // 降级为备用机械音
      return;
    }

    if (isAudioPlaying) {
      audioEl.pause();
      setIsAudioPlaying(false);
      singleSentenceBoundaryRef.current = null;
    } else {
      singleSentenceBoundaryRef.current = null;
      setLoopSentenceIdx(null);
      cancelWebSpeech();
      audioEl.playbackRate = currentPlaybackRate;
      try {
        await audioEl.play();
        setIsAudioPlaying(true);
        void playEffect('sfx#pop');
      } catch (err) {
        console.warn('Audio play failed, falling back to TTS:', err);
        setAudioLoadError(true);
      }
    }
  };

  // 单句原声点听 / 循环精听
  const handlePlaySingleSentence = async (idx: number, isLoop = false) => {
    const audioEl = nativeAudioRef.current;
    if (!audioEl || !currentLessonAudio) {
      // 降级为语音合成（共享 owner，见 speech-fallback.ts）
      const text = selectedLesson.sentences[idx];
      if (text && isSpeechSynthesisAvailable()) void speakWithWebSpeech(text, currentPlaybackRate);
      return;
    }

    const sent = currentLessonAudio.sentences[idx];
    if (!sent) return;

    if (isLoop && loopSentenceIdx === idx && isAudioPlaying) {
      // 取消单句循环
      audioEl.pause();
      setIsAudioPlaying(false);
      setLoopSentenceIdx(null);
      singleSentenceBoundaryRef.current = null;
      return;
    }

    cancelWebSpeech();
    singleSentenceBoundaryRef.current = {
      index: idx,
      stopTime: sent.end,
      loop: isLoop,
    };
    setLoopSentenceIdx(isLoop ? idx : null);
    setActiveSentenceIdx(idx);
    setIsPauseForRepeating(false);

    audioEl.currentTime = sent.start;
    audioEl.playbackRate = currentPlaybackRate;
    try {
      await audioEl.play();
      setIsAudioPlaying(true);
      void playEffect('sfx#pop');
    } catch {
      setAudioLoadError(true);
      if (isSpeechSynthesisAvailable()) void speakWithWebSpeech(sent.text, currentPlaybackRate);
    }
  };

  // 单词点击发音
  const handlePlayWord = async (wordObj: DianfanWord) => {
    if (playingWord) return;
    setPlayingWord(wordObj.word);

    try {
      // 1. 检查是否存在系统音频库词条
      const matched = content?.catalog.words.find((w) => w.word.toLowerCase() === wordObj.word.toLowerCase());
      if (matched && audio.has(matched.audio.word)) {
        await audio.unlock();
        await audio.play(matched.audio.word, `dianfan:${wordObj.word}`, currentPlaybackRate);
        return;
      }

      // 2. 没有系统片段时用共享的兜底朗读，并等它真正结束（不再用固定延时猜测）
      await speakWithWebSpeech(wordObj.word, currentPlaybackRate);
    } finally {
      setPlayingWord(null);
    }
  };

  // 进度条拖拽/点击
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audioEl = nativeAudioRef.current;
    if (!audioEl || !currentLessonAudio) return;
    const target = parseFloat(e.target.value);
    audioEl.currentTime = target;
    setCurrentTime(target);
    singleSentenceBoundaryRef.current = null;
  };

  // 语速切换
  const handleSpeedChange = (mode: SpeedMode) => {
    setSpeedMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('dianfan_speed_mode', mode);
    }
    void playEffect('sfx#pop');
  };

  const handleCustomRateChange = (val: number) => {
    const clamped = Math.max(0.5, Math.min(1.25, Math.round(val * 100) / 100));
    setCustomRate(clamped);
    setSpeedMode('custom');
    if (typeof window !== 'undefined') {
      localStorage.setItem('dianfan_custom_rate', String(clamped));
      localStorage.setItem('dianfan_speed_mode', 'custom');
    }
  };

  // 格式化秒数为 mm:ss
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const content = useAppStore((state) => state.content);

  // 单词过滤
  const filteredWords = useMemo(() => {
    return DIANFAN_WORDS.filter((w) => {
      const matchSearch = w.word.toLowerCase().includes(searchTerm.toLowerCase()) || w.zh.includes(searchTerm);
      if (!matchSearch) return false;
      if (filterType === 'phonics') return w.track === 'phonics';
      if (filterType === 'sight') return w.track === 'sight' && !w.isRole;
      if (filterType === 'role') return w.isRole;
      return true;
    });
  }, [searchTerm, filterType]);

  // Quiz state
  const [quizQuestionIndex, setQuizQuestionIndex] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [quizAnswered, setQuizAnswered] = useState<string | null>(null);

  const quizPool = useMemo(() => {
    return lessonWords.length >= 4 ? lessonWords : DIANFAN_WORDS.slice(0, 30);
  }, [lessonWords]);

  const currentQuizItem = quizPool[quizQuestionIndex % quizPool.length]!;

  const quizOptions = useMemo(() => {
    const options = [currentQuizItem];
    const others = DIANFAN_WORDS.filter((w) => w.word !== currentQuizItem.word);
    const shuffled = [...others].sort(() => 0.5 - Math.random());
    options.push(...shuffled.slice(0, 3));
    return options.sort(() => 0.5 - Math.random());
  }, [currentQuizItem]);

  const handleQuizAnswer = (optionWord: string) => {
    if (quizAnswered) return;
    setQuizAnswered(optionWord);
    const correct = optionWord === currentQuizItem.word;
    if (correct) {
      setQuizScore((s) => s + 1);
      void playEffect('sfx#chime_success');
    } else {
      void playEffect('sfx#pop');
      setTimeout(() => {
        if (isSpeechSynthesisAvailable()) void speakWithWebSpeech(currentQuizItem.word, currentPlaybackRate);
      }, 500);
    }
  };

  const nextQuizQuestion = () => {
    setQuizAnswered(null);
    setQuizQuestionIndex((i) => i + 1);
  };

  return (
    <div className="dianfan-container min-h-screen bg-[#fdfbf7] text-[#2c3e50] flex flex-col font-sans select-none">
      {/* 隐藏的原声 Audio 标签 */}
      {currentLessonAudio && (
        <audio
          ref={nativeAudioRef}
          src={currentLessonAudio.audioUrl}
          preload="metadata"
          onTimeUpdate={handleNativeTimeUpdate}
          onLoadedMetadata={() => {
            if (nativeAudioRef.current) {
              setDuration(nativeAudioRef.current.duration);
              nativeAudioRef.current.playbackRate = currentPlaybackRate;
            }
          }}
          onEnded={handleNativeAudioEnded}
          onError={() => setAudioLoadError(true)}
        />
      )}

      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-amber-100 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <IconButton label="返回主页" onClick={() => navigate('/themes')}>
            <ArrowLeft className="w-5 h-5" />
          </IconButton>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📚</span>
              <h1 className="text-lg font-bold text-amber-900 tracking-tight">典范英语 1A · 官方原声精听</h1>
              <span className="text-xs bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                <Music className="w-3 h-3 text-amber-600" />
                <span>牛津原版英国原声</span>
              </span>
            </div>
            <p className="text-xs text-amber-700/70 hidden sm:block">
              42 课官方纯正戏剧化录音 · 带跟读留白与卡拉OK句句同步
            </p>
          </div>
        </div>

        {/* Top Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* 原声变速控制 */}
          <div className="relative flex items-center bg-amber-50 p-1 rounded-xl border border-amber-200/70 text-xs font-medium shadow-inner">
            <span className="text-amber-900/70 px-2 flex items-center gap-1 font-semibold">
              <Turtle className="w-3.5 h-3.5 text-amber-700" />
              <span className="hidden sm:inline">语速</span>
            </span>
            {(['slow', 'medium', 'normal'] as const).map((mode) => {
              const cfg = SPEED_CONFIG[mode];
              const isSelected = speedMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => {
                    setShowSpeedPopover(false);
                    handleSpeedChange(mode);
                  }}
                  title={cfg.desc}
                  className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 text-xs ${
                    isSelected
                      ? 'bg-amber-500 text-white font-bold shadow-sm scale-[1.02]'
                      : 'text-amber-900 hover:bg-amber-100/70'
                  }`}
                >
                  <span>{cfg.icon}</span>
                  <span>{cfg.label}</span>
                  <span className="text-[10px] opacity-80">({cfg.rate}x)</span>
                </button>
              );
            })}

            <button
              onClick={() => setShowSpeedPopover(!showSpeedPopover)}
              title="微调倍速"
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 text-xs ml-0.5 ${
                speedMode === 'custom' || showSpeedPopover
                  ? 'bg-amber-600 text-white font-bold shadow-sm'
                  : 'text-amber-900 hover:bg-amber-100/70'
              }`}
            >
              <SlidersHorizontal className="w-3 h-3" />
              <span>{speedMode === 'custom' ? `${customRate.toFixed(2)}x` : '微调'}</span>
            </button>

            {/* 微调浮层 */}
            {showSpeedPopover && (
              <div className="absolute right-0 top-full mt-2 z-50 bg-white rounded-2xl shadow-xl border border-amber-200 p-3.5 w-72 text-amber-950 font-sans">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-xs flex items-center gap-1.5 text-amber-900">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-amber-600" />
                    <span>原声变速（不变调）</span>
                  </span>
                  <span className="text-amber-700 font-extrabold bg-amber-100 px-2 py-0.5 rounded-full text-xs">
                    {customRate.toFixed(2)}x
                  </span>
                </div>

                <div className="space-y-1 mb-2">
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>慢速 0.60x</span>
                    <span>原速 1.00x</span>
                    <span>流利 1.25x</span>
                  </div>
                  <input
                    type="range"
                    min="0.55"
                    max="1.25"
                    step="0.05"
                    value={customRate}
                    onChange={(e) => handleCustomRateChange(Number(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer h-2 bg-amber-100 rounded-lg appearance-none"
                  />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-amber-100 text-[11px]">
                  <span className="text-gray-400">英国专业配音演员原声</span>
                  <button
                    onClick={() => setShowSpeedPopover(false)}
                    className="bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold px-2.5 py-1 rounded-lg"
                  >
                    完成
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 选项卡切换 */}
          <div className="flex items-center bg-amber-50 p-1 rounded-xl border border-amber-200/60 text-sm font-medium">
            <button
              onClick={() => setActiveTab('lessons')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'lessons' ? 'bg-amber-500 text-white shadow-sm font-bold' : 'text-amber-900 hover:bg-amber-100'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>按课文分课 (42)</span>
            </button>
            <button
              onClick={() => setActiveTab('words')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'words' ? 'bg-amber-500 text-white shadow-sm font-bold' : 'text-amber-900 hover:bg-amber-100'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>全部词汇 (245)</span>
            </button>
            <button
              onClick={() => setActiveTab('favorites')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'favorites' ? 'bg-amber-500 text-white shadow-sm font-bold' : 'text-amber-900 hover:bg-amber-100'
              }`}
            >
              <Star className={`w-4 h-4 ${favoriteWordsList.length > 0 ? 'fill-amber-400 text-amber-500' : ''}`} />
              <span>重点生词本 ({favoriteWordsList.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('quiz')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'quiz' ? 'bg-amber-500 text-white shadow-sm font-bold' : 'text-amber-900 hover:bg-amber-100'
              }`}
            >
              <Award className="w-4 h-4" />
              <span>闯关小练习</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full">
        {/* Tab 1: 按课文原声精听分课 */}
        {activeTab === 'lessons' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* 课文目录列表 */}
            <div className="lg:col-span-4 xl:col-span-3 bg-white rounded-2xl p-4 shadow-sm border border-amber-100 flex flex-col max-h-[82vh]">
              <div className="flex items-center justify-between pb-3 mb-2 border-b border-amber-50">
                <span className="font-bold text-amber-950 text-sm">选择课文 (1A-01 ~ 1A-42)</span>
                <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">共 42 课</span>
              </div>
              <div className="overflow-y-auto space-y-1.5 pr-1 flex-1 custom-scrollbar">
                {DIANFAN_LESSONS.map((lesson) => {
                  const isSelected = lesson.id === selectedLessonId;
                  return (
                    <button
                      key={lesson.id}
                      onClick={() => {
                        setSelectedLessonId(lesson.id);
                        void playEffect('sfx#pop');
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center justify-between text-sm ${
                        isSelected
                          ? 'bg-amber-500 text-white font-bold shadow-sm translate-x-1'
                          : 'hover:bg-amber-50/80 text-gray-700'
                      }`}
                    >
                      <div className="truncate pr-2">
                        <span className={`text-xs font-mono mr-1.5 opacity-80 ${isSelected ? 'text-amber-100' : 'text-amber-600'}`}>
                          {lesson.id}
                        </span>
                        <span>{lesson.title}</span>
                      </div>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-md shrink-0 ${
                        isSelected ? 'bg-amber-600/60 text-white' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {lesson.wordCount} 词
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 课文主体与原声控制台 */}
            <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-5">
              {/* 课文 Banner & 绘本插图卡 */}
              <div className="bg-gradient-to-r from-amber-500 to-orange-400 rounded-3xl p-5 text-white shadow-md flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-amber-100 text-xs font-semibold mb-1">
                    <span>Lesson {selectedLesson.id.replace('1A-', '')}</span>
                    <span>•</span>
                    <span>{selectedLesson.wordCount} 个核心生词</span>
                    <span>•</span>
                    <span className="bg-white/20 px-2 py-0.5 rounded-full">
                      牛津原版录音 ({currentLessonAudio?.duration || 45}s)
                    </span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2">
                    {selectedLesson.title}
                  </h2>
                  <p className="text-amber-100 text-xs sm:text-sm">
                    点击下方任意句子直接播放原声；开启跟读留白，在提示时跟着大声读！
                  </p>
                </div>

                {/* 绘本彩色封面展示 */}
                <div className="w-24 h-28 sm:w-28 sm:h-32 bg-white/20 p-1.5 rounded-2xl shrink-0 shadow-inner flex items-center justify-center overflow-hidden">
                  <img
                    src={coverImageUrl}
                    alt={selectedLesson.title}
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                    className="w-full h-full object-cover rounded-xl shadow-sm"
                  />
                </div>
              </div>

              {/* 官方原声控制台 (Broadcast-Grade Audio Console) */}
              <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-sm border border-amber-200">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3 pb-3 border-b border-amber-100">
                  {/* 模式选择切换器 */}
                  <div className="flex items-center gap-1.5 bg-amber-50 p-1 rounded-xl text-xs font-semibold text-amber-950">
                    <button
                      onClick={() => setPlayMode('repeat')}
                      className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                        playMode === 'repeat' ? 'bg-amber-500 text-white shadow-sm' : 'hover:bg-amber-100/70'
                      }`}
                      title="官方原版带留白：读一句留 3~5 秒供孩子大声跟读"
                    >
                      <Mic className="w-3.5 h-3.5" />
                      <span>🎤 原声跟读（带停顿）</span>
                    </button>
                    <button
                      onClick={() => setPlayMode('continuous')}
                      className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                        playMode === 'continuous' ? 'bg-amber-500 text-white shadow-sm' : 'hover:bg-amber-100/70'
                      }`}
                      title="连贯连续听读：顺畅连读，不等待留白"
                    >
                      <Headphones className="w-3.5 h-3.5" />
                      <span>🎧 连贯磨耳朵</span>
                    </button>
                  </div>

                  {/* 状态徽标与跟读提示 */}
                  <div className="flex items-center gap-2">
                    {audioLoadError && (
                      <span className="text-xs bg-rose-50 text-rose-600 font-medium px-2 py-0.5 rounded-md">
                        ⚠️ 原声加载失败，使用备用朗读
                      </span>
                    )}
                    {isPauseForRepeating && isAudioPlaying ? (
                      <span className="text-xs bg-rose-100 text-rose-700 font-extrabold px-3 py-1 rounded-full flex items-center gap-1.5 animate-pulse">
                        <Mic className="w-3.5 h-3.5 text-rose-600" />
                        <span>轮到你读啦！ ({pauseCountdown}s)</span>
                      </span>
                    ) : isAudioPlaying && activeSentenceIdx !== null ? (
                      <span className="text-xs bg-emerald-50 text-emerald-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                        <Volume2 className="w-3.5 h-3.5 text-emerald-600 animate-bounce" />
                        <span>正在朗读第 {activeSentenceIdx + 1} 句</span>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">
                        {currentLessonAudio ? '官方原声就绪' : 'TTS 发音就绪'}
                      </span>
                    )}
                  </div>
                </div>

                {/* 播放控制与进度条 */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleTogglePlayAll}
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-md shrink-0 ${
                      isAudioPlaying
                        ? 'bg-amber-600 text-white hover:bg-amber-700'
                        : 'bg-amber-500 text-white hover:bg-amber-600 hover:scale-[1.03]'
                    }`}
                    title={isAudioPlaying ? '暂停原声' : '播放整篇原声'}
                  >
                    {isAudioPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                  </button>

                  <div className="flex-1 flex flex-col gap-1 min-w-0">
                    <input
                      type="range"
                      min={0}
                      max={duration || currentLessonAudio?.duration || 60}
                      step={0.1}
                      value={currentTime}
                      onChange={handleSeek}
                      className="w-full accent-amber-500 cursor-pointer h-2 bg-amber-100 rounded-lg appearance-none"
                    />
                    <div className="flex justify-between text-[11px] text-gray-400 font-mono">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(duration || currentLessonAudio?.duration || 0)}</span>
                    </div>
                  </div>

                  {/* 停止/重置按钮 */}
                  <button
                    onClick={() => {
                      if (nativeAudioRef.current) {
                        nativeAudioRef.current.pause();
                        nativeAudioRef.current.currentTime = 0;
                      }
                      setIsAudioPlaying(false);
                      setCurrentTime(0);
                      setActiveSentenceIdx(null);
                      setIsPauseForRepeating(false);
                      singleSentenceBoundaryRef.current = null;
                      setLoopSentenceIdx(null);
                    }}
                    className="p-2.5 rounded-xl hover:bg-amber-50 text-gray-400 hover:text-amber-800 transition-colors"
                    title="重置播放进度"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* 课文句子列表（支持点句原声播报 & 单句循环） */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-amber-950 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <span>故事原文句子 ({selectedLesson.sentences.length})</span>
                  </h3>
                  <span className="text-xs text-gray-400">
                    💡 点击任意句子或右侧按钮点听；🔁 可单句循环精听
                  </span>
                </div>

                <div className="space-y-2">
                  {selectedLesson.sentences.map((sent, idx) => {
                    const isSentenceActive = activeSentenceIdx === idx;
                    const isLooping = loopSentenceIdx === idx;
                    return (
                      <div
                        key={idx}
                        onClick={() => void handlePlaySingleSentence(idx, false)}
                        className={`group p-3 sm:p-3.5 rounded-2xl border transition-all flex items-center justify-between cursor-pointer ${
                          isSentenceActive
                            ? isPauseForRepeating
                              ? 'bg-rose-50/80 border-rose-300 ring-2 ring-rose-200 shadow-sm'
                              : 'bg-amber-100/90 border-amber-400 ring-2 ring-amber-300 shadow-md scale-[1.008]'
                            : 'hover:bg-amber-50/70 border-transparent hover:border-amber-200 bg-[#fefdfb]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 flex-1 pr-2 min-w-0">
                          <span className={`text-xs font-mono font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                            isSentenceActive ? 'bg-amber-500 text-white' : 'bg-amber-100/70 text-amber-800'
                          }`}>
                            {idx + 1}
                          </span>
                          <span className={`text-base font-medium flex-1 ${
                            isSentenceActive ? 'text-amber-950 font-bold' : 'text-gray-800 group-hover:text-amber-950'
                          }`}>
                            {sent}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                          {/* 单句循环精听按钮 */}
                          <button
                            data-sfx="none"
                            onClick={() => void handlePlaySingleSentence(idx, true)}
                            className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                              isLooping
                                ? 'bg-amber-500 text-white shadow-sm ring-2 ring-amber-300'
                                : 'bg-amber-50 text-amber-700 hover:bg-amber-200 hover:text-amber-900'
                            }`}
                            title={isLooping ? '取消单句循环' : '单句循环精听'}
                          >
                            <Repeat className={`w-3.5 h-3.5 ${isLooping ? 'animate-spin' : ''}`} />
                          </button>

                          {/* 单句播放按钮 */}
                          <button
                            data-sfx="none"
                            onClick={() => void handlePlaySingleSentence(idx, false)}
                            className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm ${
                              isSentenceActive && isAudioPlaying && !isPauseForRepeating
                                ? 'bg-amber-500 text-white'
                                : 'bg-amber-100 text-amber-700 group-hover:bg-amber-500 group-hover:text-white'
                            }`}
                            title="播放这句原声"
                          >
                            <Volume2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 核心词汇列表 (带原声例句联动) */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-amber-950 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-amber-500" />
                    <span>本课核心词汇 ({lessonWords.length})</span>
                  </h3>
                  <span className="text-xs text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full font-medium">
                    点击听词汇清晰读音 · 星星加入生词本
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {lessonWords.map((wordObj) => (
                    <div
                      key={wordObj.word}
                      data-sfx="none"
                      onClick={() => void handlePlayWord(wordObj)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between hover:shadow-md hover:-translate-y-0.5 relative group ${
                        playingWord === wordObj.word
                          ? 'border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-400/50 scale-[1.02]'
                          : 'border-amber-100 bg-[#fefdfb] hover:border-amber-300'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1.5">
                        <span className="text-2xl">{wordObj.emoji}</span>
                        <div className="flex items-center gap-1">
                          <button
                            data-sfx="none"
                            onClick={(e) => void handleToggleFavorite(wordObj.word, e)}
                            className={`p-1 rounded-md transition-all ${
                              favorites.includes(wordObj.word.toLowerCase())
                                ? 'text-amber-500'
                                : 'text-gray-300 hover:text-amber-400 opacity-60 group-hover:opacity-100'
                            }`}
                            title={favorites.includes(wordObj.word.toLowerCase()) ? '从生词本移出' : '加入重点生词本'}
                          >
                            <Star className="w-3.5 h-3.5" fill={favorites.includes(wordObj.word.toLowerCase()) ? 'currentColor' : 'none'} />
                          </button>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            wordObj.track === 'phonics' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {wordObj.track === 'phonics' ? '拼读' : '高频'}
                          </span>
                        </div>
                      </div>

                      <div className="my-1">
                        <div className="font-bold text-lg text-gray-900 leading-tight">
                          {wordObj.word}
                        </div>
                        <div className="text-xs text-amber-700/80 font-mono mt-0.5">
                          {wordObj.ipa}
                        </div>
                        <div className="text-xs text-gray-600 font-medium mt-1">
                          {wordObj.zh}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-amber-50 flex items-center justify-between text-[11px] text-gray-400">
                        <span>全书 {wordObj.count} 次</span>
                        {playingWord === wordObj.word ? (
                          <span className="text-amber-600 font-bold text-[10px] animate-pulse">发音中</span>
                        ) : (
                          <Volume2 className="w-3.5 h-3.5 text-amber-500" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: 全部 245 词汇 */}
        {activeTab === 'words' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-amber-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                {(['all', 'phonics', 'sight', 'role'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      filterType === type
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'bg-amber-50 text-amber-900 hover:bg-amber-100'
                    }`}
                  >
                    {type === 'all' && '全部 (245)'}
                    {type === 'phonics' && '可拼读词'}
                    {type === 'sight' && '视觉高频词'}
                    {type === 'role' && '绘本角色名'}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="搜索英文单词或中文释义..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-amber-50/50 border border-amber-200/60 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {filteredWords.map((wordObj) => (
                <div
                  key={wordObj.word}
                  data-sfx="none"
                  onClick={() => void handlePlayWord(wordObj)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between hover:shadow-md hover:-translate-y-0.5 relative group ${
                    playingWord === wordObj.word
                      ? 'border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-400/50 scale-[1.02]'
                      : 'border-amber-100 bg-[#fefdfb] hover:border-amber-300'
                  }`}
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <span className="text-2xl">{wordObj.emoji}</span>
                    <div className="flex items-center gap-1">
                      <button
                        data-sfx="none"
                        onClick={(e) => void handleToggleFavorite(wordObj.word, e)}
                        className={`p-1 rounded-md transition-all ${
                          favorites.includes(wordObj.word.toLowerCase())
                            ? 'text-amber-500'
                            : 'text-gray-300 hover:text-amber-400 opacity-60 group-hover:opacity-100'
                        }`}
                        title={favorites.includes(wordObj.word.toLowerCase()) ? '从生词本移出' : '加入重点生词本'}
                      >
                        <Star className="w-3.5 h-3.5" fill={favorites.includes(wordObj.word.toLowerCase()) ? 'currentColor' : 'none'} />
                      </button>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        wordObj.track === 'phonics' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {wordObj.track === 'phonics' ? '拼读' : '高频'}
                      </span>
                    </div>
                  </div>

                  <div className="my-1">
                    <div className="font-bold text-lg text-gray-900 leading-tight">
                      {wordObj.word}
                    </div>
                    <div className="text-xs text-amber-700/80 font-mono mt-0.5">
                      {wordObj.ipa}
                    </div>
                    <div className="text-xs text-gray-600 font-medium mt-1">
                      {wordObj.zh}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-amber-50 flex items-center justify-between text-[11px] text-gray-400">
                    <span>{wordObj.lessons.length} 课出现</span>
                    {playingWord === wordObj.word ? (
                      <span className="text-amber-600 font-bold text-[10px] animate-pulse">发音中</span>
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-amber-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: 重点生词本 */}
        {activeTab === 'favorites' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-amber-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
                  <Star className="w-5 h-5 fill-current" />
                </div>
                <div>
                  <h3 className="font-bold text-amber-950 text-base">重点生词本</h3>
                  <p className="text-xs text-amber-800/70">
                    共标记了 {favoriteWordsList.length} 个难记词汇 · 集中攻克
                  </p>
                </div>
              </div>
            </div>

            {favoriteWordsList.length === 0 ? (
              <div className="bg-white rounded-3xl p-10 text-center border border-amber-100 shadow-sm max-w-lg mx-auto mt-6">
                <div className="text-4xl mb-3">⭐</div>
                <h4 className="text-lg font-bold text-amber-950 mb-1">重点生词本还是空的</h4>
                <p className="text-sm text-gray-500 mb-5 leading-relaxed">
                  在“按课文分课”或“全部词汇”中，点击任意单词卡片右上角的星星，把难记的词收藏到这里！
                </p>
                <button
                  onClick={() => setActiveTab('lessons')}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-sm transition-all"
                >
                  去课文中挑选生词
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {favoriteWordsList.map((wordObj) => (
                  <div
                    key={wordObj.word}
                    data-sfx="none"
                    onClick={() => void handlePlayWord(wordObj)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between hover:shadow-md hover:-translate-y-0.5 relative group ${
                      playingWord === wordObj.word
                        ? 'border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-400/50 scale-[1.02]'
                        : 'border-amber-200 bg-[#fffdfa] hover:border-amber-400'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-2xl">{wordObj.emoji}</span>
                      <div className="flex items-center gap-1">
                        <button
                          data-sfx="none"
                          onClick={(e) => void handleToggleFavorite(wordObj.word, e)}
                          className="p-1 rounded-md text-amber-500 hover:text-amber-600 transition-colors"
                          title="从生词本移出"
                        >
                          <Star className="w-4 h-4 fill-current" />
                        </button>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          wordObj.track === 'phonics' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                        }`}>
                          {wordObj.track === 'phonics' ? '拼读' : '高频'}
                        </span>
                      </div>
                    </div>

                    <div className="my-1.5">
                      <div className="font-bold text-lg text-gray-900 leading-tight">
                        {wordObj.word}
                      </div>
                      <div className="text-xs text-amber-700/80 font-mono mt-0.5">
                        {wordObj.ipa}
                      </div>
                      <div className="text-xs text-gray-600 font-medium mt-1">
                        {wordObj.zh}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-amber-50 flex items-center justify-between text-[11px] text-gray-400">
                      <span>{wordObj.lessons.length} 课出现</span>
                      {playingWord === wordObj.word ? (
                        <span className="text-amber-600 font-bold text-[10px] animate-pulse">发音中</span>
                      ) : (
                        <Volume2 className="w-3.5 h-3.5 text-amber-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: 闯关小练习 */}
        {activeTab === 'quiz' && (
          <div className="max-w-xl mx-auto space-y-6 pt-2">
            <div className="bg-white rounded-3xl p-6 shadow-md border border-amber-100 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-amber-600 uppercase tracking-wider block mb-1">
                  当前练习
                </span>
                <h3 className="text-xl font-extrabold text-amber-950">
                  {selectedLesson.title} 重点词通关
                </h3>
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-400 block mb-0.5">已答对题数</span>
                <span className="text-2xl font-black text-amber-600">{quizScore}</span>
              </div>
            </div>

            {/* Quiz Question Card */}
            <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-amber-100 text-center relative overflow-hidden">
              <span className="text-xs font-bold text-gray-400 block mb-3">
                第 {(quizQuestionIndex % quizPool.length) + 1} 题 / 共 {quizPool.length} 题
              </span>

              <div className="text-5xl sm:text-7xl mb-4 animate-bounce">
                {currentQuizItem.emoji}
              </div>

              <div className="text-2xl sm:text-4xl font-extrabold text-gray-900 tracking-tight mb-2 flex items-center justify-center gap-2">
                <span>{currentQuizItem.word}</span>
                <button
                  onClick={() => void handlePlayWord(currentQuizItem)}
                  className="p-1.5 rounded-full hover:bg-amber-100 text-amber-600 transition-colors"
                  title="听清晰发音"
                >
                  <Volume2 className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              </div>

              <p className="text-sm font-mono text-amber-700/80 mb-6">
                {currentQuizItem.ipa}
              </p>

              {/* Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                {quizOptions.map((opt) => {
                  const isChosen = quizAnswered === opt.word;
                  const isCorrectTarget = opt.word === currentQuizItem.word;

                  let style = 'bg-[#fffdfa] hover:bg-amber-50/80 border-amber-200 text-gray-800';
                  if (quizAnswered) {
                    if (isCorrectTarget) {
                      style = 'bg-emerald-500 text-white border-emerald-500 shadow-md scale-[1.02]';
                    } else if (isChosen) {
                      style = 'bg-rose-500 text-white border-rose-500 shadow-sm';
                    } else {
                      style = 'bg-gray-50 text-gray-400 border-gray-100 opacity-40';
                    }
                  }

                  return (
                    <button
                      key={opt.word}
                      disabled={!!quizAnswered}
                      onClick={() => handleQuizAnswer(opt.word)}
                      className={`p-4 rounded-2xl border-2 font-bold text-base transition-all flex items-center justify-center min-h-[58px] ${style}`}
                    >
                      {opt.zh}
                    </button>
                  );
                })}
              </div>

              {quizAnswered && (
                <div className="pt-2 animate-in fade-in slide-in-from-bottom-2">
                  <button
                    onClick={nextQuizQuestion}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold text-base py-3.5 rounded-2xl shadow-md transition-all flex items-center justify-center gap-2"
                  >
                    <span>下一题</span>
                    <span>→</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
export default DianfanPage;

import { useState, useMemo, useEffect, useRef } from 'react';
import { ArrowLeft, BookOpen, Volume2, Search, Sparkles, Award, Layers, Star, Turtle, Play, Square, SlidersHorizontal } from 'lucide-react';
import { DIANFAN_WORDS, DIANFAN_LESSONS, type DianfanWord } from '../data/dianfan-data.ts';
import { IconButton } from '../components/ui.tsx';
import { navigate } from '../app/router.ts';
import { audio, playEffect, toggleFavorite } from '../app/runtime.ts';
import { useAppStore, useParentStore } from '../app/store.ts';

// Global reference pool to prevent Chromium SpeechSynthesisUtterance GC bug
const activeUtterances = new Set<SpeechSynthesisUtterance>();
let voicesCache: SpeechSynthesisVoice[] = [];

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  const updateVoices = () => {
    voicesCache = window.speechSynthesis.getVoices();
  };
  updateVoices();
  window.speechSynthesis.onvoiceschanged = updateVoices;
}

export type SpeedMode = 'slow' | 'medium' | 'normal' | 'custom';

export const SPEED_CONFIG: Record<
  'slow' | 'medium' | 'normal',
  { label: string; icon: string; wordRate: number; sentenceRate: number; desc: string }
> = {
  slow: {
    label: '慢速',
    icon: '🐢',
    wordRate: 0.58,     // 现在的慢速改成更慢的速度：0.58x，拉长音节充分辨音
    sentenceRate: 0.62, // 句子 0.62x 从容慢读
    desc: '超慢精听，音素充分舒展',
  },
  medium: {
    label: '较慢',       // 优化文案为“较慢”
    icon: '🍃',
    wordRate: 0.70,     // 较慢改成现在慢速的速度：0.70x！
    sentenceRate: 0.74, // 句子 0.74x
    desc: '较慢舒适，字句清晰分明',
  },
  normal: {
    label: '标准',
    icon: '⚡',
    wordRate: 0.85,     // 标准流畅语速
    sentenceRate: 0.88, // 自然流利
    desc: '日常流利朗读',
  },
};

// Robust speech utterance helper with GC protection and auto-resume
function speakText(text: string, rate = 0.70) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = Math.max(0.5, Math.min(1.5, rate));
    utterance.pitch = 1.02; // 稍微增添亲和自然的音高

    const voices = voicesCache.length ? voicesCache : window.speechSynthesis.getVoices();
    const preferredVoice = voices.find((v) => 
      v.lang.startsWith('en') && (
        v.name.includes('Jenny') || v.name.includes('Natural') || v.name.includes('Aria') || 
        v.name.includes('Google US') || v.name.includes('Guy') || v.name.includes('Samantha')
      )
    ) || voices.find((v) => v.lang.startsWith('en-US')) || voices.find((v) => v.lang.startsWith('en'));

    if (preferredVoice) utterance.voice = preferredVoice;

    // Retain in set to prevent GC collection before playback ends
    activeUtterances.add(utterance);
    const release = () => { activeUtterances.delete(utterance); };
    utterance.onend = release;
    utterance.onerror = release;

    // Chromium needs a resume call before speak if queue was previously blocked
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('Speech synthesis error:', err);
  }
}

export function DianfanPage() {
  const [activeTab, setActiveTab] = useState<'lessons' | 'words' | 'favorites' | 'quiz'>('lessons');
  const [selectedLessonId, setSelectedLessonId] = useState<string>(DIANFAN_LESSONS[0]?.id || '1A-01');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'phonics' | 'sight' | 'role'>('all');
  const [playingWord, setPlayingWord] = useState<string | null>(null);
  const [playingSentence, setPlayingSentence] = useState<string | null>(null);
  const [isReadingAll, setIsReadingAll] = useState(false);

  // 重点生词本响应式数据
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

  // 播放速度档位控制，默认开启“慢速”，并持久化存储
  const [speedMode, setSpeedMode] = useState<SpeedMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dianfan_speed_mode') as SpeedMode;
      if (saved === 'custom' || (saved && saved in SPEED_CONFIG)) return saved;
    }
    return 'slow';
  });

  // 0.x 自定义语速状态（支持 0.45x ~ 1.20x 自由调节）
  const [customRate, setCustomRate] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = parseFloat(localStorage.getItem('dianfan_custom_rate') || '');
      if (!isNaN(saved) && saved >= 0.45 && saved <= 1.2) return saved;
    }
    return 0.65;
  });

  const [showSpeedPopover, setShowSpeedPopover] = useState(false);

  const stopReadingAllRef = useRef(false);

  // 计算当前生效的单词与句子语速
  const currentWordRate = speedMode === 'custom' ? customRate : SPEED_CONFIG[speedMode].wordRate;
  const currentSentenceRate = speedMode === 'custom'
    ? Math.min(1.2, Math.round(customRate * 1.05 * 100) / 100)
    : SPEED_CONFIG[speedMode].sentenceRate;
  const currentSpeedLabel = speedMode === 'custom'
    ? `自定义 ${customRate.toFixed(2)}x`
    : `${SPEED_CONFIG[speedMode].label} (${SPEED_CONFIG[speedMode].wordRate.toFixed(2)}x)`;

  // Quiz state
  const [quizQuestionIndex, setQuizQuestionIndex] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [quizAnswered, setQuizAnswered] = useState<string | null>(null);
  const [quizIsCorrect, setQuizIsCorrect] = useState<boolean | null>(null);

  const selectedLesson = useMemo(() => {
    return DIANFAN_LESSONS.find((l) => l.id === selectedLessonId) || DIANFAN_LESSONS[0]!;
  }, [selectedLessonId]);

  const lessonWords = useMemo(() => {
    const wordSet = new Set(selectedLesson.words);
    return DIANFAN_WORDS.filter((w) => wordSet.has(w.word));
  }, [selectedLesson]);

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

  // Generate quiz questions based on the current lesson or full vocab
  const quizPool = useMemo(() => {
    return lessonWords.length >= 4 ? lessonWords : DIANFAN_WORDS.slice(0, 30);
  }, [lessonWords]);

  const currentQuizItem = quizPool[quizQuestionIndex % quizPool.length]!;

  const quizOptions = useMemo(() => {
    const options = [currentQuizItem];
    const others = DIANFAN_WORDS.filter((w) => w.word !== currentQuizItem.word);
    // Shuffle and pick 3 wrong options
    const shuffled = [...others].sort(() => 0.5 - Math.random());
    options.push(...shuffled.slice(0, 3));
    return options.sort(() => 0.5 - Math.random());
  }, [currentQuizItem]);

  // Keep a periodic heartbeat to prevent Chrome SpeechSynthesis from timing out
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // 切换课文时停止全课连读
  useEffect(() => {
    stopReadingAllRef.current = true;
    setIsReadingAll(false);
  }, [selectedLessonId]);

  const content = useAppStore((state) => state.content);

  const handleSpeedChange = (mode: SpeedMode) => {
    setSpeedMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('dianfan_speed_mode', mode);
    }
    void playEffect('sfx#pop');
  };

  const handleCustomRateChange = (val: number) => {
    const clamped = Math.max(0.45, Math.min(1.2, Math.round(val * 100) / 100));
    setCustomRate(clamped);
    setSpeedMode('custom');
    if (typeof window !== 'undefined') {
      localStorage.setItem('dianfan_custom_rate', String(clamped));
      localStorage.setItem('dianfan_speed_mode', 'custom');
    }
  };

  const handlePlayWord = async (wordObj: DianfanWord, customOverrideRate?: number) => {
    if (playingWord || playingSentence) return;
    setPlayingWord(wordObj.word);

    const rate = customOverrideRate ?? currentWordRate;
    try {
      // 1. 检查是否存在预录制音频
      const matchedWord = content?.catalog.words.find((w) => w.word.toLowerCase() === wordObj.word.toLowerCase());
      if (matchedWord && audio.has(matchedWord.audio.word)) {
        await audio.unlock();
        await audio.play(matchedWord.audio.word, `dianfan:${wordObj.word}`, rate);
        return;
      }

      // 2. Web Speech API 慢速朗读
      speakText(wordObj.word, rate);
      // 自适应等待时长：慢速发音需要更长的保护时长，避免快速连点或提前结束状态
      const duration = Math.round(1100 / rate);
      await new Promise((r) => setTimeout(r, duration));
    } finally {
      setPlayingWord(null);
    }
  };

  const handlePlaySentence = async (sentence: string, customOverrideRate?: number) => {
    if (playingWord || playingSentence) return;
    setPlayingSentence(sentence);
    const rate = customOverrideRate ?? currentSentenceRate;
    try {
      speakText(sentence, rate);
      const wordCount = sentence.split(/\s+/).length;
      const duration = Math.max(1600, Math.round(wordCount * 520 / rate));
      await new Promise((r) => setTimeout(r, duration));
    } finally {
      setPlayingSentence(null);
    }
  };

  // 连续慢速朗读整篇课文
  const handleToggleReadEntireLesson = async () => {
    if (isReadingAll) {
      stopReadingAllRef.current = true;
      setIsReadingAll(false);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setPlayingSentence(null);
      return;
    }

    stopReadingAllRef.current = false;
    setIsReadingAll(true);
    const rate = currentSentenceRate;

    for (let i = 0; i < selectedLesson.sentences.length; i++) {
      if (stopReadingAllRef.current) break;
      const sent = selectedLesson.sentences[i]!;
      setPlayingSentence(sent);
      speakText(sent, rate);

      const wordCount = sent.split(/\s+/).length;
      const duration = Math.max(1600, Math.round(wordCount * 520 / rate));
      await new Promise((r) => setTimeout(r, duration));

      setPlayingSentence(null);
      if (stopReadingAllRef.current) break;
      // 句子间留白停顿，给孩子跟读缓冲时间
      await new Promise((r) => setTimeout(r, 900));
    }

    setIsReadingAll(false);
    setPlayingSentence(null);
  };

  const handleQuizAnswer = (optionWord: string) => {
    if (quizAnswered) return;
    setQuizAnswered(optionWord);
    const correct = optionWord === currentQuizItem.word;
    setQuizIsCorrect(correct);
    if (correct) {
      setQuizScore((s) => s + 1);
      void playEffect('sfx#chime_success');
    } else {
      void playEffect('sfx#pop');
      // 答错时自动以慢速温柔播放正确单词，强化记忆
      setTimeout(() => {
        speakText(currentQuizItem.word, currentWordRate);
      }, 500);
    }
  };

  const nextQuizQuestion = () => {
    setQuizAnswered(null);
    setQuizIsCorrect(null);
    setQuizQuestionIndex((i) => i + 1);
  };

  return (
    <div className="dianfan-container min-h-screen bg-[#fdfbf7] text-[#2c3e50] flex flex-col font-sans select-none">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-amber-100 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <IconButton label="返回主页" onClick={() => navigate('/themes')}>
            <ArrowLeft className="w-5 h-5" />
          </IconButton>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📚</span>
              <h1 className="text-lg font-bold text-amber-900 tracking-tight">典范英语 1A · 同步词汇天地</h1>
              <span className="text-xs bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded-full">
                牛津阅读树 42 课
              </span>
            </div>
            <p className="text-xs text-amber-700/70 hidden sm:block">
              42 个经典趣味小故事 · 245 个核心词汇与例句慢速朗读
            </p>
          </div>
        </div>

        {/* Speed Control & Tab Switcher */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* 语速选择器 */}
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
                  <span className="text-[10px] opacity-80">({cfg.wordRate}x)</span>
                </button>
              );
            })}

            {/* 可调 0.x 自由调节按钮 */}
            <button
              onClick={() => setShowSpeedPopover(!showSpeedPopover)}
              title="自由调节 0.x 倍速"
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 text-xs ml-0.5 ${
                speedMode === 'custom' || showSpeedPopover
                  ? 'bg-amber-600 text-white font-bold shadow-sm'
                  : 'text-amber-900 hover:bg-amber-100/70'
              }`}
            >
              <SlidersHorizontal className="w-3 h-3" />
              <span>{speedMode === 'custom' ? `${customRate.toFixed(2)}x` : '可调 0.x'}</span>
            </button>

            {/* 0.x 自由调节浮层 */}
            {showSpeedPopover && (
              <div className="absolute right-0 top-full mt-2 z-50 bg-white rounded-2xl shadow-xl border border-amber-200 p-3.5 w-72 text-amber-950 font-sans animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-xs flex items-center gap-1.5 text-amber-900">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-amber-600" />
                    <span>自定义语速 (0.x)</span>
                  </span>
                  <span className="text-amber-700 font-extrabold bg-amber-100 px-2 py-0.5 rounded-full text-xs">
                    {customRate.toFixed(2)}x
                  </span>
                </div>

                {/* 快捷 0.x 点选 */}
                <div className="grid grid-cols-6 gap-1 mb-2.5">
                  {[0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((rateVal) => (
                    <button
                      key={rateVal}
                      onClick={() => handleCustomRateChange(rateVal)}
                      className={`py-1 text-[11px] rounded-lg font-medium transition-all ${
                        speedMode === 'custom' && Math.abs(customRate - rateVal) < 0.02
                          ? 'bg-amber-500 text-white font-bold'
                          : 'bg-amber-50 hover:bg-amber-100 text-amber-900'
                      }`}
                    >
                      {rateVal.toFixed(1)}x
                    </button>
                  ))}
                </div>

                {/* 滑块微调 */}
                <div className="space-y-1 mb-2">
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>极慢 0.45x</span>
                    <span>舒适 0.70x</span>
                    <span>原速 1.10x</span>
                  </div>
                  <input
                    type="range"
                    min="0.45"
                    max="1.10"
                    step="0.05"
                    value={customRate}
                    onChange={(e) => handleCustomRateChange(Number(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer h-2 bg-amber-100 rounded-lg appearance-none"
                  />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-amber-100">
                  <button
                    onClick={() => speakText('Hello, happy reading!', customRate)}
                    className="text-[11px] text-amber-700 hover:text-amber-900 font-semibold flex items-center gap-1"
                  >
                    <Volume2 className="w-3 h-3" />
                    <span>试听当前语速</span>
                  </button>
                  <button
                    onClick={() => setShowSpeedPopover(false)}
                    className="text-[11px] bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold px-2.5 py-1 rounded-lg"
                  >
                    完成
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Tab Switcher */}
          <div className="flex items-center bg-amber-50 p-1 rounded-xl border border-amber-200/60 text-sm font-medium">
            <button
              onClick={() => setActiveTab('lessons')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'lessons' ? 'bg-amber-500 text-white shadow-sm font-bold' : 'text-amber-900 hover:bg-amber-100'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>按课文分课</span>
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

      {/* Main Content Areas */}
      <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full">
        {/* Tab 1: 按课文分课学习 */}
        {activeTab === 'lessons' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left/Top Lesson Picker */}
            <div className="lg:col-span-4 xl:col-span-3 bg-white rounded-2xl p-4 shadow-sm border border-amber-100 flex flex-col max-h-[78vh]">
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

            {/* Right Lesson Detail */}
            <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-6">
              {/* Lesson Banner */}
              <div className="bg-gradient-to-r from-amber-500 to-orange-400 rounded-3xl p-6 text-white shadow-md relative overflow-hidden">
                <div className="absolute right-4 -bottom-4 text-7xl opacity-20 pointer-events-none">📖</div>
                <div className="flex items-center gap-2 text-amber-100 text-sm font-semibold mb-1">
                  <span>Lesson {selectedLesson.id.replace('1A-', '')}</span>
                  <span>•</span>
                  <span>{selectedLesson.wordCount} 个重点单词</span>
                  <span>•</span>
                  <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">
                    当前语速: {currentSpeedLabel}
                  </span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2">
                  {selectedLesson.title}
                </h2>
                <p className="text-amber-100 text-xs sm:text-sm max-w-xl">
                  点击下方故事句子或单词卡片，练习纯正慢速美语朗读与清晰拆音。
                </p>
              </div>

              {/* Story Sentences */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h3 className="font-bold text-amber-950 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <span>故事原文句子</span>
                  </h3>
                  <div className="flex items-center gap-2">
                    {/* 一键全课连续慢读 */}
                    <button
                      onClick={handleToggleReadEntireLesson}
                      className={`text-xs px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shadow-sm ${
                        isReadingAll
                          ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse'
                          : 'bg-amber-100 hover:bg-amber-200 text-amber-900'
                      }`}
                      title={isReadingAll ? '点击停止连续朗读' : '按顺序慢读整篇课文并留出跟读空隙'}
                    >
                      {isReadingAll ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                      <span>{isReadingAll ? '停止朗读' : '连续慢读全文'}</span>
                    </button>
                    <span className="text-xs text-gray-400 hidden sm:inline">点击句子朗读</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {selectedLesson.sentences.map((sent, idx) => (
                    <div
                      key={idx}
                      data-sfx="none"
                      className={`group p-3 rounded-xl border transition-all flex items-center justify-between cursor-pointer ${
                        playingSentence === sent
                          ? 'bg-amber-100/90 border-amber-400 ring-2 ring-amber-300 shadow-sm'
                          : 'hover:bg-amber-50/70 border-transparent hover:border-amber-200'
                      }`}
                    >
                      <span
                        onClick={() => void handlePlaySentence(sent)}
                        className="text-base text-gray-800 font-medium group-hover:text-amber-950 flex-1 pr-2"
                      >
                        {sent}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {/* 极慢速重听按钮 (0.52x) */}
                        <button
                          data-sfx="none"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handlePlaySentence(sent, 0.52);
                          }}
                          className="w-8 h-8 rounded-full flex items-center justify-center transition-all bg-amber-50 text-amber-700 hover:bg-amber-200 hover:text-amber-900"
                          title="超慢速精听 (0.52x)"
                        >
                          <Turtle className="w-4 h-4" />
                        </button>
                        {/* 随语速播放按钮 */}
                        <button
                          data-sfx="none"
                          onClick={() => void handlePlaySentence(sent)}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm ${
                            playingSentence === sent
                              ? 'bg-amber-500 text-white'
                              : 'bg-amber-100 text-amber-700 group-hover:bg-amber-500 group-hover:text-white'
                          }`}
                          title="按当前速度朗读"
                        >
                          {playingSentence === sent ? (
                            <div className="flex items-end gap-0.5 h-3.5 px-0.5" title="正在播放">
                              <span className="w-0.5 bg-white rounded-full animate-[pulse_0.6s_infinite_ease-in-out]" style={{ height: '70%' }} />
                              <span className="w-0.5 bg-white rounded-full animate-[pulse_0.6s_infinite_ease-in-out_0.2s]" style={{ height: '100%' }} />
                              <span className="w-0.5 bg-white rounded-full animate-[pulse_0.6s_infinite_ease-in-out_0.4s]" style={{ height: '50%' }} />
                            </div>
                          ) : (
                            <Volume2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lesson Words Grid */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-amber-950 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-amber-500" />
                    <span>本课核心词汇 ({lessonWords.length})</span>
                  </h3>
                  <span className="text-xs text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full font-medium">
                    点击听清晰发音 · 右上角🐢极慢听
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
                          <button
                            data-sfx="none"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handlePlayWord(wordObj, 0.52);
                            }}
                            className="p-1 rounded-md text-amber-600 hover:bg-amber-100 opacity-60 group-hover:opacity-100 transition-opacity"
                            title="超慢速精听 (0.52x)"
                          >
                            <Turtle className="w-3.5 h-3.5" />
                          </button>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            wordObj.track === 'phonics' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {wordObj.track === 'phonics' ? '拼读' : '高频'}
                          </span>
                        </div>
                      </div>
                      <div>
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
                      <div className="mt-2 pt-2 border-t border-amber-50 flex items-center justify-between text-[11px] text-gray-400">
                        <span>全书 {wordObj.count} 次</span>
                        {playingWord === wordObj.word ? (
                          <span className="text-amber-600 font-bold text-[10px] animate-pulse">朗读中</span>
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

        {/* Tab 2: 全部 245 词汇大词典 */}
        {activeTab === 'words' && (
          <div className="flex flex-col gap-6">
            {/* Search and Filters */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-amber-100 flex flex-col sm:flex-row items-center justify-between gap-4">
              {/* Search Bar */}
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="搜索英文单词或中文含义..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-amber-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-amber-50/30"
                />
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto text-xs font-semibold">
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    filterType === 'all' ? 'bg-amber-500 text-white shadow-sm' : 'bg-amber-50 text-amber-900 hover:bg-amber-100'
                  }`}
                >
                  全部 ({DIANFAN_WORDS.length})
                </button>
                <button
                  onClick={() => setFilterType('phonics')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    filterType === 'phonics' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  }`}
                >
                  自然拼读词 ({DIANFAN_WORDS.filter((w) => w.track === 'phonics').length})
                </button>
                <button
                  onClick={() => setFilterType('sight')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    filterType === 'sight' ? 'bg-blue-600 text-white shadow-sm' : 'bg-blue-50 text-blue-800 hover:bg-blue-100'
                  }`}
                >
                  高频视觉词 ({DIANFAN_WORDS.filter((w) => w.track === 'sight' && !w.isRole).length})
                </button>
                <button
                  onClick={() => setFilterType('role')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    filterType === 'role' ? 'bg-purple-600 text-white shadow-sm' : 'bg-purple-50 text-purple-800 hover:bg-purple-100'
                  }`}
                >
                  牛津树主角 (4)
                </button>
              </div>
            </div>

            {/* Word Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
              {filteredWords.map((wordObj) => (
                <div
                  key={wordObj.word}
                  data-sfx="none"
                  onClick={() => void handlePlayWord(wordObj)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between hover:shadow-md hover:-translate-y-0.5 relative group ${
                    playingWord === wordObj.word
                      ? 'border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-400/50 scale-[1.02]'
                      : 'border-amber-100 bg-white hover:border-amber-300'
                  }`}
                >
                  <div className="flex items-start justify-between">
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
                      <button
                        data-sfx="none"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePlayWord(wordObj, 0.52);
                        }}
                        className="p-1 rounded-md text-amber-600 hover:bg-amber-100 opacity-60 group-hover:opacity-100 transition-opacity"
                        title="超慢速精听 (0.52x)"
                      >
                        <Turtle className="w-3.5 h-3.5" />
                      </button>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        wordObj.track === 'phonics' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {wordObj.track === 'phonics' ? '拼读' : '高频'}
                      </span>
                    </div>
                  </div>

                  <div className="my-2">
                    <div className="font-bold text-lg text-gray-900 leading-tight">
                      {wordObj.word}
                    </div>
                    <div className="text-xs text-amber-700/80 font-mono">
                      {wordObj.ipa}
                    </div>
                    <div className="text-xs text-gray-600 font-medium mt-1">
                      {wordObj.zh}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-amber-50 flex items-center justify-between text-[11px] text-gray-400">
                    <span>{wordObj.lessons.length} 课出现</span>
                    {playingWord === wordObj.word ? (
                      <span className="text-amber-600 font-bold text-[10px] animate-pulse">朗读中</span>
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-amber-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: 重点生词本 */}
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
                    共标记了 {favoriteWordsList.length} 个难记词汇 · 集中攻克慢速精听
                  </p>
                </div>
              </div>

              {favoriteWordsList.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full font-medium">
                    语速: {currentSpeedLabel}
                  </span>
                </div>
              )}
            </div>

            {favoriteWordsList.length === 0 ? (
              <div className="bg-white rounded-3xl p-10 text-center border border-amber-100 shadow-sm max-w-lg mx-auto mt-6">
                <div className="text-4xl mb-3">⭐</div>
                <h4 className="text-lg font-bold text-amber-950 mb-1">重点生词本还是空的</h4>
                <p className="text-sm text-gray-500 mb-5 leading-relaxed">
                  在“按课文分课”或“全部词汇”中，点击任意单词卡片右上角的星星，把易混淆或难记的词收藏到这里，随时集中攻克！
                </p>
                <button
                  onClick={() => setActiveTab('lessons')}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-sm transition-all"
                >
                  去课文中挑选生词
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
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
                        <button
                          data-sfx="none"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handlePlayWord(wordObj, 0.52);
                          }}
                          className="p-1 rounded-md text-amber-600 hover:bg-amber-100 opacity-60 group-hover:opacity-100 transition-opacity"
                          title="超慢速精听 (0.52x)"
                        >
                          <Turtle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="my-2">
                      <div className="font-bold text-lg text-gray-900 leading-tight">
                        {wordObj.word}
                      </div>
                      <div className="text-xs text-amber-700/80 font-mono">
                        {wordObj.ipa}
                      </div>
                      <div className="text-xs text-gray-700 font-medium mt-1">
                        {wordObj.zh}
                      </div>
                      {wordObj.example && (
                        <div className="text-[11px] text-gray-400 italic mt-1 line-clamp-1">
                          “{wordObj.example}”
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-amber-50 flex items-center justify-between text-[11px] text-gray-400">
                      <span>{wordObj.lessons.length} 课出现</span>
                      {playingWord === wordObj.word ? (
                        <span className="text-amber-600 font-bold text-[10px] animate-pulse">朗读中</span>
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

        {/* Tab 3: 闯关小练习 */}
        {activeTab === 'quiz' && (
          <div className="max-w-xl mx-auto bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-amber-100 flex flex-col items-center text-center">
            <div className="flex items-center justify-between w-full mb-6">
              <span className="text-xs font-bold text-amber-700 bg-amber-50 px-3 py-1 rounded-full">
                第 {quizQuestionIndex + 1} 题
              </span>
              <div className="flex items-center gap-1.5 text-amber-500 font-bold text-sm">
                <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                <span>得分: {quizScore}</span>
              </div>
            </div>

            {/* Target word prompt */}
            <div className="text-5xl mb-3">{currentQuizItem.emoji}</div>
            <div className="text-sm text-gray-500 mb-1">这个单词的意思是：</div>
            <div className="text-2xl sm:text-3xl font-extrabold text-amber-950 mb-4">
              "{currentQuizItem.zh}"
            </div>

            <button
              onClick={() => speakText(currentQuizItem.word, currentWordRate)}
              className="inline-flex items-center gap-2 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-semibold px-4 py-2 rounded-full mb-6 transition-all"
            >
              <Volume2 className="w-4 h-4" />
              <span>听发音线索 ({speedMode === 'custom' ? `${customRate.toFixed(2)}x` : SPEED_CONFIG[speedMode].label})</span>
            </button>

            {/* 4 Options Grid */}
            <div className="grid grid-cols-2 gap-3 w-full mb-6">
              {quizOptions.map((opt) => {
                const isSelected = quizAnswered === opt.word;
                const isRight = opt.word === currentQuizItem.word;
                let btnStyle = 'border-amber-100 bg-[#fefdfb] hover:border-amber-300 text-gray-800';

                if (quizAnswered) {
                  if (isRight) {
                    btnStyle = 'border-emerald-500 bg-emerald-50 text-emerald-800 font-bold ring-2 ring-emerald-300';
                  } else if (isSelected) {
                    btnStyle = 'border-rose-400 bg-rose-50 text-rose-800 ring-2 ring-rose-200';
                  } else {
                    btnStyle = 'opacity-40 border-gray-100';
                  }
                }

                return (
                  <button
                    key={opt.word}
                    disabled={Boolean(quizAnswered)}
                    onClick={() => handleQuizAnswer(opt.word)}
                    className={`p-4 rounded-2xl border text-lg font-bold transition-all flex flex-col items-center justify-center gap-1 ${btnStyle}`}
                  >
                    <span>{opt.word}</span>
                    <span className="text-xs font-normal opacity-70 font-mono">{opt.ipa}</span>
                  </button>
                );
              })}
            </div>

            {/* Next Button */}
            {quizAnswered && (
              <div className="w-full flex flex-col items-center gap-2 animate-fadeIn">
                <div className={`text-sm font-bold ${quizIsCorrect ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {quizIsCorrect ? '🎉 太棒了，答对啦！' : `💡 正确答案是: ${currentQuizItem.word} (${currentQuizItem.zh})`}
                </div>
                <button
                  onClick={nextQuizQuestion}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold shadow-md hover:shadow-lg transition-all text-base mt-2"
                >
                  下一题
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

import { useState, useMemo, useEffect } from 'react';
import { ArrowLeft, BookOpen, Volume2, Search, Sparkles, Award, Layers, Star } from 'lucide-react';
import { DIANFAN_WORDS, DIANFAN_LESSONS, type DianfanWord } from '../data/dianfan-data.ts';
import { IconButton } from '../components/ui.tsx';
import { navigate } from '../app/router.ts';
import { audio, playEffect } from '../app/runtime.ts';
import { useAppStore } from '../app/store.ts';

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

// Robust speech utterance helper with GC protection and auto-resume
function speakText(text: string, rate = 0.85) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = rate;

    const voices = voicesCache.length ? voicesCache : window.speechSynthesis.getVoices();
    const preferredVoice = voices.find((v) => 
      v.lang.startsWith('en') && (v.name.includes('Jenny') || v.name.includes('Aria') || v.name.includes('Natural') || v.name.includes('Google US'))
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
  const [activeTab, setActiveTab] = useState<'lessons' | 'words' | 'quiz'>('lessons');
  const [selectedLessonId, setSelectedLessonId] = useState<string>(DIANFAN_LESSONS[0]?.id || '1A-01');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'phonics' | 'sight' | 'role'>('all');
  const [playingWord, setPlayingWord] = useState<string | null>(null);
  const [playingSentence, setPlayingSentence] = useState<string | null>(null);

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

  const content = useAppStore((state) => state.content);

  const handlePlayWord = async (wordObj: DianfanWord) => {
    if (playingWord || playingSentence) return; // 播放完成前完全忽略后续连击
    setPlayingWord(wordObj.word);

    try {
      // 1. Check if this word exists in pre-recorded high quality audio sprites
      const matchedWord = content?.catalog.words.find((w) => w.word.toLowerCase() === wordObj.word.toLowerCase());
      if (matchedWord && audio.has(matchedWord.audio.word)) {
        await audio.unlock();
        await audio.play(matchedWord.audio.word, `dianfan:${wordObj.word}`);
        return;
      }

      // 2. Fallback to robust Web Speech API
      speakText(wordObj.word);
      await new Promise((r) => setTimeout(r, 850));
    } finally {
      setPlayingWord(null);
    }
  };

  const handlePlaySentence = async (sentence: string) => {
    if (playingWord || playingSentence) return; // 播放完成前完全忽略后续连击
    setPlayingSentence(sentence);
    try {
      speakText(sentence, 0.88);
      const wordCount = sentence.split(/\s+/).length;
      await new Promise((r) => setTimeout(r, Math.max(1200, wordCount * 380)));
    } finally {
      setPlayingSentence(null);
    }
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
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-amber-100 px-4 py-3 flex items-center justify-between shadow-sm">
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
              42 个经典趣味小故事 · 245 个核心词汇与例句朗读
            </p>
          </div>
        </div>

        {/* Tab switcher */}
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
            onClick={() => setActiveTab('quiz')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'quiz' ? 'bg-amber-500 text-white shadow-sm font-bold' : 'text-amber-900 hover:bg-amber-100'
            }`}
          >
            <Award className="w-4 h-4" />
            <span>闯关小练习</span>
          </button>
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
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2">
                  {selectedLesson.title}
                </h2>
                <p className="text-amber-100 text-xs sm:text-sm max-w-xl">
                  点击下方故事句子或单词卡片，练习纯正美语朗读与自然拼读拆音。
                </p>
              </div>

              {/* Story Sentences */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-amber-950 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <span>故事原文句子</span>
                  </h3>
                  <span className="text-xs text-gray-400">点击小喇叭朗读全句</span>
                </div>
                <div className="space-y-2">
                  {selectedLesson.sentences.map((sent, idx) => (
                    <div
                      key={idx}
                      data-sfx="none"
                      onClick={() => void handlePlaySentence(sent)}
                      className={`group p-3 rounded-xl border transition-all flex items-center justify-between cursor-pointer ${
                        playingSentence === sent
                          ? 'bg-amber-100/80 border-amber-400 ring-2 ring-amber-300'
                          : 'hover:bg-amber-50/70 border-transparent hover:border-amber-200'
                      }`}
                    >
                      <span className="text-base text-gray-800 font-medium group-hover:text-amber-950">
                        {sent}
                      </span>
                      <button
                        data-sfx="none"
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm shrink-0 ml-3 ${
                          playingSentence === sent
                            ? 'bg-amber-500 text-white animate-pulse'
                            : 'bg-amber-100 text-amber-700 opacity-70 group-hover:opacity-100 group-hover:bg-amber-500 group-hover:text-white'
                        }`}
                        title="朗读句子"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
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
                  <span className="text-xs text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full font-medium">
                    点击单词听清晰发音
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {lessonWords.map((wordObj) => (
                    <div
                      key={wordObj.word}
                      data-sfx="none"
                      onClick={() => void handlePlayWord(wordObj)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between hover:shadow-md hover:-translate-y-0.5 ${
                        playingWord === wordObj.word
                          ? 'border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-400/50 scale-[1.02]'
                          : 'border-amber-100 bg-[#fefdfb] hover:border-amber-300'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1.5">
                        <span className="text-2xl">{wordObj.emoji}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          wordObj.track === 'phonics' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                        }`}>
                          {wordObj.track === 'phonics' ? '拼读' : '高频'}
                        </span>
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
                        <Volume2 className="w-3.5 h-3.5 text-amber-500" />
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
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between hover:shadow-md hover:-translate-y-0.5 ${
                    playingWord === wordObj.word
                      ? 'border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-400/50 scale-[1.02]'
                      : 'border-amber-100 bg-white hover:border-amber-300'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-2xl">{wordObj.emoji}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      wordObj.track === 'phonics' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                    }`}>
                      {wordObj.track === 'phonics' ? '拼读' : '高频'}
                    </span>
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
                    <Volume2 className="w-3.5 h-3.5 text-amber-500" />
                  </div>
                </div>
              ))}
            </div>
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
              onClick={() => speakText(currentQuizItem.word)}
              className="inline-flex items-center gap-2 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-semibold px-4 py-2 rounded-full mb-6 transition-all"
            >
              <Volume2 className="w-4 h-4" />
              <span>听发音线索</span>
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

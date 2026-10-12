import { useMemo, useState } from 'react';
import { RotateCcw, Volume2 } from 'lucide-react';
import { Button } from '../components/ui.tsx';
import { checkSpelling, shuffle, spellingTiles, type ChoiceQuestion, type ListeningQuestion, type SpellingQuestion } from './quiz.ts';
import type { TextbookWordEntry } from '../data/content-schema.ts';

const panel = 'rounded-3xl bg-white p-5 shadow-sm ring-1 ring-amber-100';
const option = 'min-h-16 rounded-2xl border-2 border-amber-100 bg-white px-4 text-xl font-semibold text-stone-700 transition-colors disabled:opacity-60';

export function PromptPanel({ children }: { children: React.ReactNode }) {
  return <div className={`${panel} flex min-h-32 items-center justify-center text-center`}>{children}</div>;
}

export function PromptText({ children }: { children: React.ReactNode }) {
  return <p className="text-4xl font-bold text-stone-800">{children}</p>;
}

export function ListenButton({ label = '再听一遍', onPlay }: { label?: string; onPlay: () => void }) {
  return <Button className="quiet" onClick={onPlay}><Volume2 size={18} />{label}</Button>;
}

export function ChoiceCard({ question, disabled, chosen, onAnswer }: {
  question: ChoiceQuestion | ListeningQuestion; disabled?: boolean; chosen?: string | null; onAnswer: (value: string) => void;
}) {
  return <div className="grid grid-cols-2 gap-3">
    {question.options.map((value) => <button key={value} type="button" disabled={disabled} onClick={() => onAnswer(value)}
      className={`${option} ${chosen === value ? 'border-amber-400 bg-amber-50' : ''}`}>{value}</button>)}
  </div>;
}

// 拼写：单词是单个字母，短语是词元；点击摆放，可撤销或清空。
export function SpellingCard({ question, disabled, onAnswer }: { question: SpellingQuestion; disabled?: boolean; onAnswer: (value: string) => void }) {
  const tiles = useMemo(() => shuffle(spellingTiles(question.word)), [question]);
  const [placed, setPlaced] = useState<number[]>([]);
  const remaining = tiles.map((_, index) => index).filter((index) => !placed.includes(index));
  const typed = placed.map((index) => tiles[index]!).join(question.word.kind === 'phrase' ? ' ' : '');
  const accepted = checkSpelling(typed, question.answer);
  return <div className="flex flex-col gap-4">
    <div className={`${panel} min-h-20 text-center text-3xl font-bold text-stone-800`}>{placed.length ? typed : <span className="text-stone-300">点下面的图块拼出来</span>}</div>
    <div className="flex flex-wrap justify-center gap-2">
      {remaining.map((index) => <button key={index} type="button" disabled={disabled} onClick={() => setPlaced((current) => [...current, index])}
        className="min-h-16 min-w-16 rounded-2xl border-2 border-amber-100 bg-white px-4 text-2xl font-bold text-stone-700">{tiles[index]}</button>)}
    </div>
    <div className="button-row">
      <Button className="quiet" disabled={!placed.length} onClick={() => setPlaced((current) => current.slice(0, -1))}><RotateCcw size={18} />撤销</Button>
      <Button className="primary" disabled={!placed.length || disabled} onClick={() => onAnswer(typed)}>{accepted ? '检查' : '检查'}</Button>
    </div>
  </div>;
}

// 翻卡自评：正面只给英文与读音，翻到背面看中文和例句后自己判断。
export function FlipCard({ word, onPlay, onGrade }: { word: TextbookWordEntry; onPlay: () => void; onGrade: (grade: 'again' | 'good') => void }) {
  const [revealed, setRevealed] = useState(false);
  return <div className="flex flex-col gap-4">
    <div className={`${panel} flex flex-col items-center gap-3 py-8`}>
      <div className="text-5xl" aria-hidden="true">{word.illustration.type === 'emoji' ? word.illustration.value : '🔤'}</div>
      <p className="text-4xl font-bold text-stone-800">{word.word}</p>
      <p className="text-lg text-stone-500">{word.ipa}</p>
      {revealed && <><p className="text-2xl font-semibold text-amber-700">{word.definition.zh}</p>
        <p className="text-base text-stone-500">{word.example.en} · {word.example.zh}</p></>}
    </div>
    <div className="button-row">
      <ListenButton onPlay={onPlay} />
      {revealed
        ? <><Button onClick={() => onGrade('again')}>还要再练</Button><Button className="primary" onClick={() => onGrade('good')}>记住了</Button></>
        : <Button className="primary" onClick={() => setRevealed(true)}>翻过来看看</Button>}
    </div>
  </div>;
}

export function SessionResult({ answered, correct, coins, onDone }: { answered: number; correct: number; coins: number; onDone: () => void }) {
  const percent = answered ? Math.round(correct / answered * 100) : 0;
  return <div className={`${panel} flex flex-col items-center gap-4 py-10 text-center`}>
    <div className="text-5xl" aria-hidden="true">{percent >= 80 ? '🌟' : '💪'}</div>
    <h1 className="text-3xl font-bold text-stone-800">这一轮练完了</h1>
    <p className="text-lg text-stone-600">答对 {correct} / {answered} 个，正确率 {percent}%。</p>
    <p className="text-lg text-amber-700">🪙 本轮赚到 {coins} 枚金币</p>
    <p className="text-base text-stone-500">明天到期的词会再来找你。</p>
    <Button className="primary" onClick={onDone}>回到课本复习</Button>
  </div>;
}

import { Bird, Crown, Diamond, Fish, Flower, Heart, Leaf, LockKeyhole, Moon, Mountain, Rabbit, Rainbow, Rocket, Shell, Sparkles, Star, Sun, TreeDeciduous } from 'lucide-react';
import { explorationRoute } from '../app/runtime.ts';
import { navigate } from '../app/router.ts';
import { useAppStore } from '../app/store.ts';
import { GuideBubble, Header } from '../components/ui.tsx';
import { WORDS_PER_STICKER } from '../domain/stickers.ts';

const STICKERS = [
  ['小叶子', Leaf], ['暖太阳', Sun], ['小星星', Star], ['小鱼儿', Fish], ['小鸟儿', Bird], ['小花朵', Flower],
  ['小贝壳', Shell], ['小爱心', Heart], ['彩虹桥', Rainbow], ['小兔子', Rabbit], ['小火箭', Rocket], ['小皇冠', Crown],
  ['大树朋友', TreeDeciduous], ['小山峰', Mountain], ['弯月亮', Moon], ['小宝石', Diamond], ['点点星光', Sparkles],
] as const;
export function StickerBook() {
  const state = useAppStore(); const content = state.content;
  const awarded = new Set(state.stickers.map((reward) => reward.milestone));
  const availableWords = new Set(content?.catalog.themes.flatMap((theme) => theme.listenTapWordIds) ?? []);
  const count = Math.max(Math.floor(availableWords.size / WORDS_PER_STICKER), ...awarded, 0);
  return <><Header back={() => navigate(explorationRoute())} /><main className="sticker-page"><div className="sticker-heading"><div><div className="eyebrow">LITTLE DISCOVERIES TO KEEP</div><h1>把小小发现，收进贴纸册</h1></div><span className="sticker-count">已收集 {state.stickers.length} 枚</span></div>
    <div className="sticker-grid">{Array.from({ length: count }, (_, index) => {
      const [name, Icon] = STICKERS[index % STICKERS.length]!; const earned = awarded.has(index + 1);
      return <div className={`sticker-tile ${earned ? 'earned' : 'waiting'} sticker-tone-${index % 4}`} key={index} role="img" aria-label={`第 ${index + 1} 枚${name}，${earned ? '已收集' : '等待发现'}`}>
        <Icon aria-hidden="true" /><span>{earned ? name : '等待小小发现'}</span>{!earned && <LockKeyhole className="sticker-lock" />}
      </div>;
    })}</div><GuideBubble>慢慢听，慢慢发现。每一份进步都值得珍藏。</GuideBubble>
  </main></>;
}

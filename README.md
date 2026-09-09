# 🌟 Webster Kids English (W-English)
### 🎈 韦氏儿童英语 Web 学习平台

专为 **4～9 岁低幼及小学低年级儿童（Pre-K 至 Grade 3）** 量身打造的趣味英语词汇、自然拼读与多感官探索 Web 应用。

---

## 🎯 项目核心理念

1. **告别古版字典陷阱**：拒绝 1913 年古董公版韦氏大词典晦涩难懂的学术释义，采用大模型技术重构符合儿童认知（CEFR Pre-A1/A1）的“现代韦氏儿童词典风格”简易释义。
2. **多感官场景探索**：摒弃成人键盘输入与 A-Z 抽象检索，通过**主题大地图（动物、食物、自然、学校）**、**可点触插画**和**清脆音效**引导孩子主动探秘。
3. **自然拼读强化（Phonics Blender）**：每个词汇拆解为可单独发音的音素气球，强化音形对应与自主拼读直觉。
4. **正向游戏化激励**：星星收集、小怪兽喂食、贴纸手帐、听音辨图，让孩子在玩耍中无痛习得核心高频词（Dolch / Fry Sight Words）。

---

## 📂 项目结构

```text
w-english/
├── docs/
│   └── PROJECT_PLAN.md      # 📑 完整系统规划方案（架构、教学法、实施路线图）
├── data/
│   └── sample_words.json    # 🎨 儿童词汇标准格式与自然拼读样例数据
├── .gitignore               # Git 忽略配置
└── README.md                # 本文档
```

---

## 📖 详细规划方案

完整的技术架构、儿童交互设计规范（UI/UX）、数据管道与研发里程碑请查阅：
👉 **[完整项目规划方案 (docs/PROJECT_PLAN.md)](./docs/PROJECT_PLAN.md)**

---

## 🛠️ 推荐技术栈

- **前端架构**：Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **动效引擎**：Framer Motion + Canvas Confetti
- **音频引擎**：Howler.js (Audio Sprites) + Microsoft Edge-TTS (`en-US-AnaNeural`)
- **离线存储**：IndexedDB (Dexie.js) / LocalStorage
- **字体规范**：Fredoka / Nunito / Quicksand（圆润童趣）

---

## 🚀 快速开始（规划开发阶段）

```bash
# 克隆仓库
git clone https://github.com/mystudy-hub/w-english.git
cd w-english

# 查看规划文档
cat docs/PROJECT_PLAN.md
```

---

## 📜 许可协议

MIT License

# 🌟 Webster Kids English (W-English)
### 🎈 韦氏儿童英语 Web 学习平台

专为 **4～9 岁低幼及小学低年级儿童（Pre-K 至 Grade 3）** 量身打造的趣味英语词汇、自然拼读与多感官探索 Web 应用。

---

## 🎯 项目核心理念

1. **告别古版字典陷阱**：拒绝 1913 年古董公版韦氏大词典晦涩难懂的学术释义，采用大模型技术重构符合儿童认知（CEFR Pre-A1/A1）的“现代韦氏儿童词典风格”简易释义。
2. **多感官场景探索**：摒弃成人键盘输入与 A-Z 抽象检索，通过**主题大地图（动物、食物、自然、学校）**、**可点触插画**和**清脆音效**引导孩子主动探秘。
3. **自然拼读强化（Phonics Blender）**：可拼读词按"字母组合 → 音素"拆成气球，双写辅音只发一次音、不发音字母不发音、consonant-le 整体教学；不可拼读的高频词（Dolch / Fry）走整词识别通道，不进拼读气球。
4. **正向游戏化激励**：星星记录"听过 + 选择"等参与行为，学习记录区分探索、完整听音、首次答对和间隔至少 24 小时的复习答对。

当前是一个**三专区应用**（2026-10-11 完成 Stage 4 双轨道合并，2026-10-15 补齐素材层）：

- **explore** 轨道（4~9 岁）：100 词、三个场景、卡片与亲子提示、听音选图、拼读、点选/拖拽拼字母、解锁与贴纸、休息提醒、家长统计、学习记录清除和离线管理。
- **drill** 轨道（9~10 岁）：译林版新编 4A 课本复习，8 个单元 172 条词、SM-2 间隔复习、五种题型、金币与连击、多孩子档案、学习报告页、旧应用记录导入。
- **典范英语 1A 专区**：牛津阅读树 42 课，官方原版英国录音（跟读留白 / 连贯磨音两种模式）、逐句点听与单句循环、原生变速不变调、绘本封面与 245 个分课词汇。

素材与审批已全量落地：272 个词条都有 SVG 插图与录音（1409 个音频片段，ASR 回读 829/829 通过），模型辅助审批链写入两个台账；窗口交接、数据库迁移、内容更新回退与分批素材审核工具均已实现。

本地通过 **239 项单元测试**与 **45 项浏览器测试**（`npm run test:e2e` 全绿，带语音与无语音两种内容包都验证过）；类型检查、lint、内容与素材校验（`--preview` 与正式）、预览与发布构建均通过。`npm run build:release` 现在可以放行：272 个词条全部 `audio_approved`。完整现状、验证证据、未完成项与风险见 [开发状态（交接说明）](./docs/DEVELOPMENT_STATUS.md)；逐项证据与未满足的交付条件见 [规格核对记录](./docs/qa/SPEC_AUDIT_2026-09-12.md)。剩余的是真机验收（iPad/Android）与部署，不含内容缺口。

---

## 📂 项目结构

```text
w-english/
├── docs/
│   ├── PROJECT_PLAN.md          # v2.4 范围、架构与阶段计划
│   ├── IMPLEMENTATION_SPEC.md   # 配置、页面、游戏、数据、音频与离线协议
│   ├── STAGE4_TASKS.md          # 双轨道合并与素材层的逐项进度、里程碑
│   ├── DEVELOPMENT_STATUS.md    # 已实现内容、验证证据和剩余工作
│   ├── AUDIO_WORKFLOW.md        # 真实录音接入、精灵生产、审批指纹
│   └── RESEARCH_NOTES.md        # 官方资料、查阅结果和选型依据
├── src/                        # 页面、规则、Dexie、音频与内容包服务
│   ├── core/srs/               # SM-2 内核与每日会话构建（自 memoryApp 移植）
│   └── drill/                  # 课本轨道：出题、会话、卡片、单元首页
├── assets/illustrations/        # 269 张 SVG 插图（100 探索 + 169 课本），台账登记来源与许可
├── data/
│   ├── sample_words.json        # 5 词结构示例，不直接并入首批词库
│   ├── stage0_words.json        # 10 个 CVC 候选词（历史阶段，仍为 draft）
│   ├── stage0_theme.json        # 动物之家场景、两页各 5 词、活动白名单
│   ├── catalog.json             # 活动阶段与源文件入口
│   ├── stage1_words.json        # 20 个 CVC 草稿
│   ├── stage1_theme.json        # 四页场景和易混淆图片排除表
│   ├── stage2_words.json        # 当前活动目录的 100 个词（已审批）
│   ├── stage2_*.json            # 三场景，分别 34 / 33 / 33 词
│   ├── illustration-licenses.json # 图形来源、许可、文件指纹
│   ├── content-approvals.json   # 文本/图片审批（272 条，模型辅助）
│   ├── audio-approvals.json     # 最终音频审批（1409 条，指纹绑定）
│   └── textbook/                # 课本轨道：catalog.json、8 个单元的词条与单元配置、旧 id 映射
├── scripts/
│   ├── validate-words.mjs        # 共用 Zod 契约与场景检查
│   ├── build-content.mjs         # 哈希清单、预览/发布内容包
│   ├── validate-assets.mjs       # 文件、精灵和审批校验
│   ├── pack-audio.mjs            # 全量/按场景/按精灵的 WAV 打包与原子合并
│   ├── review-inventory.mjs      # 生成独立离线素材审核页
│   ├── import-review.mjs         # 验证并导入审核结果，保留源文件备份
│   ├── ai-review.mjs             # 逐词模型复核：提示生成 → 裁决 → 白名单修补 → 审批记录
│   ├── generate_audio.py         # edge-tts 批量生成 24kHz 单声道 WAV 源
│   ├── asr_verify.py             # faster-whisper 回读校验最终切片
│   └── record-audio-approvals.mjs # 把 ASR 结果写成带指纹的音频审批
├── public/content/              # 构建产出的内容包（不入库）：单元音频、精灵、插图
├── audio-source/                # 未提交的录音源（生成或真人录制）
├── artifacts/                   # 未提交的中间产物：音频精灵索引、ASR 报告、审核页
├── tests/                       # 规则、事务、媒体工具与浏览器测试
├── .github/workflows/ci.yml      # 工程 CI，不自动发布草稿
├── package.json
├── package-lock.json
├── .gitignore               # Git 忽略配置
└── README.md                # 本文档
```

---

## 📖 详细规划方案

建议按以下顺序阅读：

1. [开发状态](./docs/DEVELOPMENT_STATUS.md)：当前实现、验证证据、未完成项与风险（先读这份）。
2. [项目计划](./docs/PROJECT_PLAN.md)：整体范围、架构与阶段边界。
3. [实施规格](./docs/IMPLEMENTATION_SPEC.md)：配置组合、题目状态、数据事务、音频协议与离线更新，§13 为双轨道与多档案。
4. [Stage 4 任务清单](./docs/STAGE4_TASKS.md)：逐任务进度、复核点与剩余里程碑。
5. [音频与审批工作流](./docs/AUDIO_WORKFLOW.md)：素材生产、精灵打包、指纹审批与模型辅助替代听审的链路。
6. [资料核对记录](./docs/RESEARCH_NOTES.md)：官方文档和维护者资料。

---

## 🛠️ 推荐技术栈

- **前端架构**：Node 24 LTS + Vite 8 + React 18.3.1 + TypeScript + Tailwind CSS 4（纯客户端静态站）
- **离线**：vite-plugin-pwa / Workbox `injectManifest`，独立内容包校验与等待更新
- **动效**：轻量 CSS 动效，尊重家长与系统减少动态效果设置
- **音频引擎**：Howler.js 播放单元精灵；语音由 edge-tts 生成（`audio:generate`），最终切片用 faster-whisper 回读校验（`audio:asr`）
- **学习存储**：IndexedDB（Dexie schema 3 / 原生 30，十一张表，含 `profiles`/`srsProgress`/`dailyLogs`）；不依赖账户或云端同步
- **字体规范**：本地 Nunito + 系统中文字体
- **目标设备**：10 英寸平板横屏（设计基准 960×600）；手机横屏等更小屏幕会把界面等比缩小到刚好放下，不再要求旋转；手机竖屏仍提示横过来。Safari/iPadOS 16.4、Chrome 111 为待验证最低目标

精确依赖已保存到 package-lock.json，本地基线为 Node 24.19.0 / npm 11.17.0；已验证干净安装。CI 使用相同 Node/npm 组合，CI 的远端运行和真实设备结果仍需分别取得证据。

---

## 🚀 本地运行

```bash
# 克隆仓库
git clone https://github.com/mystudy-hub/w-english.git
cd w-english

npm ci
npm run dev
```

开发地址为 `http://127.0.0.1:5173`。`predev` 会生成预览内容包。PowerShell 中如 npm.ps1 受环境限制，可使用相同安装的 `npm.cmd`。

离线测试必须使用生产形式的预览构建：

```bash
npm run build:preview
npm run preview
```

预览地址为 `http://127.0.0.1:4173`。本机若已运行过 `npm run audio:generate` 与 `npm run audio:pack`，预览包会带全部语音；在干净检出（无 `audio-source/`）上构建则得到 0 语音的包，界面会如实显示“图片已保存，语音待准备”。真实 Service Worker 的离线声音、分段请求、缓存修复及多窗口等待更新已有测试信号验证；可读性、安全区、PCM 与解码检查见 [验证记录](./docs/qa/ENGINEERING_2026-09-12.md)。

## ✅ 检查与素材生产

```bash
npm run validate:content
npm run typecheck
npm run lint
npm test
npm run build:preview
npm run validate:assets -- --preview
npm run browsers:install
npm run test:e2e

npm run audio:inventory
npm run audio:generate   # edge-tts 生成缺失的源 WAV
npm run audio:pack       # 打包音频精灵（单元超 180 秒会自动要求拆包）
npm run audio:asr        # faster-whisper 回读校验最终切片
npm run audio:approve    # 写入带指纹的音频审批记录
npm run content:review
# 打开 artifacts/review/index.html 逐项核对、试听并导出人工审核结果
# 导入时先生成变更预览：
npm run review:import -- /path/to/review-result.json
# 提供 audio-source 下的真实 WAV 后：
npm run audio:pack
# 也可分批提供完整场景及公共素材，或独立提供向导：
npm run audio:inventory -- --theme animal_home
npm run audio:pack -- --theme animal_home
npm run audio:pack -- --sprite guide
npm run audio:pack -- --sprite ui_guide

# 文本/图片与音频审批齐全后即可放行（当前 272 词全部 audio_approved）：
npm run build:release
```

浏览器测试使用工作区 `.cache/ms-playwright`，测试运行器自行开启并关闭 HTTP 服务；子路径构建写入 `.cache/e2e-subpath-dist`。测试专用声音只在私有测试响应或 `.cache` 中存在，不写入应用素材目录。语音接入、审核导出及显式应用方法见 [AUDIO_WORKFLOW.md](./docs/AUDIO_WORKFLOW.md)。

---

## 📜 许可协议

MIT License

第三方图形、字体和语音分别遵循其自身许可，发布素材需保留来源与授权记录；不能把项目代码的 MIT 声明作为素材许可。

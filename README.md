# 🌟 Webster Kids English (W-English)
### 🎈 韦氏儿童英语 Web 学习平台

专为 **4～9 岁低幼及小学低年级儿童（Pre-K 至 Grade 3）** 量身打造的趣味英语词汇、自然拼读与多感官探索 Web 应用。

---

## 🎯 项目核心理念

1. **告别古版字典陷阱**：拒绝 1913 年古董公版韦氏大词典晦涩难懂的学术释义，采用大模型技术重构符合儿童认知（CEFR Pre-A1/A1）的“现代韦氏儿童词典风格”简易释义。
2. **多感官场景探索**：摒弃成人键盘输入与 A-Z 抽象检索，通过**主题大地图（动物、食物、自然、学校）**、**可点触插画**和**清脆音效**引导孩子主动探秘。
3. **自然拼读强化（Phonics Blender）**：可拼读词按"字母组合 → 音素"拆成气球，双写辅音只发一次音、不发音字母不发音、consonant-le 整体教学；不可拼读的高频词（Dolch / Fry）走整词识别通道，不进拼读气球。
4. **正向游戏化激励**：星星记录"听过 + 选择"等参与行为，学习记录区分探索、完整听音、首次答对和间隔至少 24 小时的复习答对。

当前已有可运行的 **Stage 2 工程预览**：100 词、三个场景、卡片与亲子提示、听音选图、拼读、点选/拖拽拼字母、解锁与贴纸、休息提醒、家长统计、学习记录清除和离线管理。窗口交接、数据库迁移、内容更新回退及分批素材审核工具已实现。真实语音按用户安排随后提供；缺少声音的活动保持不可用。

本地通过 **163 项单元测试和 44 项浏览器测试**。工程覆盖范围见 [开发状态](./docs/DEVELOPMENT_STATUS.md)，逐项证据与未满足的交付条件见 [规格核对记录](./docs/qa/SPEC_AUDIT_2026-09-12.md)。全部词条仍为 `draft`，真实素材、老师/真机验收和正式发布尚未完成。

---

## 📂 项目结构

```text
w-english/
├── docs/
│   ├── PROJECT_PLAN.md          # v2.3 范围、架构与阶段计划
│   ├── IMPLEMENTATION_SPEC.md   # 配置、页面、游戏、数据、音频与离线协议
│   ├── STAGE0_TASKS.md          # 任务依赖、工时、资源与实机验收表
│   ├── DEVELOPMENT_STATUS.md    # 已实现内容、验证证据和剩余工作
│   ├── AUDIO_WORKFLOW.md        # 真实录音接入、精灵生产、审批指纹
│   └── RESEARCH_NOTES.md        # 官方资料、查阅结果和选型依据
├── src/                        # 页面、规则、Dexie、音频与内容包服务
├── assets/illustrations/        # 100 张自有/经许可改编的 SVG，图义待审
├── data/
│   ├── sample_words.json        # 5 词结构示例，不直接并入首批词库
│   ├── stage0_words.json        # 10 个 CVC 候选词，均为 draft
│   ├── stage0_theme.json        # 动物之家场景、两页各 5 词、活动白名单
│   ├── catalog.json             # 活动阶段与源文件入口
│   ├── stage1_words.json        # 20 个 CVC 草稿
│   ├── stage1_theme.json        # 四页场景和易混淆图片排除表
│   ├── stage2_words.json        # 当前活动目录的 100 个草稿词
│   ├── stage2_*.json            # 三场景，分别 34 / 33 / 33 词
│   ├── illustration-licenses.json # 图形来源、许可、文件指纹
│   ├── content-approvals.json   # 文本/图片审批，当前为空
│   └── audio-approvals.json     # 最终音频审批，当前为空
├── scripts/
│   ├── validate-words.mjs        # 共用 Zod 契约与场景检查
│   ├── build-content.mjs         # 哈希清单、预览/发布内容包
│   ├── validate-assets.mjs       # 文件、精灵和审批校验
│   ├── pack-audio.mjs            # 全量/按场景/按精灵的 WAV 打包与原子合并
│   ├── review-inventory.mjs      # 生成独立离线素材审核页
│   └── import-review.mjs         # 验证并导入人工审核，保留源文件备份
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

1. [项目计划](./docs/PROJECT_PLAN.md)：Stage 0 验证、Stage 1 内部试用、Stage 2 公开首版的范围。
2. [实施规格](./docs/IMPLEMENTATION_SPEC.md)：六种配置组合、题目状态、首次作答、数据事务、音频和离线更新。
3. [Stage 0 任务清单](./docs/STAGE0_TASKS.md)：56 小时开发任务 + 4 小时预留，老师最多 8 小时，以及验收证据模板。
4. [资料核对记录](./docs/RESEARCH_NOTES.md)：官方文档和维护者资料，以及尚需审核/实测的边界。

---

## 🛠️ 推荐技术栈

- **前端架构**：Node 24 LTS + Vite 8 + React 18.3.1 + TypeScript + Tailwind CSS 4（纯客户端静态站）
- **离线**：vite-plugin-pwa / Workbox `injectManifest`，独立内容包校验与等待更新
- **动效**：轻量 CSS 动效，尊重家长与系统减少动态效果设置
- **音频引擎**：Howler.js；整词/例句优先 Azure Speech 构建生成，音素使用审核后的真人录音或授权素材
- **学习存储**：IndexedDB（Dexie schema 2，八张表）；不依赖账户或云端同步
- **字体规范**：本地 Nunito + 系统中文字体
- **目标设备**：10 英寸平板横屏；Safari/iPadOS 16.4、Chrome 111 为待验证最低目标

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

预览地址为 `http://127.0.0.1:4173`。当前包可浏览图片与卡片；完整教学语音等待素材。真实 Service Worker 的离线声音、分段请求、缓存修复及多窗口等待更新已有测试信号验证；可读性、安全区、PCM与解码检查见 [验证记录](./docs/qa/ENGINEERING_2026-09-12.md)。

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

# 需要真实音频、文本/图片和最终切片审批；当前应被拒绝：
npm run build:release
```

浏览器测试使用工作区 `.cache/ms-playwright`，测试运行器自行开启并关闭 HTTP 服务；子路径构建写入 `.cache/e2e-subpath-dist`。测试专用声音只在私有测试响应或 `.cache` 中存在，不写入应用素材目录。语音接入、审核导出及显式应用方法见 [AUDIO_WORKFLOW.md](./docs/AUDIO_WORKFLOW.md)。

---

## 📜 许可协议

MIT License

第三方图形、字体和语音分别遵循其自身许可，发布素材需保留来源与授权记录；不能把项目代码的 MIT 声明作为素材许可。

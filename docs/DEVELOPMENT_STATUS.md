# 工程实现状态（交接说明）

日期：2026-10-15。本轮在双轨道之上补齐素材层：172 张 AI 生成 SVG 插图、全量 1409 个音频片段（edge-tts 生成 + faster-whisper 回读校验）与课本侧全部模型审批；另补上课本轨道的学习报告页。

范围以 [实施规格 §13](./IMPLEMENTATION_SPEC.md)、[项目计划 v2.4 §7.4](./PROJECT_PLAN.md) 与 [Stage 4 任务清单](./STAGE4_TASKS.md) 为准。**未完成项一律不算完成**：探索轨道 100 词的文本/图片审批仍未记录（模型审批政策目前只授权到课本词），`npm run build:release` 仍按预期拒绝。

## 1. 一句话现状

- 一个应用、两条轨道：**explore**（4~9 岁，场景探索 + 自然拼读，Stage 2 的 100 词三场景）与 **drill**（9~10 岁，译林版新编 4A 全部 8 个单元 172 条词，SM-2 间隔复习）。
- 课本轨道的词条数据已齐全（含音标、字母组合拆分、音素、整句例句）；插图（AI 生成 SVG）与录音（edge-tts 生成 + ASR 回读校验）已全部生产并录入台账，课本 172 词达到 `audio_approved`。
- 探索轨道的音频同样已打包（0 个待提供片段），但 100 个探索词的文本/图片审批记录仍未落（政策只授权到课本词），所以探索词仍是 `draft`，发布门禁继续拒绝。
- 探索轨道的既有行为、内容包校验与发布门禁未改动。

## 2. 怎么跑

```bash
# 本机 Node 24.19.0 是绿色包，项目要求 engines >=24.19.0 <25
export PATH="/c/Users/maoju/.local/node-v24.19.0-win-x64:$PATH"   # Git Bash / WSL 风格路径
npm ci
npm run dev            # http://127.0.0.1:5173（predev 会生成预览内容包）

# 离线与生产形态
npm run build:preview
npm run preview        # http://127.0.0.1:4173
```

入口：欢迎页「开始冒险」进 explore；「课本复习」进 drill（只有内容包带了 textbook 块时才出现）。首次进入会先做一次共用的设置（操作方式 / 等级），从「课本复习」进来的会在设置完成后回到 `/drill`。

检查命令（本地全绿）：

```bash
npm run validate:content            # 100 个探索词 + 172 个课本词（8 个单元）
npm run typecheck && npm run lint
npm test                            # 239 项单元测试 / 32 个文件
npm run validate:assets -- --preview # 360 个文件；0 个音频片段待提供
npm run audio:asr                   # faster-whisper 回读校验全部语言片段（829 个）
npm run audio:approve               # 把 ASR 结果写入 data/audio-approvals.json（模型辅助听审）
npm run build:preview
npm run browsers:install && npm run test:e2e   # 见第 6 节的既有失败
```

## 3. 已实现

| 范围 | 产物 | 关键位置 |
|---|---|---|
| 探索轨道（Stage 2） | 100 词 / 三场景 / 拼读与拼字母 / 解锁与贴纸 / 休息提醒 / 家长统计 / 离线内容包与更新回退 | `src/features/*`、`src/domain/*`、`src/services/*` |
| 典范英语 1A 深度优化 | 集成 Downloads 本机原版牛津戏剧化录音（42 课官方 320kbps MP3）、42 张 PDF 绘本高清封面、全课智能时间戳切片、双模式（原声带跟读留白 / 连贯磨耳朵）、点句即播与单句循环精听、原生变速不变调，降级 TTS 兜底 | `src/features/dianfan.tsx`、`src/data/dianfan-audio.ts`、`public/content/dianfan/1a/*`、`scripts/align-dianfan-audio.mjs` |
| 课本轨道数据 | 8 个单元 172 条（U1 29 / U2 26 / U3 25 / U4 14 / U5 21 / U6 19 / U7 19 / U8 19），与 memoryApp 逐条对应；含 `ipa`、`graphemes`、`phonemes`、`syllables`、整句例句、`textbook{bookId,unit,pos,core}` | `data/textbook/*`、`docs` 中的契约说明 |
| 内容契约 v4 | `kind: word|phrase`、`track: textbook`、短语/专有名词按字母比对、探索与课本拆成两份 schema 但共用一个跨字段规则函数 | `src/data/content-schema.ts` |
| 内容包与构建 | 场景包与单元包同一套打包逻辑（`unitId` 即 pack id）、清单 `schemaVersion: 4`、`appContract.max: 3`、缺音清单与 release 门禁 | `src/domain/content-scopes.ts`、`scripts/build-content.mjs`、`scripts/validate-assets.mjs`、`scripts/lib/textbook-source.mjs` |
| SM-2 内核 | 从 memoryApp 原样移植（含易度下限、10 分钟重试、hard 收敛 0.7），词库与时钟由调用方注入 | `src/core/srs/*` |
| drill 存储 | Dexie schema 3（原生 30）：`profiles` / `srsProgress[profileId+wordId]` / `dailyLogs[profileId+day]`；v10、v20 两种旧布局都能升级，未知结构中止 | `src/data/database.ts` |
| drill 仓储 | 一次复习一个事务写卡片 + 日报 + 档案计分；同毫秒重复提交只计一次；档案增删改（删除只清该档案的记录） | `src/data/drill-repository.ts` |
| drill 出题与界面 | 五种题型（看英文选中文 / 看中文选英文 / 听音辨词 / 拼写 / 翻卡自评）、同单元同词性干扰项、答错本轮重排、自动朗读只在听音与拼写、单元列表、错词本、今日数字、金币与连击 | `src/drill/*` |
| 金币与连击 | 答对 2 / 轻松 3 / 重做 1 / 答错 0；跨日 +1，超过一天未学显示 0 | `src/domain/day.ts` |
| 旧应用导入 | 只读读 `yilin-memory`，按 `data/textbook/legacy-id-map.json`（172 条）映射并入；幂等；档案合并策略保守 | `src/data/legacy-import.ts`、`src/features/legacy-import.tsx` |
| 多档案 | 家长页可增删改、换头像、改每日新词目标；正在使用的档案拒绝删除；drill 首页切换档案并写回设置 | `src/features/profiles.tsx`、`src/domain/profiles.ts` |
| 音效与语音 | drill 用 Web Audio 合成音效（零素材依赖）；缺录音时用浏览器 TTS 兜底（探索与课本共用） | `src/core/sfx.ts`、`src/services/speech-fallback.ts` |
| 模型复核（替代老师听审的文本侧） | `npm run content:ai-review`：生成逐单元复核提示 → 任意模型给出裁决 JSON → `--apply` 修补源词条（白名单字段 + 嵌套对象合并 + 修补后重跑契约校验，失败则整文件回滚）→ `--record` 写入与指纹绑定的审批记录（`reviewer: model:<名字>`）。**8 个单元 172 条已全部复核完**，7 个单元并行复核后共修补 53 条（U1 10 / U2 6 / U3 3 / U4 6 / U5 13 / U6 1 / U7 9 / U8 5），无剔除；命中最多的是英式音标落在允许表外（əʊ→oʊ、ɒ→ɑ、ə(r)→ər）、不发音字母未拆出、例句没用词条本形。172 条文本+图片审批已随插图落盘，课本词全部 `audio_approved` | `scripts/ai-review.mjs`、`data/content-approvals.json`（含 `policy: model-assisted`）、`artifacts/ai-review/*` |
| 素材生产（音频） | 1409 个片段全部生产：`audio:generate`（edge-tts，en-US-JennyNeural / zh-CN-XiaoxiaoNeural，学科缩写 PE/IT 按字母逐个念）→ `audio:pack`（单元拆 4 个精灵：词/例句/音素前半/后半，单个不超 180 秒）→ `audio:asr`（faster-whisper base→small→medium 回读，829 个语言片段全部通过：数字归一、同音词组、拼音比对）→ `audio:approve`（逐片绑定精灵/源/文字指纹写入台账，reviewer 如实标注 `model:asr-…` / `model:pack-calibration`） | `scripts/generate_audio.py`、`scripts/asr_verify.py`、`scripts/record-audio-approvals.mjs`、`artifacts/asr-report.json` |
| 素材生产（插图） | 172 张课本词 SVG（子代理工作流 cpa/gpt-5.6-sol 按探索轨道扁平卡通风格生成），程序化校验（根元素/viewBox/禁用元素/大小/哈希）后落盘；台账补 169 条（3 个重复拼写共用图片） | `assets/illustrations/tb4a_*.svg`、`data/illustration-licenses.json` |
| 学习报告页（P3） | `#/drill/report`：掌握度（已学/已掌握/待复习+进度条）、最近 7 天柱状统计（新学/复习/答对）、错词本（按答错次数排序+单词发音+一键只练错词），按档案切换 | `src/drill/report.tsx`、`src/drill/drill-home.tsx` |

## 4. 验证证据

- **239 项单元测试 / 32 个文件**通过（`npm test`，本机 Node 24.19.0）；`typecheck`、`lint` 干净。
- `validate:content`：100 个探索词 + 172 个课本词（8 个单元）结构、语义与场景/单元引用全部通过。
- `validate:assets -- --preview`：360 个文件哈希/许可通过；**0 个音频片段待提供**（探索 353 + 课本 1056 全部打包）。
- **浏览器实测**（Playwright，`127.0.0.1:4173` 的 preview 构建）：
  - 欢迎页 →「课本复习」→ 首次设置 → 自动进入 `#/drill`；
  - 首页显示 8 个单元（29/26/25/14/21/19/19/19）与今日数字；
  - 一轮从 `1/10` 开始（每日新词上限生效），答错后排到队尾（`2/11`），拼写题显示打乱的字母块；
  - 答题写入 `srsProgress`（含 `lapses`/`ease`）与 `dailyLogs`，档案的 `streak`/`lastStudyDay`/`totalReviews` 同步更新，首页显示 🪙/🔥；
  - 家长页：新增档案（妹妹 🐼 目标 20）落库、切换档案写回 `activeProfileId`、正在使用的档案删除被拒；
  - 旧库导入：预置 `yilin-memory` 后「检查旧记录」报 1 档案 / 2 进度 / 1 天打卡，「导入到本应用」把 `u2-day`→`w_tb4a_001`、`u1-subject`→`w_tb4a_101` 与档案计数并入，全程无控制台错误。

## 5. 尚未完成

1. **探索轨道 100 词的文本/图片审批**：音频已生产并通过 ASR 回读（第 3 节），但模型审批政策只授权到课本词（用户 2026-10-11 的决策）。把 `model-assisted` 扩展到探索词或改由家长人工审批后，`build:release` 才能放行。
2. **报告页（已完成 2026-10-15）**：`#/drill/report` 提供掌握度、最近 7 天统计与错词本；家长端无独立周报导出。
3. **按档案的探索轨道限额**：`wordProgress`/`rewards`/`activityState` 未加 `profileId`（§13.3 记录为触发条件：第二个孩子开始用探索轨道时再升 schema）。
4. **P4 单部署**：单 PWA 部署、旧应用归档说明、真机验收（iPad/Android 各一台）。
5. **e2e 门槛**：见第 6 节。
6. **有意不移植**：memoryApp 的句子完形/拼句题型（需要在例句里写占位符，属新增契约）与独立的统计页。

## 6. 已知问题与风险

- **本机 e2e：18 项失败 / 26 项通过**（2026-10-15 实测；Stage 4 基线 `630767b` 时为 12 项失败）。失败主因已从“本机 `artifacts/audio` 已生成与待提供断言冲突”变成“内容包里现在带**真实打包音频与已记录审批**”：若干 e2e 断言的是语音待准备/审批为空的旧世界（如听音按钮应禁用、审核页应从 pending 起步），另有若干用例依赖真实音频的播放时序（旁白播完才可作答）。单测 239/239、`validate:assets --preview`（0 待提供）与发布门禁（正确拒绝探索词 draft）全部符合预期；e2e 需要按“真实音频世界”改写这批断言，列为后续事项，不阻塞自用。
- **Node 版本**：全局 Node 是 22.20.0，项目要求 24.x（`engines`）。不要用全局 Node 跑迁移类验证；用第 2 节的绿色包。
- **测试超时预算**：`vitest.config.ts` 的 30 秒与子进程用例的 120 秒是按本机（Windows + 30 个 jsdom 环境并行）定的；单跑都远低于预算。
- **写锁**：drill 与 explore 共用同一把会话写锁；drill 只写自己的三张表，回归测试覆盖到该边界。
- **删除档案是破坏性操作**：家长页二次确认；只删该档案的 `srsProgress`/`dailyLogs`。
- **内容契约 v4** 有两处刻意放宽：`word` 允许句末标点，`kind='word'` 的拼接比对只比字母（`o'clock` 可表达）；`spelling` 仍必须是逐字母。
- **课本文案待审**：172 条的释义、音标、字母组合拆分与例句均为本轮新写或从 memoryApp 改写，全部 `draft`；双写辅音合并、不发音字母、`əʊ`→`oʊ` 等边界由校验器把守，但不能代替老师听审。

## 7. 速查地图

| 需要什么 | 去哪里 |
|---|---|
| 契约、存储、离线与双轨道的规则 | [IMPLEMENTATION_SPEC.md](./IMPLEMENTATION_SPEC.md)（§13 双轨道与多档案） |
| 范围、路线图与阶段边界 | [PROJECT_PLAN.md](./PROJECT_PLAN.md)（v2.4） |
| 逐任务进度、复核点与剩余里程碑 | [STAGE4_TASKS.md](./STAGE4_TASKS.md) |
| 真实录音接入与审批 | [AUDIO_WORKFLOW.md](./AUDIO_WORKFLOW.md) |
| SM-2 与出题 | `src/core/srs/*`、`src/drill/quiz.ts` |
| 数据访问 | `src/data/{database,learning-repository,drill-repository,legacy-import}.ts` |
| 内容源 | `data/stage2_*.json`（探索）、`data/textbook/*`（课本）、`data/textbook/legacy-id-map.json`（旧库映射） |

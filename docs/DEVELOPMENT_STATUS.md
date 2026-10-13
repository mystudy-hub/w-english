# 工程实现状态（交接说明）

日期：2026-10-11。本轮完成 Stage 4「双轨道合并」：`english_app` 与 memoryApp（译林 4A 课本复习）合并为一个 PWA、一个 IndexedDB、多个孩子档案。

范围以 [实施规格 §13](./IMPLEMENTATION_SPEC.md)、[项目计划 v2.4 §7.4](./PROJECT_PLAN.md) 与 [Stage 4 任务清单](./STAGE4_TASKS.md) 为准。**未完成项一律不算完成**：内容仍全部是 `draft`，`npm run build:release` 仍按预期拒绝。

## 1. 一句话现状

- 一个应用、两条轨道：**explore**（4~9 岁，场景探索 + 自然拼读，Stage 2 的 100 词三场景）与 **drill**（9~10 岁，译林版新编 4A 全部 8 个单元 172 条词，SM-2 间隔复习）。
- 课本轨道的词条数据已齐全（含音标、字母组合拆分、音素、整句例句）；**插图与录音尚未生产**，所以 drill 目前用 emoji 占位 + 浏览器 TTS 兜底发音，只能停在 preview。
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
npm run validate:assets -- --preview # 127 个文件；771 个音频片段待提供（preview 允许）
npm run build:preview
npm run browsers:install && npm run test:e2e   # 见第 6 节的既有失败
```

## 3. 已实现

| 范围 | 产物 | 关键位置 |
|---|---|---|
| 探索轨道（Stage 2） | 100 词 / 三场景 / 拼读与拼字母 / 解锁与贴纸 / 休息提醒 / 家长统计 / 离线内容包与更新回退 | `src/features/*`、`src/domain/*`、`src/services/*` |
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
| 模型复核（替代老师听审的文本侧） | `npm run content:ai-review`：生成逐单元复核提示 → 任意模型给出裁决 JSON → `--apply` 修补源词条（白名单字段 + 嵌套对象合并 + 修补后重跑契约校验，失败则整文件回滚）→ `--record` 写入与指纹绑定的审批记录（`reviewer: model:<名字>`）。**8 个单元 172 条已全部复核完**，7 个单元并行复核后共修补 53 条（U1 10 / U2 6 / U3 3 / U4 6 / U5 13 / U6 1 / U7 9 / U8 5），无剔除；命中最多的是英式音标落在允许表外（əʊ→oʊ、ɒ→ɑ、ə(r)→ər）、不发音字母未拆出、例句没用词条本形。审批记录仍为 0 条：172 条都还是 emoji 占位图，图片侧无法审批 | `scripts/ai-review.mjs`、`data/content-approvals.json`（含 `policy: model-assisted`）、`artifacts/ai-review/*` |

## 4. 验证证据

- **239 项单元测试 / 32 个文件**通过（`npm test`，本机 Node 24.19.0）；`typecheck`、`lint` 干净。
- `validate:content`：100 个探索词 + 172 个课本词（8 个单元）结构、语义与场景/单元引用全部通过。
- `validate:assets -- --preview`：127 个文件哈希/许可通过；**771 个音频片段待提供**（353 个探索 + 418 个课本）。
- **浏览器实测**（Playwright，`127.0.0.1:4173` 的 preview 构建）：
  - 欢迎页 →「课本复习」→ 首次设置 → 自动进入 `#/drill`；
  - 首页显示 8 个单元（29/26/25/14/21/19/19/19）与今日数字；
  - 一轮从 `1/10` 开始（每日新词上限生效），答错后排到队尾（`2/11`），拼写题显示打乱的字母块；
  - 答题写入 `srsProgress`（含 `lapses`/`ease`）与 `dailyLogs`，档案的 `streak`/`lastStudyDay`/`totalReviews` 同步更新，首页显示 🪙/🔥；
  - 家长页：新增档案（妹妹 🐼 目标 20）落库、切换档案写回 `activeProfileId`、正在使用的档案删除被拒；
  - 旧库导入：预置 `yilin-memory` 后「检查旧记录」报 1 档案 / 2 进度 / 1 天打卡，「导入到本应用」把 `u2-day`→`w_tb4a_001`、`u1-subject`→`w_tb4a_101` 与档案计数并入，全程无控制台错误。

## 5. 尚未完成

1. **课本素材层**：172 张 SVG 插图（现为 `emoji` 占位，因此图片侧审批仍无法记录）、逐词录音（含音素片段）、插图许可台账、音频的 ASR 回读校验。文本侧的模型复核已可用（第 3 节），`release` 门禁按设计依旧拒绝。
2. **报告页**：只有首页的今日数字与 `mastery()` 接口，没有周统计 / 掌握度曲线 / 单独的错词本页。
3. **按档案的探索轨道限额**：`wordProgress`/`rewards`/`activityState` 未加 `profileId`（§13.3 记录为触发条件：第二个孩子开始用探索轨道时再升 schema）。
4. **P4 单部署**：单 PWA 部署、旧应用归档说明、真机验收（iPad/Android 各一台）。
5. **e2e 门槛**：见第 6 节。
6. **有意不移植**：memoryApp 的句子完形/拼句题型（需要在例句里写占位符，属新增契约）与独立的统计页。

## 6. 已知问题与风险

- **本机 e2e 有 12 项既有失败**（基线 commit `630767b` 同样失败，与 Stage 4 无关）：多为一类断言“语音待准备”的缓存态，而本机 `artifacts/audio` 已生成；另有 `guide.spec.ts:36` 依赖同文件前序用例状态（单跑与整跑结论不同）。因此 Stage 4 的验收门槛定为**“相对基线不新增失败”**，不是 e2e 全绿。想在干净环境跑，可临时把 `artifacts/audio` 移开再 `build:preview`。
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

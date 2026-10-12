# Stage 4 任务清单：双轨道合并（explore + drill）

日期：2026-10-11；范围以 [项目计划 v2.4 第 7.4 节](./PROJECT_PLAN.md) 和 [实施规格第 13 节](./IMPLEMENTATION_SPEC.md) 为准。

本文件把 Stage 4 的 P0~P1 拆成可执行任务；P2~P4 只列里程碑与验收，等素材产能落实后另开任务清单。未勾选任务均未完成；计划、代码、自动检查和人工验收分别记录。

**Aegis Visibility**：本计划值得先成文，是因为它同时改动内容契约（schema v4）、本地存储（Dexie v3 + 迁移）和两个应用的所有权边界；这三处任一处没定好，后续素材合规与 UI 工作都会返工。

## 0. 计划前置读数

```text
Plan Basis:
- 需求来源：用户 2026-10-11 确认的四个决策（单壳双轨道 / 内容完整合规 + 契约 v4 / 多档案 profiles / 代码先行逐单元合规）
- 设计来源：docs/IMPLEMENTATION_SPEC.md §13、docs/PROJECT_PLAN.md §7.4 与 §7.2 Stage 4
- 现状来源：docs/DEVELOPMENT_STATUS.md、memoryApp 源码快照（S4-01 生成）

BaselineUsageDraft:
- Required baseline refs: docs/IMPLEMENTATION_SPEC.md（§5.2 存储、§6 内容包、§10.2 目录、§13）
  docs/PROJECT_PLAN.md（§7.2、§7.4、附录 B）
- Delivered context refs: 本目录同批更新，实现者可直接读
- Acknowledged before plan refs: 上述两文件
- Cited in plan refs: 同 Acknowledged
- Missing refs: memoryApp 版本控制（S4-01 创建后才存在）
- Decision: continue

Requirement Ready Check:
- Requirement source refs: 用户确认（本会话）+ 实施规格 §13
- Goals and scope refs: §13.1 终态形态、§13.7 P0~P4
- User / scenario refs: 自用；explore 4~9 岁、drill 9~10 岁
- Requirement item refs: §13.2 契约、§13.3 存储、§13.4 闭环、§13.5 音源、§13.6 边界
- Acceptance / verification criteria refs: 本文件每个任务的「验证」
- Open blocker questions: 课本轨道素材审校产能（PROJECT_PLAN 附录 B #9，只影响 P2 起）
- Decision: ready（P0~P1 无阻塞）
```

## 1. 执行记录

```text
TDD Route:
- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Strict signals: 本计划含契约、持久化与迁移改动，属高风险信号，但会话 TDD 模式为 off，不自动升为 strict
- Light eligibility: 不适用（已按 off 跳过）
- TDD-fit exception: 无
- Test posture: post-change regression（新增行为另加聚焦单测，不写 RED 先行步骤）
- Reason: 会话 TDD 模式 off，用户未要求 strict
- Verification: npm run validate:content / typecheck / lint / test / build:preview / test:e2e + 各任务内的聚焦测试命令
```

```text
Change Necessity:
- User-visible need: 一个应用里既能给 4~9 岁做探索拼读，也能给 9~10 岁做译林课本的每日复习
- No-change / non-code option: 两个 PWA 各自演进（原决策）——用户已明确否掉；纯文档方案无法产生单入口体验
- Why code change is necessary: 需要新增 drill 轨道代码、把 SM-2 接进现有 Dexie 仓储、并把内容契约扩到能装下短语与专有名词
- Minimum change boundary: 新增 src/core/（srs、sfx）与 src/drill/；扩展 src/data/content-schema.ts 与 src/data/database.ts；扩展 scripts/ 与 src/domain/content-scopes.ts 支持 textbook 包；不重排现有目录
- Decision: code-change
```

```text
Existence Check（本计划新增的表面）:
1. data/textbook/catalog.json + scripts/lib/textbook-source.mjs
   - Existing owner / reuse candidate: data/catalog.json + scripts/lib/catalog-source.mjs
   - Why insufficient: catalog-source 硬编码 stage/expectedWords（[10,20,100]）与「Stage 2 必须三个场景」，按 unit 分组且无场景的课本内容无法满足
   - Creation proof: 课本单元数与 stage 门槛无关；塞进同一 source 会让两边同时失效
   - Retirement impact: 取消课本轨道时整目录删除，不影响 explore
   - Decision: add-with-proof
2. src/core/srs/**
   - Existing owner / reuse candidate: english_app 无 SRS；memoryApp 有实现但项目将归档
   - Creation proof: 现只有「首次答对 / 24 小时复习答对」打点，没有调度器
   - Decision: add-with-proof
3. src/core/sfx.ts
   - Existing owner / reuse candidate: src/services/audio-engine.ts（Howler 精灵）、src/services/speech-fallback.ts（TTS）
   - Why insufficient: explore 的 SFX 是 sprite 文件，english_app 没有合成器；drill 需要零素材依赖的即时反馈
   - Creation proof: 迁一个 88 行合成器比新增音频素材便宜，且离线可用
   - Decision: add-with-proof（TTS 继续复用 speech-fallback.ts，不新建语音层）
4. 未新增：第二套存储封装、第二套休息/奖励实现、第二套校验器（见 §13.6）
```

```text
Architecture Integrity Lens:
- Invariant: 一个 IndexedDB、一套档案、一套休息与音频链；内容只有一个校验入口
- Canonical owner / contract: src/data/content-schema.ts（契约）、src/data/database.ts（schema）、src/data/learning-repository.ts（explore 写入）、src/data/drill-repository.ts（drill 写入）
- Responsibility overlap: 两个仓储都写 IndexedDB，按表分工——srsProgress/dailyLogs 归 drill；sessions/attempts/rewards/wordProgress 归 explore；不得交叉写对方表
- Higher-level simplification: unit 复用 manifest 的 pack 机制（unitId 即 pack id），不新增第二套内容分发
- Retirement / falsifier: 若 drill 需要写 explore 的表，说明轨道隔离设计错误，回到 §13.1 重新划分
- Verdict: proceed
```

```text
Plan Pressure Test:
- Owner / contract / retirement: 契约 owner 单一；memoryApp 退役路径明确（P3 停写、P4 归档、旧库只读保留）
- Architecture integrity / higher-level path: 复用 pack 与 Dexie 仓储，未新增并行体系
- Verification scope: 契约反例、迁移回放、两档案隔离、双轨道 e2e
- Task executability: 每个任务给出文件路径、精确改动点与命令
- Pressure result: proceed

Plan-Time Complexity Check:
- Target files: src/data/content-schema.ts（207 行）、src/data/database.ts（70 行）、src/domain/content-scopes.ts（33 行）、scripts/build-content.mjs（105 行）
- Existing size / shape signals: 均为单一职责的契约/迁移/包构建文件，当前规模小
- Owner fit: v4 契约与 textbook 校验继续由 content-schema.ts 承载（同一校验入口）
- Add-in-place risk: content-schema.ts 预计增至约 300 行，仍在单文件可读范围；超过 400 行时拆出 content-textbook.ts
- Better file boundary: drill 仓储与 UI 落新文件，不塞进 learning-repository.ts
- Recommendation: edit-in-place（content-schema / database / content-scopes），其余新增文件
```

## 2. 文件地图

| 动作 | 路径 | 说明 |
|---|---|---|
| 新建 | `src/core/srs/{types,sm2,session,index}.ts` | SM-2 内核，从 memoryApp 移植 |
| 新建 | `src/core/sfx.ts` | Web Audio 合成音效 |
| 新建 | `src/data/drill-repository.ts` | drill 的 profiles / srsProgress / dailyLogs 读写 |
| 新建 | `src/drill/{drill-home,session,words,report}.tsx`、`src/drill/quiz.ts`、`src/drill/ui/*.tsx` | 课本轨道 |
| 新建 | `data/textbook/catalog.json`、`data/textbook/yilin4a_u2.json`、`data/textbook/yilin4a_u2_words.json` | 课本源：目录、unit 配置、词条（v4） |
| 新建 | `scripts/lib/textbook-source.mjs` | 课本源加载与校验 |
| 新建 | `tests/core-srs.test.ts`、`tests/core-sfx.test.ts`、`tests/content-textbook.test.ts`、`tests/database-migration.test.ts`、`tests/drill-repository.test.ts`、`tests/drill.spec.ts` | 验证 |
| 修改 | `src/data/content-schema.ts` | 契约 v4（kind / textbook / 短语放宽 / manifest 版本） |
| 修改 | `src/data/database.ts` | Dexie v3 + 三张新表 + 守卫 |
| 修改 | `src/domain/models.ts` | Profile、SrsCardState、DailyLog 类型 |
| 修改 | `src/domain/content-scopes.ts` | `makeContentPacks` 支持 unit 包；支持契约 3 |
| 修改 | `src/data/learning-repository.ts` | 既有表补 `profileId`，其余行为不变 |
| 修改 | `src/app/app.tsx`、`src/features/welcome.tsx` | `/drill` 路由与入口 |
| 修改 | `scripts/build-content.mjs`、`scripts/validate-assets.mjs` | 课本包与素材校验 |
| 修改 | `C:/Users/maoju/Desktop/memoryApp/.gitignore` | 快照忽略规则（S4-01） |

**兼容边界**

- 现有 100 词与三场景的源文件、清单、离线包和进度记录必须继续可用：词条 `schemaVersion` 接受 `3 | 4`，构建产出 4。
- Dexie 既有八张表的主键与索引不得改动；只做新增表与回写 `profileId`。
- 现有 `wordId`（如 `w_animal_home_001`）不得变更；课本词 ID 用 `w_tb4a_###`。
- 现有 `npm run build:release` 门禁语义不变：课本内容未 `audio_approved` 前 release 必须继续失败。

## 3. 任务

### 进度

| 任务 | 状态 | 证据 |
|---|---|---|
| S4-00 收敛工作区并切到 Node 24 | ✅ 2026-10-11 | commit `993eb83`；Node 24.19.0 / npm 11.17.0；validate:content、typecheck、lint、188 测试、build:preview 全绿 |
| S4-01 memoryApp 回滚快照 | ✅ 2026-10-11 | memoryApp@`b43afb31c9485256d2461948c8734b881d799537`（42 个文件，工作区干净） |
| S4-02 抽出 `src/core/srs` | ✅ 2026-10-11 | commit `df48ee5`；`tests/core-srs.test.ts` 13 项通过 |
| S4-03 Web Audio 音效合成 | ✅ 2026-10-11 | commit `a521afa`；`tests/core-sfx.test.ts` 7 项通过 |
| S4-10 内容契约 v4 | ✅ 2026-10-11 | commit `6719b8b`；`tests/content-textbook.test.ts` 11 项通过；现有 100 词源文件零修改 |
| S4-11 课本源与加载器 | ✅ 2026-10-11 | commit `6bb2a77`；`validate:content` 报 100 个探索词 + 2 个课本词（1 个单元） |
| S4-12 内容包与构建 | ✅ 2026-10-11 | commit `91a092d`；manifest `schemaVersion=4`、`appContract.max=3`、包含 `tb4a_u2`；`validate:assets -- --preview` 通过；release 仍拒绝草稿 |
| S4-13 Dexie schema 3 + 多档案 + 迁移 | ✅ 2026-10-11 | commit `9b41ed0`；新增 `tests/database-migration.test.ts` 3 项（新库建默认档案、v2→v3 不重写旧记录、未知 v20 布局中止）；浏览器实测旧 v20 库升到 30 并出现三张新表与默认档案，欢迎页无控制台错误 |
| S4-14 drill 仓储与 SRS 接线 | ✅ 2026-10-11 | commit `efce1ba`；`tests/drill-repository.test.ts` 9 项通过；全库 211 项通过 |
| S4-15 drill UI 与路由 | ✅ 2026-10-11 | commit `ca1cdf9`；`tests/drill-quiz.test.ts` 10 项通过（全库 221 项）；浏览器实测：欢迎页“课本复习”→首次设置→`/drill`→开始→答错重排（1/2 变 2/3），写入 `srsProgress{lapses:1,ease:2.3}` 与 `dailyLogs{newLearned:1,reviews:1,correct:0}`，无控制台错误 |
| S4-16 U2 试点 26 条 | ✅ 2026-10-11 | commit `42f17b9`；`validate:content` 报 100 个探索词 + 26 个课本词（17 个单词 + 9 个短语）；`validate:assets -- --preview` 通过（112 个音频待提供）；浏览器实测首页显示 26 个词、一轮从 1/10 开始、答错重排 2/11、拼写题字母块可点 |
| P2 U1~U8 词条与拆分 | ✅ 2026-10-11 | commits `99b2927`、`ee59917`、`e039204`；8 个单元共 172 条（与 memoryApp 快照逐条对应）：U1 29 / U2 26 / U3 25 / U4 14 / U5 21 / U6 19 / U7 19 / U8 19；`validate:content` 100 探索词 + 172 课本词 |
| P2 插图、音频与老师审校 | 未开始（卡在素材与人工） | 172 张 SVG（现为 emoji 占位）、771 个音频片段、逐词听审；`release` 仍拒绝 |

#### P2 词条层的完成标准与遗留

- 完成的是**数据层**：每个词条都有 `ipa`、`graphemes`、`phonemes`、`syllables`、整句例句、`textbook{bookId,unit,pos,core}`、稳定 `wordId`（`w_tb4a_<unit><nn>`）和 `audio` 引用位。
- 未完成的是**素材层**：插图还是 `emoji`（`release` 会拒），音频尚未生产（`missingAudio` 771 条，预览允许），老师逐词审校尚未做。三项都完成后才能在 `release` 模式下构建。
- 单词的字母组合拆分与音素由本轮新写（memoryApp 缺 34 条音标），属待审草稿；其中双写辅音合并、不发音字母置空、`o'clock`/大写专有名词等边界已由 `validate:content` 反例覆盖。
- 一个可重复的教训：给课本短语编音素拆分时，UK 的 `əʊ` 不在允许音素表内（表里是 US 的 `oʊ`），`e`/`o`/`a` 也不作为单独音素；新单元用同样的脚本方法生成时先跑一次音素检查。

#### S4-16 实现定稿（需在复核时确认）

1. **插图先用 `emoji`**：26 条都是占位表情。`validate:assets -- --preview` 允许，`release` 仍拒绝（规格未变）。
2. **短语不给音素**：9 个短语的 `graphemes` 有字母但 `phonemes` 为空且 `audio: null`（契约允许），只填了 `ipa`。给短语编音素拆分应该由老师做，不在本轮编造。
3. **IPA 与字母组合拆分由本轮新写**，memoryApp 里 34 条无音标；这些是待审草稿（`review.status = 'draft'`），P2 需要老师逐词核对。
4. **例句去掉了 `_` 完形标记**：v4 的 `example.en` 是整句（用于朗读与展示），所以把占位符换成了真实词形。
5. **契约的两处放宽**：`word` 允许句末标点（`! ? …`），`kind='word'` 的拼接比对改为只比字母（`o'clock` 能过，但 `spelling` 仍必须是逐字母，原有反例测试不变）。
6. **每日新词上限恢复生效**：会话不再把 unit 当分组传给 `buildSession`（那会触发“整单元不限量”的分支），26 个新词变成每天 10 个；错词本仍绕过上限。
7. **legacy id 未映射**：memoryApp 的 `u2-*` 与 `w_tb4a_*` 的对应关系目前只能从词形推；`data/textbook/legacy-id-map.json` 等 P3 导入旧库时再落。

#### S4-15 实现定稿（需在复核时确认）

1. **题型只做规格 §13.4 列的五种**：memoryApp 的句子完形与“模板例句兜底”没有移植——v4 里 `example` 必填，兜底永远不会触发；句子完形还需要在例句里写占位符，属于新增契约，本阶段不做。
2. **`words.tsx` / `report.tsx` 折进首页**：错词本作为首页的“只练错词（n）”按钮（把 `lapses > 0` 的词交给同一轮会话），今天的新学/复习/答对数直接显示在首页顶部。少两个只读页面，但信息都在。
3. **`src/drill/ui.tsx` 一个文件装下所有卡片**，与 `src/components/ui.tsx` 的现有风格一致，而不是 `ui/` 目录下 5 个文件。
4. **首次设置后回到 drill**：用 `sessionStorage` 里的 `w-english:entry` 标记（同一会话有效），而不是给 store 加一个持久字段。
5. **自动朗读只出现在 listening 与 spelling**，听音题先给声音、1.5 秒后再显示选项；选择题与翻卡不自动播报。
6. **答题写库失败不阻断学习**：`review()` 抛错时提示“这次练习的记录暂时没能保存”，仍继续下一题。

#### P1-a 浏览器回归证据（2026-10-11）

Playwright chromium 1243 首次装到 `.cache/ms-playwright`（约 436MB）。完整 e2e 在三种状态下各跑一次：

| 状态 | 结果 | 说明 |
|---|---|---|
| 改动后 + 本地 `artifacts/audio` 存在 | 20 失败 / 24 通过 | 暴露出一个真实回归（见下） |
| 修完回归 + 本地音频存在 | 17 失败 / 27 通过 | 欢迎页恢复可进入 |
| 把 `artifacts/audio` 暂时移开（文档描述的“预览只带核心 SFX”状态）+ main | 13 失败 / 31 通过 | 与基线可比 |
| 同环境基线 `630767b` | 12 失败 / 32 通过 | 失败集合与 main 相同，只多一个 guide 用例 |

- 被 e2e 抓到并已修复的真实回归：播放层把每个课本词条的 `contentVersion` 与清单（属于探索词库）的版本相比，导致整包被拒、欢迎页停在“小小世界暂时打不开”。修法见 commit `5cf1823`（课本词条只要求彼此一致）。
- main 与基线相比多出的唯一失败是 `guide.spec.ts:36`；该用例在基线单跑同样失败（依赖同文件内前序用例的状态），判定为顺序依赖的 flake，不是回归。
- 其余 **12 项失败在基线上就存在**，集中在两类：断言语义依赖“语音待准备”的缓存态（本机 `artifacts/audio` 已生成，与实际不符），以及多窗口/缓存/主题解锁的状态依赖。它们与 Stage 4 无关，应单独排查。
- 因此 Stage 4 的验收不能把“e2e 全绿”当门槛；本阶段只要求：“相对基线不新增失败”（已满足）。

S4-00 的两处必要修复（属于收敛范围）：

- `src/domain/config.ts`：`defaultSettings()` 补齐 `freePlayMode` / `favoriteWords`，否则 `settingsSchema` 的 Zod 默认值会让「默认设置保存后读回」不相等（`tests/history-management.test.ts`）。
- `tests/audio-production.test.mjs`、`tests/review-workflow.test.mjs`：三个真实子进程用例显式给 60 秒预算；全局 10 秒在双 worker 下不够（单跑均通过，属环境竞争而非逻辑错误）。
- 工具链：本机无 nvm/fnm，Node 24.19.0 以绿色包放在 `C:/Users/maoju/.local/node-v24.19.0-win-x64`，用 `export PATH="/c/Users/maoju/.local/node-v24.19.0-win-x64:$PATH"` 生效；全局 Node 22.20.0 未动。

### P1-a 实现定稿（S4-10~S4-12，需在复核时确认）

1. **`kind` 缺省为 `word`**：入参可省略，解析结果总是有值。这样现有 135 条源词条无需回填；新写的课本词条仍应显式声明。
2. **探索与课本拆成两份 schema，共用一个跨字段规则函数**：`exploreWordSchema` 仍是 `WordEntry` 与 `catalog.words` 的类型，探索代码、字段严格度与报错文案零改动；`textbookWordSchema` 只为课本轨道放宽 `parentTip` 与英文释义。
3. **`parentTip`、`definition.en_young`/`en_older` 对课本词条可选**：drill 没有亲子提示界面，强制填写会产生无人消费的内容；`definition.zh`、`illustration`、`audio`、`review` 仍与探索轨道同规。
4. **允许空 `assetIds` 的包**：单元媒体未产出时仍要在清单里声明该单元，否则 drill 无法发现它；release 仍会因 `missingAudio` 失败。
5. **三处格式放宽**：词 ID 允许数字（`w_tb4a_001`）、精灵 ID 允许数字（`tb4a_u2`）、IPA 允许短语音节间空格。其余校验未放宽。
6. **发布门禁分两处执行**：探索词条在 `validateCatalog`，课本词条在 `validateTextbook`；两边规则相同，但各自只看到自己那份词库。
7. **尚未完成**：unit 包在运行时的下载/就绪与入口显示（原计划属 S4-15），P1-a 只保证包已进清单且能被校验；`npm run test:e2e` 未运行（本机未装 Playwright 浏览器，S4-15/S4-16 前补齐）。

### P0：回滚点与共享内核

#### S4-00 收敛工作区并切到 Node 24

- **文件**：无代码改动（提交现有改动）
- **为什么**：工作区已有 20 个未提交文件（+1005/−270），叠加 Stage 4 改动后无法区分回归来源；本机 Node 为 22.20.0，与 `engines`（`>=24.19.0 <25`）不符。
- **步骤**
  1. 切换 Node：`nvm use 24.19.0`（或 `fnm use 24.19.0`），确认 `node -v` 输出 `v24.19.0`；缺该版本时先 `nvm install 24.19.0`。记录实际版本。
  2. `npm ci`
  3. `npm run validate:content && npm run typecheck && npm run lint && npm test`
  4. `npm run build:preview`
  5. 全绿后提交：`git add -A && git commit -m "chore: converge dianfan-zone work before Stage 4 merge"`
- **验证**：上述命令退出码均为 0；`git status --short` 无输出；`git log -1 --oneline` 显示该提交。
- **停止条件**：第 3 步有失败时先修复或 `git stash`，不得带红灯进入 P1。

#### S4-01 给 memoryApp 建回滚快照

- **文件**：新建 `C:/Users/maoju/Desktop/memoryApp/.gitignore`
- **为什么**：memoryApp 没有版本控制，合并后它是被移植源码的唯一来源；没有快照就无法回滚或追溯移植错误。
- **步骤**
  1. 写 `.gitignore`：

     ```gitignore
     node_modules/
     dist/
     *.log
     ```
  2. `cd C:/Users/maoju/Desktop/memoryApp && git init -b main`
  3. `git add -A && git commit -m "chore: freeze pre-merge snapshot of xiaoxue-english-memory"`
  4. 记录 `git rev-parse HEAD` 的值，写进 S4-02 的提交信息，形如 `port: SM-2 core from memoryApp@<sha>`。
- **验证**：`git log -1 --oneline` 有提交；`git status --short` 干净（`node_modules/`、`dist/` 被忽略）。
- **影响**：只读快照，不改 memoryApp 源码。

#### S4-02 抽出 `src/core/srs`

- **文件**：新建 `src/core/srs/types.ts`、`src/core/srs/sm2.ts`、`src/core/srs/session.ts`、`src/core/srs/index.ts`、`tests/core-srs.test.ts`
- **为什么**：SM-2 调度器是本次合并收益最高的部分；memoryApp 的 `sm2.ts` 已跑通并被 3 个测试文件覆盖。
- **步骤**
  1. 从 S4-01 快照逐字复制 `memoryApp/src/srs/types.ts`（33 行）与 `memoryApp/src/srs/sm2.ts`（109 行）到 `src/core/srs/`，只改 import 为 `./types.ts`。`Sm2Engine` 的构造参数与默认值（`minEase 1.3`、`initialEase 2.5`、`retryMinutes 10`、`intervalAfterFirst 1`、`intervalAfterSecond 3`）必须保持原值。
  2. 移植 `session.ts`：原实现直接 `import { WORDS } from '../data/yilin4a'`，改为参数注入：

     ```typescript
     export interface SrsWord { id: string; core: boolean; unit: number }
     export interface SessionPlan { dueReviews: SrsWord[]; newWords: SrsWord[]; all: SrsWord[] }
     export function buildSession(input: {
       words: readonly SrsWord[];
       progress: ReadonlyMap<string, { learned: boolean; due: number }>;
       dailyNewTarget: number;
       includeNonCore: boolean;
       unit?: number;
       wordIds?: string[];
       now?: number;
     }): SessionPlan;
     ```
  3. `src/core/srs/index.ts` 只再导出：`export * from './types.ts'; export * from './sm2.ts'; export * from './session.ts';`
  4. 写 `tests/core-srs.test.ts`，至少覆盖：答 `again` 后 `due = now + 10 分钟` 且 `ease` 不低于 1.3；连续答对间隔依次为 1 天、3 天、`round(interval * ease)`；`hard` 使间隔乘 0.7 且不小于 1；`wordIds` 分支只返回指定词且 `newWords` 为空；`unit` 参数下所有词都已学过时返回整单元强化复习。
- **验证**：`npx vitest run tests/core-srs.test.ts`
- **兼容边界**：现有代码不引用该模块，纯新增。

#### S4-03 增加 Web Audio 音效合成

- **文件**：新建 `src/core/sfx.ts`、`tests/core-sfx.test.ts`；不修改 `src/services/speech-fallback.ts`
- **为什么**：drill 需要答对/答错/完成三种即时反馈；explore 的 SFX 是 sprite 文件，课本轨道不应再引入新素材依赖。TTS 已有 owner，不另建。
- **步骤**
  1. 移植 `memoryApp/src/tts/sfx.ts`（88 行）到 `src/core/sfx.ts`，保持 `export function playSfx(kind: 'correct' | 'wrong' | 'complete'): void`，内部懒加载并复用一个 `AudioContext`。
  2. 增加守卫：`AudioContext` 不可用或上下文为 `suspended` 时静默返回，不抛错。
  3. 写 `tests/core-sfx.test.ts`：用 stub 的 `AudioContext` 断言三种音效各创建振荡器与增益节点；`AudioContext` 缺失时不抛错。
- **验证**：`npx vitest run tests/core-sfx.test.ts`

### P1：单壳接入

#### S4-10 内容契约 v4

- **文件**：修改 `src/data/content-schema.ts`；新建 `tests/content-textbook.test.ts`
- **为什么**：172 条课本词条中有 56 条（38 条含大写、33 条含空格、16 条含句末标点）无法用现有 `^[a-z]+$` 表达；且课本词条必须与 explore 同等合规，只能扩同一份契约，不能另开第二套校验器。
- **精确改动点**
  1. 词 ID 正则 `/^w_[a-z]+_\d{3}$/` → `/^w_[a-z0-9]+_\d{3}$/`（允许 `w_tb4a_012`）。
  2. 新增必填 `kind: z.enum(['word', 'phrase'])`。
  3. `word` 正则 `/^[a-z]+$/` → `/^[A-Za-z][A-Za-z'’ .\-]*$/`。
  4. `theme` 由基类必填改为 `optional()`，并在 `superRefine` 中要求非 textbook 词条必须有 `theme`。
  5. 新增 `textbookSchema = z.strictObject({ bookId: z.literal('yilin-4a-2024'), unit: z.number().int().min(1).max(8), pos: z.enum(['n.','v.','adj.','adv.','prep.','pron.','num.','conj.','int.','phr.','proper']), core: z.boolean() })`；基类加 `textbook: textbookSchema.optional()`；`track` union 增加 `wordBase.extend({ track: z.literal('textbook'), textbook: textbookSchema })`；非 textbook 轨道出现该字段即拒绝。
  6. 短语放宽（仅 `kind='phrase'`）：`spelling` 与 `syllables` 允许词元数组（以单空格连接后等于 `word`）；`graphemes` 拼接忽略空格后等于 `word`；`phonemes` 允许空数组且不校验与 graphemes 的顺序。`kind='word'` 保持现有全部强校验（双写辅音合并、阶段 1 的 CVC 规则等）。
  7. `definition.en_young` 改为 `limitedText(8)`，并在 `superRefine` 中要求 `kind='word'` 时不超过 5 个英文词。
  8. 词条 `schemaVersion` 改为 `z.union([z.literal(3), z.literal(4)])`（现有源文件保持 3，新课本文件写 4）。
  9. 新增 `textbookUnitSchema = z.strictObject({ schemaVersion: z.literal(1), bookId: z.literal('yilin-4a-2024'), unitId: z.string().regex(/^tb4a_u[1-8]$/), title: text, wordIds: z.array(wordId).min(1), spriteIds: z.array(text).min(1) })` 与 `validateTextbook(words, units, release)`：unit 不重复、词被覆盖且无重复、每个词的音频精灵已在 `spriteIds` 声明、`release` 下要求 `audio_approved` 且 `illustration.type === 'image'`、词 ID 不与 explore 词库冲突。
  10. `manifestSchema.schemaVersion`：`z.literal(3)` → `z.union([z.literal(3), z.literal(4)])`。
- **验证**：`npx vitest run tests/content-textbook.test.ts`；反例必须含短语缺 `kind`、textbook 轨道缺 `textbook` 块、非 CVC 词标 `phonicsStage: 1`、短语 `graphemes` 拼接不符、unit 漏词、unit 词 ID 与 explore 重复、`release` 下 emoji 插图被拒。
- **兼容边界**：`kind='word'` 的校验行为与报错文案不变；现有 163 项单测必须继续全绿。

#### S4-11 课本源文件与加载器

- **文件**：新建 `data/textbook/catalog.json`、`data/textbook/yilin4a_u2.json`、`data/textbook/yilin4a_u2_words.json`、`scripts/lib/textbook-source.mjs`；修改 `scripts/build-content.mjs`
- **步骤**
  1. `data/textbook/catalog.json`：

     ```json
     {
       "schemaVersion": 1,
       "bookId": "yilin-4a-2024",
       "units": [
         { "unitId": "tb4a_u2", "config": "data/textbook/yilin4a_u2.json", "words": "data/textbook/yilin4a_u2_words.json" }
       ]
     }
     ```
  2. `data/textbook/yilin4a_u2.json`（unit 配置，对应 `textbookUnitSchema`）：

     ```json
     {
       "schemaVersion": 1,
       "bookId": "yilin-4a-2024",
       "unitId": "tb4a_u2",
       "title": "Unit 2 My day",
       "wordIds": ["w_tb4a_001", "w_tb4a_002"],
       "spriteIds": ["tb4a_u2"]
     }
     ```
  3. `data/textbook/yilin4a_u2_words.json`：本任务只先落**两条样例**——一条 `kind='word'`（如 `day`）与一条 `kind='phrase'`（如 `get up`，需自行补 `ipa`），用来验证 word 与 phrase 两条契约路径。必须是完整 v4 词条（含 `kind`、`spelling`、`graphemes`、`phonemes`、`syllables`、`ipa`、`definition`、`example`、`audio`、`illustration`、`review`、`contentVersion`、`track: 'textbook'`、`textbook` 块）；此阶段允许 `illustration.type = 'emoji'`、`audio` 指向占位 sprite `tb4a_u2#<word>`、`review.status = 'draft'`。20 条完整内容在 S4-16 补齐。
  4. `scripts/lib/textbook-source.mjs`：`export async function loadTextbookCatalog(release = false)`，读 `data/textbook/catalog.json`，逐 unit 读 unit 配置与词文件，调用 `validateTextbook`，返回 `{ bookId, units, words }`。
  5. `scripts/build-content.mjs`：在 `loadActiveCatalog` 之后调用 `loadTextbookCatalog(release)`，把课本词条并入 `words`（`wordId` 全局唯一），把 unit 列表传给包构建（S4-12）。
- **验证**：`npm run validate:content`

#### S4-12 内容包与构建接入课本单元

- **文件**：修改 `src/domain/content-scopes.ts`、`scripts/build-content.mjs`、`scripts/validate-assets.mjs`
- **精确改动点**
  1. `SUPPORTED_CONTENT_CONTRACTS`：`[1, 2]` → `[1, 2, 3]`。
  2. `makeContentPacks` 增加可选 `units?: readonly { unitId: string; wordIds: readonly string[]; spriteIds: readonly string[] }[]`，为每个 unit 产出 `{ id: unitId, themeId: unitId, dependsOn: ['common'], assetIds: [...] }`，共用词条与 `common` 的划分逻辑不变。unit 值一律以 `tb4a_` 开头，保证与场景 ID 不重名。
  3. `scripts/build-content.mjs`：`appContract: { min: source.stage === 2 ? 2 : 1, max: 3 }`；`schemaVersion: 4`；把课本精灵（`tb4a_u1`…`tb4a_u8`）纳入与场景精灵相同的哈希、PCM、真峰值与审批校验；`missingAudio` 计入课本片段。
  4. `scripts/validate-assets.mjs`：素材所属包检查覆盖 unit 包（课本词条的插图与精灵必须有归属包）。
- **验证**：`npm run validate:assets -- --preview` 与 `npm run build:preview` 均通过；`public/content/manifest.*.json` 的 `packs` 含 `tb4a_u2`，`schemaVersion` 为 4。
- **停止条件**：若 `makeContentPacks` 的 unit 分支需要改 `manifestSchema.packs` 的结构，停下重新评估——那说明 pack 机制不适用于 unit，应回到 §13.2 重新设计。

#### S4-13 Dexie schema 3、多档案与迁移

- **文件**：修改 `src/data/database.ts`、`src/domain/models.ts`、`src/data/learning-repository.ts`；新建 `tests/database-migration.test.ts`
- **为什么**：drill 需要按孩子分开的每日目标与 SRS 进度；现行 schema 2 只有单档案 `local`。
- **精确改动点**
  1. `DATABASE_SCHEMA_VERSION` 2 → 3（原生 version 30）。
  2. 新增 stores：`profiles: 'id'`、`srsProgress: '[profileId+wordId], [profileId+due]'`、`dailyLogs: '[profileId+day]'`。
  3. 新增 `VERSION_TWO_STORES` 常量（副本 = v2 的八张表定义），把 `isKnownVersionOne` 泛化为 `isKnownVersion(db, tx, spec)`，并在 `guardedFactory` 中放行 `oldVersion ∈ {10, 20}`：10 时按 v1 规格校对，20 时按 v2 规格校对；其他情况仍 `abort`。
  4. v30 的 `upgrade`：建三张新表；回写 `settings.activeProfileId = 'p_default'`；给每条 `wordProgress`、每个 `rewards`、`activityState` 补 `profileId = 'p_default'`；创建默认档案对象。
  5. `src/domain/models.ts` 增加 `Profile`、`SrsCardState`、`DailyLog`；`Settings` 增加 `activeProfileId`；`WordProgress`、`Reward`、`UsageState` 增加 `profileId`。
  6. `src/data/learning-repository.ts`：所有读写带上当前 `profileId`（从 `settings.activeProfileId` 取，缺省 `p_default`）；不改事务边界与去重逻辑。
- **验证**：`npx vitest run tests/database-migration.test.ts`。用例用 `fake-indexeddb` 建一个 v20 库（含 v2 八表与旧记录）后以 v30 打开，断言：三张新表存在；旧 `wordProgress` 记录均带 `profileId='p_default'`；旧 `settings` 有 `activeProfileId`；对未知 schema 仍抛出并中止。另跑 `npm test` 确认既有 163 项全绿。
- **兼容边界**：旧记录不得丢失或改写主键；`clearLearningRecords()` 仍只清学习记录，不删档案。

#### S4-14 drill 仓储与闭环接线

- **文件**：新建 `src/data/drill-repository.ts`、`tests/drill-repository.test.ts`
- **为什么**：drill 的写入必须与 explore 的表互不干扰，且复用同一写锁。
- **步骤**
  1. `class DrillRepository`，构造注入 `db: LearningDatabase` 与 `write: (work) => Promise<T>`（与 `LearningRepository` 相同的写锁形状）。
  2. 方法：`profiles()`、`saveProfile(profile)`、`progress(profileId, wordIds[])`、`due(profileId, now)`、`review(profileId, wordId, grade, now)`（内部调 `sm2.review`）、`dailyLog(profileId, day)`、`bumpDaily(...)`、`todayPlan(profileId, words, now)`（调 `buildSession`）。
  3. 每次 `review` 在**一个事务**内写 `srsProgress` + `dailyLogs`；重复提交同一 `(profileId, wordId, now, grade)` 不得重复计数（以 `lastReviewed` 判重）。
  4. 写 `tests/drill-repository.test.ts`：新词首答进入下次 1 天、答错回到 10 分钟、两档案互不影响、同一毫秒重复提交只计一次、`dailyLogs` 累计正确。
- **验证**：`npx vitest run tests/drill-repository.test.ts`
- **影响**：只写 `srsProgress` / `dailyLogs` / `profiles`；不触碰 explore 四表。

#### S4-15 drill UI、路由与入口

- **文件**：新建 `src/drill/drill-home.tsx`、`src/drill/session.tsx`、`src/drill/words.tsx`、`src/drill/report.tsx`、`src/drill/quiz.ts`、`src/drill/ui/{PreviewCard,QuestionCard,SpellingCard,FlipCard,SessionResult}.tsx`；修改 `src/app/app.tsx`、`src/features/welcome.tsx`；新建 `tests/drill.spec.ts`
- **步骤**
  1. 移植 `memoryApp/src/study/quiz.ts`（10.7 KB）为 `src/drill/quiz.ts`，保留 `PracticeMode`、`MODE_LABELS`、`makeQuestion`、`checkSpelling`、`exampleFor`（含模板兜底）与干扰项规则；词类型改为 v4 词条类型。
  2. 移植 `memoryApp/src/ui/components/*`（7 个卡片组件）到 `src/drill/ui/`，改用 Tailwind 4 与现有儿童控件 token（触控区 ≥ 64px、正文 ≥ 20px），复用 `src/components/ui.tsx` 的 `Button`/`IconButton`。
  3. `drill-home.tsx`：今日新学/到期复习数量、开始按钮、错误率与连续天数摘要。
  4. `session.tsx`：队列来自 `buildSession`；答错回插队列尾；自动朗读只在新词预览、`listening`、`spelling`；选择与翻卡不自动播报；本轮结束写 `dailyLogs` 并显示 `SessionResult`。
  5. 路由：`app.tsx` 增加 `/drill`、`/drill/session`、`/drill/words`、`/drill/report` 分支；只在 `manifest.schemaVersion === 4` 且存在 unit 包时显示入口，否则入口隐藏（旧内容包仍可用 explore）。
  6. `welcome.tsx`：家长设置完成后，档案选择页同时列出两条轨道；家长页可关闭 drill。
  7. 新会话仍走 `SessionLock`（`runtime.ts` 的 `sessionLock.write`），避免与 explore 并发写同一 IndexedDB。
  8. 写 `tests/drill.spec.ts`（Playwright，路由用假数据或预览构建）：两档案进度隔离；答错后本轮重现；`listening` 首屏不显示选项直到 1.5 秒；drill 不产生贴纸。
- **验证**：`npm run typecheck && npm run lint && npm test && npm run test:e2e`
- **兼容边界**：explore 路由与行为不变；`welcome.tsx` 在无 unit 包时与当前行为完全一致。

#### S4-16 U2 试点：20 条内容闭环

- **文件**：`data/textbook/yilin4a_u2_words.json`（从 2 条样例补全为 20 条）、`data/textbook/yilin4a_u2.json`（同步 `wordIds`）、`data/illustration-licenses.json`、`data/content-approvals.json`
- **步骤**
  1. 从 memoryApp 快照 `src/data/yilin4a.ts` 取 Unit 2 全部词条（含短语），转换为 v4 词条：补 `graphemes` / `phonemes` / `syllables` / `ipa`（原 34 条无音标，短语必补齐）/ `definition`（`en_young` ≤ 5 词，短语 ≤ 8 词）/ `example`（≤ 8 词且含 `audio`）。
  2. 每条提供 `illustration`（先用 `emoji` 保证可跑）与 `illustration-licenses.json` 记录；`content-approvals.json` 仍为空，全部保持 `draft`。
  3. 登记 unit 的 `spriteIds: ['tb4a_u2']`；音频未生产前 `audio` 指向占位片段，构建结果会进入 `missingAudio`（preview 允许，release 继续拒绝）。
- **验证**：`npm run validate:content && npm run validate:assets -- --preview && npm run build:preview && npm run preview`；手测：两个孩子档案各自跑完一轮新学+复习，答错词在本轮重现，explore 轨道与贴纸行为不变，休息提醒按档案独立计时。
- **说明**：本任务的 emoji 插图与占位音频**只能停在 preview**；P2 必须换成 SVG 与真实 sprite 才能通过 release 门禁。

## 4. 后续里程碑

| 阶段 | 内容 | 状态 | 完成判据 / 剩余前置 |
|---|---|---|---|
| P2 数据层 | U1 → U8 逐单元词条、音标、字母组合拆分与例句 | ✅ 2026-10-11（commits `99b2927`、`ee59917`、`e039204`） | 8 个单元 172 条，与 memoryApp 逐条对应 |
| P2 素材层 | 172 张 SVG 插图、771 个音频片段、插图许可台账、老师逐词听审 | 未开始 | `validate:assets`（非 `--preview`）通过；`data/audio-approvals.json` 有逐条记录；卡在素材与人工（附录 B #9） |
| P3 旧库导入 | 只读读 `yilin-memory`，按 172 条 id 映射并入档案/进度/日报 | ✅ 2026-10-11（commit `7b8f234`） | 幂等；档案合并（默认状态接受旧身份，已使用的只合并计数）；家长页有入口与结果回显 |
| P3 档案管理 | 增删改、头像、每日新词目标、切换、金币与连击 | ✅ 2026-10-11（commits `75380e4`、`f7a4127`） | 删除只清该档案的卡片与日报；正在使用的档案拒绝删除 |
| P3 报告页 | 独立的学习报告（周统计、掌握度曲线、错词本单独页） | 部分 | 首页已展示今日新学/复习/答对、金币、连击与掌握度接口（`mastery()`）；尚无周报表页 |
| P3 按档案限额 | 探索轨道的休息限额按档案分开 | 未做（已在 §13.3 记录为触发条件） | 第二个孩子开始用探索轨道时，需要新的 schema 版本给三张表加 `profileId` |
| P4 单部署 | 单 PWA 部署、字典型旧应用归档说明、`DEVELOPMENT_STATUS` 与 `PRD` 同步 | 未开始 | 单 PWA 真机验收（iPad/Android 至少各一台） |

- 不打算移植的 memoryApp 能力：句子完形/拼句题型（`sentence_choice`/`sentence_spell`）。规格 §13.4 只列了五种题型，而完形需要在例句里写占位符，属于新增契约，本阶段不做。

## 5. 风险与回滚

| 风险 | 触发信号 | 应对 |
|---|---|---|
| 契约 v4 影响面大（content-schema / build-content / validate-assets / content-scopes / manifest） | `npm run validate:content` 或 `npm test` 在 S4-10~S4-12 之间变红 | 同一提交内落 schema 与校验器；不长期保留「v4 已上、校验器未上」的中间态 |
| 素材长尾拖住合并（172 条：34 条无音标、49 条无例句） | 某单元合规超过 4 天 | 按单元分批上线；单元素材未齐时该 unit 不进入入口 |
| 双轨道共用 IndexedDB 与写锁 | 出现跨轨道覆盖或休息计时串档 | drill 与 explore 各自只写自己的表；写锁共用 `sessionLock` |
| 旧库导入冲突 | 同一 `[profileId+wordId]` 有两份进度 | 保留 `lastReviewed` 较新者；导入后保留旧库只读 |
| Node 版本不符（本机 22.20.0） | `EBADENGINE` 告警 | S4-00 先切到 24.19.0 并记录；不在 22.x 上做迁移类验证 |
| 单 PWA 体积增长 | 首屏预缓存超过 1 MB | 课本音频不进 `core` 预缓存；unit 包按需下载（复用现有 pack 流程） |

**回滚面**：S4-00~S4-16 全部落在 `english_app` 的提交历史内，回滚即 revert；`memoryApp` 由 S4-01 快照保护；`yilin-memory` 索引库在导入后仍保留，可重新导入。

## 6. 退役计划

| 对象 | 当前状态 | 保留原因 / 删除触发 |
|---|---|---|
| `memoryApp` 应用 | P3 起停止写入；P4 归档 | 保留只读副本直到 P4 单 PWA 真机验收通过 |
| `memoryApp` 的 `idb` 依赖 | 不进入 english_app | 无需移植；english_app 继续用 Dexie |
| `yilin-memory` 索引库 | 只读保留 | 导入校验通过且两个单元稳定运行 30 天后可删除 |
| 词条 `schemaVersion: 3` 的源文件 | 继续被接受 | 全部源文件机械升为 4 且无旧离线包后，删除 v3 读取分支 |

## 7. 执行交接

```text
Execution Readiness View:
- Intent Lock: 单 PWA + 多档案 + 两条轨道；P0~P1 结束时 U2 试点闭环可跑，explore 行为不变
- Scope Fence: 不改 explore 的页面、活动、贴纸与发布门禁；不重排现有目录；不新增第二套存储/校验/奖励
- Baseline Lock: 起点为 S4-00 的提交（工作区干净）与 S4-01 快照
- Approved Behavior: §13.1~§13.6
- Owner / Contract Constraints: 契约 owner=content-schema.ts；schema owner=database.ts；drill 只写 profiles/srsProgress/dailyLogs
- Compatibility Boundary: 旧源文件 v3 可读；旧 Dexie v20 可升；现有 wordId 与八张表结构不变
- Retirement Boundary: memoryApp P3 停写、P4 归档；v3 读取分支按 §6 触发条件删除
- Task Batches: P0（S4-00~S4-03）→ P1-a（S4-10~S4-12 契约与构建）→ P1-b（S4-13~S4-14 存储）→ P1-c（S4-15~S4-16 UI 与试点）
- Test Obligations: 每个任务内的聚焦测试命令 + npm run validate:content / typecheck / lint / test / build:preview；P1-c 结束跑 test:e2e
- Review Gates: S4-12 后（契约与构建）、S4-14 后（存储与迁移）、S4-16 后（试点闭环）各一次人工复核
- Drift / Rewind Rules: 契约与校验器必须同批提交；迁移测试变红立即回退到 S4-12 的提交；素材合规超出预算时停在 P1 不改契约
- Evidence Required Before Completion: 命令输出、manifest 中 tb4a 包与 schemaVersion=4、迁移测试结果、双档案手测记录
- Advisory Boundary: method-pack execution guidance only; not GateDecision, PolicySnapshot, or completion authority
```

```text
Execution Route:
- Decision: inline
- Evidence: P0~P1 的任务依次修改同一批文件（content-schema / database / build-content）且共享一个工作区，属单写者顺序执行；无独立 ownership 的并行批次
- Fallback: P2 的 8 个单元互相独立，那时可改为 subagent-driven
- User confirmation required: no
```

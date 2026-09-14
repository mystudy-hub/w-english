# W-English 实施规格

版本：1.3；日期：2026-09-12；对应 [PROJECT_PLAN.md v2.3.2](./PROJECT_PLAN.md)。本次同步儿童控件与可读性、安全区与横屏提示、PCM 中间文件、解码边界检查和核心资源缓存规则。工程状态与人工验收分别记录，逐项证据见 [规格核对记录](./qa/SPEC_AUDIT_2026-09-12.md)。

## 1. 基线、交付与文档状态

本文定义实现与验收的默认规则。工程已开始实现，当前代码覆盖范围和验证边界见 [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md)，阶段完成状态以 [STAGE0_TASKS.md](./STAGE0_TASKS.md) 为准；不能将局部测试通过视为全阶段完成。

| 阶段 | 固定交付 | 进入下一阶段的门槛 |
|---|---|---|
| Stage 0 | 10 个常见 CVC 词、一个“动物之家”场景配置、单卡/精灵音频、应用壳与场景离线、默认音量和系统减少动态效果支持 | 10 词文本/图片/音频审核、素材来源记录、两台真机验收 |
| Stage 1 内部试用 | 同场景 20 个 CVC 词、设置、卡片、亲子共读、听音选图、向导、学习事件与恢复 | 3 名儿童完成学习及间隔至少 24 小时的复习；配置/恢复用例通过 |
| Stage 2 公开首版 v1.0 | 100 个不同词、3 个场景、拼读/拼字母、高频词、解锁/贴纸、休息、家长统计和离线管理 | 全量首版内容审核、更新迁移、兼容与发布验收 |
| Stage 3 | 录音、晚安、自动调级、丰富动画、更多内容 | 使用反馈支持需求，资源与教学模型已验证 |

- 一个浏览器存储空间对应一个儿童档案，固定本地键 `local`。Stage 0~2 不建账户系统或跨设备同步。
- 家长界面和向导说明使用中文；学习对象使用统一美音。儿童页不出现内部版本号、审核状态或技术错误码。
- `wordId` 表示稳定词义身份。同词换图、改释义或重做音频不改 ID；换成另一个词义时使用新 ID。
- 当前已有的五词 `sample_words.json` 是结构示例；`stage0_words.json` 是首批候选输入，两者不能简单拼接，否则会重复收录 cat/sun。

## 2. 配置矩阵与默认值

交互模式只决定操作、热区、菜单标签和默认向导；等级决定题目选项、时间和内容上限。

| 模式 | 等级 | 热区/间距 | 听音选图 | 计时 | 释义 | 拼读阶段上限 | 默认向导 |
|---|---|---|---|---|---|---|---|
| tap | L1 | 80px / 16px | 3 图，点击 | 无 | en_young | 1 | 开 |
| tap | L2 | 80px / 16px | 4 图，点击 | 无 | en_young | 2 | 开 |
| tap | L3 | 80px / 16px | 4 图，点击 | 15 秒有效时间 | en_older | 4 | 开 |
| drag | L1 | 64px / 12px | 3 图，点击 | 无 | en_young | 1 | 关 |
| drag | L2 | 64px / 12px | 4 图，点击 | 无 | en_young | 2 | 关 |
| drag | L3 | 64px / 12px | 4 图，点击 | 15 秒有效时间 | en_older | 4 | 关 |

默认 `interactionMode = tap`、`learningLevel = L1`。未完成设置时展示家长设置页；不根据表现改变交互模式。家长在一轮中更改设置时，已生成题组保留原快照，下一轮使用新设置；音量和减少动态效果立即生效。

Stage 2 的休息间隔作用于当前使用周期，修改间隔不清零已用时间；已开始的休息截止时间保持保存。

| 家长设置 | 默认值 | 可见阶段/行为 |
|---|---|---|
| volumeCap | 0.7，范围 0.4~1.0 | Stage 0 底层生效，Stage 1 可调；静音独立操作，不把 0.4 当作最低可静音音量 |
| reducedMotion | false | Stage 0 起 `effective = 用户设置 OR 系统 prefers-reduced-motion`；Stage 1 可调 |
| guideEnabled | null | null 跟随模式；显式 true/false 覆盖；不影响题目目标词 |
| screenTimeMinutes | 8 | Stage 2 展示；建议 4~5 岁 8 分钟、6~7 岁 12 分钟、8~9 岁 18 分钟，不存出生日期 |
| bedtimeMode | false | Stage 3 |
| lockLevel | false | Stage 3，锁定自动调级 |
| micEnabled | false | Stage 3，仅 drag 模式可显示录音入口 |

家长入口固定长按 3 秒，释放或移出即取消；键盘 Space/Enter 持续按住同样生效。首次设置免此门槛。退出家长页即关闭入口授权，不长期保存“已解锁”。

## 3. 首批词表与素材生产

### 3.1 场景与词条

把首批主题明确为“动物之家”，保留一个场景的实现成本，容纳动物及常见物品。`WordEntry.theme` 是词义分类；实际呈现和资源分包以 `ThemeConfig` 为准。

| 顺序 | wordId | 词 | 音素草稿（美音） | 画面含义 |
|---|---|---|---|---|
| 1 | w_cat_001 | cat | k / æ / t | 猫 |
| 2 | w_dog_006 | dog | d / ɑ / g | 狗；口音最终由老师冻结 |
| 3 | w_pig_007 | pig | p / ɪ / g | 猪 |
| 4 | w_hen_008 | hen | h / ɛ / n | 母鸡，不能用蛋代替 |
| 5 | w_sun_002 | sun | s / ʌ / n | 太阳 |
| 6 | w_bed_009 | bed | b / ɛ / d | 床 |
| 7 | w_bag_010 | bag | b / æ / g | 可携带的包；候选用背包 |
| 8 | w_cup_011 | cup | k / ʌ / p | 杯子，不用只呈现饮料的图 |
| 9 | w_hat_012 | hat | h / æ / t | 帽子 |
| 10 | w_pen_013 | pen | p / ɛ / n | 钢笔/圆珠笔，不用铅笔 |

可校验草稿：[stage0_words.json](../data/stage0_words.json)；收词清单：[stage0_theme.json](../data/stage0_theme.json)。这些 IPA、释义、配图和分段全部等待老师审核，不因脚本通过而自动批准。

Stage 1 固定增加 rat、bat、ram、bug、map、cap、pan、net、log、pot，共 20 词。新增词沿用三字母、三个音素、单个短元音的约束；hat/cap、cup/pot 等容易混淆的图不得同时作为同一题的候选，直到配图审校明确可区分。词义图无法表达时替换词，不把专有动物词凑入数量。

### 3.2 素材清单与审核门槛

- 10 张概念图；30 个语音片段（常速词、慢速词、例句各 10）；去重后的 14 个音素片段：`k,a_short,t,d,o_short,g,p,i_short,h,e_short,n,s,u_short,b`。生产时扫描词条生成实际集合，词表调整后同步增减素材。
- Stage 0 核心向导片段：`guide#welcome`、`guide#offline`、`guide#audio_retry`；Stage 1 增加 `guide#explore`、`guide#listen_choose`、`guide#try_again`、`guide#idle`、`guide#round_end`。Stage 1 实际清单为 60 个学习语音、17 个音素和 8 个向导；20 个慢速词派生，输入 65 个 WAV。
- 上述 Stage 0/1 数量描述原学习包；当前应用另有独立 `ui_guide#rotate` 一条界面录音，不修改旧包所要求的 `guide` 集合。新版完整 Stage 1 素材连同此提示为 86 片段、66 输入 WAV。
- 英文整词/例句由 Azure Speech 预置声音生成；英语声音候选 `en-US-JennyNeural`，中文候选 `zh-CN-XiaoxiaoNeural`，S0-04 先查账户区域的 voices list 并听审，再将实际声音名称固定到生产配置。
- 音素使用老师录音或明确授权的音素库。Azure `<phoneme>` 支持音标控制，不能据此推断所有孤立音素都适合教学；Edge-TTS 不提供可依赖的自定义 SSML 路径。[R7/R8/R12](./RESEARCH_NOTES.md)
- 构建可用 emoji 占位；儿童试用使用同一版本、随包保存的 Twemoji SVG 或自有插图，避免操作系统字体造成差异。Twemoji 图形是 CC-BY 4.0，须保存原作者/来源/许可/修改记录，代码许可与图形许可分开。[R10](./RESEARCH_NOTES.md)

| 片段 | 中文草稿 | 播放时机 |
|---|---|---|
| welcome | “你好！我们一起认识新朋友吧。” | 用户解锁音频后一次 |
| offline | “先连上网，我就能把朋友们带来啦。” | 初次缺资源，且没有可用旧包 |
| audio_retry | “点一下小喇叭，我们再听听。” | 恢复播放需要再次手势 |
| explore | “点一个你喜欢的朋友，和它打个招呼吧。” | 场景前台闲置且满足向导频率限制 |
| listen_choose | “听一听，再点出你听到的图片。” | 一轮开始时，先说明再播放目标词 |
| try_again | “再听一次，试试看。” | 第一次选错 |
| idle | “点点小喇叭，听一听吧。” | 可见空闲 8 秒且满足提示频率限制 |
| round_end | “这一轮完成啦，和家人分享一下吧。” | 题组完成一次 |

首次语音故障时不能指望 `audio_retry` 一定可播放，必须同时有可点击的喇叭图标；离线提示和欢迎语随应用壳缓存。

审核顺序固定为：词义/拆分/文本/图片 → `text_approved` → 音频及精灵切片听审 → `audio_approved`。批准时记录审核人、ISO 日期和资源版本；任何已审核字段或素材变更都使对应审核失效。首版 100 词全部逐词审核。

许可台账和试听页由 S0-03/S0-04 产出，至少记录 `assetId, source, creator, license, permissionEvidence, sha256, reviewer, reviewedAt`。当前没有已购服务、已签录音授权或已审核音频的假设。

### 3.3 当前 Stage 2 活动目录

`data/catalog.json` 当前选择 Stage 2，内容版本 `2026.09.3`，来源为 `stage2_words.json` 与三个 `stage2_*.json` 场景文件。动物之家 34 词、阳光花园 33 词、快乐学校 33 词；共 89 个拼读词、11 个整词识别词。原 20 个词的 ID/顺序保留，book、blue、apple 复用原示例的稳定 ID。

当前需要 300 个学习语音、40 个公共音素及 13 个向导/界面提示，共 353 个片段。100 个慢速词派生，实际输入为 253 个 WAV。Stage 2 的 `guide` 精灵包含场景选择、拼读、拼字母、休息等 12 个片段；横屏提示单独使用 `ui_guide#rotate`。旧内容包的八个/十二个学习向导集合保持兼容，不因新增界面提示改变就绪条件。

100 张 SVG 已有来源/许可及哈希台账：自有图形、Lucide 改编图形和使用 Nunito 的整词识别图分别保存适用的 MIT、ISC/MIT、OFL 证据。许可文件随内容包保存，图片变化须同步台账并重新核对图义。当前所有词条仍为 draft，正式审批台账为空。

语音可按场景或精灵分批接入，详见 [AUDIO_WORKFLOW.md](./AUDIO_WORKFLOW.md)。任何已有候选数据、源录音或生成图片均不自动视为教学审核通过。

## 4. 页面、游戏与学习流程

### 4.1 页面和导航

使用 hash 路由，适应静态托管；浏览器入口总能回到可解锁音频的欢迎页。应用内恢复到哪一步由会话快照决定。

| 页面/路由 | 主要动作 | 恢复和异常 |
|---|---|---|
| `/#/` 欢迎 | 开始冒险；家长入口 | 先读本地设置。读取超过 2 秒显示重试/临时体验入口，不能永久空白 |
| `/#/setup` 初始设置 | 家长选模式、等级、确认 | 写入设置事务成功后才记完成；未实现设置不展示 |
| `/#/scene/animal_home` 场景 | 点击图、开始听音选图 | 每页 5 个词；缺素材的卡片有等待/重试状态；能播放的卡片可以先探索 |
| `/#/word/:wordId` 卡片 | 常速、慢速、例句、亲子开关 | 返回场景原页；切词停止旧声音；Stage 0 调试卡含音素按钮 |
| `/#/play/listen/:themeId` 题组 | 听音、选择、重播、退出 | 固定题目/选项顺序；恢复须重新点播，保留已作答/提示/奖励信息 |
| `/#/session/:sessionId/end` 完成 | 查看参与星、回场景、开始下一轮 | 不无限自动开始下一轮；复习入口只在存在到期词时出现 |
| `/#/parent` 家长 | 设置、离线状态；Stage 2 统计/管理 | 设置保存失败保留旧值并给出明确重试；退出需重新长按才能进入 |
| `/#/themes` 场景选择 | 查看三个场景、准备并进入已解锁场景 | 资格和下载状态分开；不预取未解锁媒体 |
| `/#/phonics/:wordId` 拼读 | 点单段音，或顺序拼合后听整词 | 只允许当前等级内的拼读词；切页或休息取消序列 |
| `/#/play/spell/:themeId` 拼字母 | 点击/拖拽字母、听音、揭示或下一词 | 恢复原题、字母身份及待听片段；跳过不发星 |
| `/#/stickers` 图鉴 | 查看已获贴纸与后续里程碑 | Stage 2 为静态图鉴，点击重播留至 Stage 3 |

最小线框（横屏，具体色彩沿用项目计划）：

```text
场景页                               卡片页
┌ 返回 ───── 动物之家 ───── 家长 ┐     ┌ 返回 ─────────────── 家长 ┐
│      猫图      狗图      猪图   │     │          大图片             │
│          母鸡图     太阳图      │     │          cat                │
│  上一页    听音选图    下一页   │     │   常速图标  慢速图标  例句   │
└──────────────────────────────┘     │ 亲子开关 / 展开教学提示      │
                                     └────────────────────────────┘
题目页                               完成页
┌ 退出 ─── 题目进度点 ─── 家长 ┐     ┌ 返回 ─────────────── 家长 ┐
│          重播喇叭              │     │         参与星星            │
│     选项图 A     选项图 B      │     │    回场景      再玩一轮      │
│     选项图 C     选项图 D      │     │  有到期词时提供复习入口      │
└──────────────────────────────┘     └────────────────────────────┘
```

小童隐藏上述菜单文字，用图标和语音提供相同功能；单词本身保留。亲子面板展开后须保留主要发音按钮热区，不能覆盖退出入口。

### 4.2 出题算法

1. 一轮最多 5 个不同目标词，不重复目标；候选池不足 5 词时缩短题组。
2. 候选必须属于当前场景、允许 `listenTap`、图片和目标词音频完整；发布构建只能选已审核词。听音选图不按 `phonicsStage` 筛选。
3. 普通轮优先选最多 3 个到期复习词，再选尚未首次答对的词，最后补其他词；同优先级按上次出现最早优先，时间相同再随机。复习轮仅用到期词作目标，干扰项可用其他合格词。
4. 到期：已有 `firstCorrectAt`，尚无 `reviewCorrectAt`，且 `now >= firstCorrectAt + 86_400_000`。后续熟词重玩允许，但不重复增加“复习答对词数”。更复杂的间隔复习留在后续反馈迭代。
5. L1 每题 1 正确 + 2 干扰；L2/L3 为 1 + 3。词 ID、概念图及 `confusablePairs` 均需去重。选项位置随机一次并保存，重试时不换位置。
6. 找不到足够无歧义干扰项时跳过该目标；整池不足时引导先探索，不降低既定选项数、不制造重复图片。

### 4.3 题目状态和计分

| 状态 | 允许行为 | 下一步与记录 |
|---|---|---|
| loading | 退出/重试 | 必需资源就绪才播放，不记错题 |
| promptPlaying | 退出；等待声音结束 | 完整自然结束后 `heardInQuestion = true`，开放选择 |
| awaitingAnswer | 选择/重播/退出 | 第一选择写 attemptNo=1；L3 此时累计有效计时 |
| feedback（第一次错误） | 先反馈，再重播 | 一次中性反馈，重新开放选择；不高亮答案 |
| feedback（第二次错误或超时） | 接受提示/退出 | 高亮正确图，永久设置本题 hinted=true；一次引导选择后结束 |
| completed | 下一题/退出 | 写入结果和奖励后再跳转，重复回调不重复写入 |

- 每题最多两次无答案提示选择；第二次错误后的引导点击记录为第三次且 `hinted=true`。第一次或第二次选对都可结束本题。
- 第一选择在本题完整听过后发一颗参与星，无论对错；`rewardId = questionId + ':participation'`，最多一次。单纯超时、看提示或退出不给星；超时后的真实引导选择可给参与星。
- 首次答对/复习答对只接受 `kind=select && attemptNo=1 && correct && heardInQuestion && !hinted`，不能把重试猜中记成掌握证据。
- 超时是独立 attempt（`kind=timeout, selectedWordId=null, correct=false`），占用一次首次机会；用于完成状态，不进入自动调级的有效选择分母。
- 重播声音不属于提示；高亮答案属于提示。音频失败、加载等待或切后台不算错误。
- L3 总共 15 秒有效作答时间，从首次完整目标词结束后开始；语音播放、反馈、隐藏和离开页面均暂停，重播不重置剩余时长。使用单调时钟累计，不能依赖后台 `setInterval`。
- 点退出归档本轮为 `abandoned`，已提交结果保留。意外刷新保留当前轮；正确提交后崩溃也必须从下一未完成题恢复。
- 8 秒闲置提示只在页面可见、语音空闲且向导开启时触发，一题最多 2 次、间隔至少 20 秒。每次路由变化撤销旧页面的提示计时器。

### 4.4 向导与后续规则

向导步骤固定 `welcome → explore_one → hear_one → try_listen → round_end → done`；保存完成步骤和版本号，完成过的步骤不因刷新重播欢迎。向导关闭仍记录步骤，使之后开启可以从有效位置继续。

Stage 2 的主题解锁固定为前置场景 5 个不同词的有效首次答对；贴纸固定每 5 个不同词一个里程碑。解锁资格与资源下载状态分开，下载失败不收回资格。

### 4.5 拼读、整词识别与拼字母

- 拼读词按 `graphemes` 顺序播放实际音素，再播整词；按音素区分元音、辅音、混合与静音段，不能靠字母字符串猜发音。静音字母保留视觉位置，不制造音素片段。
- `sight` 词使用整词和例句，在例句中完整高亮目标；不进入拼读或拼字母。拼字母只选当前场景内、当前 `phonicsStage` 上限允许且全部实际声音齐备的词。
- 拼字母支持一词定向练习或最多五个不同词的一轮。tap 模式按顺序点击；drag 模式可拖到下一空位，仍保留点击/键盘替代。相同字母有不同 tile ID，任一尚未使用的相同字母都可填下一相同字母位。
- 每题保存 `spelling = { tiles, placed, heardParts, pendingPart?, skipped }`。一段拼写完整后才播放其音素，双写辅音不拆成两次发音；只有自然结束才确认已听。刷新后继续未完成片段，不能跳过声音确认。
- 全部字母实际摆放完成、所需音素及完整单词自然播完后，原子写一次 `tapSpell` 参与记录、参与星和题目推进。揭示后跳过不给 attempt 或星；拼字母从不写词汇首次答对/复习答对，不采用 L3 听音选图的倒计时。
- 会话保存 `activity` 和 `contentStage` 快照，恢复按活动路由进入。Stage 2 听音有效首次答对在同一事务中补发贴纸；既有聚合进度首次进入 Stage 2 时可去重补发，无需伪造旧会话 ID。

### 4.6 前台使用与休息

Stage 2 只累计可见前台儿童页面的时间；家长页、设置页、后台、横屏提示和休息弹层暂停。单调时钟测量间隔，累积检查点按写入者、序号及周期去重，写失败后下一检查点可补交尚未保存的时间。刷新不清零。

达到阈值时记录当时题目 ID；先结束该题，再弹出休息。题目切换/归档/离开前保存计时，禁止下一题先播放再被提醒覆盖。休息使用原生模态 dialog，保留家长入口，暂停背景语音、拼读序列、闲置提示及完成页播报。

| 间隔 | 到时行为与继续条件 |
|---|---|
| 8 分钟 | 温和提醒，可选择继续或先休息，不强制等待 |
| 12 分钟 | 可先休息，或仅延长一次完整的 3 分钟；从实际提醒时的累计值计算，不因先完成当前题而缩水 |
| 18 分钟 | 保存三分钟休息截止时间，到期前不允许继续；刷新或进入家长页不会重置截止时间 |

`activityState` 持久化累计、待提醒题目、阶段、延长标记与截止时间；`restUntil` 同时写入活动会话。继续后新建使用周期，迟到的旧周期检查点不能加回时间。墙上时钟倒退时保留记录并将剩余锁定限制为最多三分钟，不造成无限锁定；本地时钟机制不承诺防止家长主动改系统时间。

## 5. 数据契约与本地存储

### 5.1 内容与配置类型

词条沿用 Schema v3，`track` 使用 discriminated union：`phonics` 必填 1~4 的阶段，`sight` 不带阶段；`spelling` 必须是逐字母数组。非 draft 的审核信息必须包含审核人和时间。

```typescript
type ThemeConfig = {
  schemaVersion: 1;
  contentVersion: string;
  themeId: string;
  title: { zh: string; en: string };
  wordIds: string[];
  pages: string[][];                  // 每页最多 5 个，覆盖 wordIds 且无重复
  listenTapWordIds: string[];         // 可配图并经审核的活动白名单
  confusablePairs: [string, string][];
  spriteIds: string[];
  unlock: { prerequisiteThemeId: string | null; requiredFirstCorrect: number };
};

type AttemptRecord = {
  id: string;                         // `${questionId}:${attemptNo}`
  sessionId: string;
  questionId: string;
  wordId: string;
  contentVersion: string;
  ts: number;                         // Unix 毫秒
  activity: 'listenTap' | 'tapSpell' | 'feed';
  attemptNo: number;                   // 从 1 开始，包括 timeout
  kind: 'select' | 'timeout';
  selectedWordId: string | null;
  correct: boolean;
  heardInQuestion: boolean;
  hinted: boolean;
};
```

`SessionSnapshot` 包含 `id, status, themeId, contentVersion, manifestId, configSnapshot, questionIds, currentQuestionIndex, questions, updatedAt, startedAt`，并保存 `activity, contentStage, restUntil` 等恢复字段；旧数据允许缺少后加入字段。每题保存目标、选项顺序、状态、已尝试次数、提示、听音标记、剩余有效时间和拼字母状态。提交前持久化题目身份，不用点击时间重建 questionId。

`settings` 包含 `settingsVersion=1, onboardingComplete, interactionMode, learningLevel, parentSettings`；`guideState` 包含 `guideVersion=1, stepId, completedStepIds`。词进度沿用项目计划中的字段并增加 `lastAskedAt` 供调度排序。

### 5.2 Dexie schema 2 表、迁移与事务

| 表 | 主键/必要索引 | 职责 |
|---|---|---|
| settings | key=`local` | 设置与初始设置完成状态 |
| guideState | key=`local` | 引导步骤 |
| wordProgress | wordId；firstCorrectAt、reviewCorrectAt、lastAskedAt | 词级聚合进度 |
| sessions | id；status、updatedAt | 固定题组和恢复快照 |
| attempts | id；questionId、sessionId、[wordId+ts]、ts | 不可变的作答记录 |
| rewards | id；sessionId、kind | 每题参与星和 Stage 2 贴纸里程碑去重 |
| contentPacks | id；state、contentVersion、updatedAt | 下载/校验/待激活/当前包及分场景元数据 |
| activityState | key=`local` | 使用周期、前台累计、延长次数、待提醒题目与休息截止时间 |

- 一次答题用同一 IndexedDB 事务写 `attempts + rewards + wordProgress + sessions`；主键已存在则读取旧结果，不再次发星或增加统计。
- 异步记录刷新只应用最新请求；清除完成后，使此前仍在等待的查询失效。题组使用递增版本跟踪全部切换，包括空状态、开始、再次退出，不只比较对象或空值。查询及休息保存不得以旧会话覆盖新界面；退出和使用时间返回还须属于原来那次使用，过期结果或错误不影响新状态。
- 退出归档失败时保留原题并显示重试提示，听音选图和拼字母均可重新点播后继续。迟到的退出操作不能清掉另一个题组，或把用户从已经切换的页面拉回旧场景。
- 开始/恢复题组在查询、内容切换和写入返回后复核页面、使用和请求版本，只保留最新开始意图。切页后再返回、隐藏、休息暂停或退出应用均使旧请求失效；旧查询不能借用下一次使用的写权限发起题组创建。已经受理的事务仍按原写锁规则完成并可随后恢复，但旧页面不发布结果或自动导航；当前有效请求失败仍给出重试反馈。
- 完整播放事件由 AudioEngine 使用唯一 playbackId，单次结束回调只发一次；常速/慢速计 heardCount，例句/SFX/音素不计。新一次真实完整播放可以再次计数。
- 同一 origin 同时只允许一个学习写入窗口。目标浏览器使用 Web Locks 持有会话锁，其他窗口停留在欢迎页并提示家长；缺少该能力的浏览器仅提供卡片探索，不能开启会话写入。Web Locks 列入目标浏览器能力检查，不能只靠 BroadcastChannel 消息判断唯一性。
- 写锁覆盖进入应用后的整次使用，包括卡片和家长设置；题组结束和主动退出题组不释放。返回欢迎页/页面离开时先保存剩余计时并等待已受理事务，再交接写入权。接手窗口重新读取设置、进度和精确会话清单。
- 临时/受限存储失败时允许内存中的卡片探索和听音，家长侧明确显示“本次记录无法保存”；不显示持久化成功。IndexedDB 未完成而 LocalStorage 仍为 true 时，重新设置或恢复数据库，不直接进入未初始化会话。
- Stage 2 取得写锁后清理超过 90 天的作答和已结束/归档题组。保留当前题组、近期记录，以及最近 20 道已结束听音题首次尝试所属的完整题组上下文；超时可占窗口，未结束题和拼字母不替代该窗口。四类聚合进度和所有已获贴纸长期保留；随废弃题组清理旧参与星，不删除对应词进度。
- 历史删除放在同一事务，失败完整回滚并在以后进入时重试，不阻断已有记录的读取。家长可导出聚合/作答/奖励；清除须在家长页再次确认，原子删除学习进度、题组、作答和奖励，重置向导，保留设置、休息状态及离线内容。
- 数据库版本与 contentVersion 独立。升级通过 Dexie 显式 migration，保留旧词 ID 的进度；遇到未知的新数据库版本不清库，停留家长恢复页。升级被其他窗口阻塞时提示关闭旧窗口。
- 当前固定 Dexie schema 2（原生 IndexedDB version 20）。从已知 v1 / 原生 10 升级前核对七张旧表、主键和全部索引；迁移只新增 `activityState` 并继承有效休息设置，不重写旧记录。未知旧结构提前中止，未来版本、无版本重试与隐式补表均拒绝。家长恢复页可只读导出现有各表；备份版本与学习导出版本分别记录。
- 24 小时条件使用本地 Unix 时间；发现时钟倒退时当轮暂停复习达标判定并保留数据。没有服务器时不能证明设备时间真实，产品不把该指标用于排名或长期能力认证。

## 6. 内容包契约与发布校验

所有 URL 同源。源词条可保留 `/images/words/cat.svg` 等逻辑资源名；发布清单将逻辑名映射到带内容哈希的真实 URL，运行时统一解析，不能把逻辑名直接拼到网站根路径。

```typescript
type AssetRecord = {
  url: string;                        // 相对应用 base，例如 content/audio/animal_home.<hash>.mp3
  bytes: number;
  sha256: string;                      // 完整 64 位小写十六进制
  mime: string;
};

type ContentManifest = {
  manifestVersion: 1;
  schemaVersion: 3;
  contentVersion: string;
  appContract: { min: number; max: number };
  stage?: 0 | 1 | 2;
  mode: 'preview' | 'release';
  catalogAssetId: string;
  missingAudio: string[];
  builtinSprites?: Array<'sfx'>;
  assets: Record<string, AssetRecord>; // 逻辑资源 ID → 文件；包含词库、场景、精灵清单、图像/音频
  sprites: Record<string, string>;     // spriteId → 对应清单的 assetId
  packs: Array<{
    id: string;
    themeId: string | null;            // null 为公共资源包
    dependsOn: string[];
    assetIds: string[];
  }>;
};
```

清单本身位于不可变 URL；小型 `content/index.json` 指向该清单及其哈希，启动时联网查询、离线读已验证副本。每个会话固定 manifest/version，途中发现更新只暂存。

应用支持内容契约 1 和 2；Stage 2 清单要求契约 2。公共资源使用 `themeId=null` 的包，各场景包声明公共依赖。包记录保存 `requestedThemeIds`、`readyThemeIds`、`activeThemeId`；ready 同时要求文件实检通过和就绪元数据成功提交，不能只看磁盘上存在文件。

精灵清单保存 `audioAssetId, durationMs, sampleRate, channels, sprite`，`sprite[clipId] = [offsetMs, durationMs]`。适配器把 audioAssetId 解析成 Howler 的 `src`；单词中的 `sprite#clip` 先查 sprites 再查 clip，查不到不能静默当作已听过。

发布校验分层实施：

| 检查 | 必须拒绝的输入 |
|---|---|
| 结构 | null/非对象、非逐字母 spelling、类型错误、无效枚举、重复词 ID、缺失审批时间 |
| 教学基础约束 | 分段拼接不符、无效音素、非 CVC 被标为阶段 1；程序检查不能代替老师核对真实发音 |
| 场景 | 引用缺词、页面漏词/重复、活动白名单越界、干扰项约束不可满足 |
| 素材 | 引用不存在、图片无 alt、emoji 占位混入试用包、许可记录缺失、哈希/大小不符 |
| 音频 | 不存在的 sprite/clip、负时间、零时长、切片越界、非法重叠、最终文件真峰值超限 |
| 发布包 | draft/text_approved、空词库、阶段要求数量不足、应用契约不兼容、不完整包被标记 ready |

S0-02 将现有零依赖检查迁移到 Zod + 跨字段规则，保持原命令兼容。S0-04 补真实文件和音频检查；审核日志与发布包清单一起归档。仅查看 `review.status` 不足以证明素材可发布。

## 7. 音频实现规格

### 7.1 构建生产

1. 输入为经文本审核的词条、固定音色/口音、音素原始素材；普通 TTS 密钥只存在于构建机环境，不进入 Vite 的客户端环境变量或产物。
2. 统一保存无损 PCM 中间文件。慢速词使用 FFmpeg `atempo=0.75` 生成保音高版本，再听审；Howler 播放所有片段均设 `rate=1.0`。[R11](./RESEARCH_NOTES.md)
3. 普通语音可测量时使用双遍 loudnorm，目标 -16 LUFS，完成后重新检查编码产物真峰值 ≤ -1 dBTP。极短音素或无效响度读数走参考录音增益校准，记录例外、不能无限放大噪声。[R11](./RESEARCH_NOTES.md)
4. 每段前后各 150ms 静音；按 PCM 时间建立清单，sprite 指向实际有效片段，不含填充。编码为 mono MP3 后再解码检查边界，不能认为 MP3 填充会自动保证精度。
5. 每个场景一个学习语音精灵，公共音素、SFX、向导分别管理；超出预算按清单拆成多个精灵，词条仍使用逻辑 sprite 引用。
6. 每个最终 clip 在目标设备试听。爆破音不使用会吃掉开头的渐入；必要的去点击处理最多 5ms，并记录是否影响音素。

规范化单片段和填充后的整精灵 PCM 均保存为 24kHz、mono、16-bit 无损 WAV，位于 `artifacts/audio/pcm/`，索引的 `pcm` 字段保存文件名和哈希。整精灵中间文件保留编码前声音；最终衰减量由 `postGainDb` 记录。中间文件不加入儿童应用预缓存。分批保留时核对 PCM 哈希、格式和单片段规范化哈希。

编码后实际解码为 PCM，检查解码时长与清单相差不超过 50ms、每个切片均在实际帧范围内且不是全静音。构建/素材校验再次执行此检查，不仅相信生产报告。此项不能代替老师检查发音或实机听审。

生产命令支持 `--theme` 或 `--sprite` 分批选取完整精灵。先校验所有所选输入及保留文件，再编码，最后在排他锁下原子替换合并索引；失败不发布部分索引。慢速派生源必须属于所选集合，公共精灵不因场景批次被截短。

生产及审批记录保存 `promptSha256`，绑定引用、语言、文字、整词 IPA、音素与速度要求。源文件、最终 MP3、切片区间或对应文案/发音要求变化时，旧批准失效。预览忽略过期精灵，正式构建拒绝缺少当前指纹/审批的内容。

### 7.2 运行时调度

唯一 AudioEngine 持有全局 Howler、一个语音通道和一个轻音效通道；一个已加载精灵对应一个 Howl，组件卸载不能各自新建全局播放器。[R6](./RESEARCH_NOTES.md)

| 请求 | 处理 |
|---|---|
| 儿童点播新词/重播 | 取消上一条儿童语音和待播旧向导，播放最新请求；不累计长队列 |
| 拼读序列 | 同一 sequenceId 内顺序播放；新手势可取消整个序列 |
| 向导 | 仅语音空闲时播放；最多保留一个仍适用的提示，超过 3 秒或路由改变即丢弃 |
| SFX | 短音效低音量；连续快速点击最多每 100ms 一次，晚安/减少动态效果按配置处理 |
| 路由退出/页面隐藏 | 停止所属语音和未播提示，暂停计时；取消事件不生成 heard/completed |

首次点击中同步准备 Howler.ctx 并调用 resume，不能先 await 数据库、网络或长动画。回前台重新检查 `running/suspended/interrupted/closed`；在下一次手势内尝试恢复或重建，失败保持可重试图标，禁止无界递归 resume。[R5/R6](./RESEARCH_NOTES.md)

AudioEngine 返回 `ended | cancelled | failed`，调用方不能用固定 setTimeout 假装播完。只在自然结束时递增 heardCount、开放首次选择。音量使用统一 master cap；应用静音不需要改变系统音量。

在浏览器提供 `mediaDevices.devicechange` 时尝试 300ms 淡出、300ms 淡入；期间仍使用即时家长音量上限，不解除静音、不枚举设备或请求录音权限。浏览器不发设备事件时无法提供这项缓冲，必须另作真机验收。

## 8. 离线内容包与更新协议

### 8.1 应用壳与学习包

- 采用 `vite-plugin-pwa` 的 `injectManifest`，自定义 `src/sw.ts`；Workbox 预缓存应用壳、字体、核心欢迎/离线提示，不把所有场景音频塞进构建预缓存。[R2](./RESEARCH_NOTES.md)
- SW 安装时就缓存壳；用户开始后才请求场景和其公共依赖。`onOfflineReady` 不能代表学习包已就绪。
- 核心预缓存只包含 `core/index.json` 当前引用的文件，旧哈希文件可留供旧客户端读取，但不自动加入新壳预缓存。核心界面提示作为兜底注册，在切换旧学习包时仍可使用。
- 家长显示 `未下载 / 下载中 x% / 已就绪 / 失败 / 空间不足`。百分比按已校验文件字节数除以必需文件总字节数，重试不重复累计，全部验证前不显示 100%。
- 首次包未齐时允许已完整下载的卡片探索；出题仅从真实就绪素材构建。已有旧完整包时继续用旧包，不混用新旧词条和音频。
- Stage 2 下载与进度按所选场景及依赖计算，未解锁媒体不预取。其他场景缺音频或提交失败时，已就绪场景保持可用；家长可分别暂停/继续准备。内容更新只预备已请求场景在新版中的对应包，活动会话固定精确清单。

### 8.2 下载和原子可见性

1. 取 index 和 manifest，检查版本、应用契约、依赖闭包及逻辑引用；不兼容则保留旧版并通知家长下次更新应用。
2. 从当前缓存复用同 SHA-256 的文件，其余并发最多 2 个请求；必须拿到完整 HTTP 200，再核对 bytes/hash 并写 staging 缓存。
3. 每文件最多重试 3 次，退避 1/2/4 秒；失败保留已验证文件。下次启动逐文件复核后续传，不声称支持 MP3 的分块断点续传。
4. 全部必需文件验证后，用 IndexedDB 事务把包置为 ready。Cache API 与 IndexedDB 没有跨库事务，所以始终先写缓存、后写就绪元数据；崩溃后的部分包保持不可激活。
5. 下一次开始新学习会话时切换 active 指针，并将 contentVersion 保存进会话快照。首次安装可在尚未开始题组的场景页激活；进行中的题组不切换。
6. 至少保留当前版本和前一个完整版本。只有没有活动会话引用的旧文件才能清理；共用文件按引用关系保留。清理失败不能删除进度表。
7. 每次启动检查当前包必需键仍存在；缺失则标记 degraded，优先回到另一完整版本，联网修复。浏览器随时可能回收 best-effort 数据，ready 标记不能永久代替文件检查。[R4](./RESEARCH_NOTES.md)

`navigator.storage.estimate()` 仅用作预估；捕获实际 `QuotaExceededError`，先清理未引用旧包和废弃 staging，始终保留正在使用的完整包。家长主动下载可请求 `navigator.storage.persist()`，拒绝后仍可使用，不能承诺永久保存。[R4](./RESEARCH_NOTES.md)

缓存修改使用独立 Web Lock 串行协调；清理保留当前、前一完整版本、活动会话、待切换内容和共用文件。家长可暂停准备并按已验证文件续传；暂停不会使部分包变为 ready。取消与请求超时使用 `AbortController` 组合实现，不依赖最低目标浏览器未普遍支持的静态 `AbortSignal.any/timeout`。

### 8.3 Service Worker 生命周期

采用等待更新语义，不启用 `registerType: 'autoUpdate'`，不主动 `skipWaiting()`，不在 controllerchange 时无条件 reload。官方文档说明 autoUpdate 会强制启用 skipWaiting/clientsClaim，无法直接满足本项目的使用中不更新要求。[R3](./RESEARCH_NOTES.md)

新 SW 等全部旧受控页面关闭后自然激活。首次安装和自然激活时可 claim 客户端；不为越过旧会话而强制激活。家长文案为“更新将在关闭所有应用窗口并重新打开后使用”，不保证单次刷新就更新。

应用壳随 SW 版本更新，内容包可独立更新，但必须满足 appContract。Dexie 迁移失败不能通过删除数据库恢复；回退应用必须兼容现有数据库版本，否则保留数据并暂停进入学习。

### 8.4 音频缓存与托管路径

Web Audio 使用完整文件。音频路由同时处理可能的 Range 请求，使用 Workbox RangeRequestsPlugin；只把完整 200 响应入缓存，不能把播放时取得的 206 局部内容当完整离线文件。[R9](./RESEARCH_NOTES.md)

主部署 Cloudflare Pages，所有内容同源。应用、manifest、SW scope 和资源解析均使用同一 `BASE_URL`；离线 hash 路由回到同一 index.html。S0-07 增加 `/w-english/` 子路径预览检查，以保留 GitHub Pages 迁移能力。

HTML、webmanifest、SW 和两个可变索引（`content/index.json`、`core/index.json`）使用 `no-cache`；带哈希的脚本、字体、图片、音频及清单可使用长期 immutable 缓存。`_headers` 的可变索引规则不得与长期缓存规则重叠，实际托管响应仍需在部署环境复核。

## 9. 界面、兼容与性能预算

### 9.1 设备和视觉

- 最低目标 Safari/iPadOS 16.4、Android 10 + Chrome 111；同时测试两平台当前稳定版本。前者来自 Vite/Tailwind CSS 的最低浏览器能力要求，不能写成“已通过”。开发 HMR 也不能替代生产构建的旧版本验证。[R1/R13](./RESEARCH_NOTES.md)
- Safari 标签页与主屏应用分别联网打开并完成缓存，再各自验证离线冷启动；不能假定不同安装容器自动共享已下载内容。
- 真机首选 iPad 第 9 代或同等 10 英寸设备，Android 选 4GB RAM 的 10 英寸设备；实际型号和版本写入任务验收表。设备拿不到时保留待测，不能用 Playwright WebKit 代替 iPad 结果。
- 最小可用布局视口 960×600 CSS px；横屏、可处理安全区。竖屏/过小窗口用旋转图标和语音提示进入横屏，家长入口仍可访问。
- 可用尺寸扣除 `safe-area-inset-*`，内容与固定弹层避开遮挡区。横屏提示使用原生模态 dialog，保留键盘焦点循环与家长入口；有录音时可播放独立横屏提示，无录音时图形和文字仍可用。
- 学习文字默认 ≥20px，单词 48~64px；深色正文配浅色背景，普通文字对比度 ≥4.5:1、大字/关键图标 ≥3:1。不能依靠红绿颜色表示正误。
- 可点击元素具有键盘焦点、语义 button 和可理解的 accessible name；减少动态效果时禁止弹簧位移、循环跳动和粒子，淡入 ≤150ms。
- 字体本地打包及附许可；首版用 Nunito 与系统中文字体，缺字回退，避免额外下载整套大型中文字体。

### 9.2 初始预算（项目目标，S0 实测后可有记录地调整）

| 指标 | 初始门槛 | 测量方式 |
|---|---|---|
| 壳资源首次压缩传输 | ≤1.5 MiB，含必要字体/提示，不含场景 | 生产构建网络记录 |
| Stage 0 / Stage 1 学习包 | ≤8 / 12 MiB，包含公共依赖 | manifest bytes 求和 |
| 单精灵 | ≤4 MiB，语音时长 ≤180 秒，mono | ffprobe + manifest |
| 已解码音频总量 | ≤64 MiB，同时仅加载当前场景和公共音频 | `ctx.sampleRate × channels × seconds × 4` 求和；以实际 AudioContext 采样率计算 |
| 热缓存点击视觉响应 | p95 ≤100ms | 每台真机至少 30 次 |
| 已解码音频开始响应 | p95 ≤250ms | 同上；冷加载另记，不混入热播放指标 |
| 冷启动到可点开始 | ≤4 秒，10Mbps/80ms RTT | 记录网络条件与生产版本 |
| 完整缓存后离线重开 | ≤3 秒到可操作欢迎页 | 飞行模式，真正关闭再启动 |

MP3 文件大小不能代表解码内存；AudioContext 可能以设备采样率重采样。离开场景后停止任务并 unload 不再使用的精灵，再加载下一场景。

## 10. 工程基线与模块边界

### 10.1 依赖和版本

- Node 24 LTS。研究时官网列出的最新 LTS 为 24.21.0；本轮保留并验证工作区已有的 **24.19.0 / npm 11.17.0**，避免在应用开发中未经验证改动全局运行时。`.node-version`、packageManager、lockfile 和 CI 配置已写入；后续补丁升级单独验证。[R14](./RESEARCH_NOTES.md)
- Vite 8（本次文档版本 8.2.2）、React/react-dom 18.3.1、TypeScript、Tailwind CSS 4、Zustand 5、Dexie 4、Howler 2、vite-plugin-pwa、Zod。沿用已选 React 18，避免在计划补充中引入额外框架迁移。
- 测试采用 Vitest + Testing Library（纯规则/组件）、Playwright（浏览器流程），真实设备手工验收音频和 A2HS。
- 精确补丁已在 package-lock.json 锁定，并通过实际安装、peerDependencies 检查和本地构建。继续使用 save-exact 和 npm ci，依赖更新后重新验证，不使用浮动 latest 作为发布依据。

### 10.2 计划目录

```text
src/
  app/             入口、hash 路由、错误边界、配置加载
  features/        welcome、setup、scene、word-card、listen-tap、parent、guide
  domain/          选题、进度、奖励、配置的纯规则
  data/            Zod 契约、Dexie、迁移与内容加载
  services/        AudioEngine、ContentPackManager、会话锁
  components/      共用儿童按钮、图卡、状态反馈
  sw.ts            Workbox 路由与应用壳缓存
data/              词库源文件、场景源配置
scripts/           校验、语音生成、精灵打包、素材检查
public/content/    构建出的可发布内容；源素材/凭据不放这里
tests/             规则测试、浏览器流程、迁移 fixtures
```

组件不直接写 IndexedDB 或创建 Howl；domain 不依赖 DOM；音频/存储/随机数/时钟通过明确接口注入，便于验证 24 小时边界和重试去重。

### 10.3 命令与 CI 契约

以下 npm 命令已创建，实际验证范围见开发状态。缺少真实素材和审批时，发布命令必须失败。

| 命令 | 作用 |
|---|---|
| npm run dev | 本地开发；不作为离线验收环境 |
| npm run validate:content | 结构、语义基础、场景引用检查 |
| npm run validate:assets | 真实文件/哈希/精灵/授权台账检查 |
| npm run typecheck / lint / test | 类型、静态检查、关键规则与组件 |
| npm run build:preview | 允许明确标识的 draft，供内部开发 |
| npm run build:release | 拒绝草稿/缺素材/不兼容清单后构建静态站 |
| npm run preview | 使用生产构建测试；真机通过 HTTPS 预览域名访问 |
| npm run test:e2e | 本地 HTTP localhost 可测 SW；另保留真机证据 |

CI 顺序：npm ci → 内容检查 → typecheck/lint → 关键测试 → 构建 → 浏览器冒烟；发布任务额外执行 release 素材门禁。编译、安装和日常测试不自动调用付费 TTS，语音生产是独立显式任务。CI 不因没有真实审核素材而把 preview 当成 release。

## 11. 验收与后续阶段交接

Stage 0 的可执行步骤和记录表见 [STAGE0_TASKS.md 第 5 节](./STAGE0_TASKS.md#5-验收用例与证据记录)。必须记录测试人、时间、设备、应用/内容版本、结果和证据路径；文档中的预期结果不等于测试结果。

Stage 1 验收必须覆盖六组合配置、每题最多一星、首次选择与重试、超时/提示分离、23:59 与 24:00 小时复习边界、刷新重试事务、双窗口写锁、向导恢复、存储不可用体验及到期词选题。上述规则已有工程测试，真实教学和设备验收仍须独立执行。

儿童试用至少 3 人，每人一次最多 5 题的学习轮和一次满 24 小时后的复习轮，家长在场，记录完成题数、必要成人协助次数、停滞步骤和设备。样本覆盖 tap/drag；若未覆盖 8~9 岁，报告中注明该年龄段尚未验证。3 人试用用于发现可用性问题，不据此宣称教学效果显著。

Stage 2 必测中断下载、缓存缺失、空间不足、应用/内容版本错配、waiting SW、多窗口更新、Dexie 迁移/回退和词下架。新增 phonicsStage 2~4 内容先补通过审校的代表样例及显示规则，尤其双字母、静音 e 和 consonant-le，不由前端按字符串猜发音。

当前工程已实现上述 Stage 2 流程并记录自动化证据；100 词仍为待审候选。素材生产、逐词审核、最低浏览器和真机、儿童观察、HTTPS 与远端 CI 条件见 [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md)，不得因自动测试通过而跳过。

## 12. 决策记录与未决资源

| 决策 | 原因 | 重新评估触发条件 |
|---|---|---|
| 单场景收动物与物品，10→20 个 CVC | 可列出常见、可配图的实际词；维持单场景成本 | 老师否决词义/发音/配图 |
| 听音选图两种模式都点击 | 测声音到词义的联系，无须额外拖拽目标 | 儿童试用提供明确证据 |
| 官方 TTS 整词 + 审核音素素材 | 避免把字母名当拼读音；保留生成接口替换能力 | 服务条款/预算不可用或听审失败 |
| injectManifest + 等待激活 | 满足独立内容包、恢复与使用中不刷新 | 两平台生命周期测试不通过 |
| Stage 1 提供音量/减少动态效果设置 | 与初次儿童试用一起验证基础体验 | 无，属于基础体验 |

仍待负责人落实的外部条件：老师、语音服务账户和预算、素材授权、目标真机、HTTPS 预览域名、儿童试用安排。对应任务设明确门禁，开发可先做不依赖资源的脚手架和规则，但不能将缺少证据的审核/实机结果标为完成。

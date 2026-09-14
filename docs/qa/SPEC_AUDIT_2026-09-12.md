# 实施规格逐项核对 · 2026-09-12

对象为 [IMPLEMENTATION_SPEC.md v1.3](../IMPLEMENTATION_SPEC.md) 和其中引用的 [Stage 0 任务清单](../STAGE0_TASKS.md)。保留 Stage 0～3 的原始范围与进入条件；没有把“工程预览可运行”改写成“正式版本已交付”。

**结论：工程路径已有代码及下列本地证据，完整目标尚未达成。** 真实语音、文本/图片与音频审批、目标设备/安装容器、儿童真实复习和发布环境证据均未取得。用户已安排语音随后提供，这一外部条件在此前多轮持续存在；本次仍没有源录音目录、正式音频索引或审批记录。

状态：**E**＝所列工程范围已核对；**R**＝还需真实资源、人工或外部运行证据；**C**＝规格明确的条件阶段，启动条件尚未满足。E 不代替同项的 R，也不代表真实发音、所有设备或正式发布通过。

## 现场证据

| 核对项 | 本次观察 |
|---|---|
| 活动输入 | `data/catalog.json` 为 Stage 2；100 词、三场景 34/33/33；内容版本 `2026.09.3` |
| 规则、存储、工具 | 24 个文件、163 项单元测试通过 |
| 浏览器 | 44 项 Chromium 浏览器流程通过；横屏文字调整后补测安全区场景通过 |
| 构建与静态检查 | typecheck、lint、preview 构建通过；17 个壳预缓存条目，约 693.3 KiB 原始文件大小 |
| 素材文件 | 109 个当前清单文件大小/哈希/许可检查通过；353 个语音明确缺失 |
| 真实录音 | `audio-source/` 不存在；`artifacts/audio/index.json` 不存在 |
| 审批 | `content-approvals.json.words`、`audio-approvals.json.clips` 均为空；100 词仍为 draft |
| 发布门禁 | 当前 release 命令退出 1，逐词拒绝 100 个未审核词；不是成功发布 |
| 实际设备记录 | `docs/qa/stage0/` 尚无验收资料；原测试登记行仍为未测 |
| 依赖 | Node 24.19.0 / npm 11.17.0；`npm ls --depth=0` 正常，版本与精确依赖声明相符 |

声音测试仅使用私有测试目录/HTTP 响应中的非语言信号，不写入教学源目录。布局测试使用真实 100 词目录的代表页面，不代表老师已逐词核对图义或发音。当前没有远端 CI 和 HTTPS 部署的同版本验证链接。

## 1～3：交付、配置和内容

| 规格项目 | 状态 | 实现与直接证据 | 尚缺的验收 |
|---|---|---|---|
| §1 Stage 0：10 CVC、单场景、卡片/音频/离线 | E/R | `data/stage0_*`、`stage1-catalog.test.mjs`、`app.spec.ts`、`offline-audio.spec.ts` | 10 词批准、真实音频、两台设备 |
| §1 Stage 1：同场景 20 词与设置/共读/听音/恢复 | E/R | `data/stage1_*`；`stage1-catalog`、`lesson`、`guide`、`single-writer` 用例 | 儿童与满 24 小时复习 |
| §1 Stage 2：100 词/三场景及全部列出的活动/家长管理 | E/R | `stage2-catalog`、`spelling`、`themes`、`stickers`、`usage`、`history-management` 与浏览器流程 | 全量审校、真实兼容/发布验收 |
| §1 Stage 3：录音、晚安、自动调级、丰富动画、扩词 | C | 规格明确要求使用反馈、资源与教学模型验证；当前不显示未生效设置 | 尚无支持启动的反馈/资源证据，不能记完成 |
| 单个本地档案、免账户/同步 | E | `models.ts`、`database.ts` 的固定 local 键；应用无账户或云同步接口 | — |
| 中文家长/向导；儿童页无内部版本/审核/错误码 | E/R | 页面源代码、`app.spec.ts` 故障文案及 `guide-recovery.spec.ts` | 实际中文/美音素材听审 |
| 稳定词义 ID、示例不直接拼接 | E/R | `stage2-catalog.test.mjs` 检查原 10/20 词及 book/blue/apple ID | 词义是否改变仍由老师判断 |
| §2 tap/L1、tap/L2、tap/L3 | E/R | `config.ts`；六组合规则测试；三图/四图与 L3 计时浏览器流程；tap 布局测量 | 真实儿童与目标设备体验 |
| §2 drag/L1、drag/L2、drag/L3 | E/R | 同一配置表与规则测试；drag 拼字、点击替代与布局测量 | 同上 |
| 80/64px 热区、16/12px 间距、标签/默认向导 | E | `styles.css`；`accessibility.spec.ts` 测实际边界/间距/名称，tap 标签隐藏；`guide.spec.ts` | 手指操作与协助次数需儿童观察 |
| L1 默认、首次设置、当轮配置快照 | E | `setup.tsx`、`learning-repository.ts`；`repository`、`guide.spec` 设置跨轮与恢复用例 | — |
| volumeCap 默认 0.7、范围 0.4～1、独立静音 | E/R | 设置 schema、`audio-engine.test.ts`、浏览器静音后重播 | 设备实际声音体验 |
| reducedMotion：家长 OR 系统 | E | `config.ts`、`app.tsx`、减少动态效果下的拼字/布局用例 | 两平台系统设置验收 |
| guideEnabled：null/true/false | E | 配置纯规则与 tap/drag/关闭向导浏览器用例 | 真实录音 |
| screenTimeMinutes：8/12/18；不采生日 | E | 设置 schema、家长表单、`usage` 与 `rest.spec.ts` | 年龄建议需真实使用反馈 |
| bedtimeMode/lockLevel/micEnabled | C | 默认值存在、Stage 2 不暴露控制；录音不在本版本启用 | Stage 3 条件 |
| 家长入口长按三秒、释放/移出/失焦取消、键盘处理 | E/R | `ui.tsx` 的 pointer/Space/Enter/blur 处理；浏览器完整/不足时长、移出、焦点和入口验证 | 目标设备键盘/触控最终验收 |
| 退出家长页撤销授权、首次设置免门槛 | E | `router.ts`、`welcome/setup/parent`；双窗口与恢复用例 | — |
| §3.1 十词、Stage 1 固定扩词及排歧 | E/R | 原始 JSON 与 `stage1-catalog.test.mjs` 的词序/图引用/易混淆对检查 | IPA、释义、概念图的人工判定 |
| §3.2 常速/慢速/例句、去重音素与向导清单 | E/R | `audio-inventory.mjs`；当前 353 片段/253 输入 WAV；旧学习向导集合保留 | 实际源录音 |
| Azure 候选音色/固定美音、授权音素来源 | R | 仅有候选和 WAV 接口；按用户安排等待素材，没有假定账户或预算 | 实际来源、声音选择及授权 |
| 图片、alt、许可、原作者/修改/证据/哈希 | E/R | `illustration-licenses.json`、`assets/licenses`；100 图真实字节/许可检查 | 教学图义审核；素材权利人的实际依据需发布前复核 |
| welcome/offline/audio_retry/explore/listen_choose/try_again/idle/round_end | E/R | `guide-content.ts`；`guide`、`guide-recovery`、`lesson` 用例 | 真实向导录音 |
| choose_world/blend/spell/rest 与独立 rotate | E/R | 场景/拼读/拼字/休息代码；独立 `ui_guide`、核心兜底与安全区语音用例 | 13 个录音及批准 |
| 文本/图片先审、再听最终切片；变更使审批失效 | E/R | `content-audit`、`audio-audit`、`review-workflow`、浏览器审核；文字/IPA/速度指纹 | 当前两个审批台账为空 |

## 4：页面、选题和学习规则

| 规格项目 | 状态 | 实现与证据 |
|---|---|---|
| 欢迎/初始设置与存储失败入口 | E | `welcome/setup/storage-recovery`；`app`、`storage-recovery.spec.ts` |
| 场景五词分页、卡片/慢速/例句、亲子开关 | E/R | `scene/word-card`；普通与共读页面可点击、无插图遮挡的布局检查；真实语音待供 |
| 听音题组、完成页与到期复习入口 | E/R | `lesson.tsx`、`questions.ts`；轮次完成、重播、重试及边界规则测试；真实复习待测 |
| 家长页、三场景入口、拼读、拼字、贴纸路由 | E | 对应 feature 文件；`themes`、`spelling`、`history`、`rest` 浏览器流程 |
| 4.2-1：最多五个不同目标，候选不足时缩短 | E | `questions.ts`、`learning.test.ts`、定向一词/五词拼字用例 |
| 4.2-2：场景/活动/素材/批准资格，听音不按拼读等级筛 | E/R | `createSession` 的候选条件、readyIds 与 release 分支；素材/批准的真实性仍待人工 |
| 4.2-3：最多三个到期词、新词优先、上次最早/随机；专门复习只用到期词 | E | 选题代码、普通三复习/专门五复习测试、进度 lastAskedAt |
| 4.2-4：24h 精确边界与只累计一次复习答对 | E/R | `learning.ts`、epoch-zero/23:59/24:00 边界与事务测试；真实 24h 尚无证据 |
| 4.2-5：3/4 图、ID/图引用/排歧、随机一次后保存 | E/R | `chooseOptions` 与每个白名单词出题检查、保存恢复；视觉上是否易混仍须老师审图 |
| 4.2-6：无合法干扰项时跳过，不降低选项数 | E | 选题回溯与不足/冲突候选反例 |
| loading/promptPlaying/awaitingAnswer 状态约束 | E/R | `reduceAnswer`、音频自然 ended、仓储与浏览器先听后选测试；实际声音待审 |
| 第一次错误、第二次错误、超时和引导选择 | E | 规则及浏览器双错高亮；第二次选对不造提示；提示保持到结束 |
| 每题第一真实选择一颗参与星，重复回调去重 | E | participation ID、同事务保存；并发/重试/无选择退出及超时反例 |
| 首次/复习证据严格 first-select + heard + correct + unhinted | E | `applyLearningEvidence` 与对应反例；拼字/超时/重试不算掌握 |
| L3 15秒、播放/后台/离开暂停、重播不重置 | E/R | ActiveTimer、持久化剩余值、重播浏览器测试；真实中断另验收 |
| 归档、刷新、提交后恢复、退出失败可继续/重试 | E | repository、session-exit、single-writer；新题和新访问不被迟到结果覆盖 |
| 闲置 8秒、20秒间隔、每题两次、退出取消 | E | IdleGuideClock、claimIdlePrompt、guide.spec 持久化预算 |
| 向导步骤、关闭后继续记录、恢复不重复欢迎 | E/R | `advanceGuide`、仓储各行为、guide-state/intro 恢复；录音验收待供 |
| 前置场景五个不同词解锁、资格独立于下载 | E | themes/stickers 规则及实际五题解锁；锁定路由/媒体不能绕过 |
| 每五词贴纸、参与星独立、旧进度补发去重 | E | stickers/repository；浏览器一枚贴纸及清除后归零 |
| 拼读顺序与元音/辅音/混合/静音分类 | E/R | 显式音素映射、spelling/phonics 代码与用例；教学拆分仍待审核 |
| 高频词整词高亮、不进入拼读/拼字 | E/R | discriminated union、catalog 与活动筛选；图义和教学用途待老师 |
| 拼字点击/拖拽/键盘替代、重复字母/双写辅音、待听片段恢复 | E | spelling 状态与浏览器点选/拖拽/刷新；原声结束后才记录 |
| 全部拼好才发星、揭示/跳过无星、无 L3 拼字倒计时 | E | 完成事务、跳过五题与定向拼字用例 |
| 8/12/18 分钟、前台统计、家长/隐藏/不适尺寸不计 | E/R | UsageState、ForegroundUsageClock、休息与安全区测试；实际设备长时间试用待验收 |
| 当前题后提醒、一次完整三分钟延长、三分钟锁定/刷新截止时间 | E | usage/rest 用例；下一题在提醒前未产生听音证据 |
| 旧周期/旧访问结果无效，时钟倒退不无限锁定 | E | usage 与 runtime-records 的累计/版本/回退/迟到检查 |

## 5～8：数据、音频与离线

| 规格项目 | 状态 | 实现与证据 |
|---|---|---|
| Schema v3、phonics/sight、逐字母 spelling、非 draft 审批字段 | E | Zod strict/discriminated schema 与结构/跨字段反例 |
| ThemeConfig/AttemptRecord/SessionSnapshot/设置与向导版本 | E | schema/models、仓储快照；原题序、活动、等级、manifestId 恢复 |
| 八张表、原子 attempts/rewards/progress/session、playback 去重 | E | `database.ts`、`repository.test.ts`、失败回滚及并发测试 |
| 整次使用写锁、交接排空、无 Web Locks 仅卡片 | E | SessionLock 测试及 single-writer 四条浏览器用例 |
| 开始、恢复、内容激活、清除等异步取消 | E | runtime-records/session-start 共 21 项；真实 IDB 阻塞下旧查询不借新锁创建题组 |
| 90 天明细清理、保留聚合/贴纸/当前及最近二十题 | E | historyRetentionPlan；边界、重跑、回退和回滚测试 |
| 家长导出、再次确认清除、保留设置/休息/下载 | E | history-management 与 history.spec 实际下载 JSON、取消/确认与重载 |
| 已知 v1→v2、拒绝未知/未来/隐式补表、失败不清库 | E | database-migration：七表逐表一致；未知布局；配额失败回滚后重试；local-backup |
| 缺少数据库时不造空备份；恢复只读导出原表 | E | local-backup 与 storage-recovery.spec |
| 同源 URL、base、不可变 manifest/index 哈希和内容契约 1/2 | E | content-schema/packs；真实子路径构建与离线验证 |
| 结构、重复 ID、CVC、场景分页/白名单/排歧拒绝 | E | schema/catalog 与 CLI 校验，所有当前白名单目标可构造合法选项 |
| 图片 alt/文件/许可、音频引用/时长/越界/重叠、草稿门禁 | E/R | schema + validate-assets + release 负例；真实全包正向发布还没有输入 |
| 7.1-1：固定口音/声音、构建机持有服务凭据 | E/R | WAV 入口，不在客户端调用付费服务/读取 TTS 密钥；真实声音/服务尚未落实 |
| 7.1-2：无损 PCM、atempo 0.75、播放 rate=1 | E/R | 单段/整精灵 WAV 与哈希保存、ffprobe 实测 pcm_s16le；实际原声待供 |
| 7.1-3：双遍 -16 LUFS、峰值≤-1、短音素参考增益 | E/R | 真工具处理、最终真峰值检查、calibrationRequired 审批约束；不能替代老师校准 |
| 7.1-4：前后150ms、有效切片、编码后解码边界 | E/R | PCM 填充/帧长断言、实际解码时长/越界/全静音反例；目标设备切片听审待测 |
| 7.1-5/6：分精灵/预算/最终试听、不吃爆破音 | E/R | 当前六个学习精灵及公共组、4MiB/180秒限制；发音边界的真实听审未取得 |
| 分批完整精灵、原子索引、并发锁、保留文件复核 | E | 实际编码/分批替换/缺文件/损坏 MP3或PCM/另一写入者测试 |
| 文本/IPA/音素/速度、源/最终文件及切片共同绑定审批 | E/R | promptSha256 与审核导入反例；正式审批为空 |
| 7.2：单语音/单SFX、最新请求、序列取消、向导3秒过期 | E/R | AudioEngine 与页面生命周期测试；真实音频环境另验收 |
| 同手势解锁、suspended/interrupted/closed、失败重试、不伪造 ended | E/R | 浏览器实际播放测试信号、假后端中断/重建/取消；真实iOS中断待测 |
| 音量 cap、独立静音、SFX降幅/100ms限流、设备切换缓冲 | E/R | AudioEngine 规则与浏览器静音；设备事件是否触发及耳机切换需真机 |
| 8.1：壳/内容分开、进入后下场景、就绪进度按字节 | E | PWA 配置与 ContentPackManager；未解锁媒体不预取，缺语音不标全包 ready |
| 当前核心预缓存，不预取历史核心音频 | E | manifestTransform 与 hosting.test；本次排除一个 66,524 字节旧 SFX，保留文件供旧客户端 |
| 8.2-1：契约/依赖/逻辑引用，不兼容保持旧版 | E | manifestSchema、loadFiles、版本不兼容与恢复分支 |
| 8.2-2/3：并发≤2、完整200、hash/bytes、重试1/2/4秒 | E | 两 worker、retrieve、206/损坏/暂停续传反例 |
| 8.2-4/5：先缓存后元数据、提交后ready、下轮原子可见 | E | metadata 失败/部分包反例；content-update 浏览器完成旧轮再切新轮 |
| 8.2-6/7：当前/上一完整/引用保留、启动复核/降级/修复 | E/R | 内容 GC 与真实 SW 缺键回退/修复；实际系统存储回收待验收 |
| quota/estimate/persist、独立缓存锁、暂停不变ready | E/R | 故障注入、storage-status 与父母入口；真实系统配额与持久化授予不作保证 |
| 8.3：等待更新、无强制skipWaiting/使用中reload | E/R | worker-lifecycle 真SW双窗口；两平台安装容器仍待测 |
| 8.4：Range只切完整缓存、200/206分开、根/子路径 | E | offline-audio/subpath 浏览器流程、完整文件哈希保持 |
| Cloudflare部署与缓存响应头 | E/R | `_headers` 可变索引与不可变资源规则、无重叠检查；尚无实际HTTPS响应证据 |

## 9～12：体验、预算、命令和交接

| 规格项目 | 状态 | 证据与缺口 |
|---|---|---|
| Safari/iPadOS16.4、Android10/Chrome111及当前稳定版本 | R | 当前仅桌面 Chromium 153；没有以模拟器或当前Chrome代替最低/移动目标 |
| Safari标签页与主屏应用各自联网缓存再冷启动 | R | 没有真实容器记录；自动SW测试不能证明两者共享/隔离状态 |
| iPad9或等效10寸、4GB Android设备登记 | R | 未登记真实型号/版本/容器，不能填“支持” |
| 960×600、扣除安全区、竖屏/小窗口、家长入口 | E/R | 两模式代表页面几何检查；模拟非零安全区、原生横屏对话框、语音/焦点/家长入口；真实设备待测 |
| 学习字≥20、单词48～64、4.5文本/3图标、不仅靠红绿 | E/R | 实际DOM字号/对比度检查、提示星/完成标记/L3计时条；颜色/视力体验仍需用户观察 |
| 语义按钮、可理解名称、键盘焦点、减少动态效果 | E/R | 模式标签/可访问名称、Tab焦点、横屏焦点循环、reduced-motion流程；实机键盘与手势待验收 |
| 本地字体与许可 | E | Nunito文件/许可、产物本地URL，未下载大中文字体 |
| 壳压缩传输≤1.5MiB | R | 当前原始预缓存约693.3KiB仅作诊断；没有正式托管压缩网络记录 |
| Stage0/1完整学习包≤8/12MiB | R | 当前缺真实音频，现有字节求和不能证明完整包预算 |
| 单精灵≤4MiB/180s、mono | E/R | 生产/实际文件验证均有拒绝；真实全部精灵尚未生成 |
| 解码内存≤64MiB、只保留当前/公共组 | E/R | 按实际AudioContext采样率估算、LRU/unload与拒绝测试；移动设备实测待做 |
| 热视觉p95≤100ms、热音频p95≤250ms、每台≥30样本 | R | 没有两台设备原始样本，不用测试时钟或测试信号宣称达标 |
| 冷启动≤4秒（10Mbps/80ms）、完整离线重开≤3秒 | R | 自动浏览器流程证明可启动；尚无所需网络/设备条件的正式计时数据 |
| Node/npm/精确库版本、lock、save-exact、npm ci | E/R | `.node-version/.npmrc/package-lock`、当前依赖树/编译/测试；远端干净CI未执行 |
| 目录分层、domain不依赖DOM、组件不写IDB/建Howl | E | 对应源码目录；统一仓储/音频服务；时间/随机/媒体后端测试注入 |
| dev/preview 命令与离线验收区别 | E | package脚本；真实生产形式 Vite preview 被测试运行器启动和关闭；HMR不作离线证据 |
| validate:content/assets、typecheck/lint/test、build:preview/test:e2e | E | 本次完成命令、输入规模及退出状态见现场证据 |
| build:release 成功与正式站 | E/R | 负门禁真实拒绝100草稿；正向发布、域名和账户均未完成 |
| CI顺序、预览不自动发布、审核素材不自动付费生成 | E/R | `.github/workflows/ci.yml` 与本地脚本；未运行远端CI/发布任务 |
| Stage1全部列出规则/恢复任务与配置 | E/R | 对应纯规则/事务/浏览器证据；三名儿童、24小时、监护人和年龄覆盖记录缺失 |
| Stage2全部中断/版本/SW/迁移/词下架用例 | E/R | 当前自动化已覆盖；真实配额、设备与教师代表样例未验收 |
| §12老师、服务预算/授权、真机、HTTPS与儿童排期 | R | 不能靠联网或代码推断负责人、许可与观测结果；待项目方落实 |

## Stage 0 工作包与验收编号

| 编号 | 核对结果 |
|---|---|
| S0-00 | R：实际负责人、可用时间、预算、设备和域名仍未填写 |
| S0-01 | E/R：版本/依赖/工程和本地检查存在；不以本地结果冒充远端CI |
| S0-02 | E：原十词/两页、Zod、ID/类型/伪CVC/空包等反例已核 |
| S0-03 | E/R：图片/alt/许可/审核工具已有，十词文本和图义签署缺失 |
| S0-04 | E/R：PCM、慢速、精灵、解码和审批流水线已验证；真实30语音/14音素和批准缺失 |
| S0-05、S0-06 | E/R：代码与本地测试信号证明卡片/音频/离线流程；真实声音/设备条件未齐，原复合任务不勾完成 |
| S0-07 | E/R：preview/release与CI配置、子路径已有；真实release及HTTPS缺失 |
| S0-08 | R：V01～V05/V08/V11～V13等两平台结果没有原始证据 |
| S0-09及预留 | R：真实人工工时、验收结论和重估排期不能用代理运行时间替代 |
| V00 | E/R：草稿/断引用等拒绝路径；真实合格包的正向发布未测 |
| V01、V02、V03 | E/R：解锁/连点/取消/恢复工程用例；两台真机和实际声音未测 |
| V04、V05 | E/R：SW离线代码可用；浏览器/主屏两种真实容器冷启动未测 |
| V06、V07、V09、V10 | E/R：中断/更新/故障/子路径自动化通过；要求的真机冒烟待测 |
| V08、V11、V12、V13 | R：等待更新与基本操作已有自动证据；两平台、性能采样及老师听审仍缺 |
| §5.1～5.2记录与分级 | E/R：模板/分级规则已有；真实测试人、设备、提交/内容版本、审批与复测资料未填写 |
| §6完成清单 | 保留原未勾项，不因本次本地回归通过代替其素材/人工条件 |
| 交接1：版本、安装、已审核十词 | E/R：工程版本/构建说明已有；已审核十词缺失 |
| 交接2/4：配置、事务、恢复/复习任务和工时 | E/R：规则与代码测试已有；实际人工工时/真复习未记录 |
| 交接3/5/6：扩词/排歧、儿童排期、兼容范围 | E/R：扩词/候选排歧与未测范围已列明；老师档期、儿童/设备资料缺失 |

本次没有发现可以用软件验证替代的剩余人工门槛。继续正式验收需要实际源素材/许可和审核人，以及目标设备、儿童观察、HTTPS项目与同版本远端CI结果；这些条件到位前，完整目标保留为未完成。

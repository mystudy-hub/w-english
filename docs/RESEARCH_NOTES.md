# 实施选型资料核对

查阅日期：2026-09-10。优先查阅框架、浏览器、项目维护者和服务提供方的原始文档。以下将“来源明确说明的事实”和“针对本项目的决定”分开记录；网页查证不等于实机通过或取得素材商业授权。

## 1. 已核对来源

| 编号 | 原始来源 | 本次核对的事实 | 项目采用方式 |
|---|---|---|---|
| R1 | [Vite 入门](https://vite.dev/guide/)；[生产构建兼容](https://vite.dev/guide/build) | 入门页要求 Node 20.19+/22.12+；查阅时构建文档为 Vite 8.2.2，默认目标包括 Chrome 111、Safari 16.4；JS 转译不等于补齐所有平台 API | 采用 Node 24 LTS；以生产构建验证最低浏览器，单独核验平台 API |
| R2 | [Vite PWA injectManifest](https://vite-pwa-org.netlify.app/guide/inject-manifest) | 插件可编译自定义 SW 并注入预缓存清单；自定义策略需显式配置 | 壳走预缓存，学习内容走独立清单和完整包协议 |
| R3 | [Vite PWA automatic reload](https://vite-pwa-org.netlify.app/guide/auto-update) | autoUpdate 配置会强制启用 skipWaiting 和 clientsClaim；自动更新/页面重载还受注册与客户端代码影响 | 不直接使用 autoUpdate；等待旧受控页面关闭，不在学习中强制激活或 reload |
| R4 | [MDN 存储配额与回收](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) | IndexedDB/Cache 默认 best-effort，可能被回收；QuotaExceededError 要处理；persistent storage 申请可能被拒绝；私密浏览另有行为 | 检查实际缓存键、保留旧完整包、捕获配额错误；不承诺浏览器永久保存 |
| R5 | [MDN BaseAudioContext.state](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state) | 除 running/suspended/closed 外还有 interrupted；页面离开/锁屏可能使 iOS Safari 进入 interrupted，恢复行为因浏览器而异 | AudioEngine 明确处理中断，后续手势恢复；不只判断 suspended |
| R6 | [Howler 维护者 README](https://github.com/goldfire/howler.js#documentation) | sprite 以毫秒偏移/时长定义；API 提供 play/stop/rate/unload、播放生命周期和全局音频控制 | 一个 AudioEngine 管理多个受控 Howl；结束/取消/失败分开；及时 unload |
| R7 | [Azure Speech SSML 发音控制](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-pronunciation) | 支持 phoneme、IPA 等音标体系及自定义词典；locale 支持的音标集合有限，非法音标可返回 400 | 官方 TTS 可作整词发音控制；孤立音素仍须试听，不能将 API 支持当成教学审核 |
| R8 | [Edge-TTS 维护者 README](https://github.com/rany2/edge-tts#custom-ssml) | 调用的是 Microsoft Edge 在线 TTS；自定义 SSML 支持已移除，因为服务限制可用结构 | 原方案“Edge-TTS 自动生产所有音素”不作为默认路线；原型工具与发布授权分开 |
| R9 | [Workbox 缓存音视频](https://developer.chrome.com/docs/workbox/serving-cached-audio-and-video) | 离线音视频应预先缓存完整文件；播放时可能只取 206 局部内容；Range 请求需 RangeRequestsPlugin 等处理 | 先完整 200 下载/校验入库，再服务音频和 Range；播放成功不等于已完整缓存 |
| R10 | [Twemoji 维护者 README](https://github.com/jdecked/twemoji#attribution-requirements) | 代码 MIT，图形 CC-BY 4.0，需署名 | 将所用 SVG 本地化，保留图形来源/许可/修改台账；不把图形当 MIT |
| R11 | [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html#loudnorm) | loudnorm 提供单/双遍、线性/动态规范化；提供输入测量参数、真峰值目标等；滤镜文档也定义 atempo | 普通语音双遍规范化；慢速保音高；极短音素采用有记录的校准例外，最终 MP3 再检查 |
| R12 | [Oxford Owl phonics](https://home.oxfordowl.co.uk/reading/learn-to-read-phonics/) | 明确区分字母/字母组合（grapheme）和声音（phoneme），介绍分解与拼合，并建议学习 pure sounds | 教学设计依据；不复制其音频、词表或插图，不把英式示例直接当作本项目美音标准 |
| R13 | [Tailwind CSS compatibility](https://tailwindcss.com/docs/compatibility) | 当前框架核心浏览器基线为 Chrome 111、Safari 16.4、Firefox 128；部分新 CSS 功能还需另行判断 | 固定目标 Safari/Chrome 下限；不以 Vite 转译设置掩盖 CSS 兼容性 |
| R14 | [Node.js releases](https://nodejs.org/en/about/previous-releases) | 查阅时 Node 24 为 LTS，官网显示最新 LTS 24.21.0；Node 26 为 Current；官网建议生产使用 Active/Maintenance LTS | 选择 Node 24 LTS；当前工作区 24.19.0，S0-01 再统一本地/CI 精确补丁 |

网页版本会变化；上述版本只记录本次查阅结果。依赖安装还要读取实际包的 engines/peerDependencies，并提交经过构建验证的 lockfile。

## 2. 采用的决定及取舍

### 2.1 语音来源

默认采用 Azure Speech 预置声音制作整词/例句，以及经过老师审核的真人/授权音素素材。理由是可用官方接口配置发音、易于固定生产参数，同时避免把普通字母名误当作孤立音素。

Azure SSML 文档不能证明某个账户、音色或用途的分发授权。适用账户条款、录音许可和预算仍由负责人记录；尚无依据把它们标记为已解决。服务不可用时替换为授权真人录音，AudioEngine 和内容引用契约不变。音色建议也是待听审候选。

不采用浏览器实时 TTS 作为发布时依赖，因为本项目要求离线、固定声音与逐片审核。Edge-TTS 仍可研究原型，其客户端开源许可不等于微软服务或产物分发许可。

### 2.2 离线与更新

独立场景包有按需下载、进度、恢复、哈希校验和激活时机要求，因此采用 injectManifest。初次壳缓存随 SW 安装进行，学习包在开始后下载；核心离线提示必须属于壳。

等待所有旧受控窗口关闭，比笼统写“下次启动自动更新”更可验证。应用 SW 生命周期与内容包版本分别管理，只有完整、兼容的内容包才能在新学习会话中生效。具体状态机是本项目工程决定，仍需测试生命周期和配额异常。

### 2.3 浏览器、框架与图片

Safari 16.4 / Chrome 111 是依赖能力的起始下限，并非已验证支持声明。保留计划中的 React 18.3.1；使用现代构建工具时验证插件兼容。若项目后来需要更老的 iPad，必须同时重估 CSS、浏览器 API 和实机范围，不能只降低 JS target。

采用本地 SVG 图标是为了固定图义与跨设备呈现。首批源数据保留 emoji 便于结构验证，发布构建需替换为经图义和许可审核的素材。图片具体含义仍要审校，例如通用牛图不能自动代表 yak。

### 2.4 内容数量与学习规则

首批 10 词和 Stage 1 的 20 词是本项目选词决定，不是上述来源对词表的认证。单场景扩展到动物身边的物品，可保持 CVC 约束、配图清晰度和单场景工作量。具体发音、文字难度与图片仍须老师全审。

“每轮最多 5 题”“首次选择才计学习证据”“24 小时复习”“选项 3/4/4”“各项性能预算”同样是可测试的产品默认值，不能表述为科学界公认最优值；Stage 1 试用后按证据调整。

## 3. 尚未被资料查阅解决的事项

| 项目 | 本次结论 | 后续证据 |
|---|---|---|
| Azure 使用/分发条款和预算 | 未确认具体账户条件 | 适用条款版本、负责人记录、预算 |
| 音色与孤立音素质量 | 仅有技术可行性依据 | 实际合成/录音及老师试听签字 |
| 10 词/20 词内容正确性 | 已给出具体草稿 | 文本、图片和音频审批 |
| iPad/Android 生命周期与内存 | 已确定测试目标及策略 | 真机记录与性能数据 |
| 插件精确版本兼容 | 尚无依赖安装/lockfile | S0-01 安装、类型检查与构建记录 |
| 老师/设备/儿童试用 | 无法由公开网页确定 | 项目负责人落实 |

部分 Azure FAQ/声音样式页面和 PWA prompt 页面在本次请求中出现连接错误，未据这些未成功读取页面给出授权或功能承诺。相关决定已使用成功读取的原始文档支撑，剩余问题按以上表格保留。

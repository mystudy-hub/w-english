# 音频素材接入与审核

真实素材按用户安排随后提供。当前工程不使用浏览器实时 TTS、字母名或合成提示音代替学习语音；预览界面可先浏览卡片。

## 1. 准备源录音

运行 `npm run audio:inventory` 生成 `artifacts/audio-inventory.json`。当前活动目录 `data/catalog.json` 指向 Stage 2，内容版本 `2026.09.3`：100 词、三场景，共 353 个片段（300 个学习语音、40 个音素、13 个中文向导/界面提示）。100 个慢速词从常速录音派生，实际输入为 253 个 WAV。

场景为动物之家 34 词、阳光花园 33 词、快乐学校 33 词；89 个拼读词、11 个整词识别词。素材的准确路径、文案和音素以生成清单为准，不能仅凭字母名称录音。

`sfx#pop`、`sfx#chime_success`、`sfx#star_coin` 由工程生成并随应用壳缓存，仅用于非语言交互反馈，不计入教学语音素材。

文件放在未提交的 `audio-source/` 下：

```text
audio-source/
  words/cat.wav              # 常速整词；其余词同样命名
  sentences/cat.wav          # 例句
  phonics/a_short.wav        # 按 inventory 中的文件名提供孤立音素
  guide/welcome.wav          # 按 inventory 文案提供中文向导
  guide/rotate.wav           # 独立 ui_guide#rotate 横屏提示
```

使用已获许可的录音或服务生成产物；脚本不自动调用付费服务。音素须为老师认可的实际发音。每段有效声音最长 30 秒，输入不能是静音占位。请保留授权和原始文件，生产日志记录源文件哈希。

## 2. 构建精灵

运行 `npm run audio:pack`。脚本会：

1. 先检查全部源文件，输出统一 24kHz/mono PCM。
2. 通过 `atempo=0.75` 生成慢速词，保留音高。
3. 普通可测语音进行双遍响度处理；音素和无法稳定测量的短片段走参考增益分支。可在 `data/audio-gains.json` 设置 `{ "phonics#p": -2 }`，实际处理结果仍需听审。
4. 为每段前后各加 150ms 静音，记录不含填充的有效切片位置。
5. 编码 MP3 后重新测量真峰值，必要时整体衰减重编码，直至 ≤-1 dBTP；同时检查时长、采样率、mono、文件大小。
6. 写入带哈希的不可变精灵文件，最后原子替换 `artifacts/audio/index.json`。失败不会发布半成品索引。

规范化片段和填充后的整精灵另存到 `artifacts/audio/pcm/`，为可播放的 24kHz/mono/16-bit PCM WAV；索引的 `pcm.file`、`pcm.sha256` 指向对应中间文件。整精灵文件在最终 MP3 衰减前保存，重现编码时结合 `postGainDb`。这些文件保留在工程产物中，不进入应用下载包。

脚本实际解码最终音频，拒绝明显时长不匹配、越出实际帧范围或全静音的切片；`decoded` 记录检查结果。素材校验会重新解码。格式检查不能判断是否发成了字母名，仍必须完成老师与目标设备听审。

可按场景或精灵分批提供素材，两个筛选参数不能同时使用：

```bash
# 第一场景及完整公共语音依赖：155 片段、121 个输入 WAV
npm run audio:inventory -- --theme animal_home
npm run audio:pack -- --theme animal_home

# 独立准备 12 个学习向导、1 个横屏提示，或公共音素
npm run audio:inventory -- --sprite guide
npm run audio:pack -- --sprite guide
npm run audio:pack -- --sprite ui_guide
npm run audio:pack -- --sprite phonics

# 仅重做第一场景的两个学习精灵，沿用已生成公共素材
npm run audio:pack -- --sprite animal_home,animal_home_extra
```

分批清单写入独立的 `artifacts/audio-inventory.<范围>.json`，不覆盖全量清单。每批始终处理完整精灵：场景批次包含其学习精灵及完整公共音素/向导，因此后续场景不会因公共精灵被截短而丢失声音。未选精灵和生产记录经哈希核对后保留；所选精灵整组替换并重新听审。

同一输出目录只允许一个打包任务。常规成功或失败会释放 `.index.lock`；进程被强制结束时，先核实锁内 PID 对应任务已结束，再移除 `artifacts/audio/.index.lock` 后重试。素材文件或旧索引异常时停止，不以空索引覆盖原结果。

`ui_guide` 与原 `guide` 分开，避免新界面提示使旧学习包失效。新的场景批次会包含它；旧生成索引若没有 PCM 元数据，可通过重新打包补齐中间文件，程序不会伪造缺失的中间产物或审批。

默认使用已锁定 npm 工具包提供的 FFmpeg/ffprobe；可通过 `FFMPEG_PATH`、`FFPROBE_PATH` 指向团队统一的本机版本。生产验收须保存实际工具版本和最终产物；当前本机工具版本见工程验证记录，不宣称已验证所有 FFmpeg 版本。

运行 `npm run build:preview` 后，可以在卡片和游戏内听最终片段。只有目标词和图片真实齐全的活动才可开启；拼字母还需全部实际音素。完整离线状态按场景判定，其他场景尚缺语音不会阻塞已齐全场景。

## 3. 审核记录

逐片听最终 MP3 精灵，并为 `data/audio-approvals.json` 的 `clips` 填写记录。以下是字段说明，**不是已经取得的审批**：

```json
{
  "ref": "animal_home#cat",
  "reviewer": "实际审核人",
  "reviewedAt": "实际 ISO 时间",
  "spriteSha256": "最终精灵文件的完整 SHA-256",
  "sourceSha256": "index.json 中该片段的源文件 SHA-256",
  "promptSha256": "index.json 中该片段的文字与发音要求 SHA-256",
  "clip": [150, 540],
  "creator": "素材权利人",
  "license": "适用许可或授权名称",
  "permissionEvidence": "授权依据位置",
  "calibrationApproved": true
}
```

按音频引用作为键保存，例如 `clips["animal_home#cat"]`。`clip` 须填写本次产物实际的 `[起点毫秒, 时长毫秒]`，示例数字不能直接沿用。短音素的 `calibrationApproved` 必须由听审决定；生成脚本不会自动批准。改变源文件、编码产物、切片位置或增益后，旧审批不再适用。

`promptSha256` 绑定引用、类型、语言、文字、整词 IPA、音素及慢速要求。即使录音文件没有变化，例句、音标、音素或向导文案改变后也必须重新打包并听审。预览构建不会把过期或缺少此指纹的精灵映射到新文案；旧审批也不能自动沿用。

文本、图片和音频全部审核后，再更新词条 `review`。`audio_approved` 标签不能替代真实素材与切片审批。`npm run build:release` 和 `npm run validate:assets` 会检查实际文件及审核记录；当前素材未提供时，发布失败是正确行为。

## 4. 文本与图片的审批指纹

运行 `npm run content:review` 生成 `artifacts/review-inventory.json`。老师核对文字、拆分、图片和教学提示后，将实际审核人、ISO 时间、`contentSha256` 和 `imageSha256` 记录到 `data/content-approvals.json` 的 `words[wordId]`。

生成清单中的审核人和时间为空，不能直接充当审批。发布构建会重新计算内容及图片哈希；保留旧的 `audio_approved` 标签但修改释义、音素或图片，同样会被拒绝。单纯提升内容包版本不会使未变化的词义审批失效。

## 5. 使用本地审核工作台

`npm run content:review` 同时生成 `artifacts/review/index.html`。用桌面浏览器打开此文件即可查看图片、释义、例句、拆分和教学提示；已提供的最终音频以内嵌数据保存，可离线试听。页面不上传内容，也不修改词库源文件。

1. 填写实际审核人，逐词核对文字与图片，勾选核对项后批准；未操作的项目保持待审。
2. 切换“语音切片”，试听实际最终精灵中的准确区间。自然播放结束后才能批准；停止或切后台不算完整试听。缺失的录音没有批准入口。
3. 填写该片段的权利人、许可和授权依据。短音素还须核对参考响度。相关词条的文字与图片须先通过审核。
4. 不通过时填写修改意见，选择“标记需修改 / 撤回批准”。可以导出部分结果，下次在相同批次页面恢复。
5. 导出 JSON 后，工程端先预览变更：

   ```bash
   npm run review:import -- /path/to/w-english-review-2026.09.3.json
   ```

   结果写入 `artifacts/review/import-preview.json`，源文件不变。确认内容后显式应用：

   ```bash
   npm run review:import -- /path/to/w-english-review-2026.09.3.json --apply
   ```

导入会重新核对整批身份、词义/图片及发音要求指纹、源音频、最终精灵和切片区间；批次过期或素材变化时拒绝应用。原始审核结果及被替换源文件备份到 `artifacts/review/backups/<时间>/`。词条只在当前文本和对应全部语音审批齐全时达到 `audio_approved`；向导片段还需通过发布包的独立检查。

本机草稿保存依赖浏览器，审核结束应导出结果。网页/脚本通过不代替老师在目标设备试听，工程不会填写真实审核人或自动批准缺失素材。

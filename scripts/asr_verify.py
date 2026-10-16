#!/usr/bin/env python3
"""ASR 回读校验：把最终精灵里的每个语言片段切出来，用 faster-whisper 转写，
与清单文字比对，生成 artifacts/asr-report.json（模型辅助的音频听审证据）。

用法：
  python scripts/asr_verify.py                          # 校验全部语言片段（word/slow/sentence/guide）
  python scripts/asr_verify.py --limit 5               # 只抽查前 5 个（调试）
  python scripts/asr_verify.py --model small --retry artifacts/asr-report.json
                                                         # 用更强的模型重试报告里未通过的片段并合并

音素片段不参与 ASR（孤立音素无法用语音识别判断），由打包管线与审批记录的
参考响度校准覆盖。
"""

import argparse
import difflib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = ROOT / "node_modules" / "@ffmpeg-installer" / "win32-x64" / "ffmpeg.exe"

ASR_KINDS = {"word", "slow", "sentence", "guide"}

# ASR 会把单词数字写成阿拉伯数字；比对前归一成词。
DIGIT_WORDS = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six",
    "7": "seven", "8": "eight", "9": "nine", "10": "ten", "11": "eleven", "12": "twelve",
    "13": "thirteen", "14": "fourteen", "15": "fifteen", "16": "sixteen", "17": "seventeen",
    "18": "eighteen", "19": "nineteen", "20": "twenty", "30": "thirty", "40": "forty",
    "50": "fifty", "60": "sixty", "70": "seventy", "80": "eighty", "90": "ninety",
    "100": "one hundred",
}


# 英文同音词组：组内词互为同音，比对时视为等价（ASR 对孤立短词常选高频同音词）。
HOMOPHONE_GROUPS = [
    {"eye", "i", "aye"},
    {"wear", "where", "ware"},
    {"hear", "here"},
    {"to", "too", "two"},
    {"for", "four"},
    {"by", "buy", "bye"},
    {"no", "know"},
    {"one", "won"},
    {"see", "sea"},
    {"be", "bee"},
    {"son", "sun"},
    {"flour", "flower"},
    {"right", "write"},
    {"new", "knew"},
    {"blue", "blew"},
    {"ate", "eight"},
    {"meat", "meet"},
    {"week", "weak"},
    {"our", "hour"},
]
HOMOPHONE_ID = {}
for _group_index, _group in enumerate(HOMOPHONE_GROUPS):
    for _word in _group:
        HOMOPHONE_ID[_word] = _group_index

try:
    from pypinyin import lazy_pinyin
except ImportError:
    lazy_pinyin = None


def merge_model_chain(existing: list[str] | None, added: str) -> list[str]:
    """按出现顺序去重：重试多次时模型链只保留每个模型一次。"""
    return list(dict.fromkeys([*(existing or []), added]))


def normalize(text: str) -> str:
    # 去标点（中英文）、去空白、转小写，并把阿拉伯数字归一成英文词
    stripped = re.sub(r"[，。！？、；：“”‘’（）\[\]<>.,!?;:'\"()\u2026-]+", " ", text)
    tokens = [DIGIT_WORDS.get(token, token) for token in stripped.split()]
    return re.sub(r"\s+", " ", " ".join(tokens)).strip().lower()


def to_comparable(text: str, language: str) -> list[str]:
    """把归一后的文本换成可比较的符号序列：英文用同音词组号，中文用无声调拼音。"""
    tokens = text.split()
    if language == "zh":
        if lazy_pinyin is not None:
            return [syllable for token in tokens for syllable in lazy_pinyin(token, errors="ignore")]
        return list("".join(tokens))
    return [HOMOPHONE_ID.get(token, token) for token in tokens]


def equivalent(expected_norm: str, transcribed_norm: str, language: str) -> bool:
    if expected_norm == transcribed_norm:
        return True
    # 同音等价：英文按同音词组号，中文按无声调拼音（ASR 对同音字会选不同写法）。
    return to_comparable(expected_norm, language) == to_comparable(transcribed_norm, language)


def decode_clip(sprite_file: Path, start_ms: float, duration_ms: float) -> np.ndarray | None:
    cmd = [
        str(FFMPEG),
        "-hide_banner", "-loglevel", "error",
        "-ss", f"{start_ms / 1000:.3f}",
        "-i", str(sprite_file),
        "-t", f"{duration_ms / 1000:.3f}",
        "-ar", "16000", "-ac", "1",
        "-f", "f32le", "-",
    ]
    raw = subprocess.run(cmd, capture_output=True).stdout
    if not raw:
        return None
    return np.frombuffer(raw, dtype=np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(description="ASR 回读校验最终音频精灵")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 个片段（0=全部）")
    parser.add_argument("--model", default="base", help="faster-whisper 模型（默认 base）")
    parser.add_argument("--retry", help="重试已有报告里未通过的片段（例如 artifacts/asr-report.json）")
    parser.add_argument("--sprite", help="重新校验指定精灵的全部语言片段（逗号分隔，与 --retry 可同用）")
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    index_path = ROOT / "artifacts" / "audio" / "index.json"
    if not index_path.exists():
        print("错误: 缺少 artifacts/audio/index.json，请先 npm run audio:pack", file=sys.stderr)
        sys.exit(1)
    index = json.loads(index_path.read_text(encoding="utf-8"))
    # 生产索引（index.json）只存引用、哈希与切片区间；文字/语言/类型在清单（inventory）里。
    inventory = json.loads((ROOT / "artifacts" / "audio-inventory.json").read_text(encoding="utf-8"))

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    results = []
    skipped = []
    checked = 0

    language_clips = [clip for clip in inventory.get("clips", []) if clip.get("kind") in ASR_KINDS and clip.get("text")]
    prior = None
    if args.sprite:
        wanted = {name.strip() for name in args.sprite.split(",")}
        language_clips = [clip for clip in language_clips if clip["ref"].split("#", 1)[0] in wanted]
    if args.retry:
        prior = json.loads(Path(args.retry).read_text(encoding="utf-8"))
        failed_refs = {item["ref"] for item in prior.get("results", []) if not item.get("pass")}
        if args.sprite:
            wanted_refs = {clip["ref"] for clip in language_clips}
            language_clips = [clip for clip in language_clips if clip["ref"] in wanted_refs | failed_refs]
        else:
            language_clips = [clip for clip in language_clips if clip["ref"] in failed_refs]
    if args.limit:
        language_clips = language_clips[: args.limit]

    for clip in language_clips:
        ref = clip["ref"]
        sprite_id, clip_name = ref.split("#", 1)
        sprite = index.get("sprites", {}).get(sprite_id)
        if not sprite:
            skipped.append({"ref": ref, "reason": "缺少精灵生产记录"})
            continue
        interval = sprite.get("sprite", {}).get("sprite", {}).get(clip_name)
        if not interval:
            skipped.append({"ref": ref, "reason": "缺少切片区间"})
            continue
        expected = clip.get("text") or ""
        language = "zh" if clip.get("locale", "").startswith("zh") else "en"
        audio = decode_clip(ROOT / "artifacts" / "audio" / sprite["file"], interval[0], interval[1])
        if audio is None or audio.size == 0:
            skipped.append({"ref": ref, "reason": "切片解码为空"})
            continue
        segments, _info = model.transcribe(audio, language=language, beam_size=1, vad_filter=False)
        transcribed = " ".join(segment.text.strip() for segment in segments).strip()
        expected_norm = normalize(expected)
        transcribed_norm = normalize(transcribed)
        score = difflib.SequenceMatcher(None, expected_norm, transcribed_norm).ratio()
        passed = score >= 0.75 or equivalent(expected_norm, transcribed_norm, language)
        results.append({
            "ref": ref, "kind": clip.get("kind"), "expected": expected,
            "transcribed": transcribed, "score": round(score, 3), "pass": passed,
        })
        checked += 1
        if checked % 25 == 0:
            print(f"[{checked}/{len(language_clips)}] 已校验…", flush=True)

    if prior is not None:
        # 与已有报告合并：重试结果替换原结果，模型链记录在 models 里。
        merged = {item["ref"]: item for item in prior.get("results", [])}
        for item in results:
            old = merged.get(item["ref"])
            item["models"] = merge_model_chain(old.get("models") if old else None, args.model)
            merged[item["ref"]] = item
        results = list(merged.values())
        # 报告里的模型链同样去重（此前多次 --retry 会写成 base+base+small+small+small+medium）
        chain: list[str] = []
        for item in results:
            for name in item.get("models", []):
                if name not in chain:
                    chain.append(name)
        model_chain = "+".join(chain) or args.model
    else:
        model_chain = args.model
    failed = [item for item in results if not item["pass"]]
    report = {
        "schemaVersion": 1,
        "model": model_chain,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "checked": len(results), "passed": len(results) - len(failed), "failed": len(failed),
            "skipped": len(skipped), "threshold": 0.75,
        },
        "results": results,
        "skipped": skipped,
    }
    out = ROOT / "artifacts" / "asr-report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ ASR 回读校验完成：{len(results)} 个片段，通过 {len(results) - len(failed)}，未过 {len(failed)}，跳过 {len(skipped)}；报告 {out}")
    for item in failed[:20]:
        print(f"  · 未过 {item['ref']}: 期望「{item['expected']}」听到「{item['transcribed']}」（{item['score']}）")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()

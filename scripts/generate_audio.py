#!/usr/bin/env python3
"""
Batch Audio Generator for W-English using Edge-TTS
Generates 24kHz 16-bit Mono PCM WAV files required by `npm run audio:pack`.
"""

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
from pathlib import Path

try:
    import edge_tts
except ImportError:
    print("错误: 未找到 edge-tts。请先运行: pip install edge-tts", file=sys.stderr)
    sys.exit(1)


# Phonics phonetic approximation text for Edge-TTS synthesis
PHONICS_TTS_MAP = {
    "k": "k",
    "a_short": "ah",
    "t": "t",
    "d": "duh",
    "o_short": "ah",
    "g": "guh",
    "p": "puh",
    "i_short": "ih",
    "h": "huh",
    "e_short": "eh",
    "n": "nnn",
    "s": "sss",
    "u_short": "uh",
    "b": "buh",
    "r": "rrr",
    "m": "mmm",
    "l": "lll",
    "f": "fff",
    "sh": "shhh",
    "er": "err",
    "el": "ul",
    "a_long": "ay",
    "w": "wuh",
    "o_long": "oh",
    "ks": "ks",
    "ee": "ee",
    "ow": "ow",
    "or": "or",
    "schwa": "uh",
    "ch": "ch",
    "i_unstressed": "ee",
    "oo_long": "ooo",
    "oo_short": "uuh",
    "er_unstressed": "er",
    "ar": "ar",
    "air": "air",
    "ear": "ear",
    "aw": "aw",
    "i_long": "eye",
    "ng": "ing",
}


def find_ffmpeg() -> str:
    # 1. Project bundled ffmpeg
    project_root = Path(__file__).resolve().parent.parent
    bundled = project_root / "node_modules" / "@ffmpeg-installer" / "win32-x64" / "ffmpeg.exe"
    if bundled.exists():
        return str(bundled)

    # 2. System PATH ffmpeg
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg

    print("错误: 未找到 ffmpeg。请确保 node_modules/@ffmpeg-installer 存在或系统 PATH 中有 ffmpeg", file=sys.stderr)
    sys.exit(1)


async def check_proxy(proxy_url: str) -> bool:
    try:
        c = edge_tts.Communicate("test", "en-US-AnaNeural", proxy=proxy_url)
        # Test just the stream initiation
        async for chunk in c.stream():
            if chunk["type"] == "audio":
                return True
            break
        return True
    except Exception:
        return False


async def synthesize_one(
    item: dict,
    audio_source_dir: Path,
    ffmpeg_exe: str,
    proxy: str | None,
    semaphore: asyncio.Semaphore,
    skip_existing: bool,
    counter: dict,
    total: int,
):
    rel_path = item["input"]
    out_path = audio_source_dir / rel_path

    if skip_existing and out_path.exists() and out_path.stat().st_size > 1000:
        counter["done"] += 1
        print(f"[{counter['done']}/{total}] 跳过已存在: {rel_path}")
        return

    out_path.parent.mkdir(parents=True, exist_ok=True)
    temp_mp3 = out_path.with_suffix(".temp.mp3")

    kind = item.get("kind")
    text = item.get("text")
    voice = "en-US-AnaNeural"
    rate = "+0%"

    if kind == "guide":
        voice = "zh-CN-XiaoxiaoNeural"
        rate = "+0%"
    elif kind == "word":
        voice = "en-US-AnaNeural"
        rate = "-5%"
    elif kind == "sentence":
        voice = "en-US-AnaNeural"
        rate = "+0%"
    elif kind == "phoneme":
        voice = "en-US-AnaNeural"
        rate = "-10%"
        clip_name = Path(rel_path).stem
        text = PHONICS_TTS_MAP.get(clip_name, clip_name)

    if not text:
        print(f"警告: {rel_path} 缺少文本内容，跳过", file=sys.stderr)
        return

    async with semaphore:
        retries = 3
        for attempt in range(1, retries + 1):
            try:
                communicate = edge_tts.Communicate(text, voice, rate=rate, proxy=proxy)
                await communicate.save(str(temp_mp3))
                break
            except Exception as e:
                if attempt == retries:
                    print(f"失败 [{rel_path}] {text} (重试已用尽): {e}", file=sys.stderr)
                    if temp_mp3.exists():
                        temp_mp3.unlink()
                    return
                await asyncio.sleep(1.5 * attempt)

        # Convert temp MP3 to 24kHz Mono 16-bit PCM WAV
        cmd = [
            ffmpeg_exe,
            "-y",
            "-i",
            str(temp_mp3),
            "-ar",
            "24000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(out_path),
        ]
        proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if temp_mp3.exists():
            temp_mp3.unlink()

        if proc.returncode != 0 or not out_path.exists() or out_path.stat().st_size == 0:
            print(f"FFmpeg 转码失败: {rel_path}", file=sys.stderr)
            return

        counter["done"] += 1
        print(f"[{counter['done']}/{total}] 生成成功: {rel_path} ({text})")


async def main():
    parser = argparse.ArgumentParser(description="使用 Edge-TTS 批量生成 W-English 音频素材")
    parser.add_argument("--proxy", type=str, default="http://127.0.0.1:7897", help="代理地址 (默认: http://127.0.0.1:7897)")
    parser.add_argument("--no-proxy", action="store_true", help="不使用代理")
    parser.add_argument("--concurrency", type=int, default=4, help="并发数量 (默认: 4)")
    parser.add_argument("--skip-existing", action="store_true", default=True, help="跳过已存在的文件 (默认开启)")
    parser.add_argument("--force", action="store_true", help="强制重新生成全部文件")
    parser.add_argument("--only", choices=["words", "sentences", "guide", "phonics"], help="仅生成特定分类")
    parser.add_argument("--theme", choices=["animal_home", "sunny_garden", "happy_school"], help="仅生成特定场景依赖")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    inventory_path = project_root / "artifacts" / "audio-inventory.json"

    if not inventory_path.exists():
        print("未检测到 artifacts/audio-inventory.json，正在自动生成清单...")
        subprocess.run(["node", "scripts/audio-inventory.mjs"], cwd=str(project_root), check=True)

    with open(inventory_path, "r", encoding="utf-8") as f:
        inventory = json.load(f)

    audio_source_dir = project_root / "audio-source"
    ffmpeg_exe = find_ffmpeg()

    proxy = None if args.no_proxy else args.proxy
    if proxy:
        print(f"使用网络代理: {proxy}")

    # Filter items that have an input WAV requirement
    items = [clip for clip in inventory.get("clips", []) if clip.get("input")]

    if args.only:
        items = [c for c in items if c["input"].startswith(f"{args.only}/")]

    if args.theme:
        # Filter items for specific theme
        theme_prefix = f"{args.theme}#"
        items = [
            c
            for c in items
            if c.get("ref", "").startswith(theme_prefix)
            or c.get("kind") in ("phoneme", "guide")
        ]

    # Deduplicate by input path
    unique_items = {}
    for item in items:
        unique_items[item["input"]] = item
    items_to_generate = list(unique_items.values())

    skip_existing = not args.force and args.skip_existing
    total = len(items_to_generate)
    print(f"待处理音频数量: {total} 个，并发数: {args.concurrency}")

    semaphore = asyncio.Semaphore(args.concurrency)
    counter = {"done": 0}

    tasks = [
        synthesize_one(
            item,
            audio_source_dir,
            ffmpeg_exe,
            proxy,
            semaphore,
            skip_existing,
            counter,
            total,
        )
        for item in items_to_generate
    ]

    await asyncio.gather(*tasks)

    print("\n==========================================")
    print(f"批量生成完成！共处理: {counter['done']}/{total} 个文件。")
    print(f"音频目录: {audio_source_dir}")
    print("下一步可运行:")
    print("  npm run audio:pack          # 打包音频精灵 (Sprite)")
    print("  npm run validate:assets -- --preview # 校验音频素材")
    print("  npm run dev                 # 启动本地预览体验声音")
    print("==========================================")


if __name__ == "__main__":
    asyncio.run(main())

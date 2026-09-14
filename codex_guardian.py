"""
Codex CLI 自动守护程序 (Codex Guardian) - Nebula 联动增强版
功能：
1. 智能容错：后台监控 Codex 会话，遇 400 (invalid_encrypted_content)、429 (rate_limit)、Rate Limit Exceeded (如 gpt-6-astra 在 eastus2 频控)、高负载 (We're currently experiencing high demand) 等报错卡住时，自动通过后台队列输入「继续」；
2. 智能决策：识别到多选一 (1/2/3 方案选择) 或命令执行/文件修改/权限审批确认 (如 "[… 50 lines] ctrl + a view all › 1. Yes, proceed (y)") 时，支持自动后台回复默认选项「1」确认继续推进；
3. 完工通知：检测到 Codex 正常回答完成时，自动通过 Nebula Terminal 发出系统通知（Toast）与提示音，并附带回复摘要；
4. 会话指定：支持运行时交互式选择/输入特定的 Codex 会话 ID，也支持命令行参数指定，默认自动跟踪最新会话。

优势：
- 100% 后台静默处理：不抢焦点、不弹错窗，完全不打扰你在其他窗口工作；
- 深度联动 Nebula：使用 Nebula Terminal 原生注册的 AUMID 发出官方 Toast 通知，点击可直达终端；
- 纯 Python 标准库：零外部依赖，即开即用。
"""

import os
import sys
import glob
import json
import time
import html
import re
import subprocess
from datetime import datetime

# 全局保障输出流编码，防止在 GBK 等非 UTF-8 终端下因 emoji 闪退
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# 常见的需要自动发送「继续」予以恢复的错误关键词
ERROR_KEYWORDS = [
    # 400 格式 / 上下文加密异常
    "invalid_encrypted_content",
    "bad response status code 400",
    # 429 频控 / 配额耗尽 / 速率限制相关 (含 gpt-6-astra eastus2 rate limit exceeded 等)
    "429",
    "rate_limit",
    "rate limit",
    "rate limit exceeded",
    "rate_limit_exceeded",
    "exceeded rate limit",
    "have exceeded rate limit",
    "too many requests",
    "exceeded retry limit",
    "concurrency limit exceeded",
    # 官方服务器高负载 / 临时故障（兼容带 ■ 与不带 ■，单双引号）
    "experiencing high demand",
    "we're currently experiencing high demand",
    "we’re currently experiencing high demand",
    "temporary errors",
    "high demand",
    # 503 / 临时服务不可用 / 网络传输中断
    "service temporarily unavailable",
    "503 service unavailable",
    "internal_server_error",
    "stream disconnected before completion",
    "transport error",
]

# 需要较长等待时间以避开高峰拥堵或冷却频控的关键词
THROTTLE_KEYWORDS = [
    "429",
    "rate_limit",
    "rate limit",
    "rate limit exceeded",
    "rate_limit_exceeded",
    "exceeded rate limit",
    "have exceeded rate limit",
    "too many requests",
    "high demand",
    "experiencing high demand",
    "temporary errors",
    "concurrency limit",
    "service temporarily unavailable",
    "503",
]

def clean_error_text(text):
    """
    清洗错误文本：去除 ANSI 转义序列、去除前导特殊符号（如 ■, ▪, ● 等）、规范化引号与空白
    """
    if not text:
        return ""
    # 去除终端 ANSI 转义码 (如 \x1b[31m)
    s = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', str(text))
    # 规范化弯引号
    s = s.replace("’", "'").replace("‘", "'").replace("”", '"').replace("“", '"')
    # 清洗前置装饰符号 (■, ▪, ●, ◆, •, -, *, 以及空格换行)
    s = re.sub(r'^[■▪●◆•\*\-\s]+', '', s)
    return s.strip()

def is_rate_limit_error(text):
    """
    智能判断文本是否属于速率限制/频控超限错误 (Rate Limit Exceeded)
    支持形如: "rate limit exceeded: Your requests to gpt-6-astra for gpt-6-astra in eastus2 have exceeded rate limit"
    """
    if not text:
        return False
    norm = " ".join(clean_error_text(text).lower().split())
    if any(kw in norm for kw in [
        "rate limit exceeded",
        "exceeded rate limit",
        "have exceeded rate limit",
        "rate_limit_exceeded",
        "concurrency limit exceeded",
        "too many requests",
        "exceeded retry limit",
    ]):
        return True
    if re.search(r'requests\s+to\s+.*?\s+have\s+exceeded\s+rate\s+limit', norm):
        return True
    return False

def is_high_demand_error(text):
    """
    智能判断文本是否属于服务高负载/临时不可用错误 (High Demand)
    """
    if not text:
        return False
    norm = " ".join(clean_error_text(text).lower().split())
    return (
        "experiencing high demand" in norm
        or "temporary errors" in norm
        or "service temporarily unavailable" in norm
    )

def is_approval_prompt(text):
    """
    判断文本是否为 Codex 原生命令执行/文件修改/权限审批确认提示 (Proceed / Approval)
    例如:
    [… 50 lines] ctrl + a view all
    › 1. Yes, proceed (y)
      2. No, and tell Codex what to do differently (esc)
    """
    if not text:
        return False
    patterns = [
        r'(?:yes,\s*)?proceed\s*(?:\(y\))?',
        r'tell\s+codex\s+what\s+to\s+do\s+differently',
        r'ctrl\s*\+\s*a\s+view\s+all',
        r'\[…\s*\d+\s*lines\]',
        r'yes,\s*just\s+this\s+once',
        r"yes,\s*and\s+don't\s+ask\s+again",
        r'no,\s*continue\s+without\s+running',
        r'would\s+you\s+like\s+to\s+(?:run|make|grant)',
        r'needs\s+your\s+approval',
        r'do\s+you\s+want\s+to\s+approve',
    ]
    return any(re.search(p, str(text), re.IGNORECASE) for p in patterns)

def extract_text_from_payload(p):
    """从 session 事件 payload 中提取文本内容"""
    if not p:
        return ""
    if isinstance(p, str):
        return p
    if p.get("last_agent_message"):
        return str(p.get("last_agent_message"))
    if p.get("message") and isinstance(p.get("message"), str):
        return str(p.get("message"))
    item = p.get("item")
    if isinstance(item, dict):
        item_content = item.get("content")
        if isinstance(item_content, list):
            texts = []
            for it in item_content:
                if isinstance(it, dict) and "text" in it:
                    texts.append(it["text"])
                elif isinstance(it, str):
                    texts.append(it)
            if texts:
                return "\n".join(texts)
    content = p.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = []
        for item in content:
            if isinstance(item, dict):
                if "text" in item:
                    texts.append(item["text"])
                elif "output_text" in item:
                    texts.append(item["output_text"])
            elif isinstance(item, str):
                texts.append(item)
        return "\n".join(texts)
    return ""

def is_choice_prompt(text):
    """
    智能识别模型回复或终端交互是否在向用户提出选择/决策请求（例如选择方案 1/2/3、Proceed 审批确认等）
    """
    if not text:
        return False
    text = text.strip()

    # 0. 优先检测 Codex 原生命令执行/文件修改/权限审批提示 (Approval / Proceed Prompt)
    # 支持包含光标符号 (›, >, ➜, → 等)、ctrl + a view all 等
    has_approval_phrase = is_approval_prompt(text)

    # 1. 检查是否存在编号选项 (例如 1. 和 2.，或者 [1] 和 [2]，支持光标前缀 ›, >, ➜ 等)
    has_opt1 = bool(re.search(r'(?:^|\n|\s)[›>➜→*•\-»]?\s*(?:1[\.、\)]|\[1\]|\(1\)|【1】)', text))
    has_opt2 = bool(re.search(r'(?:^|\n|\s)[›>➜→*•\-»]?\s*(?:2[\.、\)]|\[2\]|\(2\)|【2】)', text))
    has_explicit_bracket = bool(re.search(r'\[[1-3]/[1-3]\]|\[[1-3]-[1-3]\]|【[1-3]/[1-3]】', text))

    # 如果命中 Codex 原生审批短语且包含选项 1 (Yes, proceed)，直接判定为选择决策
    if has_approval_phrase and (has_opt1 or "proceed" in text.lower()):
        return True

    if not ((has_opt1 and has_opt2) or has_explicit_bracket):
        return False

    # 2. 检查结尾段落（最后 500 字符以内）或开头是否存在明确让用户做出选择的指令 (Call To Action)
    tail_text = text[-500:] if len(text) > 500 else text

    cta_patterns = [
        # 中文明确选择指令
        r'请(?:从上述|从中|在上述|在以上|根据上述)?.*?(?:选择|挑选|决定)',
        r'你(?:希望|倾向|想)(?:选择|采用|使用|要哪|选哪)',
        r'您(?:希望|倾向|想)(?:选择|采用|使用|要哪|选哪)',
        r'请(?:直接)?回复\s*(?:序号|编号|选项|[1-3])',
        r'输入\s*(?:序号|编号|选项|[1-3])',
        r'回复\s*[1-3]\s*(?:确认|继续|选择|以)',
        r'请确认(?:采用)?(?:方案|选项)\s*[1-3]',
        r'请告诉我你的选择',
        r'请告知(?:你的|您的)?选择',
        r'\[[1-3]/[1-3]\]',
        r'\[[1-3]-[1-3]\]',
        r'【[1-3]/[1-3]】',
        # 英文明确选择指令
        r'(?:please\s+)?(?:choose|select|pick)\s*(?:one|an option|[1-3])?',
        r'which\s+(?:option|approach|solution)\s+do\s+you\s+prefer',
        r'reply\s+with\s+[1-3]',
        r'\[1/2/3\]|\[1/2\]',
        # 审批与确认指令
        r'(?:yes,\s*)?proceed\s*(?:\(y\))?',
        r'tell\s+codex\s+what\s+to\s+do\s+differently',
        r'ctrl\s*\+\s*a\s+view\s+all',
        r'yes,\s*just\s+this\s+once',
        r"yes,\s*and\s+don't\s+ask\s+again",
        r'would\s+you\s+like\s+to\s+(?:run|make|grant)',
        r'needs\s+your\s+approval',
        r'do\s+you\s+want\s+to\s+approve',
    ]

    has_cta = any(re.search(p, tail_text, re.IGNORECASE) for p in cta_patterns) or any(
        re.search(p, text[:300], re.IGNORECASE) for p in cta_patterns
    )
    return has_cta

def log(msg):
    now = datetime.now().strftime("%H:%M:%S")
    safe_msg = str(msg).encode(sys.stdout.encoding or "utf-8", errors="replace").decode(sys.stdout.encoding or "utf-8")
    print(f"[{now}] {safe_msg}", flush=True)

def safe_str(text):
    """确保文本在终端打印时不抛出编码异常"""
    return str(text).encode(sys.stdout.encoding or "utf-8", errors="replace").decode(sys.stdout.encoding or "utf-8")

def get_recent_sessions(limit=5):
    """读取最近记录的会话列表"""
    index_file = os.path.expanduser("~/.codex/session_index.jsonl")
    sessions = []
    seen = set()
    if os.path.exists(index_file):
        try:
            with open(index_file, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
            for line in reversed(lines):
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                    sid = d.get("id")
                    if sid and sid not in seen:
                        seen.add(sid)
                        sessions.append({
                            "id": sid,
                            "name": d.get("thread_name", "未命名任务"),
                            "updated_at": d.get("updated_at", "")[:19].replace("T", " ")
                        })
                        if len(sessions) >= limit:
                            break
                except Exception:
                    pass
        except Exception:
            pass
    return sessions

def find_session_file(thread_id=None):
    """根据 thread_id 查找对应的 rollout 文件；若未指定则返回最新修改的文件"""
    if thread_id:
        pattern = os.path.expanduser(f"~/.codex/sessions/**/rollout-*{thread_id}*.jsonl")
        files = glob.glob(pattern, recursive=True)
        if not files:
            pattern = os.path.expanduser(f"~/.codex/sessions/**/*{thread_id}*.jsonl")
            files = glob.glob(pattern, recursive=True)
        if files:
            return max(files, key=os.path.getmtime)
        return None
    else:
        pattern = os.path.expanduser("~/.codex/sessions/**/*.jsonl")
        files = glob.glob(pattern, recursive=True)
        if not files:
            return None
        return max(files, key=os.path.getmtime)

def extract_thread_id_from_file(filepath):
    """从文件名中提取 session thread_id，提取不到则回退从首行 session_meta 读取"""
    if not filepath or not os.path.exists(filepath):
        return None
    base = os.path.basename(filepath)
    parts = base.replace(".jsonl", "").split("-")
    if len(parts) >= 6:
        uuid_parts = parts[-5:]
        candidate = "-".join(uuid_parts)
        if len(candidate) == 36 and candidate.count("-") == 4:
            return candidate

    # 兜底：从文件首行 session_meta 中读取
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            first_line = f.readline().strip()
            if first_line:
                data = json.loads(first_line)
                p = data.get("payload", {})
                sid = p.get("session_id") or p.get("id")
                if sid:
                    return sid
    except Exception:
        pass
    return None

def check_pending_tool_approval(lines):
    """
    检查会话中是否存在正在等待用户审批/确认的命令执行或工具调用 (如 sandbox_permissions: require_escalated)
    在终端等待用户审批时，已经写入了 custom_tool_call，但尚未产生匹配的 custom_tool_call_output
    """
    completed_calls = set()
    for l in lines:
        if not l.strip():
            continue
        try:
            d = json.loads(l)
            p = d.get("payload", {})
            if p.get("type") == "custom_tool_call_output" and p.get("call_id"):
                completed_calls.add(p.get("call_id"))
        except Exception:
            pass

    for l in reversed(lines):
        if not l.strip():
            continue
        try:
            d = json.loads(l)
        except Exception:
            continue
        p = d.get("payload", {})
        ev_type = p.get("type")
        # 如果已经有了新的用户回复、新任务开始或任务结束，则不再是待审批状态
        if ev_type in ("task_complete", "turn_aborted") or (
            ev_type in ("user_message", "UserMessage") or (ev_type == "message" and p.get("role") == "user")
        ):
            break
        if ev_type == "custom_tool_call":
            call_id = p.get("call_id")
            inp = p.get("input", "")
            if call_id and call_id not in completed_calls:
                if "require_escalated" in inp or "justification" in inp or "approval" in inp.lower():
                    just_m = re.search(r'justification:[\"\'](.*?)[\"\']', inp)
                    cmd_m = re.search(r'cmd:[\"\'](.*?)[\"\']', inp)
                    reason = just_m.group(1) if just_m else "命令执行需要提权审批"
                    cmd_str = cmd_m.group(1) if cmd_m else ""
                    return True, call_id, reason, cmd_str
    return False, None, None, None

def inspect_session(filepath):
    """
    检查 session 文件中是否有未处理的事件
    返回: (status, is_429, turn_id, thread_id, payload_info)
    status 可选:
      - 'running': 正在处理中或有新的用户输入/任务在进行
      - 'error_stuck': 发生已知错误卡住中断，需要自动投递「继续」
      - 'choice_prompt': 检测到模型正在等待用户做 1/2/3 选项决策
      - 'normal_complete': 正常回答完成，已出结果
      - 'idle': 空闲或无待处理事件
    """
    if not filepath or not os.path.exists(filepath):
        return "idle", False, None, None, None

    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
    except Exception:
        return "idle", False, None, None, None

    thread_id = extract_thread_id_from_file(filepath)

    # 0. 优先检测是否存在正在等待用户审批的提权工具调用 (如执行命令弹出的 1. Yes, proceed 审批)
    is_pending_appr, appr_call_id, appr_reason, appr_cmd = check_pending_tool_approval(lines)
    if is_pending_appr:
        turn_id = f"escalated:{appr_call_id}"
        summary = f"Would you like to run the following command?\nReason: {appr_reason}\n$ {appr_cmd}\n› 1. Yes, proceed (y)"
        clean_summary = " ".join(clean_error_text(summary).replace("#", "").replace("*", "").split())
        return "choice_prompt", False, turn_id, thread_id, clean_summary

    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except Exception:
            continue

        p = data.get("payload", {})
        event_type = p.get("type")

        # 如果在 task_complete 之后已经有了新的用户输入或新任务开始，说明正在处理中
        is_user_input = (
            event_type in ("task_started", "user_message", "UserMessage")
            or (event_type == "message" and p.get("role") == "user")
        )
        if is_user_input:
            return "running", False, None, None, None

        # 检查是否是在中间阶段弹出的选项或审批提示 (如模型输出了待审批操作或方案选择，尚未到达 task_complete)
        if (event_type == "message" and p.get("role") == "assistant") or (
            event_type == "item_completed" and isinstance(p.get("item"), dict) and p.get("item", {}).get("type") == "AgentMessage"
        ):
            msg_text = extract_text_from_payload(p)
            if is_choice_prompt(msg_text):
                turn_id = p.get("turn_id") or p.get("internal_chat_message_metadata_passthrough", {}).get("turn_id") or f"{thread_id}:{data.get('timestamp')}"
                clean_summary = " ".join(clean_error_text(msg_text).replace("#", "").replace("*", "").split())
                return "choice_prompt", False, turn_id, thread_id, clean_summary

        # 显式 error 事件类型（部分版本或网关直接返回 payload.type == 'error'）
        if event_type == "error":
            turn_id = p.get("turn_id") or f"{thread_id}:{data.get('timestamp')}:{data.get('ordinal', '')}"
            err_msg = p.get("message") or str(p)
            clean_msg = clean_error_text(err_msg)
            msg_norm = " ".join(clean_msg.lower().split())
            is_429 = is_rate_limit_error(msg_norm) or any(k in msg_norm for k in THROTTLE_KEYWORDS)
            matched = is_429 or is_high_demand_error(msg_norm) or any(kw in msg_norm for kw in ERROR_KEYWORDS)
            if matched:
                return "error_stuck", is_429, turn_id, thread_id, clean_msg

        if event_type == "task_complete":
            turn_id = p.get("turn_id") or f"{thread_id}:{data.get('timestamp')}:{data.get('ordinal', '')}"
            item_thread_id = p.get("thread_id") or thread_id

            # 情况 1: 发生错误中断卡死（在 error 字段中）
            if p.get("error"):
                err = p["error"]
                err_str = json.dumps(err, ensure_ascii=False).lower().replace("’", "'")
                err_msg = ""
                if isinstance(err, dict):
                    err_msg = err.get("message") or err.get("error") or "Unknown error"
                    if isinstance(err_msg, dict):
                        err_msg = err_msg.get("message", json.dumps(err_msg, ensure_ascii=False))
                else:
                    err_msg = str(err)

                clean_msg = clean_error_text(err_msg)
                msg_norm = " ".join(clean_msg.lower().split())

                is_rl = is_rate_limit_error(msg_norm) or is_rate_limit_error(err_str)
                is_hd = is_high_demand_error(msg_norm) or is_high_demand_error(err_str)
                matched = (
                    is_rl
                    or is_hd
                    or any(kw in err_str for kw in ERROR_KEYWORDS)
                    or any(kw in msg_norm for kw in ERROR_KEYWORDS)
                )
                if matched:
                    is_429 = is_rl or any(k in err_str for k in THROTTLE_KEYWORDS) or any(k in msg_norm for k in THROTTLE_KEYWORDS)
                    return "error_stuck", is_429, turn_id, item_thread_id, clean_msg

            # 情况 2: 检查 last_agent_message (防止部分错误信息或限流提示混入该字段)
            elif p.get("last_agent_message"):
                summary = p.get("last_agent_message", "").strip()
                clean_msg = clean_error_text(summary)
                summary_norm = " ".join(clean_msg.lower().split())
                raw_norm = " ".join(summary.lower().replace("’", "'").split())

                # 智能识别限流、高负载及带 ■ 报错前缀的异常
                is_rl = is_rate_limit_error(summary_norm) or is_rate_limit_error(raw_norm)
                is_hd = is_high_demand_error(summary_norm) or is_high_demand_error(raw_norm)
                has_bullet = summary.startswith("■") or bool(re.match(r'^[■▪●◆•\*\-]', summary.strip()))

                is_err_stuck = is_rl or is_hd or (
                    has_bullet and any(kw in raw_norm for kw in ERROR_KEYWORDS)
                ) or any(kw in summary_norm for kw in [
                    "invalid_encrypted_content",
                    "bad response status code 400",
                    "stream disconnected before completion",
                    "internal_server_error",
                    "exceeded retry limit",
                ])

                if is_err_stuck:
                    is_429 = is_rl or any(k in summary_norm for k in THROTTLE_KEYWORDS)
                    return "error_stuck", is_429, turn_id, item_thread_id, clean_msg

                # 判断是否是等待用户做出 1/2/3 方案选择 或 Proceed 审批
                clean_summary = " ".join(clean_msg.replace("#", "").replace("*", "").split())
                if is_choice_prompt(summary) or is_choice_prompt(clean_msg):
                    return "choice_prompt", False, turn_id, item_thread_id, clean_summary

                # 正常回答完成 (无 error，且非错误信息或选项询问)
                return "normal_complete", False, turn_id, item_thread_id, clean_summary

            break

    return "idle", False, None, None, None

def send_resume_via_queue(thread_id, message="继续"):
    """通过 Codex 原生 CLI 队列后台静默投递恢复指令"""
    try:
        cmd = ["codex.cmd", "queue", "--thread", thread_id, "--message", message]
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
        output = (res.stdout or "") + (res.stderr or "")
        if "Queued message" in output or res.returncode == 0:
            return True, output.strip()
        else:
            return False, output.strip()
    except Exception as e:
        return False, str(e)

def notify_via_nebula(title: str, body: str):
    """通过 Nebula Terminal 的注册通道 (com.nebula.terminal) 发送 Windows 原生 Toast 气泡通知"""
    clean_title = html.escape(title[:40]).replace('$', '`$')
    clean_body = html.escape(body[:150]).replace('$', '`$') if body else "Codex 已成功执行完成。"

    ps_script = f'''
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$template = @"
<toast>
    <visual>
        <binding template='ToastGeneric'>
            <text>{clean_title}</text>
            <text>{clean_body}</text>
        </binding>
    </visual>
    <audio src='ms-winsoundevent:Notification.Default'/>
</toast>
"@

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('com.nebula.terminal').Show($toast)
'''
    try:
        subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], capture_output=True, text=True)
        print("\a", end="", flush=True)  # 终端提示音
        return True
    except Exception as e:
        log(f"   [通知失败] {e}")
        return False

def parse_target_thread():
    """解析命令行参数或交互式输入，返回 (target_id, auto_select_1)"""
    target_id = None
    auto_select_1 = True
    args = sys.argv[1:]

    # 解析可选开关
    clean_args = []
    for arg in args:
        if arg in ("--no-auto-1", "--no-choice-1", "--manual-choice"):
            auto_select_1 = False
        elif arg in ("--auto-1", "--auto-choice-1"):
            auto_select_1 = True
        elif arg in ("-h", "--help"):
            print("用法: python codex_guardian.py [会话ID] [选项]")
            print("示例: python codex_guardian.py 01a08906-d80f-76d2-92c6-5bf619a303a5")
            print("      python codex_guardian.py 01a08906  (支持短前缀)")
            print("选项:")
            print("  --no-auto-1       禁用 1/2/3 自动选择功能（改为仅通知并等待手动输入）")
            print("  --auto-1          启用 1/2/3 自动选择功能（默认已开启，5秒缓冲后自动选1）")
            print("  -t, --thread ID   显式指定被监控的会话 ID")
            sys.exit(0)
        else:
            clean_args.append(arg)

    # 1. 从清洗后的位置参数读取会话 ID
    if clean_args:
        if clean_args[0] in ("-t", "--thread") and len(clean_args) > 1:
            target_id = clean_args[1].strip()
        else:
            target_id = clean_args[0].strip()

    if target_id:
        return target_id, auto_select_1

    # 2. 交互式选择/输入
    recent_list = get_recent_sessions(4)
    if recent_list:
        print("\n[📋 最近的活跃 Codex 会话]", flush=True)
        for idx, item in enumerate(recent_list, start=1):
            sid = item["id"]
            name = safe_str(item["name"][:32])
            time_str = item["updated_at"]
            print(f"  [{idx}] {sid} ({name}) - {time_str}", flush=True)
        print(flush=True)

    try:
        user_input = input("请输入要锁定的会话序号 [1-4] 或 会话ID (直接回车将自动跟踪最新活跃会话): ").strip()
        if not user_input:
            return None, auto_select_1

        # 如果输入的是数字序号
        if user_input.isdigit():
            choice = int(user_input)
            if 1 <= choice <= len(recent_list):
                return recent_list[choice - 1]["id"], auto_select_1

        # 输入的是自定义 ID 或前缀
        return user_input, auto_select_1
    except (KeyboardInterrupt, EOFError):
        print("\n")
        return None, auto_select_1

def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    print("=" * 70)
    print("   🛡️ Codex CLI 自动守护程序 (Codex Guardian) - Nebula 联动版")
    print("   - 异常容错: 遇 400 / 429 / Rate Limit Exceeded / 高负载报错卡死，后台静默自动「继续」")
    print("   - 智能决策: 识别到多选一 (1/2/3) 或执行审批 (Yes, proceed) 提示时，自动后台回复「1」推进 💡")
    print("   - 完工通知: 检测到回答正常结束，通过 Nebula 发出系统弹窗通知 🎉")
    print("   - 安全特性: 100% 后台静默处理，绝不抢占焦点、绝不误触其他打字窗口")
    print("=" * 70)

    # 获取用户指定的监控目标与配置
    specified_thread, auto_select_1 = parse_target_thread()
    if auto_select_1:
        log("💡 已开启「智能选项决策」：检测到方案选择或执行审批提示时，将等待 5 秒缓冲后自动回复「1」。")
    else:
        log("✋ 已关闭「智能选项决策」：检测到方案选择时仅弹窗提醒，由用户在终端手动输入。")
    if specified_thread:
        # 验证能否找到对应的会话文件
        matched_file = find_session_file(specified_thread)
        if matched_file:
            real_thread_id = extract_thread_id_from_file(matched_file)
            log(f"🎯 已成功锁定会话: [{real_thread_id}]")
            log(f"   对应日志文件: {os.path.basename(matched_file)}")
            specified_thread = real_thread_id
        else:
            log(f"⚠️ 未在磁盘找到包含 [{specified_thread}] 的历史会话文件，将在该会话产生新日志时自动挂载。")
    else:
        log("🔄 未指定固定会话，已开启「动态跟踪模式」：将自动跟踪当前最新活跃的 Codex 会话。")

    print("-" * 70, flush=True)
    print("[*] 正在后台监控中 (按 Ctrl+C 退出)...", flush=True)

    processed_turns = set()

    # 仅忽略初次启动前已正常完成的 turn，避免启动时误发完成通知；若启动时已处于报错卡死或选项等待状态，则保留以便立刻唤醒恢复
    init_file = find_session_file(specified_thread)
    if init_file:
        status, _, turn_id, _, _ = inspect_session(init_file)
        if turn_id and status == "normal_complete":
            processed_turns.add(turn_id)

    while True:
        try:
            target_file = find_session_file(specified_thread)
            if not target_file:
                time.sleep(2)
                continue

            status, is_429, turn_id, thread_id, payload_info = inspect_session(target_file)

            if turn_id and turn_id not in processed_turns:
                # -------------------------------------------------------------
                # 状态 1: 发生错误中断卡死 -> 自动后台静默输入「继续」
                # -------------------------------------------------------------
                if status == "error_stuck":
                    active_thread = thread_id or specified_thread or extract_thread_id_from_file(target_file)
                    log(f"⚠️ 检测到会话 [{active_thread}] 报错中断！")
                    log(f"   错误详情: {safe_str(payload_info[:120])}...")

                    wait_sec = 12 if is_429 else 3
                    norm_info = " ".join(payload_info.lower().split())

                    # 识别具体的模型与区域 Rate Limit 频控信息
                    rl_match = re.search(r'requests to ([\w\-]+) .*? in ([\w\-]+) have exceeded rate limit', norm_info, re.IGNORECASE)
                    if rl_match:
                        model_name = rl_match.group(1)
                        region = rl_match.group(2)
                        log(f"   [频控超限保护] 检测到模型 [{model_name}] 在 [{region}] 区域触发 Rate Limit，避开频控冷却，倒计时 {wait_sec} 秒后发送「继续」...")
                    elif is_rate_limit_error(norm_info):
                        log(f"   [频控超限保护] 检测到请求频控限制 (Rate Limit Exceeded)，避开频控冷却，倒计时 {wait_sec} 秒后发送「继续」...")
                    elif is_high_demand_error(norm_info):
                        log(f"   [高负载保护] 检测到官方服务当前高负载 (High Demand)，避开拥堵，倒计时 {wait_sec} 秒后发送「继续」...")
                    elif is_429:
                        log(f"   [频控保护] 检测到请求受限 (Rate Limit / 429)，倒计时 {wait_sec} 秒后发送「继续」...")
                    else:
                        log(f"   倒计时 {wait_sec} 秒后通过后台队列自动发送「继续」...")

                    user_intervened = False
                    for s in range(wait_sec, 0, -1):
                        time.sleep(1)
                        chk_status, _, chk_turn, _, _ = inspect_session(target_file)
                        if chk_turn != turn_id or chk_status != "error_stuck":
                            log("   检测到会话已恢复，取消自动发送。")
                            user_intervened = True
                            break

                    if not user_intervened:
                        ok, resp = send_resume_via_queue(active_thread, "继续")
                        if ok:
                            log(f"   ✅ [后台静默送达] 成功向会话 [{active_thread}] 投递「继续」！")
                        else:
                            log(f"   ❌ queue 投递失败: {resp}")

                    processed_turns.add(turn_id)

                # -------------------------------------------------------------
                # 状态 2: 检测到选项决策 (1/2/3) 或执行审批 (Yes, proceed) -> 自动后台回复「1」确认
                # -------------------------------------------------------------
                elif status == "choice_prompt":
                    active_thread = thread_id or specified_thread or extract_thread_id_from_file(target_file)
                    summary_text = payload_info[:100] + "..." if len(payload_info) > 100 else payload_info
                    is_appr = is_approval_prompt(payload_info)

                    if is_appr:
                        log(f"💡 检测到会话 [{active_thread}] 弹出执行审批/确认提示 (Yes, proceed)！")
                        log(f"   审批内容: {safe_str(summary_text)}")
                    else:
                        log(f"💡 检测到会话 [{active_thread}] 正在等待用户做出选项决策 (1/2/3)！")
                        log(f"   问题摘要: {safe_str(summary_text)}")

                    if auto_select_1:
                        wait_sec = 5
                        if is_appr:
                            log(f"   [智能决策] 倒计时 {wait_sec} 秒后将自动确认默认选项「1」(Yes, proceed) 推进执行...")
                            notify_title = "Codex 等待执行审批 💡"
                            notify_body = f"将在 {wait_sec} 秒后自动确认选项「1」(Yes, proceed)：{summary_text}"
                        else:
                            log(f"   [智能决策] 倒计时 {wait_sec} 秒后将自动回复选项「1」（如需自行选择可直接在终端操作）...")
                            notify_title = "Codex 询问选项决策 💡"
                            notify_body = f"将在 {wait_sec} 秒后自动回复「1」：{summary_text}"

                        notify_via_nebula(notify_title, notify_body)

                        user_intervened = False
                        for s in range(wait_sec, 0, -1):
                            time.sleep(1)
                            chk_status, _, chk_turn, _, _ = inspect_session(target_file)
                            if chk_turn != turn_id or chk_status != "choice_prompt":
                                log("   检测到会话已有输入或状态变更，取消自动选择。")
                                user_intervened = True
                                break

                        if not user_intervened:
                            ok, resp = send_resume_via_queue(active_thread, "1")
                            if ok:
                                opt_desc = "选项「1」(Yes, proceed)" if is_appr else "选项「1」"
                                log(f"   ✅ [自动决策送达] 成功向会话 [{active_thread}] 自动投递{opt_desc}！\n")
                            else:
                                log(f"   ❌ queue 投递失败: {resp}\n")
                    else:
                        log("   [提示] 已禁用自动选择，请在终端手动选择。\n")
                        notify_title = "Codex 等待执行审批 ❓" if is_appr else "Codex 等待您的选择 ❓"
                        notify_body = summary_text if summary_text else "请前往终端查看选项并做出选择。"
                        notify_via_nebula(notify_title, notify_body)

                    processed_turns.add(turn_id)

                # -------------------------------------------------------------
                # 状态 3: 正常回答结束 -> 通过 Nebula 发送系统通知
                # -------------------------------------------------------------
                elif status == "normal_complete":
                    log(f"🎉 检测到会话 [{thread_id}] 回答已正常结束！")
                    summary_text = payload_info[:100] + "..." if len(payload_info) > 100 else payload_info
                    log(f"   回答摘要: {safe_str(summary_text)}")
                    log(f"   正在通过 Nebula Terminal 发送 Windows 系统通知...")

                    notify_title = "Codex 任务执行完成 🎉"
                    notify_body = summary_text if summary_text else "所有代码及指令已成功执行结束，请查看终端。"

                    if notify_via_nebula(notify_title, notify_body):
                        log(f"   🔔 [Nebula 通知已弹出] 提示音已播放，可点击通知卡片直达终端！\n")

                    processed_turns.add(turn_id)

            time.sleep(1.5)

        except KeyboardInterrupt:
            print("\n[!] 守护程序已安全停止。")
            break
        except Exception as e:
            time.sleep(2)

if __name__ == "__main__":
    main()

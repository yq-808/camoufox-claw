#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

MCP_TOOL_ACTIONS = [
    "browser_click",
    "browser_close",
    "browser_console_messages",
    "browser_drag",
    "browser_evaluate",
    "browser_file_upload",
    "browser_fill_form",
    "browser_handle_dialog",
    "browser_hover",
    "browser_navigate",
    "browser_navigate_back",
    "browser_network_requests",
    "browser_press_key",
    "browser_resize",
    "browser_run_code",
    "browser_select_option",
    "browser_snapshot",
    "browser_take_screenshot",
    "browser_type",
    "browser_wait_for",
    "browser_tabs",
    "browser_install",
    "browser_mouse_click_xy",
    "browser_mouse_down",
    "browser_mouse_drag_xy",
    "browser_mouse_move_xy",
    "browser_mouse_up",
    "browser_mouse_wheel",
    "browser_pdf_save",
    "browser_generate_locator",
    "browser_verify_element_visible",
    "browser_verify_list_visible",
    "browser_verify_text_visible",
    "browser_verify_value",
]


def send_request(host: str, port: int, payload: Dict[str, Any], timeout: float = 6.0) -> Dict[str, Any]:
    with socket.create_connection((host, port), timeout=timeout) as conn:
        conn.sendall((json.dumps(payload) + "\n").encode("utf-8"))
        conn.settimeout(timeout)
        data = b""
        while not data.endswith(b"\n"):
            chunk = conn.recv(4096)
            if not chunk:
                break
            data += chunk
    if not data:
        raise RuntimeError("empty response from daemon")
    response = json.loads(data.decode("utf-8"))
    if not isinstance(response, dict):
        raise RuntimeError("invalid daemon response type")
    return response


def daemon_alive(host: str, port: int) -> bool:
    try:
        resp = send_request(host, port, {"action": "ping"}, timeout=1.5)
    except Exception:
        return False
    return bool(resp.get("ok"))


def start_daemon(args: argparse.Namespace) -> None:
    runtime_dir = Path(args.runtime_dir).expanduser()
    runtime_dir.mkdir(parents=True, exist_ok=True)
    log_path = runtime_dir / "daemon.log"

    cmd = [
        args.python_bin,
        args.daemon_path,
        "--host",
        args.host,
        "--port",
        str(args.port),
        "--runtime-dir",
        args.runtime_dir,
        "--user-data-dir",
        args.user_data_dir,
        "--target-os",
        args.target_os,
        "--window-width",
        str(args.window_width),
        "--window-height",
        str(args.window_height),
        "--locale",
        args.locale,
        "--launch-timeout-ms",
        str(args.launch_timeout_ms),
        "--playwright-mcp-bin",
        str(args.playwright_mcp_bin),
        "--playwright-mcp-startup-timeout-ms",
        str(args.playwright_mcp_startup_timeout_ms),
        "--playwright-mcp-output-dir",
        str(args.playwright_mcp_output_dir),
    ]
    if args.proxy_server:
        cmd.extend(["--proxy-server", args.proxy_server])
    if args.headless:
        cmd.append("--headless")
    else:
        cmd.append("--headed")
    if args.exclude_ubo:
        cmd.append("--exclude-ubo")
    else:
        cmd.append("--allow-ubo")

    with open(log_path, "a+", encoding="utf-8") as log_fp:
        subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=log_fp,
            stderr=log_fp,
            start_new_session=True,
            close_fds=True,
        )


def ensure_daemon(args: argparse.Namespace, *, autostart: bool = True) -> None:
    if daemon_alive(args.host, args.port):
        return
    if not autostart:
        raise RuntimeError("daemon is not running")

    start_daemon(args)
    deadline = time.time() + (max(500, args.startup_timeout_ms) / 1000.0)
    while time.time() < deadline:
        if daemon_alive(args.host, args.port):
            return
        time.sleep(0.25)
    raise RuntimeError("daemon failed to start within timeout")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Camoufox daemon control tool")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=17888)
    parser.add_argument("--runtime-dir", default="~/.camoufox-claw/runtime")
    parser.add_argument("--user-data-dir", default="~/.camoufox-claw/profile")
    parser.add_argument("--target-os", choices=["windows", "macos", "linux"], default="macos")
    parser.add_argument("--window-width", type=int, default=1280)
    parser.add_argument("--window-height", type=int, default=800)
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument("--python-bin", default=sys.executable)
    parser.add_argument("--daemon-path", default=str(Path(__file__).with_name("camoufox_daemon.py")))
    parser.add_argument("--proxy-server", default="")
    parser.add_argument("--startup-timeout-ms", type=int, default=20000)
    parser.add_argument("--launch-timeout-ms", type=int, default=30000)
    parser.add_argument("--playwright-mcp-bin", default="~/.camoufox-claw/playwright-mcp/node_modules/.bin/playwright-mcp")
    parser.add_argument("--playwright-mcp-startup-timeout-ms", type=int, default=30000)
    parser.add_argument("--playwright-mcp-output-dir", default="~/.openclaw/media/camoufox-mcp")
    parser.add_argument("--exclude-ubo", dest="exclude_ubo", action="store_true")
    parser.add_argument("--allow-ubo", dest="exclude_ubo", action="store_false")
    parser.add_argument("--headless", dest="headless", action="store_true")
    parser.add_argument("--headed", dest="headless", action="store_false")
    parser.add_argument("--json", action="store_true")
    parser.set_defaults(exclude_ubo=True, headless=True)

    sub = parser.add_subparsers(dest="action", required=True)

    sub.add_parser("status")
    sub.add_parser("ensure")
    sub.add_parser("stop")
    sub.add_parser("restart")
    sub.add_parser("shutdown")
    sub.add_parser("mcp_status")
    sub.add_parser("mcp_stop")

    nav = sub.add_parser("navigate")
    nav.add_argument("--url", required=True)
    nav.add_argument("--wait-until", default="domcontentloaded")
    nav.add_argument("--timeout-ms", type=int, default=30000)

    snap = sub.add_parser("snapshot")
    snap.add_argument("--max-chars", type=int, default=6000)

    shot = sub.add_parser("screenshot")
    shot.add_argument("--path", required=True)
    shot.add_argument("--full-page", dest="full_page", action="store_true")
    shot.add_argument("--viewport-only", dest="full_page", action="store_false")
    shot.set_defaults(full_page=True)

    mcp_tools = sub.add_parser("mcp_tools")
    mcp_tools.add_argument("--timeout-ms", type=int, default=30000)

    for tool_action in MCP_TOOL_ACTIONS:
        tool_parser = sub.add_parser(tool_action)
        tool_parser.add_argument("--tool-args-json", default="{}")
        tool_parser.add_argument("--timeout-ms", type=int, default=60000)

    return parser.parse_args()


def print_output(payload: Dict[str, Any], as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, ensure_ascii=False))
        return
    if payload.get("ok"):
        print(json.dumps(payload.get("result", {}), ensure_ascii=False, indent=2))
        return
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def run_action(args: argparse.Namespace) -> Dict[str, Any]:
    action = args.action
    ensure_daemon(args, autostart=True)

    if action == "status":
        return send_request(args.host, args.port, {"action": "status"})
    if action == "ensure":
        return send_request(args.host, args.port, {"action": "ensure"})
    if action == "stop":
        return send_request(args.host, args.port, {"action": "stop"})
    if action == "shutdown":
        return send_request(args.host, args.port, {"action": "shutdown"})
    if action == "mcp_status":
        return send_request(args.host, args.port, {"action": "mcp_status"})
    if action == "mcp_stop":
        return send_request(args.host, args.port, {"action": "mcp_stop"})
    if action == "restart":
        if daemon_alive(args.host, args.port):
            try:
                send_request(args.host, args.port, {"action": "shutdown"})
            except Exception:
                pass
            deadline = time.time() + 8
            while time.time() < deadline:
                if not daemon_alive(args.host, args.port):
                    break
                time.sleep(0.2)
        ensure_daemon(args, autostart=True)
        return send_request(args.host, args.port, {"action": "ensure"})
    if action == "navigate":
        return send_request(
            args.host,
            args.port,
            {
                "action": "navigate",
                "url": args.url,
                "waitUntil": args.wait_until,
                "timeoutMs": int(args.timeout_ms),
            },
            timeout=max(10.0, float(args.timeout_ms) / 1000.0 + 2.0),
        )
    if action == "snapshot":
        return send_request(
            args.host,
            args.port,
            {
                "action": "snapshot",
                "maxChars": int(args.max_chars),
            },
            timeout=8.0,
        )
    if action == "screenshot":
        return send_request(
            args.host,
            args.port,
            {
                "action": "screenshot",
                "path": str(Path(args.path).expanduser()),
                "fullPage": bool(args.full_page),
            },
            timeout=15.0,
        )
    if action == "mcp_tools":
        return send_request(
            args.host,
            args.port,
            {
                "action": "mcp_tools",
                "timeoutMs": int(args.timeout_ms),
            },
            timeout=max(8.0, float(args.timeout_ms) / 1000.0 + 2.0),
        )
    if action in MCP_TOOL_ACTIONS:
        try:
            tool_args = json.loads(args.tool_args_json)
        except Exception as err:  # noqa: BLE001
            raise RuntimeError(f"tool-args-json is not valid JSON: {err}") from err
        if not isinstance(tool_args, dict):
            raise RuntimeError("tool-args-json must decode to a JSON object")
        return send_request(
            args.host,
            args.port,
            {
                "action": action,
                "toolArgs": tool_args,
                "timeoutMs": int(args.timeout_ms),
            },
            timeout=max(8.0, float(args.timeout_ms) / 1000.0 + 2.0),
        )
    raise RuntimeError(f"unsupported action: {action}")


def main() -> int:
    args = parse_args()
    try:
        payload = run_action(args)
    except Exception as err:  # noqa: BLE001
        payload = {"ok": False, "error": str(err)}
        print_output(payload, args.json)
        return 1

    print_output(payload, args.json)
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())

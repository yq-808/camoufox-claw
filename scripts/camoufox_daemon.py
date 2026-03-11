#!/usr/bin/env python3
from __future__ import annotations

import argparse
import atexit
import base64
import fcntl
import json
import os
import queue
import re
import selectors
import signal
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

MCP_TOOL_ACTIONS = {
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
}

SCREENSHOT_RETENTION_SECONDS = 3600
SCREENSHOT_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def terminate_process(proc: Optional[subprocess.Popen[Any]], timeout: float = 8.0) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=timeout)
    except Exception:
        proc.kill()
        proc.wait(timeout=timeout)


def strip_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: strip_none(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [strip_none(v) for v in value if v is not None]
    return value


def pump_text_lines(stream: Any, sink: "queue.Queue[Optional[str]]") -> None:
    try:
        while True:
            line = stream.readline()
            if not line:
                break
            sink.put(line)
    except Exception:
        pass
    finally:
        sink.put(None)


def cleanup_old_screenshots(root_dir: Path, *, retention_seconds: int) -> int:
    if retention_seconds <= 0 or not root_dir.exists():
        return 0

    cutoff = time.time() - retention_seconds
    deleted_count = 0

    for path in root_dir.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in SCREENSHOT_EXTENSIONS:
            continue
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if mtime >= cutoff:
            continue
        try:
            path.unlink()
            deleted_count += 1
        except OSError:
            continue

    for path in sorted(root_dir.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if not path.is_dir():
            continue
        try:
            path.rmdir()
        except OSError:
            continue

    return deleted_count


class CamoufoxSession:
    def __init__(
        self,
        *,
        user_data_dir: Path,
        headless: bool,
        proxy_server: Optional[str],
        exclude_ubo: bool,
        target_os: str,
        window_size: tuple[int, int],
        locale: str,
        launch_timeout_ms: int,
    ) -> None:
        self.user_data_dir = user_data_dir
        self.headless = headless
        self.proxy_server = proxy_server
        self.exclude_ubo = exclude_ubo
        self.target_os = target_os
        self.window_size = window_size
        self.locale = locale
        self.launch_timeout_ms = launch_timeout_ms
        self._cm: Any = None
        self._context: Any = None
        self._page: Any = None

    def _load_camoufox(self) -> tuple[Any, Optional[Any]]:
        try:
            from camoufox.sync_api import Camoufox  # type: ignore
        except Exception as err:  # noqa: BLE001
            raise RuntimeError(f"failed to import camoufox.sync_api.Camoufox: {err}") from err

        default_addons = None
        try:
            from camoufox import DefaultAddons  # type: ignore

            default_addons = DefaultAddons
        except Exception:
            default_addons = None

        return Camoufox, default_addons

    def _extract_context(self, opened: Any) -> Any:
        if hasattr(opened, "new_page"):
            return opened

        contexts = getattr(opened, "contexts", None)
        if callable(contexts):
            available = contexts()
        else:
            available = contexts
        if isinstance(available, list) and available:
            return available[0]
        if hasattr(opened, "new_context"):
            return opened.new_context()
        raise RuntimeError("unable to resolve browser context from Camoufox object")

    def ensure_browser(self) -> None:
        if self._page is not None:
            try:
                if not self._page.is_closed():
                    return
            except Exception:
                pass

        self.user_data_dir.mkdir(parents=True, exist_ok=True)
        Camoufox, default_addons = self._load_camoufox()
        launch_kwargs: Dict[str, Any] = {
            "headless": self.headless,
            "persistent_context": True,
            "user_data_dir": str(self.user_data_dir),
            "os": self.target_os,
            "window": self.window_size,
            "locale": self.locale,
            "timeout": self.launch_timeout_ms,
        }
        if self.proxy_server:
            launch_kwargs["proxy"] = {"server": self.proxy_server}
        if self.exclude_ubo and default_addons is not None:
            ubo = getattr(default_addons, "UBO", None)
            if ubo is not None:
                launch_kwargs["exclude_addons"] = [ubo]

        self._cm = Camoufox(**launch_kwargs)
        opened = self._cm.__enter__()
        self._context = self._extract_context(opened)
        self._page = self._context.new_page()

    def close_browser(self) -> None:
        if self._page is not None:
            try:
                self._page.close()
            except Exception:
                pass
            self._page = None
        if self._context is not None:
            try:
                self._context.close()
            except Exception:
                pass
            self._context = None
        if self._cm is not None:
            try:
                self._cm.__exit__(None, None, None)
            except Exception:
                pass
            self._cm = None

    def status(self) -> Dict[str, Any]:
        browser_started = self._page is not None
        payload: Dict[str, Any] = {
            "browserStarted": browser_started,
            "headless": self.headless,
            "proxyServer": self.proxy_server,
            "userDataDir": str(self.user_data_dir),
            "targetOs": self.target_os,
            "window": {"width": self.window_size[0], "height": self.window_size[1]},
            "locale": self.locale,
        }
        if self._page is not None:
            try:
                payload["url"] = self._page.url
            except Exception:
                payload["url"] = None
            try:
                payload["title"] = self._page.title()
            except Exception:
                payload["title"] = None
        return payload

    def navigate(self, *, url: str, wait_until: str, timeout_ms: int) -> Dict[str, Any]:
        self.ensure_browser()
        response = self._page.goto(url, wait_until=wait_until, timeout=timeout_ms)
        status = None
        if response is not None:
            try:
                status = response.status
            except Exception:
                status = None
        title = None
        try:
            title = self._page.title()
        except Exception:
            title = None
        return {
            "url": self._page.url,
            "title": title,
            "status": status,
        }

    def snapshot(self, *, max_chars: int) -> Dict[str, Any]:
        self.ensure_browser()
        title = None
        try:
            title = self._page.title()
        except Exception:
            title = None

        text = ""
        try:
            text = self._page.inner_text("body", timeout=2500)
        except Exception:
            try:
                text = self._page.content()
            except Exception:
                text = ""

        text = text.strip()
        if len(text) > max_chars:
            text = text[:max_chars]

        return {
            "url": self._page.url,
            "title": title,
            "text": text,
            "truncated": len(text) >= max_chars,
        }

    def screenshot(self, *, path: Path, full_page: bool) -> Dict[str, Any]:
        self.ensure_browser()
        path.parent.mkdir(parents=True, exist_ok=True)
        cleanup_old_screenshots(
            path.parent,
            retention_seconds=SCREENSHOT_RETENTION_SECONDS,
        )
        self._page.screenshot(path=str(path), full_page=full_page)
        return {
            "path": str(path),
            "url": self._page.url,
        }


class PlaywrightMcpBridge:
    def __init__(
        self,
        *,
        playwright_mcp_bin: Path,
        output_dir: Path,
        user_data_dir: Path,
        headless: bool,
        proxy_server: Optional[str],
        exclude_ubo: bool,
        target_os: str,
        window_size: tuple[int, int],
        locale: str,
        startup_timeout_ms: int,
    ) -> None:
        self.playwright_mcp_bin = playwright_mcp_bin
        self.output_dir = output_dir
        self.user_data_dir = user_data_dir
        self.headless = headless
        self.proxy_server = proxy_server
        self.exclude_ubo = exclude_ubo
        self.target_os = target_os
        self.window_size = window_size
        self.locale = locale
        self.startup_timeout_ms = max(1000, startup_timeout_ms)

        self.endpoint_proc: Optional[subprocess.Popen[str]] = None
        self.endpoint_script_copy: Optional[Path] = None
        self.endpoint_ws: Optional[str] = None

        self.mcp_proc: Optional[subprocess.Popen[str]] = None
        self.mcp_selector: Optional[selectors.BaseSelector] = None
        self.mcp_config_path: Optional[Path] = None
        self.mcp_stderr_lines: list[str] = []
        self.mcp_bound_endpoint: Optional[str] = None
        self.mcp_ready = False
        self.mcp_next_id = 1

    def status(self) -> Dict[str, Any]:
        return {
            "playwrightMcpBin": str(self.playwright_mcp_bin),
            "outputDir": str(self.output_dir),
            "userDataDir": str(self.user_data_dir),
            "endpointRunning": bool(self.endpoint_proc and self.endpoint_proc.poll() is None),
            "mcpRunning": bool(self.mcp_proc and self.mcp_proc.poll() is None),
            "mcpReady": bool(self.mcp_ready),
            "wsEndpoint": self.endpoint_ws,
            "mcpBoundEndpoint": self.mcp_bound_endpoint,
            "targetOs": self.target_os,
            "window": {"width": self.window_size[0], "height": self.window_size[1]},
            "locale": self.locale,
        }

    def list_tools(self, timeout_ms: int) -> Dict[str, Any]:
        response = self._request("tools/list", {}, timeout_ms=timeout_ms)
        result = response.get("result")
        if isinstance(result, dict):
            return result
        raise RuntimeError("playwright-mcp returned invalid tools/list result")

    def call_tool(self, *, tool_name: str, arguments: Dict[str, Any], timeout_ms: int) -> Any:
        if tool_name == "browser_take_screenshot":
            self.output_dir.mkdir(parents=True, exist_ok=True)
            cleanup_old_screenshots(
                self.output_dir,
                retention_seconds=SCREENSHOT_RETENTION_SECONDS,
            )
        params = {"name": tool_name, "arguments": arguments}
        response = self._request("tools/call", params, timeout_ms=timeout_ms)
        return response.get("result")

    def stop(self) -> None:
        self._stop_mcp()
        self._stop_endpoint()

    def _stop_mcp(self) -> None:
        terminate_process(self.mcp_proc)
        self.mcp_proc = None

        if self.mcp_selector is not None:
            try:
                self.mcp_selector.close()
            except Exception:
                pass
            self.mcp_selector = None

        if self.mcp_config_path is not None:
            try:
                self.mcp_config_path.unlink(missing_ok=True)
            except Exception:
                pass
            self.mcp_config_path = None

        self.mcp_bound_endpoint = None
        self.mcp_ready = False
        self.mcp_next_id = 1
        self.mcp_stderr_lines = []

    def _stop_endpoint(self) -> None:
        terminate_process(self.endpoint_proc)
        self.endpoint_proc = None
        if self.endpoint_script_copy is not None:
            try:
                self.endpoint_script_copy.unlink(missing_ok=True)
            except Exception:
                pass
            self.endpoint_script_copy = None
        self.endpoint_ws = None

    def _ensure_endpoint(self) -> str:
        if self.endpoint_proc is not None and self.endpoint_proc.poll() is None and self.endpoint_ws:
            return self.endpoint_ws

        self._stop_endpoint()

        try:
            import orjson  # type: ignore
            from camoufox import DefaultAddons  # type: ignore
            from camoufox.pkgman import LOCAL_DATA  # type: ignore
            from camoufox.server import get_nodejs, to_camel_case_dict  # type: ignore
            from camoufox.utils import launch_options  # type: ignore
        except Exception as err:  # noqa: BLE001
            raise RuntimeError(f"failed to import camoufox playwright server modules: {err}") from err

        launch_kwargs: Dict[str, Any] = {
            "headless": self.headless,
            "os": self.target_os,
            "window": self.window_size,
            "locale": self.locale,
        }
        if self.proxy_server:
            launch_kwargs["proxy"] = {"server": self.proxy_server}
        if self.exclude_ubo:
            launch_kwargs["exclude_addons"] = [DefaultAddons.UBO]

        self.user_data_dir.mkdir(parents=True, exist_ok=True)
        options = strip_none(launch_options(**launch_kwargs))
        payload_options = to_camel_case_dict(options)
        payload_options["_userDataDir"] = str(self.user_data_dir)
        payload = base64.b64encode(orjson.dumps(payload_options)).decode("ascii")

        launch_script = LOCAL_DATA / "launchServer.js"
        if not launch_script.exists():
            raise RuntimeError(f"launchServer.js not found: {launch_script}")

        fd, copied_path = tempfile.mkstemp(prefix="camoufox-launch-", suffix=".cjs")
        os.close(fd)
        copied = Path(copied_path)
        copied.write_text(launch_script.read_text(encoding="utf-8"), encoding="utf-8")
        self.endpoint_script_copy = copied

        node_bin = get_nodejs()
        driver_pkg_dir = Path(node_bin).resolve().parent / "package"
        self.endpoint_proc = subprocess.Popen(
            [node_bin, str(copied)],
            cwd=str(driver_pkg_dir),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert self.endpoint_proc.stdin is not None
        self.endpoint_proc.stdin.write(payload)
        self.endpoint_proc.stdin.close()

        logs: list[str] = []
        ws_pattern = re.compile(r"(ws://[^\s]+)")
        assert self.endpoint_proc.stdout is not None
        line_queue: "queue.Queue[Optional[str]]" = queue.Queue()
        threading.Thread(
            target=pump_text_lines,
            args=(self.endpoint_proc.stdout, line_queue),
            daemon=True,
        ).start()
        deadline = time.time() + max(5.0, self.startup_timeout_ms / 1000.0)
        while time.time() < deadline:
            if self.endpoint_proc.poll() is not None:
                excerpt = " | ".join(logs[-8:])
                raise RuntimeError(f"camoufox endpoint exited early; logs={excerpt}")
            try:
                line = line_queue.get(timeout=0.5)
            except queue.Empty:
                continue
            if line is None:
                continue
            text = line.strip()
            if text:
                logs.append(text)
                if len(logs) > 80:
                    logs = logs[-80:]
            match = ws_pattern.search(line)
            if match:
                self.endpoint_ws = match.group(1)
                return self.endpoint_ws

        excerpt = " | ".join(logs[-8:])
        self._stop_endpoint()
        raise RuntimeError(f"timed out waiting for camoufox endpoint ws url; logs={excerpt}")

    def _ensure_mcp_ready(self) -> None:
        endpoint = self._ensure_endpoint()
        if (
            self.mcp_proc is not None
            and self.mcp_proc.poll() is None
            and self.mcp_ready
            and self.mcp_bound_endpoint == endpoint
        ):
            return

        self._stop_mcp()
        if not self.playwright_mcp_bin.exists():
            raise RuntimeError(f"playwright-mcp binary not found: {self.playwright_mcp_bin}")

        fd, config_path = tempfile.mkstemp(prefix="camoufox-playwright-mcp-", suffix=".json")
        os.close(fd)
        config_file = Path(config_path)
        config_file.write_text(
            json.dumps(
                {
                    "browser": {"remoteEndpoint": endpoint},
                    "outputDir": str(self.output_dir),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        self.mcp_config_path = config_file

        self.mcp_proc = subprocess.Popen(
            [str(self.playwright_mcp_bin), "--config", str(config_file), "--headless"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.mcp_selector = selectors.DefaultSelector()
        assert self.mcp_proc.stdout is not None
        assert self.mcp_proc.stderr is not None
        self.mcp_selector.register(self.mcp_proc.stdout, selectors.EVENT_READ)
        self.mcp_selector.register(self.mcp_proc.stderr, selectors.EVENT_READ)
        self.mcp_stderr_lines = []
        self.mcp_ready = False
        self.mcp_bound_endpoint = endpoint
        self.mcp_next_id = 1

        init_id = self._next_request_id()
        self._send_mcp(
            {
                "jsonrpc": "2.0",
                "id": init_id,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "clientInfo": {"name": "camoufox-claw-daemon", "version": "0.1.0"},
                    "capabilities": {},
                },
            }
        )
        init_resp = self._wait_for_response(
            init_id, timeout_seconds=max(5.0, self.startup_timeout_ms / 1000.0)
        )
        if init_resp.get("error"):
            raise RuntimeError(f"playwright-mcp initialize failed: {init_resp['error']}")
        self._send_mcp({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})
        self.mcp_ready = True

    def _next_request_id(self) -> int:
        current = self.mcp_next_id
        self.mcp_next_id += 1
        return current

    def _send_mcp(self, payload: Dict[str, Any]) -> None:
        if self.mcp_proc is None or self.mcp_proc.stdin is None:
            raise RuntimeError("playwright-mcp process is not running")
        self.mcp_proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        self.mcp_proc.stdin.flush()

    def _stderr_excerpt(self) -> str:
        if not self.mcp_stderr_lines:
            return ""
        return " | ".join(self.mcp_stderr_lines[-12:])

    def _read_mcp_message(self, timeout_seconds: float) -> Dict[str, Any]:
        if self.mcp_proc is None or self.mcp_selector is None:
            raise RuntimeError("playwright-mcp process is not running")
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            if self.mcp_proc.poll() is not None:
                raise RuntimeError(
                    f"playwright-mcp exited with code {self.mcp_proc.returncode}; stderr={self._stderr_excerpt()}"
                )
            events = self.mcp_selector.select(timeout=0.5)
            for key, _ in events:
                stream = key.fileobj
                line = stream.readline()
                if not line:
                    continue
                text = line.strip()
                if not text:
                    continue
                if stream is self.mcp_proc.stderr:
                    self.mcp_stderr_lines.append(text)
                    if len(self.mcp_stderr_lines) > 200:
                        self.mcp_stderr_lines = self.mcp_stderr_lines[-200:]
                    continue
                try:
                    payload = json.loads(text)
                except Exception:
                    self.mcp_stderr_lines.append(f"non-json-stdout: {text}")
                    if len(self.mcp_stderr_lines) > 200:
                        self.mcp_stderr_lines = self.mcp_stderr_lines[-200:]
                    continue
                if isinstance(payload, dict):
                    return payload
        raise TimeoutError(f"timed out waiting for playwright-mcp response; stderr={self._stderr_excerpt()}")

    def _wait_for_response(self, request_id: int, timeout_seconds: float) -> Dict[str, Any]:
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            remaining = max(0.2, deadline - time.time())
            try:
                message = self._read_mcp_message(timeout_seconds=min(remaining, 1.2))
            except TimeoutError:
                continue
            if message.get("id") == request_id:
                return message
        raise TimeoutError(f"timed out waiting for playwright-mcp response id={request_id}")

    def _request(self, method: str, params: Dict[str, Any], timeout_ms: int) -> Dict[str, Any]:
        self._ensure_mcp_ready()
        request_id = self._next_request_id()
        self._send_mcp(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params,
            }
        )
        response = self._wait_for_response(
            request_id,
            timeout_seconds=max(2.0, float(timeout_ms) / 1000.0),
        )
        if response.get("error"):
            raise RuntimeError(f"playwright-mcp {method} failed: {response['error']}")
        return response


class CamoufoxApp:
    def __init__(
        self,
        *,
        server: "JsonTcpServer",
        session: CamoufoxSession,
        mcp_bridge: PlaywrightMcpBridge,
    ) -> None:
        self.server = server
        self.session = session
        self.mcp_bridge = mcp_bridge
        self.lock = threading.Lock()

    def handle(self, request: Dict[str, Any]) -> Dict[str, Any]:
        action = str(request.get("action") or "").strip().lower()
        if not action:
            raise ValueError("missing action")

        with self.lock:
            if action == "ping":
                return {"ok": True, "result": {"alive": True, "pid": os.getpid()}}
            if action == "status":
                payload = self.session.status()
                mcp_status = self.mcp_bridge.status()
                if not payload.get("browserStarted") and mcp_status.get("endpointRunning"):
                    payload["browserStarted"] = True
                payload["mcp"] = mcp_status
                return {"ok": True, "result": payload | {"pid": os.getpid()}}
            if action == "ensure":
                self.mcp_bridge.stop()
                self.session.ensure_browser()
                return {"ok": True, "result": self.session.status() | {"pid": os.getpid()}}
            if action == "stop":
                self.session.close_browser()
                self.mcp_bridge.stop()
                return {"ok": True, "result": {"stopped": True, "pid": os.getpid()}}
            if action == "restart":
                self.session.close_browser()
                self.mcp_bridge.stop()
                self.session.ensure_browser()
                return {"ok": True, "result": self.session.status() | {"pid": os.getpid()}}
            if action == "navigate":
                self.mcp_bridge.stop()
                url = str(request.get("url") or "").strip()
                if not url:
                    raise ValueError("navigate requires url")
                wait_until = str(request.get("waitUntil") or "domcontentloaded").strip()
                timeout_ms = int(request.get("timeoutMs") or 30000)
                result = self.session.navigate(url=url, wait_until=wait_until, timeout_ms=timeout_ms)
                return {"ok": True, "result": result}
            if action == "snapshot":
                self.mcp_bridge.stop()
                max_chars = int(request.get("maxChars") or 6000)
                result = self.session.snapshot(max_chars=max(256, max_chars))
                return {"ok": True, "result": result}
            if action == "screenshot":
                self.mcp_bridge.stop()
                raw_path = str(request.get("path") or "").strip()
                if not raw_path:
                    raise ValueError("screenshot requires path")
                full_page = bool(request.get("fullPage", True))
                result = self.session.screenshot(path=Path(raw_path).expanduser(), full_page=full_page)
                return {"ok": True, "result": result}
            if action == "mcp_status":
                return {"ok": True, "result": self.mcp_bridge.status() | {"pid": os.getpid()}}
            if action == "mcp_tools":
                self.session.close_browser()
                timeout_ms = max(1000, int(request.get("timeoutMs") or 30000))
                tools_result = self.mcp_bridge.list_tools(timeout_ms=timeout_ms)
                tools = tools_result.get("tools")
                count = len(tools) if isinstance(tools, list) else 0
                return {
                    "ok": True,
                    "result": {
                        "pid": os.getpid(),
                        "count": count,
                        "tools": tools,
                    },
                }
            if action in MCP_TOOL_ACTIONS:
                self.session.close_browser()
                tool_args = request.get("toolArgs")
                if tool_args is None:
                    tool_args = {}
                if not isinstance(tool_args, dict):
                    raise ValueError(f"{action} requires toolArgs as JSON object")
                timeout_ms = max(1000, int(request.get("timeoutMs") or 60000))
                output = self.mcp_bridge.call_tool(
                    tool_name=action,
                    arguments=tool_args,
                    timeout_ms=timeout_ms,
                )
                return {
                    "ok": True,
                    "result": output,
                }
            if action == "mcp_stop":
                self.mcp_bridge.stop()
                return {"ok": True, "result": {"stopped": True, "pid": os.getpid()}}
            if action == "shutdown":
                self.session.close_browser()
                self.mcp_bridge.stop()
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return {"ok": True, "result": {"shutdown": True, "pid": os.getpid()}}

        raise ValueError(f"unsupported action: {action}")


class JsonHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:  # noqa: D401
        raw = self.rfile.readline()
        if not raw:
            return
        try:
            request = json.loads(raw.decode("utf-8"))
            if not isinstance(request, dict):
                raise ValueError("request must be a JSON object")
            response = self.server.app.handle(request)
        except Exception as err:  # noqa: BLE001
            response = {"ok": False, "error": str(err)}
        self.wfile.write((json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))


class JsonTcpServer(socketserver.TCPServer):
    allow_reuse_address = True
    app: CamoufoxApp


def acquire_single_instance_lock(runtime_dir: Path) -> tuple[Any, Path]:
    runtime_dir.mkdir(parents=True, exist_ok=True)
    lock_path = runtime_dir / "daemon.lock"
    lock_fp = open(lock_path, "a+", encoding="utf-8")
    try:
        fcntl.flock(lock_fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as err:
        raise RuntimeError(f"another daemon instance is already running ({err})") from err
    return lock_fp, lock_path


def write_pid_file(runtime_dir: Path) -> Path:
    pid_path = runtime_dir / "daemon.pid"
    pid_path.write_text(str(os.getpid()), encoding="utf-8")
    return pid_path


def cleanup_pid_file(pid_path: Path) -> None:
    try:
        pid_path.unlink(missing_ok=True)
    except Exception:
        pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Camoufox daemon for OpenClaw plugin tool")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=17888)
    parser.add_argument("--runtime-dir", default="~/.camoufox-claw/runtime")
    parser.add_argument("--user-data-dir", default="~/.camoufox-claw/profile")
    parser.add_argument("--target-os", choices=["windows", "macos", "linux"], default="macos")
    parser.add_argument("--window-width", type=int, default=1280)
    parser.add_argument("--window-height", type=int, default=800)
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument("--proxy-server", default="")
    parser.add_argument("--launch-timeout-ms", type=int, default=30000)
    parser.add_argument(
        "--playwright-mcp-bin",
        default="~/.camoufox-claw/playwright-mcp/node_modules/.bin/playwright-mcp",
    )
    parser.add_argument("--playwright-mcp-startup-timeout-ms", type=int, default=30000)
    parser.add_argument("--playwright-mcp-output-dir", default="~/.openclaw/media/camoufox-mcp")
    parser.add_argument("--exclude-ubo", dest="exclude_ubo", action="store_true")
    parser.add_argument("--allow-ubo", dest="exclude_ubo", action="store_false")
    parser.add_argument("--headless", dest="headless", action="store_true")
    parser.add_argument("--headed", dest="headless", action="store_false")
    parser.set_defaults(exclude_ubo=True, headless=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    runtime_dir = Path(args.runtime_dir).expanduser()
    user_data_dir = Path(args.user_data_dir).expanduser()
    playwright_mcp_bin = Path(str(args.playwright_mcp_bin)).expanduser()
    playwright_mcp_output_dir = Path(str(args.playwright_mcp_output_dir)).expanduser()
    target_os = str(args.target_os).strip().lower()
    window_size = (
        max(1, int(args.window_width)),
        max(1, int(args.window_height)),
    )
    locale = str(args.locale).strip() or "zh-CN"

    try:
        lock_fp, _lock_path = acquire_single_instance_lock(runtime_dir)
    except RuntimeError as err:
        print(str(err), file=sys.stderr)
        return 2

    pid_path = write_pid_file(runtime_dir)
    atexit.register(cleanup_pid_file, pid_path)

    def _cleanup_and_exit(_signum: int, _frame: Any) -> None:
        cleanup_pid_file(pid_path)
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _cleanup_and_exit)
    signal.signal(signal.SIGINT, _cleanup_and_exit)

    session = CamoufoxSession(
        user_data_dir=user_data_dir,
        headless=bool(args.headless),
        proxy_server=(str(args.proxy_server).strip() or None),
        exclude_ubo=bool(args.exclude_ubo),
        target_os=target_os,
        window_size=window_size,
        locale=locale,
        launch_timeout_ms=max(1000, int(args.launch_timeout_ms)),
    )
    mcp_bridge = PlaywrightMcpBridge(
        playwright_mcp_bin=playwright_mcp_bin,
        output_dir=playwright_mcp_output_dir,
        user_data_dir=user_data_dir,
        headless=bool(args.headless),
        proxy_server=(str(args.proxy_server).strip() or None),
        exclude_ubo=bool(args.exclude_ubo),
        target_os=target_os,
        window_size=window_size,
        locale=locale,
        startup_timeout_ms=max(1000, int(args.playwright_mcp_startup_timeout_ms)),
    )

    with JsonTcpServer((args.host, int(args.port)), JsonHandler) as server:
        server.app = CamoufoxApp(server=server, session=session, mcp_bridge=mcp_bridge)
        try:
            server.serve_forever(poll_interval=0.5)
        finally:
            mcp_bridge.stop()
            session.close_browser()
            cleanup_pid_file(pid_path)
            try:
                lock_fp.close()
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())

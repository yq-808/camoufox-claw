#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import selectors
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional

import orjson


def strip_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: strip_none(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [strip_none(v) for v in value if v is not None]
    return value


def terminate_process(proc: Optional[subprocess.Popen[Any]], timeout: float = 8.0) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=timeout)
    except Exception:
        proc.kill()
        proc.wait(timeout=timeout)


class CamoufoxEndpoint:
    def __init__(
        self,
        *,
        headless: bool,
        exclude_ubo: bool,
        proxy_server: Optional[str],
    ) -> None:
        self.headless = headless
        self.exclude_ubo = exclude_ubo
        self.proxy_server = proxy_server
        self.proc: Optional[subprocess.Popen[str]] = None
        self.launch_script_copy: Optional[Path] = None
        self.ws_endpoint: Optional[str] = None

    def _build_payload(self) -> str:
        from camoufox import DefaultAddons  # type: ignore
        from camoufox.server import to_camel_case_dict  # type: ignore
        from camoufox.utils import launch_options  # type: ignore

        launch_kwargs: Dict[str, Any] = {"headless": self.headless}
        if self.proxy_server:
            launch_kwargs["proxy"] = {"server": self.proxy_server}
        if self.exclude_ubo:
            launch_kwargs["exclude_addons"] = [DefaultAddons.UBO]

        options = strip_none(launch_options(**launch_kwargs))
        payload = orjson.dumps(to_camel_case_dict(options))
        return base64.b64encode(payload).decode("ascii")

    def start(self, timeout_seconds: float = 40.0) -> str:
        from camoufox.pkgman import LOCAL_DATA  # type: ignore
        from camoufox.server import get_nodejs  # type: ignore

        payload = self._build_payload()
        launch_script = LOCAL_DATA / "launchServer.js"
        if not launch_script.exists():
            raise RuntimeError(f"launchServer.js not found: {launch_script}")

        fd, copied_path = tempfile.mkstemp(prefix="camoufox-launch-", suffix=".cjs")
        os.close(fd)
        copied = Path(copied_path)
        copied.write_text(launch_script.read_text(encoding="utf-8"), encoding="utf-8")
        self.launch_script_copy = copied

        node_bin = get_nodejs()
        driver_pkg_dir = Path(node_bin).resolve().parent / "package"
        self.proc = subprocess.Popen(
            [node_bin, str(copied)],
            cwd=str(driver_pkg_dir),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert self.proc.stdin is not None
        self.proc.stdin.write(payload)
        self.proc.stdin.close()

        ws_pattern = re.compile(r"(ws://[^\s]+)")
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError("Camoufox Playwright endpoint process exited before websocket endpoint was ready")
            assert self.proc.stdout is not None
            line = self.proc.stdout.readline()
            if not line:
                time.sleep(0.1)
                continue
            match = ws_pattern.search(line)
            if match:
                self.ws_endpoint = match.group(1)
                return self.ws_endpoint
        raise RuntimeError("Timed out waiting for Camoufox websocket endpoint")

    def stop(self) -> None:
        terminate_process(self.proc)
        if self.launch_script_copy is not None:
            try:
                self.launch_script_copy.unlink(missing_ok=True)
            except Exception:
                pass
            self.launch_script_copy = None


class McpClient:
    def __init__(self, cmd: list[str]) -> None:
        self.cmd = cmd
        self.proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.selector = selectors.DefaultSelector()
        assert self.proc.stdout is not None
        assert self.proc.stderr is not None
        self.selector.register(self.proc.stdout, selectors.EVENT_READ)
        self.selector.register(self.proc.stderr, selectors.EVENT_READ)
        self.stderr_lines: list[str] = []

    def send(self, message: Dict[str, Any]) -> None:
        if self.proc.stdin is None:
            raise RuntimeError("MCP stdin is unavailable")
        self.proc.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def read_one(self, timeout_seconds: float) -> Dict[str, Any]:
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(
                    f"MCP process exited early with code {self.proc.returncode}; stderr={self._stderr_excerpt()}"
                )
            events = self.selector.select(timeout=0.5)
            for key, _ in events:
                stream = key.fileobj
                line = stream.readline()
                if not line:
                    continue
                text = line.strip()
                if not text:
                    continue
                if stream is self.proc.stderr:
                    self.stderr_lines.append(text)
                    continue
                try:
                    parsed = json.loads(text)
                except Exception:
                    continue
                if isinstance(parsed, dict):
                    return parsed
        raise TimeoutError(f"timed out waiting for MCP response; stderr={self._stderr_excerpt()}")

    def wait_response(self, request_id: int, timeout_seconds: float) -> Dict[str, Any]:
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            remaining = max(0.5, deadline - time.time())
            message = self.read_one(timeout_seconds=remaining)
            if message.get("id") == request_id:
                return message
        raise TimeoutError(f"timed out waiting for MCP response id={request_id}")

    def _stderr_excerpt(self, max_lines: int = 15) -> str:
        if not self.stderr_lines:
            return ""
        return " | ".join(self.stderr_lines[-max_lines:])

    def close(self) -> None:
        terminate_process(self.proc)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate Playwright MCP against a Camoufox remote endpoint (install-time deploy check)."
    )
    parser.add_argument("--playwright-mcp-bin", required=True, help="Absolute path to playwright-mcp executable")
    parser.add_argument("--test-url", default="https://example.com", help="URL used by browser_navigate")
    parser.add_argument("--headless", dest="headless", action="store_true")
    parser.add_argument("--headed", dest="headless", action="store_false")
    parser.add_argument("--exclude-ubo", dest="exclude_ubo", action="store_true")
    parser.add_argument("--allow-ubo", dest="exclude_ubo", action="store_false")
    parser.add_argument("--proxy-server", default="", help="Optional proxy, e.g. socks5://127.0.0.1:11080")
    parser.set_defaults(headless=True, exclude_ubo=True)
    return parser.parse_args()


def write_config(ws_endpoint: str) -> Path:
    fd, path = tempfile.mkstemp(prefix="playwright-mcp-camoufox-", suffix=".json")
    os.close(fd)
    config_path = Path(path)
    config_path.write_text(
        json.dumps(
            {
                "browser": {
                    "remoteEndpoint": ws_endpoint,
                }
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return config_path


def main() -> int:
    args = parse_args()
    mcp_bin = Path(args.playwright_mcp_bin).expanduser()
    if not mcp_bin.exists():
        print(json.dumps({"ok": False, "error": f"playwright-mcp binary not found: {mcp_bin}"}, ensure_ascii=False))
        return 1

    endpoint = CamoufoxEndpoint(
        headless=bool(args.headless),
        exclude_ubo=bool(args.exclude_ubo),
        proxy_server=(str(args.proxy_server).strip() or None),
    )
    client: Optional[McpClient] = None
    config_path: Optional[Path] = None
    try:
        ws_endpoint = endpoint.start()
        config_path = write_config(ws_endpoint)

        client = McpClient([str(mcp_bin), "--config", str(config_path), "--headless"])
        client.send(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "clientInfo": {"name": "camoufox-claw-deploy", "version": "0.1.0"},
                    "capabilities": {},
                },
            }
        )
        init_resp = client.wait_response(1, timeout_seconds=30)
        if init_resp.get("error"):
            raise RuntimeError(f"MCP initialize failed: {init_resp['error']}")

        client.send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})
        client.send({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        list_resp = client.wait_response(2, timeout_seconds=30)
        if list_resp.get("error"):
            raise RuntimeError(f"MCP tools/list failed: {list_resp['error']}")
        tools = list_resp.get("result", {}).get("tools", [])
        if not isinstance(tools, list) or not tools:
            raise RuntimeError("MCP tools/list returned no tools")

        client.send(
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "browser_navigate", "arguments": {"url": args.test_url}},
            }
        )
        call_resp = client.wait_response(3, timeout_seconds=60)
        if call_resp.get("error"):
            raise RuntimeError(f"MCP tools/call browser_navigate failed: {call_resp['error']}")

        print(
            json.dumps(
                {
                    "ok": True,
                    "wsEndpoint": ws_endpoint,
                    "toolCount": len(tools),
                    "navigatedUrl": args.test_url,
                },
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as err:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(err)}, ensure_ascii=False))
        return 1
    finally:
        if client is not None:
            client.close()
        endpoint.stop()
        if config_path is not None:
            try:
                config_path.unlink(missing_ok=True)
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())

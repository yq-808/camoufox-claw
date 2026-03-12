#!/usr/bin/env python3
from __future__ import annotations

import argparse
import atexit
import base64
import fcntl
import json
import os
import queue
import random
import re
import signal
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
from math import asin, atan2, cos, degrees, radians, sin, tau
from pathlib import Path
from typing import Any, Dict, Optional

DEFAULT_TIMEZONE = "Asia/Shanghai"
DEFAULT_GEO_ACCURACY = 35
PROXY_OPTION_KEYS = {"proxy", "proxyServer"}
SHENZHEN_BASE_LAT = 22.5431
SHENZHEN_BASE_LON = 114.0579
SHENZHEN_DISTANCE_KM_MIN = 4.0
SHENZHEN_DISTANCE_KM_MAX = 6.0
EARTH_RADIUS_KM = 6371.0088


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


def strip_proxy_options(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: strip_proxy_options(item)
            for key, item in value.items()
            if key not in PROXY_OPTION_KEYS
        }
    if isinstance(value, list):
        return [strip_proxy_options(item) for item in value]
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


def random_geolocation_near_shenzhen() -> tuple[float, float]:
    distance_km = random.uniform(SHENZHEN_DISTANCE_KM_MIN, SHENZHEN_DISTANCE_KM_MAX)
    bearing = random.uniform(0.0, tau)

    lat1 = radians(SHENZHEN_BASE_LAT)
    lon1 = radians(SHENZHEN_BASE_LON)
    angular_distance = distance_km / EARTH_RADIUS_KM

    lat2 = asin(
        sin(lat1) * cos(angular_distance)
        + cos(lat1) * sin(angular_distance) * cos(bearing)
    )
    lon2 = lon1 + atan2(
        sin(bearing) * sin(angular_distance) * cos(lat1),
        cos(angular_distance) - sin(lat1) * sin(lat2),
    )

    return round(degrees(lat2), 6), round(degrees(lon2), 6)


class CamoufoxEndpointManager:
    def __init__(
        self,
        *,
        runtime_dir: Path,
        user_data_dir: Path,
        headless: bool,
        proxy_server: Optional[str],
        exclude_ubo: bool,
        target_os: str,
        window_size: tuple[int, int],
        locale: str,
        startup_timeout_ms: int,
    ) -> None:
        self.runtime_dir = runtime_dir
        self.identity_path = runtime_dir / "identity.json"
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

    def status(self) -> Dict[str, Any]:
        endpoint_running = bool(self.endpoint_proc and self.endpoint_proc.poll() is None)
        return {
            "browserStarted": endpoint_running,
            "endpointRunning": endpoint_running,
            "wsEndpoint": self.endpoint_ws,
            "identityPath": str(self.identity_path),
            "identityExists": self.identity_path.exists(),
            "userDataDir": str(self.user_data_dir),
            "headless": self.headless,
            "proxyServer": self.proxy_server,
            "targetOs": self.target_os,
            "window": {"width": self.window_size[0], "height": self.window_size[1]},
            "locale": self.locale,
        }

    def stop(self) -> None:
        terminate_process(self.endpoint_proc)
        self.endpoint_proc = None
        if self.endpoint_script_copy is not None:
            try:
                self.endpoint_script_copy.unlink(missing_ok=True)
            except Exception:
                pass
            self.endpoint_script_copy = None
        self.endpoint_ws = None

    def ensure_endpoint(self) -> Dict[str, Any]:
        endpoint = self._ensure_endpoint()
        return {
            "wsEndpoint": endpoint,
            "endpointRunning": bool(self.endpoint_proc and self.endpoint_proc.poll() is None),
        }

    def _ensure_endpoint(self) -> str:
        if self.endpoint_proc is not None and self.endpoint_proc.poll() is None and self.endpoint_ws:
            return self.endpoint_ws

        self.stop()

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
        if self.exclude_ubo:
            launch_kwargs["exclude_addons"] = [DefaultAddons.UBO]

        self.user_data_dir.mkdir(parents=True, exist_ok=True)
        self.identity_path.parent.mkdir(parents=True, exist_ok=True)

        payload_options: Dict[str, Any]
        if self.identity_path.exists():
            try:
                loaded = json.loads(self.identity_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict) and loaded:
                    loaded_without_none = strip_none(loaded)
                    payload_options = strip_proxy_options(loaded_without_none)
                    if payload_options != loaded_without_none:
                        self.identity_path.write_text(
                            json.dumps(payload_options, ensure_ascii=False, indent=2),
                            encoding="utf-8",
                        )
                else:
                    raise ValueError("identity.json must be a non-empty JSON object")
            except Exception as err:  # noqa: BLE001
                print(
                    f"failed to load identity snapshot {self.identity_path}: {err}; regenerating",
                    file=sys.stderr,
                )
                payload_options = {}
        else:
            payload_options = {}

        if not payload_options:
            lat, lon = random_geolocation_near_shenzhen()  # nosec: intended non-crypto randomization
            launch_kwargs["config"] = {
                "timezone": DEFAULT_TIMEZONE,
                "geolocation:latitude": lat,
                "geolocation:longitude": lon,
                "geolocation:accuracy": DEFAULT_GEO_ACCURACY,
                "locale:language": "zh",
                "locale:region": "CN",
            }
            launch_kwargs["i_know_what_im_doing"] = True
            options = strip_none(launch_options(**launch_kwargs))
            payload_options = strip_proxy_options(to_camel_case_dict(options))
            payload_options["_userDataDir"] = str(self.user_data_dir)
            payload_options["_sharedBrowser"] = True
            self.identity_path.write_text(
                json.dumps(payload_options, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(
                f"created identity snapshot {self.identity_path} with lat={lat}, lon={lon}",
                file=sys.stderr,
            )
        else:
            payload_options = strip_proxy_options(payload_options)
            payload_options["_userDataDir"] = str(self.user_data_dir)
            payload_options["_sharedBrowser"] = True

        payload_runtime_options = dict(payload_options)
        if self.proxy_server:
            payload_runtime_options["proxy"] = {"server": self.proxy_server}
        payload = base64.b64encode(orjson.dumps(payload_runtime_options)).decode("ascii")

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
        self.stop()
        raise RuntimeError(f"timed out waiting for camoufox endpoint ws url; logs={excerpt}")


class CamoufoxApp:
    def __init__(self, *, server: "JsonTcpServer", endpoint_manager: CamoufoxEndpointManager) -> None:
        self.server = server
        self.endpoint_manager = endpoint_manager
        self.lock = threading.Lock()

    def handle(self, request: Dict[str, Any]) -> Dict[str, Any]:
        action = str(request.get("action") or "").strip().lower()
        if not action:
            raise ValueError("missing action")

        with self.lock:
            if action == "ping":
                return {"ok": True, "result": {"alive": True, "pid": os.getpid()}}
            if action == "status":
                return {"ok": True, "result": self.endpoint_manager.status() | {"pid": os.getpid()}}
            if action == "ensure":
                self.endpoint_manager.ensure_endpoint()
                return {"ok": True, "result": self.endpoint_manager.status() | {"pid": os.getpid()}}
            if action == "stop":
                self.endpoint_manager.stop()
                return {"ok": True, "result": {"stopped": True, "pid": os.getpid()}}
            if action == "restart":
                self.endpoint_manager.stop()
                self.endpoint_manager.ensure_endpoint()
                return {"ok": True, "result": self.endpoint_manager.status() | {"pid": os.getpid()}}
            if action == "endpoint_ensure":
                endpoint_result = self.endpoint_manager.ensure_endpoint()
                return {"ok": True, "result": endpoint_result | {"pid": os.getpid()}}
            if action == "shutdown":
                self.endpoint_manager.stop()
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
    parser.add_argument("--endpoint-startup-timeout-ms", type=int, default=30000)
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
    target_os = str(args.target_os).strip().lower()
    window_size = (max(1, int(args.window_width)), max(1, int(args.window_height)))
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

    endpoint_manager = CamoufoxEndpointManager(
        runtime_dir=runtime_dir,
        user_data_dir=user_data_dir,
        headless=bool(args.headless),
        proxy_server=(str(args.proxy_server).strip() or None),
        exclude_ubo=bool(args.exclude_ubo),
        target_os=target_os,
        window_size=window_size,
        locale=locale,
        startup_timeout_ms=max(1000, int(args.endpoint_startup_timeout_ms)),
    )

    with JsonTcpServer((args.host, int(args.port)), JsonHandler) as server:
        server.app = CamoufoxApp(server=server, endpoint_manager=endpoint_manager)
        try:
            server.serve_forever(poll_interval=0.5)
        finally:
            endpoint_manager.stop()
            cleanup_pid_file(pid_path)
            try:
                lock_fp.close()
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


APP_ID = "steambooster-linux"
SERVICE = "steambooster-launcher.service"


@dataclass(frozen=True)
class Layout:
    home: Path
    config_home: Path
    data_home: Path
    bin_home: Path
    install_root: Path

    @classmethod
    def current(cls) -> "Layout":
        home = Path.home()
        config_home = Path(os.environ.get("XDG_CONFIG_HOME", home / ".config"))
        data_home = Path(os.environ.get("XDG_DATA_HOME", home / ".local" / "share"))
        return cls(home, config_home, data_home, home / ".local" / "bin", data_home / APP_ID)


def write_text(path: Path, content: str, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(mode)


def run(command: Sequence[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(list(command), text=True, capture_output=True, check=check)


def command_path(name: str, fallbacks: Sequence[str] = ()) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    return next((path for path in fallbacks if Path(path).is_file()), None)


def validate_dependencies() -> dict[str, str]:
    if platform.system() != "Linux" or platform.machine().lower() not in {"x86_64", "amd64"}:
        raise RuntimeError("Поддерживается только Linux x86_64.")
    node = command_path("node")
    curl = command_path("curl")
    systemctl = command_path("systemctl")
    steam = command_path("steam", ("/usr/bin/steam", "/usr/games/steam"))
    missing = [name for name, value in (("node", node), ("curl", curl), ("systemctl", systemctl), ("steam", steam)) if not value]
    if node:
        version = run([node, "--version"]).stdout.strip().lstrip("v").split(".", 1)[0]
        if not version.isdigit() or int(version) < 22:
            missing.append("node >= 22")
    if importlib.util.find_spec("PyQt6") is None:
        missing.append("Python PyQt6")
    if missing:
        joined = ", ".join(missing)
        raise RuntimeError(
            f"Не найдены зависимости: {joined}.\n"
            "Arch/CachyOS: sudo pacman -S nodejs python-pyqt6 curl steam\n"
            "Ubuntu/Debian: sudo apt install nodejs python3-pyqt6 curl steam-installer"
        )
    return {"node": node, "curl": curl, "systemctl": systemctl, "steam": steam}


def render_launcher(layout: Layout, tools: dict[str, str]) -> str:
    source = layout.install_root / "source"
    launcher = source / "booster-framework" / "linux-launcher"
    framework = source / "booster-framework" / "out" / "booster-framework.js"
    checkout = source / "steambooster-plugins" / "packages" / "booster-checkout" / "out" / "booster-checkout.js"
    addfunds = source / "steambooster-plugins" / "packages" / "booster-addfunds" / "out" / "booster-addfunds.js"
    rateaccount = source / "steambooster-plugins" / "packages" / "booster-rateaccount" / "out" / "booster-rateaccount.js"
    return f"""#!/usr/bin/env bash
set -euo pipefail
CDP_PORT="${{SB_CDP_PORT:-8080}}"
until {shlex.quote(tools['curl'])} -fsS "http://127.0.0.1:${{CDP_PORT}}/json/version" >/dev/null 2>&1; do sleep 2; done
cd {shlex.quote(str(launcher))}
exec {shlex.quote(tools['node'])} dist/index.js -w -p "$CDP_PORT" -f {shlex.quote(str(framework))} -d {shlex.quote(str(checkout))} -d {shlex.quote(str(addfunds))} -d {shlex.quote(str(rateaccount))}
"""


def render_steam_wrapper(tools: dict[str, str]) -> str:
    return f"""#!/usr/bin/env bash
set -euo pipefail
CDP_PORT="${{SB_CDP_PORT:-8080}}"
if pgrep -a steam 2>/dev/null | grep -qE "remote-debugging-port=${{CDP_PORT}}"; then
  {shlex.quote(tools['systemctl'])} --user start {SERVICE}
  exec {shlex.quote(tools['steam'])} "$@"
fi
if pgrep -x steam >/dev/null 2>&1; then
  echo "Steam уже запущен без CDP. Завершите Steam вручную и запустите SteamBooster снова." >&2
  exit 1
fi
{shlex.quote(tools['steam'])} -cef-enable-debugging "--remote-debugging-port=${{CDP_PORT}}" "$@" &
{shlex.quote(tools['systemctl'])} --user start {SERVICE}
"""


def render_service(layout: Layout) -> str:
    launcher = layout.bin_home / "steambooster-launcher-only"
    log = layout.install_root / "docs" / "artifacts" / "logs" / "launcher.log"
    return f"""[Unit]
Description=SteamBooster Linux launcher
After=network-online.target

[Service]
Type=simple
ExecStart=\"{launcher}\"
Restart=on-failure
RestartSec=3s
KillMode=process
StandardOutput=append:{log}
StandardError=append:{log}

[Install]
WantedBy=default.target
"""


def render_desktop(layout: Layout) -> str:
    return f"""[Desktop Entry]
Type=Application
Name=SteamBooster
Comment=Steam with Booster checkout and recovery tray
Comment[ru_RU]=Steam с пополнением Booster и восстановлением через трей
Exec=\"{layout.bin_home / 'steambooster-steam'}\" %U
Icon=steam
Terminal=false
Categories=Game;
MimeType=x-scheme-handler/steam;x-scheme-handler/steamlink;
Keywords=Steam;Booster;Games;
StartupNotify=false
"""


def render_tray_autostart(layout: Layout) -> str:
    tray = layout.install_root / "source" / "booster-framework" / "linux-tray" / "run-tray.py"
    return f"""[Desktop Entry]
Type=Application
Name=SteamBooster Tray
Exec=\"{sys.executable}\" \"{tray}\"
Icon=steam
Terminal=false
X-GNOME-Autostart-enabled=true
X-KDE-autostart-after=panel
"""


def render_steam_autostart(layout: Layout) -> str:
    return f"""[Desktop Entry]
Type=Application
Name=SteamBooster Steam bootstrap
Exec=\"{layout.bin_home / 'steambooster-steam'}\"
Icon=steam
Terminal=false
X-GNOME-Autostart-enabled=true
"""


def integration_enabled() -> bool:
    return os.environ.get("SB_SKIP_INTEGRATION") != "1"


def install(bundle_root: Path) -> None:
    layout = Layout.current()
    tools = ({"node": "node", "curl": "curl", "systemctl": "systemctl", "steam": "steam"}
             if os.environ.get("SB_SKIP_DEPENDENCY_CHECK") == "1" else validate_dependencies())
    payload = bundle_root / "payload"
    if not payload.is_dir():
        raise RuntimeError(f"Не найден payload: {payload}")

    if layout.install_root.exists():
        shutil.rmtree(layout.install_root)
    shutil.copytree(payload, layout.install_root)
    (layout.install_root / "docs" / "artifacts" / "logs").mkdir(parents=True, exist_ok=True)

    layout.bin_home.mkdir(parents=True, exist_ok=True)
    write_text(layout.bin_home / "steambooster-launcher-only", render_launcher(layout, tools), 0o755)
    write_text(layout.bin_home / "steambooster-steam", render_steam_wrapper(tools), 0o755)
    installed_uninstaller = layout.install_root / "uninstall.sh"
    installed_renderer = layout.install_root / "scripts" / "render_install.py"
    installed_renderer.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(bundle_root / "uninstall.sh", installed_uninstaller)
    shutil.copy2(bundle_root / "scripts" / "render_install.py", installed_renderer)
    installed_uninstaller.chmod(0o755)
    write_text(
        layout.bin_home / "steambooster-uninstall",
        f"#!/usr/bin/env bash\nexec {shlex.quote(str(installed_uninstaller))}\n",
        0o755,
    )

    write_text(layout.config_home / "systemd" / "user" / SERVICE, render_service(layout))
    write_text(layout.config_home / "autostart" / "steambooster-tray.desktop", render_tray_autostart(layout))
    write_text(layout.config_home / "autostart" / "steambooster-steam.desktop", render_steam_autostart(layout))
    write_text(layout.data_home / "applications" / "steambooster.desktop", render_desktop(layout))

    if integration_enabled():
        run([tools["systemctl"], "--user", "daemon-reload"])
        run([tools["systemctl"], "--user", "enable", "--now", SERVICE])
        xdg_mime = shutil.which("xdg-mime")
        if xdg_mime:
            run([xdg_mime, "default", "steambooster.desktop", "x-scheme-handler/steam"])
            run([xdg_mime, "default", "steambooster.desktop", "x-scheme-handler/steamlink"])
        refresh = shutil.which("kbuildsycoca6")
        if refresh:
            run([refresh, "--noincremental"], check=False)
    print(f"SteamBooster установлен в {layout.install_root}")
    print("Ярлык добавлен в Games/Игры. Перезапустите Steam через SteamBooster.")


def uninstall() -> None:
    layout = Layout.current()
    if integration_enabled():
        systemctl = command_path("systemctl")
        if systemctl:
            run([systemctl, "--user", "disable", "--now", SERVICE], check=False)
    owned = (
        layout.bin_home / "steambooster-steam",
        layout.bin_home / "steambooster-launcher-only",
        layout.bin_home / "steambooster-uninstall",
        layout.config_home / "systemd" / "user" / SERVICE,
        layout.config_home / "autostart" / "steambooster-tray.desktop",
        layout.config_home / "autostart" / "steambooster-steam.desktop",
        layout.data_home / "applications" / "steambooster.desktop",
    )
    for path in owned:
        path.unlink(missing_ok=True)
    if layout.install_root.exists():
        shutil.rmtree(layout.install_root)
    if integration_enabled():
        systemctl = command_path("systemctl")
        if systemctl:
            run([systemctl, "--user", "daemon-reload"], check=False)
    print("SteamBooster удалён. Steam и пользовательские данные Steam не изменялись.")


def main() -> int:
    parser = argparse.ArgumentParser(description="SteamBooster Linux user installer")
    parser.add_argument("action", choices=("install", "uninstall"))
    parser.add_argument("--bundle-root", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.action == "install":
            install(args.bundle_root.resolve())
        else:
            uninstall()
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

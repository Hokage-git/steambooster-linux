#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence


CommandRunner = Callable[[Sequence[str]], None]


@dataclass(frozen=True)
class InstallerLayout:
    home: Path
    config_home: Path
    data_home: Path
    bin_home: Path

    @classmethod
    def from_environment(cls) -> "InstallerLayout":
        home = Path.home()
        return cls(
            home=home,
            config_home=Path(os.environ.get("XDG_CONFIG_HOME", home / ".config")),
            data_home=Path(os.environ.get("XDG_DATA_HOME", home / ".local" / "share")),
            bin_home=home / ".local" / "bin",
        )


def render_service(layout: InstallerLayout, workspace: Path) -> str:
    launcher = layout.bin_home / "steambooster-launcher-only"
    log = workspace / "docs" / "artifacts" / "logs" / "launcher.log"
    return f"""[Unit]
Description=SteamBooster Linux launcher
After=network-online.target

[Service]
Type=simple
ExecStart={launcher}
Restart=on-failure
RestartSec=3s
KillMode=process
StandardOutput=append:{log}
StandardError=append:{log}

[Install]
WantedBy=default.target
"""


def render_application_desktop(layout: InstallerLayout) -> str:
    wrapper = layout.bin_home / "steambooster-steam"
    return f"""[Desktop Entry]
Type=Application
Name=SteamBooster
Name[ru_RU]=SteamBooster
Comment=Steam with Booster checkout and recovery tray
Comment[ru_RU]=Steam с пополнением Booster и восстановлением через трей
Exec={wrapper} %U
Icon=steam
Terminal=false
Categories=Game;
MimeType=x-scheme-handler/steam;x-scheme-handler/steamlink;
Keywords=Steam;Booster;Games;
Keywords[ru_RU]=Steam;Booster;Игры;Пополнить;
StartupNotify=false
"""


def render_tray_autostart(tray_root: Path) -> str:
    return f"""[Desktop Entry]
Type=Application
Name=SteamBooster Tray
Name[ru_RU]=SteamBooster — трей
Exec=/usr/bin/python {tray_root / 'run-tray.py'}
Icon=steam
Terminal=false
OnlyShowIn=KDE;
X-KDE-autostart-after=panel
X-GNOME-Autostart-enabled=true
"""


def render_steam_autostart(layout: InstallerLayout) -> str:
    return f"""[Desktop Entry]
Type=Application
Name=SteamBooster Steam bootstrap
Name[ru_RU]=Запуск SteamBooster
Exec={layout.bin_home / 'steambooster-steam'}
Icon=steam
Terminal=false
X-GNOME-Autostart-enabled=true
"""


def run_command(command: Sequence[str]) -> None:
    subprocess.run(list(command), check=True)


def _write(path: Path, content: str, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(mode)


def _disable_legacy_steam_autostart(layout: InstallerLayout) -> None:
    legacy = layout.config_home / "autostart" / "steam.desktop"
    if not legacy.is_file():
        return
    lines = [
        line
        for line in legacy.read_text(encoding="utf-8").splitlines()
        if not line.startswith("Hidden=")
        and not line.startswith("X-GNOME-Autostart-enabled=")
    ]
    try:
        desktop_header = lines.index("[Desktop Entry]")
    except ValueError:
        return
    lines[desktop_header + 1:desktop_header + 1] = [
        "Hidden=true",
        "X-GNOME-Autostart-enabled=false",
    ]
    _write(legacy, "\n".join(lines) + "\n")


def install_files(
    layout: InstallerLayout,
    workspace: Path,
    tray_root: Path,
    runner: CommandRunner = run_command,
) -> None:
    layout.bin_home.mkdir(parents=True, exist_ok=True)
    for name in ("steambooster-steam", "steambooster-launcher-only"):
        destination = layout.bin_home / name
        shutil.copy2(tray_root / "bin" / name, destination)
        destination.chmod(0o755)

    log_dir = workspace / "docs" / "artifacts" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    _write(
        layout.config_home / "systemd" / "user" / "steambooster-launcher.service",
        render_service(layout, workspace),
    )
    _write(
        layout.config_home / "autostart" / "steambooster-tray.desktop",
        render_tray_autostart(tray_root),
    )
    _write(
        layout.config_home / "autostart" / "steambooster-steam.desktop",
        render_steam_autostart(layout),
    )
    _write(
        layout.data_home / "applications" / "steambooster.desktop",
        render_application_desktop(layout),
    )
    _disable_legacy_steam_autostart(layout)

    runner(["systemctl", "--user", "daemon-reload"])
    runner(["systemctl", "--user", "enable", "--now", "steambooster-launcher.service"])
    runner(["xdg-mime", "default", "steambooster.desktop", "x-scheme-handler/steam"])
    runner(["xdg-mime", "default", "steambooster.desktop", "x-scheme-handler/steamlink"])
    desktop_refresh = shutil.which("kbuildsycoca6")
    if desktop_refresh:
        runner([desktop_refresh, "--noincremental"])


def main() -> int:
    tray_root = Path(__file__).resolve().parent
    workspace = tray_root.parents[2]
    layout = InstallerLayout.from_environment()
    install_files(layout, workspace, tray_root)
    print(f"SteamBooster установлен: {layout.data_home / 'applications' / 'steambooster.desktop'}")
    print("Ярлык добавлен в системную категорию Games/Игры.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

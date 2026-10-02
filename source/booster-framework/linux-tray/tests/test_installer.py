import tempfile
import unittest
from pathlib import Path

from installer import InstallerLayout, install_files, render_application_desktop, render_service


class FakeRunner:
    def __init__(self):
        self.commands = []

    def __call__(self, command):
        self.commands.append(tuple(command))


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.home = root / "home"
        self.workspace = root / "Documents" / "SteamBooster"
        self.tray_root = self.workspace / "source" / "booster-framework" / "linux-tray"
        (self.tray_root / "bin").mkdir(parents=True)
        (self.tray_root / "bin" / "steambooster-steam").write_text("#!/bin/bash\n")
        (self.tray_root / "bin" / "steambooster-launcher-only").write_text("#!/bin/bash\n")
        (self.tray_root / "run-tray.py").write_text("#!/usr/bin/env python3\n")
        self.layout = InstallerLayout(
            home=self.home,
            config_home=self.home / ".config",
            data_home=self.home / ".local" / "share",
            bin_home=self.home / ".local" / "bin",
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_application_entry_is_added_to_games_category(self):
        desktop = render_application_desktop(self.layout)
        self.assertIn("Name=SteamBooster", desktop)
        self.assertIn("Categories=Game;", desktop)
        self.assertIn(str(self.layout.bin_home / "steambooster-steam"), desktop)
        self.assertIn("x-scheme-handler/steam", desktop)

    def test_service_uses_launcher_only_entrypoint(self):
        service = render_service(self.layout, self.workspace)
        self.assertIn(str(self.layout.bin_home / "steambooster-launcher-only"), service)
        self.assertNotIn("ExecStart=" + str(self.layout.bin_home / "steambooster-steam"), service)
        self.assertIn("KillMode=process", service)

    def test_install_is_idempotent_and_registers_user_service(self):
        runner = FakeRunner()
        legacy = self.layout.config_home / "autostart" / "steam.desktop"
        legacy.parent.mkdir(parents=True)
        legacy.write_text("[Desktop Entry]\nType=Application\nExec=/usr/bin/steam\n")
        install_files(self.layout, self.workspace, self.tray_root, runner)
        install_files(self.layout, self.workspace, self.tray_root, runner)

        self.assertTrue((self.layout.data_home / "applications" / "steambooster.desktop").is_file())
        desktop = (self.layout.data_home / "applications" / "steambooster.desktop").read_text()
        self.assertIn("Categories=Game;", desktop)
        self.assertTrue((self.layout.bin_home / "steambooster-steam").stat().st_mode & 0o100)
        self.assertTrue((self.layout.config_home / "autostart" / "steambooster-tray.desktop").is_file())
        self.assertIn(
            ("systemctl", "--user", "enable", "--now", "steambooster-launcher.service"),
            runner.commands,
        )
        self.assertIn("Hidden=true", legacy.read_text())
        self.assertIn(
            ("xdg-mime", "default", "steambooster.desktop", "x-scheme-handler/steam"),
            runner.commands,
        )


if __name__ == "__main__":
    unittest.main()
